

/* ============================= SINCRONIZAÇÃO EM NUVEM (Supabase) =============================
   Conexão fixa no código — nenhum aparelho precisa ser configurado manualmente.

   O banco NÃO guarda mais tudo como um único JSON compartilhado. Cada vendedor tem suas próprias
   linhas nas tabelas normalizadas (vendas, propostas, salarios, banco_vw, clientes) e seu próprio
   estado de trabalho (vendedor_estado) — tudo protegido por RLS no Postgres usando o UUID do
   usuário autenticado: um vendedor comum só lê/grava as PRÓPRIAS linhas, o admin lê/grava todas.
   O que é da loja inteira (config, política de preços do Gerente Smart, feriados, etc.) mora em
   loja_estado, visível a qualquer perfil ativo — igual ao crm_estado de antes.

   Esta camada só existe para popular/gravar o objeto `state` (usado por todo o resto do app,
   sem mudanças) a partir dessas tabelas — o formato de `state` em memória continua o mesmo.

   IMPORTANTE (diffing real, não reenvio cego): cada persist() só envia ao banco as linhas cujo
   conteúdo realmente mudou desde o último save — nunca reenvia tudo de novo. Isso existe porque
   um upsert em massa de linhas IDÊNTICAS ainda dispara evento de mudança em tempo real pra cada
   linha; reenviar tudo a cada save gerava muito mais ecos do que o contador de "ignorar eco"
   esperava, e o excedente virava um recarregamento completo no meio de uma gravação ainda em
   voo — podendo "ressuscitar" um registro que acabara de ser excluído (ele reaparecia até depois
   de dar F5, porque o DELETE original nunca chegava a ser reenviado depois da corrida).
================================================================================================ */
const SUPABASE_URL = "https://eqpuafjokwzsemscwjij.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxcHVhZmpva3d6c2Vtc2N3amlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5OTU5NzQsImV4cCI6MjEwMTU3MTk3NH0.7t-Z29rZ9RARZ2CVFWWwHMZUo12PZS1WAClYF27daDk";
const WORKSPACE_ID = "loja1";

let supabaseClient = null;
let nuvemAssinaturaAtiva = false;
// Contador (não booleano): cada save calcula exatamente quantas linhas vai tocar (ver
// totalOperacoes em syncEstadoNuvem) e soma esse número aqui antes de disparar as gravações —
// cada eco em tempo real da própria gravação decrementa o contador; o timeout zera tudo sozinho
// como rede de segurança (evita travar recepção de mudanças de outro vendedor se algum eco não
// chegar por algum motivo).
let ignorarProximosEventosRemotos = 0;
let ignorarEventosRemotosTimer = null;
let precisaReenviar = false;
let retentativaTimer = null;

const TABELAS_COLECAO = { vendas:"vendas", propostas:"propostas", salarios:"salarios", bancoVW:"banco_vw", clientes:"clientes" };

// Snapshot do que já está confirmado no banco, por coleção: Map(id -> assinatura do conteúdo).
// Usado tanto para saber o que precisa ser DELETADO (id que sumiu do array local) quanto o que
// precisa ser reenviado (assinatura mudou) — um item que não mudou não gera upsert nenhum.
let _snapshotSincronizado = {
  vendas:new Map(), propostas:new Map(), salarios:new Map(), bancoVW:new Map(), clientes:new Map(),
  vendedorEstadoProprio: null, lojaEstado: null,
};

function statusNuvem(texto, classe){
  const a = document.getElementById("saveStatus");
  if (a){ a.textContent = texto; a.className = classe; }
}

