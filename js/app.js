/* ============================= ESTADO ============================= */
const DEFAULT_STATE = {
  config: {
    mesRef: new Date().toISOString().slice(0,7),
    metaVendas: 12, comissaoCarro: 800, taxaVD: 0.5,
    metaSeminovos: 3, metaConsorcios: 2, metaVD: 2, metaRepasses: 2, metaSeguidores: 3000, metaSalario: 10000,
    metaLig: 30, metaWpp: 30, metaStories: 10, metaReels: 2, metaFeed: 8, metaOfertas: 4,
    diasAlerta: 7, vendedor: "", concessionaria: "Volkswagen",
    roteiroLigacaoMsg: "Olá, tudo bem?\n\nAqui é o {vendedor} da Motomecânica Volkswagen de Lajeado.\n\nEstou ligando porque estamos com ótimas ofertas de carros zero km esse mês.\n\nTeria interesse em conhecer uma proposta sem compromisso?",
    roteiroWhatsMsg: "Olá! Aqui é o {vendedor}, da Motomecânica Volkswagen de Lajeado 🚗\n\nVi que você tem interesse em conhecer nossos carros 0KM. Esse mês estamos com condições especiais — posso te enviar uma proposta sem compromisso?"
  },
  dias: {},      // { [vendedorId]: { "2026-07-01": [{lig,wpp,sto,ree,nov,ret,vis,td,prop,ven,...}] } }
  clientes: [],  // { id, nome, tel, cidade, veiculo, valor, origem, ultimoContato, obs, vendedorId }
  propostas: [], // { id, data, cliente, whats, origem, carro, versao, cor, valorCota, valorCarro, descontoNF, bonusVarejo, bonusTroca, taxaMensal, entradaPct, parcelas, ipva, emplacamento, ipvaEmplacTotal, vendedorId }
  vendas: [],    // { id, data, carro, modelo, versao, cliente, valor, taxa, tipoLabel, comissao, emplacamento, emplacamentoValor, total, vendedorId }
  agenda: [],    // { id, cliente, tipo, data, hora, obs, feito }
  salarios: [],  // { id, data (YYYY-MM-DD), tipo ("Banco"|"Cartão"|"Prêmios"), valor, vendedorId }
  ponto: {},     // { [vendedorId]: { "2026-07-05": {entrada, saida, foraCidade, transporte, carroTipo, obs} } }
  humor: {},     // { [vendedorId]: { "2026-07-05": [ {valor: 1|2|3, ts: timestamp}, ... ] } }
  feriadosCustom: [], // { data: "2026-01-26", nome: "Aniversário de Lajeado" }
  aniversarios: [], // { id, data: "MM-DD", nome, whats, obs }
  postagens: [],
  metasPorVendedor: {}, // { [vendedorId]: {metaVendas, comissaoCarro, taxaVD, metaSeminovos, metaConsorcios, metaVD, metaRepasses, metaSeguidores, metaSalario, metaLig, metaWpp, metaStories, metaReels, metaFeed, metaOfertas, diasAlerta} }
};

// Campos de meta que passam a ser por vendedor (cada um define a própria) —
// os defaults abaixo são os mesmos valores que já existiam em DEFAULT_STATE.config,
// usados como ponto de partida quando um vendedor ainda não configurou a própria meta.
const DEFAULT_METAS_VENDEDOR = {
  metaVendas: 12, comissaoCarro: 800, taxaVD: 0.5,
  metaSeminovos: 3, metaConsorcios: 2, metaVD: 2, metaRepasses: 2, metaSeguidores: 3000, metaSalario: 10000,
  metaLig: 30, metaWpp: 30, metaStories: 10, metaReels: 2, metaFeed: 8, metaOfertas: 4,
  diasAlerta: 7,
};

// Metas do vendedor logado — cria o registro sob demanda (com os defaults
// acima) se ele ainda não tiver configurado a própria meta.
function metasDoVendedorAtual(){
  state.metasPorVendedor = state.metasPorVendedor || {};
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (!id) return {...DEFAULT_METAS_VENDEDOR};
  if (!state.metasPorVendedor[id]) state.metasPorVendedor[id] = {...DEFAULT_METAS_VENDEDOR};
  return state.metasPorVendedor[id];
}

let state = null;

function normalizeVendas(vendas){
  return (vendas || []).map(v=>{
    if (v.tipoLabel===undefined){
      v.tipoLabel = Number(v.taxa)===0.005 ? "0KM" : Number(v.taxa)===0.007 ? "Seminovo" : Number(v.taxa)===0.01 ? "Consórcio" : Number(v.taxa)===0.003 ? "Repasses" : "VD";
    }
    if (v.emplacamento===undefined){ v.emplacamento = false; v.emplacamentoValor = 0; }
    if (v.emplacamentoPago===undefined){ v.emplacamentoPago = false; }
    if (v.pontuacao===undefined){ v.pontuacao = 0; }
    if (v.retornoBanco===undefined){ v.retornoBanco = 0; }
    if (v.acessoriosValor===undefined){ v.acessoriosValor = 0; }
    if (v.acessoriosPago===undefined){ v.acessoriosPago = false; }
    if (v.seguroValor===undefined){ v.seguroValor = 0; }
    if (v.seguroPago===undefined){ v.seguroPago = false; }
    if (v.total===undefined){ v.total = (Number(v.comissao)||0) + (Number(v.emplacamentoValor)||0) + (Number(v.retornoBanco)||0) + (Number(v.acessoriosValor)||0) + (Number(v.seguroValor)||0); }
    return v;
  });
}

function ehChaveDeData(k){ return /^\d{4}-\d{2}-\d{2}$/.test(k); }

function normalizeDiasPlano(dias){
  const out = {};
  Object.keys(dias||{}).forEach(k=>{
    const v = dias[k];
    out[k] = Array.isArray(v) ? v : [v];
  });
  return out;
}
// state.dias pode estar em duas formas: plano (antes da migração pra
// isolamento por vendedor: { "2026-07-01": [...] }) ou aninhado por vendedor
// (depois da migração: { [vendedorId]: { "2026-07-01": [...] } }). Detecta
// pela forma da primeira chave (data vs UUID) pra normalizar do jeito certo
// sem corromper a estrutura.
function normalizeDias(dias){
  const chaves = Object.keys(dias||{});
  const aninhadoPorVendedor = chaves.length>0 && !ehChaveDeData(chaves[0]);
  if (aninhadoPorVendedor){
    const out = {};
    chaves.forEach(vid=>{ out[vid] = normalizeDiasPlano(dias[vid]||{}); });
    return out;
  }
  return normalizeDiasPlano(dias||{});
}

// Painel diário (ligações/WhatsApp/stories/... + Instagram) é por vendedor,
// particular. Escrita sempre vai na "gaveta" do vendedor logado; leitura em
// modo "ver todos" (admin) mostra o combinado de todo mundo.
function diasDoVendedor(vendedorId){
  state.dias = state.dias || {};
  if (!state.dias[vendedorId]) state.dias[vendedorId] = {};
  return state.dias[vendedorId];
}
function diasDoVendedorAtual(){
  if (currentVendedorPerfil && currentVendedorPerfil.isAdmin && verTodosVendedor){
    const combinado = {};
    Object.keys(state.dias||{}).forEach(vid=>{
      Object.keys(state.dias[vid]||{}).forEach(data=>{
        combinado[data] = (combinado[data]||[]).concat(state.dias[vid][data]||[]);
      });
    });
    return combinado;
  }
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  return id ? diasDoVendedor(id) : {};
}
// Ponto (timeclock) e humor são registros pessoais — sempre só do próprio
// vendedor logado, mesmo em modo "ver todos" (não há seletor de vendedor
// nessas telas hoje, então não há como escolher de quem ver).
function pontoDoVendedor(vendedorId){
  state.ponto = state.ponto || {};
  if (!state.ponto[vendedorId]) state.ponto[vendedorId] = {};
  return state.ponto[vendedorId];
}
function pontoDoVendedorAtual(){
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  return id ? pontoDoVendedor(id) : {};
}
function humorDoVendedor(vendedorId){
  state.humor = state.humor || {};
  if (!state.humor[vendedorId]) state.humor[vendedorId] = {};
  return state.humor[vendedorId];
}
function humorDoVendedorAtual(){
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  return id ? humorDoVendedor(id) : {};
}

function aplicarAjustesDeCompatibilidade(){
  state.config = Object.assign({}, DEFAULT_STATE.config, state.config || {});
  state.dias = normalizeDias(state.dias || {});
  state.clientes = (state.clientes || []).map(c=>({...c, historico: c.historico || []}));
  state.propostas = state.propostas || [];
  state.vendas = normalizeVendas(state.vendas);
  state.agenda = state.agenda || [];
  state.salarios = state.salarios || [];
  state.ponto = state.ponto || {};
  state.humor = state.humor || {};
  state.feriadosCustom = state.feriadosCustom || [];
  state.aniversarios = state.aniversarios || [];
  state.postagens = state.postagens || [];
  state.metasVolks = state.metasVolks || {};
  state.vendedores = state.vendedores || [];
  state.metasPorVendedor = state.metasPorVendedor || {};
  inicializarEstadoGerente();
  inicializarEstadoBancoVW();
  inicializarEstadoDocumentos();
  // troca automaticamente pro mês/ano atual toda vez que o sistema é aberto —
  // o seletor no cabeçalho continua disponível pra navegar até meses anteriores durante a sessão
  state.config.mesRef = todayISO().slice(0,7);
}

function inicializarEstadoPadrao(){
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  aplicarAjustesDeCompatibilidade();
}

function persist(){
  document.getElementById("saveStatus").textContent = "🟡 Salvando no banco…";
  document.getElementById("saveStatus").className = "pending";
  syncEstadoNuvem();
}

// Versão com debounce, para uso em handlers de "input" que disparam a cada
// tecla digitada (ex.: campos de moeda). Sem isso, cada tecla vira um upsert
// no Supabase; ao digitar rápido, o eco em tempo real de um envio anterior
// pode chegar no meio da digitação seguinte e disparar um renderAll() que
// reescreve o próprio campo (valor "tremendo"/cursor pulando/valor perdido).
// Só reenvia 500ms depois da última tecla — o "state" em si já foi atualizado
// na hora pelo handler, então não há perda de dado, só atraso no envio.
let _persistDebounceTimer = null;
function persistDebounced(delay){
  document.getElementById("saveStatus").textContent = "🟡 Digitando…";
  document.getElementById("saveStatus").className = "pending";
  clearTimeout(_persistDebounceTimer);
  _persistDebounceTimer = setTimeout(()=>{ syncEstadoNuvem(); }, delay || 500);
}