function iniciarClienteNuvem(){
  if (!window.supabase) { supabaseClient = null; return false; }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

// {} (vindo do banco pra um vendedor sem dado ainda) precisa virar null pra que os "||
// {defaults}" espalhados pelo app (inicializarEstadoGerente, inicializarEstadoBancoVW,
// metasDoVendedorAtual) continuem preenchendo os valores-padrão como sempre fizeram.
function objetoVazioParaNulo(obj){
  return (obj && typeof obj==="object" && Object.keys(obj).length>0) ? obj : null;
}

function linhaParaRegistro(row){
  return { ...(row.dados||{}), id: row.id, vendedorId: row.vendedor_id };
}
function registroParaLinha(item){
  const { id, vendedorId, ...resto } = item;
  return { id: String(id), vendedor_id: vendedorId, dados: resto, atualizado_em: new Date().toISOString() };
}
function assinaturaLinha(linha){
  return linha.vendedor_id + "|" + JSON.stringify(linha.dados);
}

async function carregarColecao(tabelaSql){
  const { data, error } = await supabaseClient.from(tabelaSql).select("id, vendedor_id, dados");
  if (error) throw error;
  return (data||[]).map(linhaParaRegistro);
}

function popularSnapshotColecao(mapa, itens){
  mapa.clear();
  itens.forEach(item=>{ mapa.set(String(item.id), assinaturaLinha(registroParaLinha(item))); });
}

// vendedor_estado: vendedor comum só recebe a própria linha (RLS já filtra); admin recebe todas
// (necessário pra "ver todos" no painel diário/Instagram continuar funcionando como antes).
async function carregarVendedorEstadoTodos(uid, isAdmin){
  let query = supabaseClient.from("vendedor_estado").select("vendedor_id, dados");
  if (!isAdmin) query = query.eq("vendedor_id", uid);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function carregarEstadoNuvem(){
  if (!supabaseClient) return;
  statusNuvem("🟡 Carregando dados do banco…", "pending");
  try{
    const uid = currentVendedorPerfil && currentVendedorPerfil.id;
    const isAdmin = !!(currentVendedorPerfil && currentVendedorPerfil.isAdmin);

    const [vendas, propostas, salarios, bancoVW, clientes, lojaRes, vendedorRows] = await Promise.all([
      carregarColecao(TABELAS_COLECAO.vendas),
      carregarColecao(TABELAS_COLECAO.propostas),
      carregarColecao(TABELAS_COLECAO.salarios),
      carregarColecao(TABELAS_COLECAO.bancoVW),
      carregarColecao(TABELAS_COLECAO.clientes),
      supabaseClient.from("loja_estado").select("dados").eq("id", WORKSPACE_ID).maybeSingle(),
      uid ? carregarVendedorEstadoTodos(uid, isAdmin) : Promise.resolve([]),
    ]);

    popularSnapshotColecao(_snapshotSincronizado.vendas, vendas);
    popularSnapshotColecao(_snapshotSincronizado.propostas, propostas);
    popularSnapshotColecao(_snapshotSincronizado.salarios, salarios);
    popularSnapshotColecao(_snapshotSincronizado.bancoVW, bancoVW);
    popularSnapshotColecao(_snapshotSincronizado.clientes, clientes);

    const loja = (lojaRes && lojaRes.data && lojaRes.data.dados) || {};
    const meuRow = vendedorRows.find(r=>r.vendedor_id===uid);
    const meu = (meuRow && meuRow.dados) || {};
    _snapshotSincronizado.vendedorEstadoProprio = meuRow ? JSON.stringify(meu) : null;
    _snapshotSincronizado.lojaEstado = (lojaRes && lojaRes.data) ? JSON.stringify(loja) : null;

    const dias = {}, ponto = {}, humor = {}, metasPorVendedor = {};
    vendedorRows.forEach(r=>{
      const d = r.dados || {};
      dias[r.vendedor_id] = d.dias || {};
      ponto[r.vendedor_id] = d.ponto || {};
      humor[r.vendedor_id] = d.humor || {};
      // "metas" precisa ser null/ausente (não {}) quando o vendedor ainda não configurou a
      // própria — metasDoVendedorAtual() só preenche os valores-padrão (meta de vendas, comissão
      // etc.) quando o campo é falsy; um objeto vazio passaria despercebido e ficaria sem defaults.
      metasPorVendedor[r.vendedor_id] = objetoVazioParaNulo(d.metas);
    });

    state = {
      config: loja.config || {},
      vendas, propostas, salarios, bancoVW, clientes,
      dias, ponto, humor, metasPorVendedor,
      gerente: {
        politica: loja.gerentePolitica || null,
        regrasConfig: loja.gerenteRegrasConfig || null,
        historico: loja.gerenteHistorico || [],
        // mesmo motivo: precisa ficar null (não {}) pra inicializarEstadoGerente() aplicar os
        // valores-padrão do formulário em vez de deixar campos como "undefined" na tela.
        est: objetoVazioParaNulo(meu.gerenteEst),
      },
      bancoVWEst: objetoVazioParaNulo(meu.bancoVWEst),
      feriadosCustom: loja.feriadosCustom || [],
      aniversarios: loja.aniversarios || [],
      postagens: loja.postagens || [],
      agenda: loja.agenda || [],
      metasVolks: loja.metasVolks || {},
      documentos: loja.documentos || {},
      _vendedorMigrationDone: loja.vendedorMigrationDone || false,
    };
    aplicarAjustesDeCompatibilidade();
    renderAll();
    statusNuvem("🟢 Sincronizado com o banco", "ok");
    assinarMudancasRemotas();
  }catch(err){
    console.error("Erro ao carregar do banco:", err);
    renderAll();
    statusNuvem("🔴 Sem conexão com o banco de dados", "err");
  }
}

// Calcula o que precisa mudar SEM tocar na rede — permite somar o total de operações de todas as
// coleções antes de disparar qualquer gravação, pra armar o contador de "ignorar eco" com o
// número exato (ver comentário no topo do arquivo sobre por que isso importa).
function calcularDiffColecao(arr, snapshotMap){
  const atuais = (arr||[]).filter(x=>x && x.vendedorId);
  const idsAtuais = new Set(atuais.map(x=>String(x.id)));
  const linhasParaEnviar = [];
  atuais.forEach(item=>{
    const linha = registroParaLinha(item);
    if (snapshotMap.get(String(item.id)) !== assinaturaLinha(linha)) linhasParaEnviar.push(linha);
  });
  const idsRemover = [...snapshotMap.keys()].filter(id=>!idsAtuais.has(id));
  return { atuais, linhasParaEnviar, idsRemover };
}

async function aplicarDiffColecao(tabelaSql, diff, snapshotMap){
  if (diff.linhasParaEnviar.length){
    const { error } = await supabaseClient.from(tabelaSql).upsert(diff.linhasParaEnviar, { onConflict: "id" });
    if (error) throw error;
  }
  if (diff.idsRemover.length){
    const { error } = await supabaseClient.from(tabelaSql).delete().in("id", diff.idsRemover);
    if (error) throw error;
  }
  snapshotMap.clear();
  diff.atuais.forEach(item=>{ snapshotMap.set(String(item.id), assinaturaLinha(registroParaLinha(item))); });
}

async function syncEstadoNuvem(){
  if (!supabaseClient) return;
  clearTimeout(retentativaTimer);
  try{
    const uid = currentVendedorPerfil && currentVendedorPerfil.id;

    const diffs = {
      vendas: calcularDiffColecao(state.vendas, _snapshotSincronizado.vendas),
      propostas: calcularDiffColecao(state.propostas, _snapshotSincronizado.propostas),
      salarios: calcularDiffColecao(state.salarios, _snapshotSincronizado.salarios),
      bancoVW: calcularDiffColecao(state.bancoVW, _snapshotSincronizado.bancoVW),
      clientes: calcularDiffColecao(state.clientes, _snapshotSincronizado.clientes),
    };

    const meuEstado = uid ? {
      dias: (state.dias && state.dias[uid]) || {},
      ponto: (state.ponto && state.ponto[uid]) || {},
      humor: (state.humor && state.humor[uid]) || {},
      metas: (state.metasPorVendedor && state.metasPorVendedor[uid]) || {},
      gerenteEst: (state.gerente && state.gerente.est) || {},
      bancoVWEst: state.bancoVWEst || {},
    } : null;
    const meuEstadoAssinatura = meuEstado ? JSON.stringify(meuEstado) : null;
    const precisaSalvarVendedorEstado = !!uid && meuEstadoAssinatura !== _snapshotSincronizado.vendedorEstadoProprio;

    const lojaEstado = {
      config: state.config || {},
      gerentePolitica: (state.gerente && state.gerente.politica) || null,
      gerenteRegrasConfig: (state.gerente && state.gerente.regrasConfig) || null,
      gerenteHistorico: (state.gerente && state.gerente.historico) || [],
      feriadosCustom: state.feriadosCustom || [],
      aniversarios: state.aniversarios || [],
      postagens: state.postagens || [],
      agenda: state.agenda || [],
      metasVolks: state.metasVolks || {},
      documentos: state.documentos || {},
      vendedorMigrationDone: !!state._vendedorMigrationDone,
    };
    const lojaEstadoAssinatura = JSON.stringify(lojaEstado);
    const precisaSalvarLojaEstado = lojaEstadoAssinatura !== _snapshotSincronizado.lojaEstado;

    let totalOperacoes = 0;
    Object.values(diffs).forEach(d=>{ totalOperacoes += d.linhasParaEnviar.length + d.idsRemover.length; });
    if (precisaSalvarVendedorEstado) totalOperacoes += 1;
    if (precisaSalvarLojaEstado) totalOperacoes += 1;

    if (totalOperacoes===0){
      statusNuvem("🟢 Sincronizado com o banco", "ok");
      return;
    }

    ignorarProximosEventosRemotos += totalOperacoes;
    clearTimeout(ignorarEventosRemotosTimer);
    ignorarEventosRemotosTimer = setTimeout(()=>{ ignorarProximosEventosRemotos = 0; }, 6000);

    const tarefas = [
      aplicarDiffColecao(TABELAS_COLECAO.vendas, diffs.vendas, _snapshotSincronizado.vendas),
      aplicarDiffColecao(TABELAS_COLECAO.propostas, diffs.propostas, _snapshotSincronizado.propostas),
      aplicarDiffColecao(TABELAS_COLECAO.salarios, diffs.salarios, _snapshotSincronizado.salarios),
      aplicarDiffColecao(TABELAS_COLECAO.bancoVW, diffs.bancoVW, _snapshotSincronizado.bancoVW),
      aplicarDiffColecao(TABELAS_COLECAO.clientes, diffs.clientes, _snapshotSincronizado.clientes),
    ];
    if (precisaSalvarVendedorEstado){
      tarefas.push((async ()=>{
        const { error } = await supabaseClient.from("vendedor_estado")
          .upsert({ vendedor_id: uid, dados: meuEstado, atualizado_em: new Date().toISOString() }, { onConflict: "vendedor_id" });
        if (error) throw error;
        _snapshotSincronizado.vendedorEstadoProprio = meuEstadoAssinatura;
      })());
    }
    if (precisaSalvarLojaEstado){
      tarefas.push((async ()=>{
        const { error } = await supabaseClient.from("loja_estado")
          .upsert({ id: WORKSPACE_ID, dados: lojaEstado, atualizado_em: new Date().toISOString() }, { onConflict: "id" });
        if (error) throw error;
        _snapshotSincronizado.lojaEstado = lojaEstadoAssinatura;
      })());
    }
    await Promise.all(tarefas);

    precisaReenviar = false;
    statusNuvem("🟢 Sincronizado com o banco", "ok");
  }catch(err){
    console.error("Erro ao salvar no banco:", err);
    ignorarProximosEventosRemotos = 0;
    statusNuvem("❌ Falha ao salvar no banco — verifique sua internet", "err");
    precisaReenviar = true;
    retentativaTimer = setTimeout(()=>{ if (precisaReenviar) syncEstadoNuvem(); }, 5000);
  }
}
window.addEventListener("online", ()=>{ if (precisaReenviar) syncEstadoNuvem(); });