document.getElementById("btnFazerLogin").addEventListener("click", async ()=>{
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;
  const erroEl = document.getElementById("loginErro");
  erroEl.textContent = "";
  if (!email || !senha){ erroEl.textContent = "Preencha email e senha."; return; }
  const btn = document.getElementById("btnFazerLogin");
  if (!supabaseClient){
    // Ainda não conectou (ou as tentativas automáticas do carregamento da página já
    // desistiram) — tenta reconectar agora mesmo, na hora do clique, em vez de só avisar.
    btn.disabled = true; btn.textContent = "Conectando…";
    erroEl.textContent = "Conectando ao banco de dados…";
    const ok = await iniciarClienteNuvem();
    btn.disabled = false; btn.textContent = "Entrar";
    if (!ok){ erroEl.textContent = "Sem conexão com o banco de dados no momento. Tente novamente em instantes."; return; }
    erroEl.textContent = "";
  }
  btn.disabled = true; btn.textContent = "Entrando…";
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    const liberado = await autenticarEControlarAcesso(data.user);
    if (!liberado) return;
  }catch(err){
    console.error("Erro no login:", err);
    if (err && err.message === "Email not confirmed"){
      erroEl.textContent = "Este e-mail ainda não foi confirmado. Fale com o administrador.";
    } else {
      erroEl.textContent = "Email ou senha incorretos.";
    }
  }finally{
    btn.disabled = false; btn.textContent = "Entrar";
  }
});
document.getElementById("loginSenha").addEventListener("keydown", e=>{
  if (e.key==="Enter") document.getElementById("btnFazerLogin").click();
});
document.getElementById("btnConfirmarNovaSenha").addEventListener("click", async ()=>{
  const s1 = document.getElementById("novaSenhaInput").value;
  const s2 = document.getElementById("novaSenhaConfirmInput").value;
  const erroEl = document.getElementById("trocarSenhaErro");
  erroEl.textContent = "";
  if (!s1 || s1.length<6){ erroEl.textContent = "A senha precisa ter pelo menos 6 caracteres."; return; }
  if (s1 === "000000"){ erroEl.textContent = "Escolha uma senha diferente da senha inicial."; return; }
  if (s1 !== s2){ erroEl.textContent = "As senhas não conferem."; return; }
  const btn = document.getElementById("btnConfirmarNovaSenha");
  btn.disabled = true;
  try{
    const { error: errSenha } = await supabaseClient.auth.updateUser({ password: s1 });
    if (errSenha) throw errSenha;
    const { error: errFlag } = await supabaseClient.rpc("marcar_senha_trocada");
    if (errFlag) throw errFlag;
    if (currentVendedorPerfil) currentVendedorPerfil.deveTrocarSenha = false;
    document.getElementById("novaSenhaInput").value = "";
    document.getElementById("novaSenhaConfirmInput").value = "";
    esconderTrocarSenhaOverlay();
  }catch(err){
    erroEl.textContent = "Erro: " + (err.message || "não foi possível trocar a senha.");
  }finally{
    btn.disabled = false;
  }
});
document.getElementById("btnLogoutVendedor").addEventListener("click", fazerLogoutVendedor);
document.getElementById("btnCriarVendedor").addEventListener("click", async ()=>{
  const nome = document.getElementById("novoVendedorNome").value.trim();
  const email = document.getElementById("novoVendedorEmail").value.trim();
  const telefone = document.getElementById("novoVendedorTelefone").value.trim();
  const statusEl = document.getElementById("statusCriarVendedor");
  statusEl.style.color = "";
  statusEl.textContent = "";
  if (!email){
    statusEl.style.color = "var(--red)";
    statusEl.textContent = "Preencha o email do vendedor.";
    return;
  }
  const btn = document.getElementById("btnCriarVendedor");
  btn.disabled = true;
  statusEl.style.color = "";
  statusEl.textContent = "Criando…";
  try{
    // A criação roda numa Edge Function (service_role fica só lá, nunca no navegador):
    // ela cria o usuário no Auth já confirmado (senha inicial fixa 000000,
    // obrigado a trocar no primeiro login) e ativa o profile, tudo em uma chamada.
    const { data, error } = await supabaseClient.functions.invoke("create-vendedor", {
      body: { nome, email, telefone },
    });
    if (error){
      // FunctionsHttpError não traz a mensagem da function em error.message —
      // o corpo JSON real ({ error: "..." }) vem em error.context (a Response).
      let msg = error.message;
      if (error.context && typeof error.context.json === "function"){
        try{ const corpo = await error.context.json(); if (corpo && corpo.error) msg = corpo.error; }catch(_e){}
      }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    await carregarListaVendedoresAdmin();
    statusEl.style.color = "var(--green)";
    statusEl.textContent = "Vendedor criado! Senha inicial: 000000 — ele(a) será obrigado(a) a trocar no primeiro login.";
    document.getElementById("novoVendedorNome").value = "";
    document.getElementById("novoVendedorEmail").value = "";
    document.getElementById("novoVendedorTelefone").value = "";
  }catch(err){
    statusEl.style.color = "var(--red)";
    statusEl.textContent = "Erro: " + (err.message || "não foi possível criar.");
  }finally{
    btn.disabled = false;
  }
});

document.getElementById("btnCompMes").addEventListener("click", ()=>{ competicaoCarrosEscopo="mes"; renderCompeticaoCarros(); });
document.getElementById("btnCompGeral").addEventListener("click", ()=>{ competicaoCarrosEscopo="geral"; renderCompeticaoCarros(); });
document.getElementById("btnRelatorioLigacoesPdf").addEventListener("click", imprimirRelatorioLigacoes);
document.addEventListener("keydown", e=>{ if (e.key==="Escape") fecharPropostaModal(); });
document.getElementById("btnGerarExtratoSalario").addEventListener("click", gerarExtratoSalarioPeriodo);
document.getElementById("btnVerificarDuplicados").addEventListener("click", ()=>{
  const salarios = filtrarPorVendedor(state.salarios || []); // só verifica/remove duplicados do próprio vendedor
  const vistos = new Map(); // chave: data|tipo|valor|origemVendaId -> primeiro id encontrado
  const duplicados = [];
  salarios.forEach(s=>{
    const chave = `${s.data}|${s.tipo}|${s.valor}|${s.origemVendaId||""}`;
    if (vistos.has(chave)){
      duplicados.push(s.id);
    } else {
      vistos.set(chave, s.id);
    }
  });
  if (duplicados.length===0){
    alert("Nenhum lançamento duplicado encontrado. Seus dados estão certinhos!");
    return;
  }
  const totalDuplicado = salarios.filter(s=>duplicados.includes(s.id)).reduce((sum,s)=>sum+(Number(s.valor)||0),0);
  if (!confirm(`Encontrei ${duplicados.length} lançamento${duplicados.length===1?"":"s"} duplicado${duplicados.length===1?"":"s"}, somando ${moneyFmt(totalDuplicado)}.\n\nEsses são cópias exatas (mesma data, tipo e valor) de outro lançamento já existente. Quer remover as cópias e manter só o original de cada um?`)) return;
  state.salarios = (state.salarios||[]).filter(s=>!duplicados.includes(s.id));
  persist(); renderAll();
  alert(`Pronto! ${duplicados.length} lançamento${duplicados.length===1?"":"s"} duplicado${duplicados.length===1?"":"s"} removido${duplicados.length===1?"":"s"}.`);
});
document.getElementById("g-modelo").addEventListener("change", e=>{
  const est = state.gerente.est;
  est.modelo = e.target.value; est.versao=""; est.ano=""; est.op=null;
  popVersoesG(); calcularGerente(); persist();
});
document.getElementById("g-versao").addEventListener("change", e=>{
  const est = state.gerente.est;
  est.versao = e.target.value; est.ano=""; est.op=null;
  popAnosG(); calcularGerente(); persist();
});
document.getElementById("g-ano").addEventListener("change", e=>{
  state.gerente.est.ano = e.target.value; calcularGerente(); persist();
});
document.getElementById("g-dias").addEventListener("input", e=>{
  const v = e.target.value.replace(/[^\d]/g,"");
  e.target.value = v;
  const est = state.gerente.est;
  if (v===""){ est.dias=null; est.fat=""; document.getElementById("g-fat").value=""; diasEstoqueG(); calcularGerente(); return; }
  est.dias = parseInt(v,10);
  est.fat = isoG(new Date(HOJE_G.getTime()-est.dias*864e5));
  document.getElementById("g-fat").value = est.fat;
  diasEstoqueG(); calcularGerente(); persist();
});
document.getElementById("g-fat").addEventListener("change", e=>{
  const est = state.gerente.est;
  est.fat = e.target.value;
  if (est.fat){ est.dias = Math.round((HOJE_G - dtG(est.fat))/864e5); document.getElementById("g-dias").value = est.dias>=0?est.dias:""; }
  else { est.dias=null; document.getElementById("g-dias").value=""; }
  diasEstoqueG(); calcularGerente(); persist();
});
moedaInputG(document.getElementById("g-preco"), "preco");
moedaInputG(document.getElementById("g-usado"), "usado");
document.getElementById("g-marca-troca").addEventListener("change", e=>{
  state.gerente.est.marcaTroca = e.target.value;
  calcularGerente(); persist();
});
document.getElementById("g-ger").addEventListener("input", e=>{
  const v = e.target.value.replace(/[^\d,\.]/g,"").replace(".",",");
  e.target.value = v;
  state.gerente.est.gerPct = parseFloat(v.replace(",","."))||0;
  calcularGerente();
});
document.getElementById("g-ger").addEventListener("blur", persist);
document.getElementById("g-cor").addEventListener("input", e=>{ state.gerente.est.cor = e.target.value; calcularGerente(); });
document.getElementById("g-cor").addEventListener("blur", persist);
document.getElementById("g-pacotes").addEventListener("input", e=>{ state.gerente.est.pacotes = e.target.value; calcularGerente(); });
document.getElementById("g-pacotes").addEventListener("blur", persist);
document.getElementById("btnImprimirResultadoGerente").addEventListener("click", imprimirResultadoGerente);
document.getElementById("bv-venda-origem").addEventListener("change", e=>{
  const id = e.target.value;
  state.bancoVWEst.vendaOrigemId = id;
  if (id){
    const v = state.vendas.find(x=>x.id===id);
    if (v){
      document.getElementById("bv-valor").value = v.valor ? NUMFG(v.valor) : "";
      state.bancoVWEst.valor = Number(v.valor)||0;
      document.getElementById("bv-pontos").value = v.pontuacao ? String(v.pontuacao).replace(".",",") : "";
      state.bancoVWEst.pontos = Number(v.pontuacao)||0;
    }
  }
  calcularEExibirBancoVW();
  persist();
});
document.getElementById("bv-tabela").addEventListener("change", e=>{
  state.bancoVWEst.tabela = e.target.value;
  renderTabelaNotaBancoVW();
  calcularEExibirBancoVW();
  persist();
});
document.getElementById("bv-valor").addEventListener("input", e=>{
  const v = e.target.value.replace(/[^\d]/g,"");
  state.bancoVWEst.valor = v ? parseInt(v,10)/100 : 0;
  e.target.value = state.bancoVWEst.valor ? NUMFG(state.bancoVWEst.valor) : "";
  calcularEExibirBancoVW();
  persist();
});
document.getElementById("bv-pontos").addEventListener("input", e=>{
  const v = e.target.value.replace(/[^\d,\.]/g,"").replace(".",",");
  e.target.value = v;
  state.bancoVWEst.pontos = parseFloat(v.replace(",","."))||0;
  calcularEExibirBancoVW();
});
document.getElementById("bv-pontos").addEventListener("blur", persist);
document.getElementById("btnAplicarPremioNaVenda").addEventListener("click", ()=>{
  if (!ultimoResultadoBancoVW){ alert("Calcule um prêmio antes de aplicar."); return; }
  const vendaId = state.bancoVWEst.vendaOrigemId;
  if (!vendaId){ alert("Escolha uma venda registrada em \"Carregar de uma venda registrada\" pra poder aplicar."); return; }
  const v = state.vendas.find(x=>x.id===vendaId);
  if (!v){ alert("Essa venda não foi encontrada — pode ter sido excluída."); return; }
  const r = ultimoResultadoBancoVW;
  const premio = r.premio;
  v.retornoBanco = premio;
  v.pontuacao = r.est.pontos;
  v.total = (Number(v.comissao)||0) + (Number(v.emplacamentoValor)||0) + premio + (Number(v.acessoriosValor)||0) + (Number(v.seguroValor)||0);

  // salva automaticamente no histórico — se já existe um prêmio salvo pra essa venda neste mês, atualiza em vez de duplicar
  state.bancoVW = state.bancoVW || [];
  const mesAtual = state.config.mesRef;
  const existente = state.bancoVW.find(x => x.origemVendaId===vendaId && (x.data||"").slice(0,7)===mesAtual);
  if (existente){
    existente.tabelaNome = r.tabelaNome;
    existente.valor = r.est.valor;
    existente.pontos = r.est.pontos;
    existente.premio = premio;
    existente.data = todayISO();
    existente.vendedorId = v.vendedorId || existente.vendedorId || null;
  } else {
    state.bancoVW.push({
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      data: todayISO(),
      origem: `${v.cliente||""} · ${v.carro||""} ${v.modelo||""}`.trim(),
      origemVendaId: vendaId,
      tabelaNome: r.tabelaNome,
      valor: r.est.valor,
      pontos: r.est.pontos,
      premio: premio,
      vendedorId: v.vendedorId || null, // herda da venda de origem
    });
  }

  persist();
  renderAll();
  alert(`Prontinho! R$ ${NUMFG(premio)} entrou como Retorno do Banco VW na venda de ${v.cliente||"cliente"} e já foi salvo no histórico deste mês.`);
});
document.getElementById("btnLimparHistoricoBancoVW").addEventListener("click", ()=>{
  // Só apaga o histórico do vendedor logado (ou de todos, se o admin estiver
  // com "ver todos" ligado) — nunca o histórico de outro vendedor por engano.
  const doVendedor = filtrarPorVendedor(state.bancoVW||[]);
  if (!doVendedor.length){ alert("Não há prêmios no histórico."); return; }
  if (!confirm(`Excluir TODOS os ${doVendedor.length} prêmios do histórico? Essa ação não pode ser desfeita.`)) return;
  const idsRemover = new Set(doVendedor.map(x=>x.id));
  const idsVendasAfetadas = doVendedor.map(x=>x.origemVendaId).filter(Boolean);
  state.bancoVW = (state.bancoVW||[]).filter(x=>!idsRemover.has(x.id));
  idsVendasAfetadas.forEach(resetarRetornoBancoDaVenda);
  persist(); renderAll();
});
document.getElementById("btnImprimirPremioBancoVW").addEventListener("click", imprimirPremioBancoVW);
document.getElementById("fipeTipo").addEventListener("change", fipeCarregarMarcas);
document.getElementById("fipeMarca").addEventListener("change", fipeCarregarModelos);
document.getElementById("fipeModelo").addEventListener("change", fipeCarregarAnos);
document.getElementById("fipeAno").addEventListener("change", fipeConsultarPreco);
document.getElementById("btnAbrirDocumentos").addEventListener("click", abrirDocumentos);
document.getElementById("btnVoltarConfigDoDocumentos").addEventListener("click", ()=>{
  document.querySelector('nav button[data-view="config"]').click();
});
document.querySelectorAll('[data-doc]').forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll('[data-doc]').forEach(b=>b.classList.remove("pill-ativo"));
    btn.classList.add("pill-ativo");
    document.querySelectorAll(".doc-painel").forEach(p=>p.style.display="none");
    document.getElementById("docPainel-"+btn.dataset.doc).style.display="block";
  });
});
document.querySelectorAll('#view-documentos input, #view-documentos select').forEach(el=>{
  el.addEventListener("change", salvarCamposDocumentos);
});

document.getElementById("btnImprimirDocProcuracao").addEventListener("click", ()=>{
  salvarCamposDocumentos();
  const d = state.documentos.procuracao || {};
  const dt = docFmtData(d["proc-data"]);
  const processosMarcados = (d.processos||[]).map(idx=>DOC_PROCESSOS_PROCURACAO[idx]);
  const corpo = `
    <h1>Procuração (Representação)</h1>
    <h2>GRT</h2>
    <div class="linha">Eu, <span class="campo" style="min-width:280px;">${d["proc-nome"]||""}</span>, inscrito no CPF sob o número
    <span class="campo">${d["proc-cpf"]||""}</span>, portador da CI número <span class="campo">${d["proc-ci"]||""}</span>,
    proprietário/adquirente do veículo <span class="campo">${d["proc-veiculo"]||""}</span>, chassi
    <span class="campo">${d["proc-chassi"]||""}</span>, de placas <span class="campo">${d["proc-placas"]||""}</span>,
    nomeio e constituo como meu PROCURADOR o Sr. ${DOC_PROCURADORES_FIXOS.map(p=>`${p.nome}, Portador(a) do CPF: ${p.cpf}`).join(", ou Sr. ")},
    para fins de encaminhar o(s) seguinte(s) processo(s) em meu nome:</div>

    <div class="chk-list">${DOC_PROCESSOS_PROCURACAO.map(p=>`<div>${processosMarcados.includes(p)?"☑":"☐"} ${p}</div>`).join("")}</div>

    <div style="margin-top:26px;">Lajeado, ${dt.dia} de ${dt.mes} de ${dt.ano}.</div>
    <div class="assinatura-box" style="margin-top:40px;max-width:320px;">
      <div class="assinatura-linha">Assinatura com firma reconhecida</div>
    </div>

    <div style="margin-top:26px;font-weight:700;font-size:11.5px;text-transform:uppercase;">Dados do adquirente (processos 101, 102 e 103) ou do proprietário (demais processos)</div>
    <div class="grid2" style="margin-top:8px;font-size:12px;">
      <div style="grid-column:1/-1;">Endereço: <span class="campo" style="min-width:400px;">${d["proc-endereco"]||""}</span></div>
      <div>Telefone celular: <span class="campo">${d.semtel ? "não possui" : (d["proc-tel"]||"")}</span></div>
      <div>Email: <span class="campo">${d.sememail ? "não possui" : (d["proc-email"]||"")}</span></div>
      <div style="grid-column:1/-1;">Autorizo o DETRAN/RS a enviar por email ou telefone celular informações de interesse junto a este órgão: <b>${d.autoriza==="NAO"?"Não":"Sim"}</b></div>
    </div>`;
  abrirJanelaImpressaoDoc("Procuração", corpo);
});

document.getElementById("btnImprimirDocAutorizacao").addEventListener("click", ()=>{
  salvarCamposDocumentos();
  const d = state.documentos.autorizacao || {};
  const dt = docFmtData(d["aut-data"]);
  const corpo = `
    <h1>Autorização de Entrega de Veículo a Terceiro</h1>
    <div class="linha" style="text-align:justify;">Eu, <span class="campo" style="min-width:300px;">${d["aut-nome"]||""}</span>,
    portador do RG/IE <span class="campo">${d["aut-rg"]||""}</span> e CPF/CNPJ <span class="campo">${d["aut-cpf"]||""}</span>,
    proprietário do veículo <span class="campo">${d["aut-veiculo"]||""}</span>, marca <span class="campo">${d["aut-marca"]||"Volkswagen"}</span>,
    ano fabricação/modelo <span class="campo" style="min-width:50px;">${d["aut-anofab"]||""}</span>/<span class="campo" style="min-width:50px;">${d["aut-anomod"]||""}</span>,
    cor <span class="campo">${d["aut-cor"]||""}</span>, chassi <span class="campo">${d["aut-chassi"]||""}</span> e placa
    <span class="campo">${d["aut-placa"]||""}</span>, autorizo o(a) Sr.(a) <span class="campo" style="min-width:280px;">${d["aut-terc-nome"]||""}</span>,
    portador do RG/IE <span class="campo">${d["aut-terc-rg"]||""}</span> e CPF/CNPJ <span class="campo">${d["aut-terc-cpf"]||""}</span>
    a retirar o veículo mencionado acima junto à concessionária Volkswagen MOTOMECÂNICA COMERCIAL DE VEICULOS S/A, inscrita no CNPJ 91.157.826/0001-14,
    no que me responsabilizo civil, administrativamente bem como criminalmente pelo uso do veículo, isentando, assim, a MOTOMECÂNICA COMERCIAL S/A por todo
    e quaisquer tipo de responsabilidade e/ou indenização por danos diretos e indiretos causados a terceiros e/ou a MOTOMECANICA COMERCIAL S/A.</div>

    <div style="margin-top:30px;">Lajeado-RS, ${dt.dia} de ${dt.mes} de ${dt.ano}.</div>

    <div class="assinaturas">
      <div class="assinatura-box"><div class="assinatura-linha">Assinatura do Cliente</div></div>
    </div>`;
  abrirJanelaImpressaoDoc("Autorização de Entrega a Terceiro", corpo);
});

document.getElementById("btnImprimirDocRetirada").addEventListener("click", ()=>{
  salvarCamposDocumentos();
  const d = state.documentos.retirada || {};
  const dt = docFmtData(d["ret-data"]);
  const corpo = `
    <h1>Declaração</h1>
    <h2>Retirada de Veículo Sem Placa</h2>
    <div class="linha" style="text-align:justify;">Eu, <span class="campo" style="min-width:300px;">${d["ret-nome"]||""}</span>,
    portador do RG <span class="campo">${d["ret-rg"]||""}</span> e CPF <span class="campo">${d["ret-cpf"]||""}</span>,
    declaro para os devidos fins de direito, que adquiri o veículo <span class="campo">${d["ret-veiculo"]||""}</span>, marca Volkswagen,
    chassi <span class="campo">${d["ret-chassi"]||""}</span>, da Concessionária MOTOMECANICA COMERCIAL S/A, inscrita no CNPJ 91.157.826/0001-14
    e nesta data estou retirando por minha livre e espontânea vontade, o referido veículo sem o devido emplacamento, tendo em vista que a
    documentação está sendo providenciada pelo meu despachante.</div>
    <div class="linha" style="text-align:justify;">Pela presente, me responsabilizo civil, administrativamente bem como criminalmente pelo uso do
    veículo, isentando, ademais, a MOTOMECANICA COMERCIAL S/A por todo e qualquer dano direto ou indireto causado a MOTOMECANICA COMERCIAL S/A
    e/ou terceiros, devendo, ademais, indenizar integralmente a MOTOMECANICA COMERCIAL S/A por eventual prejuízo causado.</div>

    <div style="margin-top:30px;">Lajeado-RS, ${dt.dia} de ${dt.mes} de ${dt.ano}.</div>

    <div class="assinaturas">
      <div class="assinatura-box"><div class="assinatura-linha">Assinatura do Cliente</div></div>
    </div>`;
  abrirJanelaImpressaoDoc("Retirada de Veículo Sem Placa", corpo);
});

document.getElementById("btnImprimirDocPedidoVD").addEventListener("click", ()=>{
  salvarCamposDocumentos();
  imprimirDocPedidoVDFielExcel(state.documentos.pedidovd || {});
});
document.getElementById("btnAddFaixaPagina").addEventListener("click", ()=>{
  state.gerente.regrasConfig.paginasExcluir.push({de:null, ate:null});
  renderRegraPaginasBox();
});
document.getElementById("btnAbrirRegraAtual").addEventListener("click", abrirRegraAtualModal);
document.getElementById("btnSalvarRegraAtual").addEventListener("click", ()=>{
  state.gerente.regrasConfig.instrucoesExtras = document.getElementById("regraInstrucoesExtras").value;
  state.gerente.regrasConfig.ignorarAntes2026 = document.getElementById("regraIgnorarAntes2026").checked;
  persist();
  fecharRegraAtualModal();
  alert("Regras salvas! Elas já valem pra próxima política que você anexar em PDF.");
});
document.getElementById("btnVerHistoricoPoliticas").addEventListener("click", abrirHistoricoPoliticasModal);
gDz.addEventListener("click", ()=>gInp.click());
gDz.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); gInp.click(); } });
gDz.addEventListener("dragover", e=>{ e.preventDefault(); gDz.classList.add("hot"); });
gDz.addEventListener("dragleave", ()=> gDz.classList.remove("hot"));
gDz.addEventListener("drop", e=>{ e.preventDefault(); gDz.classList.remove("hot"); if(e.dataTransfer.files[0]) lerPoliticaPdf(e.dataTransfer.files[0]); });
gInp.addEventListener("change", e=>{ if(e.target.files[0]) lerPoliticaPdf(e.target.files[0]); });
document.getElementById("btnCopiarInstrucoesClaude").addEventListener("click", ()=>{
  const esquema = montarEsquemaGerente();
  const texto = `Anexei um PDF com a política de ações comerciais da Volkswagen. Extraia todas as linhas das tabelas de ações comerciais desse PDF e me devolva um arquivo .json pronto pra eu baixar (crie o arquivo, não precisa mostrar tudo no chat), com essa estrutura exata:\n\n${esquema}`;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(texto).then(()=>{
      alert("Instruções copiadas! Agora é só colar numa conversa nova com o Claude, anexar o PDF da política, e pedir pra ele gerar o arquivo .json pra você baixar.");
    }).catch(()=>{
      prompt("Não consegui copiar automaticamente. Copie o texto abaixo:", texto);
    });
  } else {
    prompt("Copie o texto abaixo:", texto);
  }
});
document.getElementById("btnExportarRegrasJson").addEventListener("click", ()=>{
  const p = state.gerente.politica;
  const blob = new Blob([JSON.stringify(p, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "politica-vw.json";
  a.click();
});
document.getElementById("btnImportarRegrasJson").addEventListener("click", ()=> document.getElementById("gerenteArquivoJson").click());
document.getElementById("gerenteArquivoJson").addEventListener("change", async e=>{
  const f = e.target.files[0];
  if (!f) return;
  try{
    const texto = await f.text();
    const p = JSON.parse(texto);
    const regras = Array.isArray(p) ? p : p.regras;
    if (!Array.isArray(regras) || !regras.length) throw new Error("Arquivo sem regras.");
    if (state.gerente.politica){
      state.gerente.historico.push({ nome: state.gerente.politica.nome, dataCarregada: state.gerente.politica.dataCarregada, qtdRegras: state.gerente.politica.regras.length });
    }
    state.gerente.politica = {
      nome: (p.nome || f.name.replace(/\.json$/i,"")),
      dataCarregada: todayISO(),
      regras: regras.map(x=>Object.assign({m:"",v:"",c:"",am:[],op:null,de:null,ate:null,nf:0,ti:0,bv:0,rede:0,tot:0,tx:"",obs:""}, x)),
    };
    state.gerente.est = {modelo:"", versao:"", ano:"", fat:"", dias:null, preco:0, usado:0, gerPct:state.gerente.est.gerPct||3, op:null, marcaTroca:""};
    persist();
    renderGerentePoliticaAtualBox();
    renderGerenteForm();
    gSt.innerHTML = `<div class="nota-g" style="color:var(--green);font-weight:700;">✅ Importadas ${regras.length} regras de "${f.name}". Já é a política em uso — confira o cálculo antes de fechar negócio.</div>`;
  }catch(err){
    gSt.innerHTML = `<div class="nota-g" style="color:var(--red);">Não consegui ler esse arquivo: ${err.message}</div>`;
  }
  e.target.value = "";
});


document.querySelectorAll("nav button[data-view]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("nav button[data-view]").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-"+btn.dataset.view).classList.add("active");
    fecharMenuMobile();
  });
});
// Menu hambúrguer (mobile/tablet): o nav em si continua o mesmo, só colapsa via CSS.
function fecharMenuMobile(){
  const nav = document.getElementById("navPrincipal");
  const btn = document.getElementById("btnNavToggle");
  if (!nav || !btn) return;
  nav.classList.remove("nav-open");
  btn.setAttribute("aria-expanded","false");
}
document.getElementById("btnNavToggle").addEventListener("click", ()=>{
  const nav = document.getElementById("navPrincipal");
  const aberto = nav.classList.toggle("nav-open");
  document.getElementById("btnNavToggle").setAttribute("aria-expanded", aberto ? "true" : "false");
});
popularSeletorMesAno();
popularProdutosFinanciamento();
document.getElementById("headerMesSelect").addEventListener("change", mudarMesRefManual);
document.getElementById("headerAnoSelect").addEventListener("change", mudarMesRefManual);

document.getElementById("cData").value = todayISO();
document.getElementById("cData").addEventListener("change", atualizarAvisoDiaControle);
document.getElementById("clUlt").value = todayISO();
document.getElementById("vData").value = todayISO();
document.getElementById("vTipo").addEventListener("change", atualizarCamposVenda);
atualizarCamposVenda();
document.getElementById("pData").value = todayISO();
document.getElementById("pTipoVeiculo").addEventListener("change", atualizarCamposProposta);
atualizarCamposProposta();
maskCurrency(document.getElementById("vValor"));
maskCurrency(document.getElementById("vAcessorios"));
maskCurrency(document.getElementById("vSeguro"));
maskCurrency(document.getElementById("clVal"));
maskCurrency(document.getElementById("pCota"));
maskCurrency(document.getElementById("pValorCarro"));
maskCurrency(document.getElementById("pDescontoNF"));
maskCurrency(document.getElementById("pBonusVarejo"));
maskCurrency(document.getElementById("pBonusTroca"));
maskCurrency(document.getElementById("pAvaliacaoTroca"));
maskCurrency(document.getElementById("pAvaliacaoTrocaIdeia"));
maskCurrency(document.getElementById("pEmplacamento"));
document.getElementById("pEmplacamento").addEventListener("input", updatePropostaTotal);
document.getElementById("pEmplacamento").value = "1.400,00";
document.getElementById("pBtnCortesia").addEventListener("click", ()=>{
  cortesiaAtiva = !cortesiaAtiva;
  document.getElementById("pBtnCortesia").classList.toggle("ativo", cortesiaAtiva);
  document.getElementById("pBtnCortesia").textContent = cortesiaAtiva ? "🎁 Cortesia (ativada)" : "🎁 Cortesia";
  updatePropostaTotal();
});
updatePropostaTotal();
(function popularSelectIpvaMes(){
  const sel = document.getElementById("pIpvaMes");
  MESES_IPVA.forEach((m,i)=>{
    const opt = document.createElement("option");
    opt.value = i+1;
    opt.textContent = `${m} (${IPVA_PCT_POR_MES[i].toFixed(2)}%)`;
    sel.appendChild(opt);
  });
})();
document.getElementById("pIpvaMes").addEventListener("change", updateIpva);
document.getElementById("pValorCarro").addEventListener("input", ()=>{ updateAllValorEntrada(); updateIpva(); });
document.getElementById("btnAddTaxa").addEventListener("click", ()=> addTaxaRow());
document.getElementById("pTaxasContainer").addEventListener("click", (e)=>{
  if (e.target.classList.contains("btnRemoveTaxa")){
    const rows = document.querySelectorAll("#pTaxasContainer .taxa-row");
    if (rows.length>1) e.target.closest(".taxa-row").remove();
  }
});
document.getElementById("pTaxasContainer").addEventListener("change", (e)=>{
  if (e.target.classList.contains("entradaPctInput")) updateValorEntrada(e.target.closest(".taxa-row"));
});
resetTaxasContainer();

document.getElementById("formControle").addEventListener("submit", e=>{
  e.preventDefault();
  const k = document.getElementById("cData").value;
  if (!k) return;
  const entrada = {
    ligInvalido:+document.getElementById("cLigInvalido").value||0,
    ligNao:+document.getElementById("cLigNao").value||0,
    ligAtendCom:+document.getElementById("cLigAtendCom").value||0,
    ligAtendSem:+document.getElementById("cLigAtendSem").value||0,
    wpp:+document.getElementById("cWpp").value||0,
    sto:+document.getElementById("cSto").value||0, ree:+document.getElementById("cRee").value||0,
    feed:+document.getElementById("cFeed").value||0,
    ofe:+document.getElementById("cOfe").value||0,
    nov:+document.getElementById("cNov").value||0, ret:+document.getElementById("cRet").value||0,
    vis:+document.getElementById("cVis").value||0, td:+document.getElementById("cTd").value||0,
    prop:+document.getElementById("cProp").value||0,
    avaliados:+document.getElementById("cAvaliados").value||0,
    seg:+document.getElementById("cSeg").value||0, painel:+document.getElementById("cPainel").value||0,
    insights:+document.getElementById("cInsights").value||0, posts:+document.getElementById("cPosts").value||0,
    segLiquido:+document.getElementById("cSegLiquido").value||0, interacoes:+document.getElementById("cInteracoes").value||0,
    ts: Date.now(),
  };
  const diasVendedor = diasDoVendedor(currentVendedorPerfil && currentVendedorPerfil.id);
  if (!diasVendedor[k]) diasVendedor[k] = [];
  diasVendedor[k].push(entrada);
  persist(); renderAll();
  e.target.reset();
  document.getElementById("cData").value = todayISO();
  atualizarAvisoDiaControle();
});

document.getElementById("formVenda").addEventListener("submit", e=>{
  e.preventDefault();
  const valor = currencyToNumber(document.getElementById("vValor").value);
  const tipoSel = document.getElementById("vTipo").value;
  let taxa, tipoLabel;
  if (tipoSel==="VD"){ taxa = (Number(metasDoVendedorAtual().taxaVD)||0)/100; tipoLabel = "VD"; }
  else if (tipoSel==="CONSORCIO"){ taxa = 0.01; tipoLabel = "Consórcio"; }
  else if (tipoSel==="REPASSE"){ taxa = 0.003; tipoLabel = "Repasses"; }
  else { taxa = Number(tipoSel); tipoLabel = taxa===0.005 ? "0KM" : "Seminovo"; }
  const emplac = document.getElementById("vEmplac").value === "sim";
  const emplacValor = emplac ? 50 : 0;
  const comissao = valor*taxa;
  const editId = document.getElementById("vEditId").value;
  // pontuação e retorno do banco não são mais preenchidos aqui — eles são geridos pelo menu "Banco VW".
  // ao editar, preserva o que já estava salvo; em venda nova, começam zerados até serem aplicados no Banco VW.
  const vendaExistente = editId ? state.vendas.find(v=>v.id===editId) : null;
  const pontuacao = vendaExistente ? (Number(vendaExistente.pontuacao)||0) : 0;
  const retornoBanco = vendaExistente ? (Number(vendaExistente.retornoBanco)||0) : 0;
  const dadosVenda = {
    data: document.getElementById("vData").value,
    carro: document.getElementById("vCarro").value,
    modelo: document.getElementById("vModelo").value,
    versao: document.getElementById("vVersao").value,
    cor: document.getElementById("vCor").value,
    anoFab: document.getElementById("vAnoFab").value,
    anoModelo: document.getElementById("vAnoModelo").value,
    origemCliente: document.getElementById("vOrigem").value,
    cliente: document.getElementById("vCliente").value,
    valor: valor,
    taxa: taxa,
    tipoLabel: tipoLabel,
    emplacamento: emplac,
    emplacamentoValor: emplacValor,
    comissao: comissao,
    pontuacao: pontuacao,
    retornoBanco: retornoBanco,
    acessoriosValor: currencyToNumber(document.getElementById("vAcessorios").value),
    seguroValor: currencyToNumber(document.getElementById("vSeguro").value),
    total: comissao + emplacValor + retornoBanco + currencyToNumber(document.getElementById("vAcessorios").value) + currencyToNumber(document.getElementById("vSeguro").value),
  };
  if (editId){
    const idx = state.vendas.findIndex(v=>v.id===editId);
    // vendedorId nunca muda numa edição — mesmo se o admin (em "ver todos")
    // editar a venda de outro vendedor, a posse continua sendo de quem criou.
    if (idx>-1) state.vendas[idx] = {...state.vendas[idx], ...dadosVenda};
  } else {
    state.vendas.push({
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      emplacamentoPago:false, acessoriosPago:false, seguroPago:false,
      vendedorId: (currentVendedorPerfil && currentVendedorPerfil.id) || null,
      ...dadosVenda,
    });
  }
  persist(); renderAll();
  cancelarEdicaoVenda();
});
document.getElementById("vBtnCancelarEdicao").addEventListener("click", cancelarEdicaoVenda);

document.getElementById("calAnivMes").addEventListener("change", ()=>{
  calAnivMesAtual = +document.getElementById("calAnivMes").value;
  renderCalAniversarios();
});
document.getElementById("calAnivAno").addEventListener("change", ()=>{
  calAnivAnoAtual = +document.getElementById("calAnivAno").value;
  renderCalAniversarios();
});
document.getElementById("btnMarcarTodosCarros").addEventListener("click", ()=>{
  const checks = document.querySelectorAll('input[name="postCarroSel"]');
  const todosMarcados = Array.from(checks).every(c=>c.checked);
  checks.forEach(c=>{ c.checked = !todosMarcados; });
  document.getElementById("btnMarcarTodosCarros").textContent = todosMarcados ? "Marcar todos os modelos" : "Desmarcar todos os modelos";
  atualizarAvisoVersaoAno();
});
document.querySelectorAll('input[name="postCarroSel"]').forEach(c=> c.addEventListener("change", atualizarAvisoVersaoAno));
atualizarAvisoVersaoAno();
document.getElementById("formGerarPostagem").addEventListener("submit", e=>{
  e.preventDefault();
  const carros = Array.from(document.querySelectorAll('input[name="postCarroSel"]:checked')).map(el=>el.value);
  const versao = document.getElementById("postVersao").value;
  const ano = document.getElementById("postAno").value;
  const assunto = document.getElementById("postAssunto").value;
  const qtdReels = Math.max(0, Math.min(14, +document.getElementById("postQtdReels").value || 0));
  const qtdStories = Math.max(0, Math.min(14, +document.getElementById("postQtdStories").value || 0));
  const qtdFeed = Math.max(0, Math.min(14, +document.getElementById("postQtdFeed").value || 0));
  const formatos = Array.from(document.querySelectorAll('input[name="postFormato"]:checked')).map(el=>el.value);
  const dataInicio = document.getElementById("postDataInicio").value;
  const dataFim = document.getElementById("postDataFim").value;
  const totalPedido = qtdReels+qtdStories+qtdFeed;

  if (totalPedido===0){ alert("Escolha ao menos 1 postagem de algum tipo (Reels, Stories ou Feed)."); return; }
  if (totalPedido>15 && !confirm(`Isso vai gerar ${totalPedido} postagens (${qtdReels} Reels + ${qtdStories} Stories + ${qtdFeed} Feed) de uma vez. Confirma?`)) return;

  const geradas = gerarIdeiasPostagem({ carros, versao, ano, assunto, qtdReels, qtdStories, qtdFeed, formatos, dataInicio, dataFim });
  state.postagens.push(...geradas);
  persist();
  renderPostagens();

  const wrap = document.getElementById("postagensGeradasWrap");
  wrap.style.display = "block";
  wrap.querySelector("h2 span").textContent = `${geradas.length} ideia${geradas.length===1?"":"s"} nova${geradas.length===1?"":"s"} — já salvas no histórico abaixo, marque como postado quando publicar`;
  const formEl = document.getElementById("formGerarPostagem");
  if (formEl && typeof formEl.scrollIntoView === "function"){
    document.getElementById("postagensHistoricoBox").scrollIntoView({behavior:"smooth", block:"start"});
  }
});
document.getElementById("btnLimparPostagens").addEventListener("click", ()=>{
  if (!state.postagens || state.postagens.length===0){ alert("Não há postagens no histórico."); return; }
  if (!confirm(`Excluir TODAS as ${state.postagens.length} postagens do histórico? Essa ação não pode ser desfeita.`)) return;
  state.postagens = [];
  persist();
  renderPostagens();
});
document.getElementById("formAniversario").addEventListener("submit", e=>{
  e.preventDefault();
  const mmdd = document.getElementById("aniData").value;
  const editId = document.getElementById("aniEditId").value;
  const dados = {
    data: mmdd,
    nome: document.getElementById("aniNome").value,
    whats: document.getElementById("aniWhats").value,
    anoNascimento: +document.getElementById("aniAnoNasc").value || null,
    obs: document.getElementById("aniObs").value,
  };
  if (editId){
    const idx = state.aniversarios.findIndex(a=>a.id===editId);
    if (idx>-1) state.aniversarios[idx] = {...state.aniversarios[idx], ...dados};
  } else {
    state.aniversarios.push({ id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), ...dados });
  }
  persist(); renderAll();
  limparFormAniversario();
  renderListaAniversariosDoDia(mmdd);
});
document.getElementById("btnCancelarEdicaoAniversario").addEventListener("click", limparFormAniversario);

document.getElementById("formProposta").addEventListener("submit", e=>{
  e.preventDefault();
  const ipva = currencyToNumber(document.getElementById("pIpva").value);
  const emplacamento = currencyToNumber(document.getElementById("pEmplacamento").value);
  const editId = document.getElementById("pEditId").value;
  const dadosProposta = {
    data: document.getElementById("pData").value,
    cliente: document.getElementById("pCliente").value,
    whats: document.getElementById("pWhats").value,
    origem: document.getElementById("pOrigem").value,
    tipoVeiculo: document.getElementById("pTipoVeiculo").value,
    modalidade: document.getElementById("pModalidade").value,
    carro: document.getElementById("pCarro").value,
    versao: document.getElementById("pVersao").value,
    cor: document.getElementById("pCor").value,
    anoFab: document.getElementById("pAnoFab").value,
    anoModelo: document.getElementById("pAnoModelo").value,
    km: document.getElementById("pTipoVeiculo").value==="Seminovo" ? document.getElementById("pKm").value : "",
    pacotes: document.getElementById("pPacotes").value,
    valorCota: currencyToNumber(document.getElementById("pCota").value),
    valorCarro: currencyToNumber(document.getElementById("pValorCarro").value),
    descontoNF: currencyToNumber(document.getElementById("pDescontoNF").value),
    bonusVarejo: currencyToNumber(document.getElementById("pBonusVarejo").value),
    bonusTroca: currencyToNumber(document.getElementById("pBonusTroca").value),
    avaliacaoTroca: currencyToNumber(document.getElementById("pAvaliacaoTroca").value),
    avaliacaoTrocaIdeia: currencyToNumber(document.getElementById("pAvaliacaoTrocaIdeia").value),
    obsBonusFabrica: document.getElementById("pObsBonusFabrica").value,
    produtosFinanciamentoKeys: coletarProdutosFinanciamentoSelecionados(),
    produtosFinanciamentoPontos: [...document.querySelectorAll(".prod-financ-chk:checked")].reduce((s,c)=>s+parseFloat(c.dataset.pontos),0),
    taxas: collectTaxas(),
    ipvaMes: +document.getElementById("pIpvaMes").value || 0,
    ipva: ipva,
    emplacamento: emplacamento,
    cortesia: cortesiaAtiva,
    ipvaEmplacTotal: cortesiaAtiva ? 0 : ipva+emplacamento,
  };
  if (editId){
    const idx = state.propostas.findIndex(p=>p.id===editId);
    if (idx>-1) state.propostas[idx] = {...state.propostas[idx], ...dadosProposta};
  } else {
    state.propostas.push({
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      vendedorId: (currentVendedorPerfil && currentVendedorPerfil.id) || null,
      ...dadosProposta,
    });
  }
  persist(); renderAll();
  e.target.reset();
  document.getElementById("pEditId").value = "";
  document.getElementById("pBtnSubmit").textContent = "Salvar proposta";
  document.getElementById("pBtnCancelarEdicao").style.display = "none";
  document.getElementById("pData").value = todayISO();
  document.getElementById("pIpva").value = "";
  document.getElementById("pEmplacamento").value = "1.400,00";
  document.getElementById("pIpvaEmplacTotal").value = "";
  document.getElementById("pObsBonusFabrica").value = "Observação: Os descontos informados nesta proposta correspondem às campanhas oficiais da Volkswagen. Em determinadas negociações, é possível oferecer condições comerciais ainda mais atrativas, proporcionando um valor final ainda melhor para a compra do seu veículo.";
  marcarProdutosFinanciamento([]);
  cortesiaAtiva = false;
  document.getElementById("pBtnCortesia").classList.remove("ativo");
  document.getElementById("pBtnCortesia").textContent = "🎁 Cortesia";
  updatePropostaTotal();
  resetTaxasContainer();
  atualizarCamposProposta();
});
document.getElementById("pBtnCancelarEdicao").addEventListener("click", ()=>{
  document.getElementById("formProposta").reset();
  document.getElementById("pEditId").value = "";
  document.getElementById("pData").value = todayISO();
  document.getElementById("pIpva").value = "";
  document.getElementById("pEmplacamento").value = "1.400,00";
  document.getElementById("pIpvaEmplacTotal").value = "";
  document.getElementById("pObsBonusFabrica").value = "Observação: Os descontos informados nesta proposta correspondem às campanhas oficiais da Volkswagen. Em determinadas negociações, é possível oferecer condições comerciais ainda mais atrativas, proporcionando um valor final ainda melhor para a compra do seu veículo.";
  marcarProdutosFinanciamento([]);
  cortesiaAtiva = false;
  document.getElementById("pBtnCortesia").classList.remove("ativo");
  document.getElementById("pBtnCortesia").textContent = "🎁 Cortesia";
  document.getElementById("pBtnSubmit").textContent = "Salvar proposta";
  document.getElementById("pBtnCancelarEdicao").style.display = "none";
  updatePropostaTotal();
  resetTaxasContainer();
  atualizarCamposProposta();
});

document.getElementById("formCliente").addEventListener("submit", e=>{
  e.preventDefault();
  const veiSel = document.getElementById("clVei").value;
  state.clientes.push({
    id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    nome: document.getElementById("clNome").value,
    tel: document.getElementById("clTel").value,
    cidade: document.getElementById("clCid").value,
    veiculo: veiSel==="Outro" ? document.getElementById("clVeiOutro").value : veiSel,
    valor: currencyToNumber(document.getElementById("clVal").value),
    origem: document.getElementById("clOri").value,
    ultimoContato: document.getElementById("clUlt").value,
    obs: document.getElementById("clObs").value,
    historico: [],
    vendedorId: (currentVendedorPerfil && currentVendedorPerfil.id) || null,
  });
  persist(); renderAll();
  e.target.reset();
  document.getElementById("clVeiOutroWrap").style.display = "none";
  document.getElementById("clUlt").value = todayISO();
});
document.getElementById("chkVerTodosClientes").addEventListener("change", e=>{
  toggleVerTodosVendedor(e.target.checked);
});
document.getElementById("clVei").addEventListener("change", ()=>{
  document.getElementById("clVeiOutroWrap").style.display = document.getElementById("clVei").value==="Outro" ? "block" : "none";
});
document.getElementById("formHistorico").addEventListener("submit", e=>{
  e.preventDefault();
  const clienteId = document.getElementById("historicoClienteId").value;
  const c = state.clientes.find(x=>x.id===clienteId);
  if (!c) return;
  if (!c.historico) c.historico = [];
  c.historico.push({
    id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    data: document.getElementById("hData").value,
    hora: document.getElementById("hHora").value,
    canal: document.getElementById("hCanal").value,
    obs: document.getElementById("hObs").value,
  });
  c.ultimoContato = document.getElementById("hData").value;
  persist(); renderAll();
  document.getElementById("hObs").value = "";
  renderHistoricoLista(c);
});

document.getElementById("btnSalvarConfig").addEventListener("click", ()=>{
  // Metas são por vendedor — cada um define/edita só a própria.
  Object.assign(metasDoVendedorAtual(), {
    metaVendas: +document.getElementById("cfgMeta").value||0,
    metaSeminovos: +document.getElementById("cfgMetaSemi").value||0,
    metaConsorcios: +document.getElementById("cfgMetaConsorcio").value||0,
    metaVD: +document.getElementById("cfgMetaVD").value||0,
    metaRepasses: +document.getElementById("cfgMetaRepasse").value||0,
    metaLig: +document.getElementById("cfgLig").value||0,
    metaWpp: +document.getElementById("cfgWpp").value||0,
    metaStories: +document.getElementById("cfgSto").value||0,
    metaReels: +document.getElementById("cfgRee").value||0,
    metaFeed: +document.getElementById("cfgFeed").value||0,
    metaOfertas: +document.getElementById("cfgOfe").value||0,
    diasAlerta: +document.getElementById("cfgAlerta").value||7,
    taxaVD: +document.getElementById("cfgTaxaVD").value||0,
  });
  // O resto é da loja toda (compartilhado), não do vendedor individual.
  state.config = {
    ...state.config,
    mesRef: document.getElementById("cfgMes").value || state.config.mesRef,
    vendedor: document.getElementById("cfgVendedor").value,
    concessionaria: document.getElementById("cfgConc").value,
  };
  state.metasVolks = state.metasVolks || {};
  const metaCarrosVolks = +document.getElementById("cfgMetaVolksCarros").value || 0;
  const qtdVendedoresVolks = +document.getElementById("cfgMetaVolksVendedores").value || 0;
  if (metaCarrosVolks || qtdVendedoresVolks){
    state.metasVolks[state.config.mesRef] = { metaCarros: metaCarrosVolks, qtdVendedores: qtdVendedoresVolks };
  } else {
    delete state.metasVolks[state.config.mesRef];
  }
  persist(); renderAll();
  alert("Configurações salvas!");
});

document.getElementById("olhoComissaoBtn").addEventListener("click", (e)=>{
  e.stopPropagation();
  comissaoVisivel = !comissaoVisivel;
  atualizarVisualComissao();
});
document.getElementById("btnVerPedidos").addEventListener("click", abrirPedidosModal);
document.getElementById("btnComissaoFinal").addEventListener("click", abrirRelatorioComissao);

document.getElementById("btnSalvarMetaInsta").addEventListener("click", ()=>{
  const v = +document.getElementById("instaMetaInput").value || 0;
  metasDoVendedorAtual().metaSeguidores = v;
  persist(); renderAll();
});

document.getElementById("btnSalvarMetaSalario").addEventListener("click", ()=>{
  const v = +document.getElementById("metaSalarioInput").value || 0;
  metasDoVendedorAtual().metaSalario = v;
  persist(); renderAll();
});

document.getElementById("btnConfigMenu").addEventListener("click", (e)=>{
  e.stopPropagation();
  document.getElementById("configDropdown").classList.toggle("open");
});
document.addEventListener("click", (e)=>{
  const dd = document.getElementById("configDropdown");
  if (dd.classList.contains("open") && !dd.contains(e.target) && e.target.id !== "btnConfigMenu"){
    dd.classList.remove("open");
  }
});

document.getElementById("extMes").value = state && state.config ? state.config.mesRef : new Date().toISOString().slice(0,7);
document.getElementById("btnExtratoAtualizar").addEventListener("click", renderExtrato);
document.getElementById("btnImprimir").addEventListener("click", ()=>{ renderExtrato(); window.print(); });

/* ============================= INIT ============================= */
inicializarEstadoPadrao();
popularSelectsSalario();
maskCurrency(document.getElementById("salValor"));
document.getElementById("formSalario").addEventListener("submit", e=>{
  e.preventDefault();
  const dia = String(document.getElementById("salDia").value).padStart(2,"0");
  const mes = String(document.getElementById("salMes").value).padStart(2,"0");
  const ano = document.getElementById("salAno").value;
  const dataISO = `${ano}-${mes}-${dia}`;
  const editId = document.getElementById("salEditId").value;
  const dados = {
    data: dataISO,
    tipo: document.getElementById("salTipo").value,
    valor: currencyToNumber(document.getElementById("salValor").value),
  };
  if (editId){
    const idx = state.salarios.findIndex(s=>s.id===editId);
    if (idx>-1) state.salarios[idx] = {...state.salarios[idx], ...dados};
  } else {
    state.salarios.push({
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      vendedorId: (currentVendedorPerfil && currentVendedorPerfil.id) || null,
      ...dados,
    });
  }
  persist(); renderAll();
  cancelarEdicaoSalario();
});
document.getElementById("salBtnCancelarEdicao").addEventListener("click", cancelarEdicaoSalario);

document.getElementById("btnAbrirSalarios").addEventListener("click", ()=>{
  document.querySelectorAll("nav button").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-salarios").classList.add("active");
  renderSalarios();
  renderPontoCalendario();
});
document.getElementById("cfgRoteiroLigacao").addEventListener("change", ()=>{
  state.config.roteiroLigacaoMsg = document.getElementById("cfgRoteiroLigacao").value;
  persist();
});
document.getElementById("cfgRoteiroWhats").addEventListener("change", ()=>{
  state.config.roteiroWhatsMsg = document.getElementById("cfgRoteiroWhats").value;
  persist();
});
document.getElementById("btnRoteiroLigacoes").addEventListener("click", baixarRoteiroLigacoes);
document.getElementById("formFeriado").addEventListener("submit", e=>{
  e.preventDefault();
  state.feriadosCustom.push({
    data: document.getElementById("fData").value,
    nome: document.getElementById("fNome").value,
  });
  persist(); renderAll();
  e.target.reset();
});
document.getElementById("btnVoltarSalarios").addEventListener("click", ()=>{
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-config").classList.add("active");
  document.querySelector('nav button[data-view="config"]').classList.add("active");
});

document.getElementById("pontoMesAnterior").addEventListener("click", ()=>{
  const [y,m] = pontoMesAtual.split("-").map(Number);
  const d = new Date(y, m-2, 1);
  pontoMesAtual = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  renderPontoCalendario();
});
document.getElementById("pontoMesProximo").addEventListener("click", ()=>{
  const [y,m] = pontoMesAtual.split("-").map(Number);
  const d = new Date(y, m, 1);
  pontoMesAtual = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  renderPontoCalendario();
});
document.getElementById("pontoForaCidade").addEventListener("change", atualizarCamposPonto);
document.getElementById("pontoTransporte").addEventListener("change", atualizarCamposPonto);
document.getElementById("btnExcluirPonto").addEventListener("click", delPonto);
document.getElementById("formPonto").addEventListener("submit", e=>{
  e.preventDefault();
  const ds = document.getElementById("pontoData").value;
  const foraCidade = document.getElementById("pontoForaCidade").checked;
  pontoDoVendedor(currentVendedorPerfil && currentVendedorPerfil.id)[ds] = {
    entrada: document.getElementById("pontoEntrada").value,
    saida: document.getElementById("pontoSaida").value,
    foraCidade: foraCidade,
    transporte: foraCidade ? document.getElementById("pontoTransporte").value : "",
    carroTipo: (foraCidade && document.getElementById("pontoTransporte").value==="carro") ? document.getElementById("pontoCarroTipo").value : "",
    obs: document.getElementById("pontoObs").value,
  };
  persist(); renderAll();
  fecharPontoModal();
});

renderAll(); // estado padrão inicial, enquanto verifica sessão/carrega do banco

// Frase do dia: reavalia a cada minuto pra trocar sozinha quando o período
// do dia mudar (meio-dia / meia-noite), sem o usuário precisar atualizar a página.
setInterval(renderMensagemDia, 60000);

iniciarClienteNuvem().then(ok=>{
  if (ok){
    verificarSessaoLogin();
  } else {
    statusNuvem("🔴 Sem conexão com o banco de dados", "err");
    mostrarLoginOverlay();
  }
});