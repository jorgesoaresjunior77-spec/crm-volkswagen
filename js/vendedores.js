
let currentVendedorEmail = null;
let currentVendedorPerfil = null; // { id, nome, ativo, isAdmin, telefone, deveTrocarSenha }
let verTodosVendedor = false; // admin-only: ver dados de todos os vendedores, não só os próprios

// Chamado pelo checkbox "ver todos" (compartilhado entre clientes e os demais
// painéis isolados por vendedor) — sincroniza qualquer outro checkbox igual
// na tela e re-renderiza tudo.
function toggleVerTodosVendedor(v){
  verTodosVendedor = v;
  document.querySelectorAll(".chk-ver-todos-vendedor").forEach(el=>{ if (el.checked !== v) el.checked = v; });
  renderAll();
}

// Filtra um array de registros (vendas, propostas, salarios, bancoVW, clientes)
// pelo vendedor logado, usando o UUID do Supabase Auth — nunca nome/e-mail.
// Admin com "ver todos" ligado enxerga o array inteiro.
function filtrarPorVendedor(array){
  if (!Array.isArray(array)) return [];
  if (currentVendedorPerfil && currentVendedorPerfil.isAdmin && verTodosVendedor) return array;
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (!id) return array; // defensivo: não deveria acontecer pós-login
  return array.filter(item => item.vendedorId === id);
}

function atualizarInfoVendedorLogado(){
  const info = document.getElementById("vendedorLogadoInfo");
  const btnOut = document.getElementById("btnLogoutVendedor");
  if (currentVendedorEmail){
    const tag = currentVendedorPerfil && currentVendedorPerfil.isAdmin ? " · ADMIN" : "";
    if (info) info.textContent = "👤 " + currentVendedorEmail + tag;
    if (btnOut) btnOut.style.display = "block";
  } else {
    if (info) info.textContent = "";
    if (btnOut) btnOut.style.display = "none";
  }
  aplicarVisibilidadeAdmin();
}
function aplicarVisibilidadeAdmin(){
  const isAdmin = !!(currentVendedorPerfil && currentVendedorPerfil.isAdmin);
  document.querySelectorAll('[data-admin-only]').forEach(el=>{
    el.style.display = isAdmin ? "" : "none";
  });
  if (isAdmin) carregarListaVendedoresAdmin();
}
async function fazerLogoutVendedor(){
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentVendedorEmail = null;
  currentVendedorPerfil = null;
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginSenha").value = "";
  atualizarInfoVendedorLogado();
  document.getElementById("configDropdown").classList.remove("open");
  mostrarLoginOverlay();
}

/* ---- Perfil (profiles) e controle de acesso ---- */
async function carregarPerfilLogado(userId){
  const { data, error } = await supabaseClient
    .from("profiles").select("id, nome, ativo, is_admin, telefone, deve_trocar_senha").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return { id: userId, nome: data.nome, ativo: data.ativo, isAdmin: data.is_admin, telefone: data.telefone, deveTrocarSenha: data.deve_trocar_senha };
}

// Usado tanto no boot (sessão já existente) quanto no clique em "Entrar": só libera
// o app se existir um perfil ativo (ou admin) para esse usuário.
async function autenticarEControlarAcesso(user){
  currentVendedorEmail = user.email;
  currentVendedorPerfil = await carregarPerfilLogado(user.id);
  if (!currentVendedorPerfil || (!currentVendedorPerfil.ativo && !currentVendedorPerfil.isAdmin)){
    await fazerLogoutVendedor();
    document.getElementById("loginErro").textContent = "Seu acesso foi desativado. Fale com o gerente.";
    return false;
  }
  await carregarEstadoNuvem();
  esconderLoginOverlay();
  atualizarInfoVendedorLogado();
  if (currentVendedorPerfil.deveTrocarSenha) mostrarTrocarSenhaOverlay();
  return true;
}

/* ---- Painel Administração > Vendedores (somente ADMIN, protegido por RLS) ---- */
let listaVendedoresAdmin = [];

async function carregarListaVendedoresAdmin(){
  if (!supabaseClient || !currentVendedorPerfil || !currentVendedorPerfil.isAdmin) return;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, nome, telefone, ativo, is_admin, removido_em, created_at")
    .is("removido_em", null)
    .order("created_at", { ascending: true });
  if (error){ console.error("Erro ao carregar vendedores:", error); return; }
  listaVendedoresAdmin = data || [];
  renderVendedores();
  if (typeof renderMigracaoVendedorPanel === "function") renderMigracaoVendedorPanel();
  // A lista de vendedores também alimenta o nome/telefone mostrado nos cards
  // de proposta (modo "ver todos") — se ela chegar depois do primeiro paint,
  // os cards precisam se auto-corrigir.
  if (typeof renderPropostas === "function") renderPropostas();
}

function renderVendedores(){
  const tbody = document.querySelector("#vendedoresTable tbody");
  if (!tbody) return;
  if (listaVendedoresAdmin.length===0){
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum vendedor cadastrado ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = listaVendedoresAdmin.map(v=>`
    <tr>
      <td class="left">${v.nome || "—"}</td>
      <td class="left">${v.email}</td>
      <td class="left">${v.telefone || "—"} <button class="ghost" style="padding:2px 6px;font-size:10px;" onclick="editarTelefoneVendedor('${v.id}')" title="Editar telefone">✏️</button></td>
      <td>${v.ativo ? `<span class="tag green">Ativo</span>` : `<span class="tag red">Desativado</span>`}</td>
      <td>${v.is_admin ? `<span class="tag green">Admin</span>` : "Vendedor"}</td>
      <td>${new Date(v.created_at).toLocaleDateString("pt-BR")}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="toggleVendedorAtivo('${v.id}')">${v.ativo ? "Desativar" : "Reativar"}</button>
        <button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="toggleVendedorAdmin('${v.id}')">${v.is_admin ? "Remover admin" : "Tornar admin"}</button>
        <button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="redefinirSenhaVendedor('${v.email}')">Redefinir senha</button>
        <button class="danger" style="padding:4px 10px;font-size:11px;" onclick="excluirVendedor('${v.id}')">Excluir</button>
      </td>
    </tr>`).join("");
}

async function editarTelefoneVendedor(id){
  const v = listaVendedoresAdmin.find(x=>x.id===id);
  if (!v) return;
  const novo = prompt("Telefone do vendedor:", v.telefone || "");
  if (novo === null) return;
  const { error } = await supabaseClient.from("profiles").update({ telefone: novo.trim() }).eq("id", id);
  if (error){ alert("Erro: " + error.message); return; }
  await carregarListaVendedoresAdmin();
}

async function toggleVendedorAtivo(id){
  const v = listaVendedoresAdmin.find(x=>x.id===id);
  if (!v) return;
  const { error } = await supabaseClient.from("profiles").update({ ativo: !v.ativo }).eq("id", id);
  if (error){ alert("Erro: " + error.message); return; }
  await carregarListaVendedoresAdmin();
}

async function toggleVendedorAdmin(id){
  const v = listaVendedoresAdmin.find(x=>x.id===id);
  if (!v) return;
  if (v.email===currentVendedorEmail && v.is_admin && !confirm("Você vai remover SEU PRÓPRIO acesso de administrador. Continuar?")) return;
  const { error } = await supabaseClient.from("profiles").update({ is_admin: !v.is_admin }).eq("id", id);
  if (error){ alert("Erro: " + error.message); return; }
  if (v.email===currentVendedorEmail) currentVendedorPerfil.isAdmin = !v.is_admin;
  atualizarInfoVendedorLogado();
  await carregarListaVendedoresAdmin();
}

async function redefinirSenhaVendedor(email){
  if (!confirm(`Enviar email de redefinição de senha para ${email}?`)) return;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  if (error){ alert("Erro: " + error.message); return; }
  alert("Email de redefinição enviado para " + email + ".");
}

async function excluirVendedor(id){
  const v = listaVendedoresAdmin.find(x=>x.id===id);
  if (!v) return;
  if (!confirm(`Excluir o acesso de ${v.email}? Ele perde o acesso imediatamente (o histórico dele é preservado).`)) return;
  const { error } = await supabaseClient.from("profiles").update({ removido_em: new Date().toISOString(), ativo:false }).eq("id", id);
  if (error){ alert("Erro: " + error.message); return; }
  await carregarListaVendedoresAdmin();
}

/* ---- Migração única: atribui os dados existentes (sem vendedorId) a um vendedor real ----
   Só o ADMIN vê isso, e só enquanto state._vendedorMigrationDone não for true.
   Não roda sozinha — é sempre uma ação explícita e confirmada pelo admin, pra
   nunca "adivinhar" o dono de um lançamento. */
function renderMigracaoVendedorPanel(){
  const box = document.getElementById("migracaoVendedorPanel");
  if (!box) return;
  const isAdmin = !!(currentVendedorPerfil && currentVendedorPerfil.isAdmin);
  if (!isAdmin || (state && state._vendedorMigrationDone)){
    box.innerHTML = "";
    return;
  }
  const vendasSemDono = (state.vendas||[]).filter(v=>!v.vendedorId);
  if (listaVendedoresAdmin.length===0){
    box.innerHTML = `<div class="panel" style="border:2px dashed var(--orange);margin-top:16px;">
      <h2>⚠️ Migração única de dados existentes</h2>
      <p style="font-size:13px;">Cadastre pelo menos um vendedor (além de você) antes de rodar essa migração — assim ela aparece na lista abaixo pra você escolher a dona das 2 vendas já existentes (Helena).</p>
    </div>`;
    return;
  }
  const opcoesVendedor = (selecionadoId)=> `<option value="">— escolha —</option>` + listaVendedoresAdmin.map(v=>
    `<option value="${v.id}" ${v.id===selecionadoId?"selected":""}>${v.nome||v.email}${v.is_admin?" (admin)":""}</option>`
  ).join("");
  const linhasVendas = vendasSemDono.map(v=>`
    <tr>
      <td>${fmtDate(v.data)}</td><td class="left">${v.cliente||"—"}</td><td class="left">${v.carro||""} ${v.modelo||""}</td><td>${moneyFmt(v.valor)}</td>
      <td><select class="migracao-venda-select" data-venda-id="${v.id}">${opcoesVendedor("")}</select></td>
    </tr>`).join("");
  box.innerHTML = `<div class="panel" style="border:2px dashed var(--orange);margin-top:16px;">
    <h2>⚠️ Migração única de dados existentes <span>diga a quem pertence cada dado que já existe no sistema — isso só pode ser feito uma vez</span></h2>
    ${vendasSemDono.length ? `
      <div class="table-wrap">
        <table><thead><tr><th>Data</th><th>Cliente</th><th>Carro</th><th>Valor</th><th>Pertence a</th></tr></thead>
        <tbody>${linhasVendas}</tbody></table>
      </div>` : `<p style="font-size:13px;">Nenhuma venda sem dono encontrada.</p>`}
    <div class="metagrid" style="margin-top:14px;">
      <div>
        <label>Todos os demais dados existentes (propostas, salários, histórico do Banco VW, clientes sem dono, painel diário, ponto, humor e metas atuais) pertencem a:</label>
        <select id="migracaoRestoSelect">${opcoesVendedor("")}</select>
      </div>
    </div>
    <div style="margin-top:12px;">
      <button class="primary" id="btnConfirmarMigracaoVendedor" style="width:auto;">Confirmar migração (executa uma única vez)</button>
    </div>
  </div>`;
  document.getElementById("btnConfirmarMigracaoVendedor").addEventListener("click", ()=>{
    const restoId = document.getElementById("migracaoRestoSelect").value;
    if (!restoId){ alert("Escolha a quem pertence o restante dos dados."); return; }
    const mapaVendas = {};
    let faltaAlguma = false;
    document.querySelectorAll(".migracao-venda-select").forEach(sel=>{
      if (!sel.value) faltaAlguma = true;
      mapaVendas[sel.dataset.vendaId] = sel.value;
    });
    if (faltaAlguma){ alert("Escolha o dono de cada venda listada antes de confirmar."); return; }
    const nomeResto = (listaVendedoresAdmin.find(v=>v.id===restoId)||{}).nome || "esse vendedor";
    if (!confirm(`Confirma? As vendas listadas vão para o vendedor escolhido em cada linha, e TODO O RESTANTE dos dados existentes (propostas, salários, Banco VW, clientes sem dono, painel diário, ponto, humor e metas atuais) vai para "${nomeResto}". Essa ação não pode ser desfeita.`)) return;
    executarMigracaoVendedorInicial(mapaVendas, restoId);
  });
}

function executarMigracaoVendedorInicial(mapaVendasEscolhido, restoId){
  state.vendas.forEach(v=>{ if (!v.vendedorId) v.vendedorId = mapaVendasEscolhido[v.id] || restoId; });
  state.propostas.forEach(p=>{ if (!p.vendedorId) p.vendedorId = restoId; });
  state.salarios.forEach(s=>{ if (!s.vendedorId) s.vendedorId = restoId; });
  (state.bancoVW||[]).forEach(b=>{ if (!b.vendedorId) b.vendedorId = restoId; });
  state.clientes.forEach(c=>{
    if (c.vendedorId) return;
    const porEmail = c.criadoPor && listaVendedoresAdmin.find(v=>v.email===c.criadoPor);
    c.vendedorId = porEmail ? porEmail.id : restoId;
  });
  state.metasPorVendedor = state.metasPorVendedor || {};
  if (!state.metasPorVendedor[restoId]){
    state.metasPorVendedor[restoId] = {
      metaVendas: state.config.metaVendas, comissaoCarro: state.config.comissaoCarro, taxaVD: state.config.taxaVD,
      metaSeminovos: state.config.metaSeminovos, metaConsorcios: state.config.metaConsorcios, metaVD: state.config.metaVD,
      metaRepasses: state.config.metaRepasses, metaSeguidores: state.config.metaSeguidores, metaSalario: state.config.metaSalario,
      metaLig: state.config.metaLig, metaWpp: state.config.metaWpp, metaStories: state.config.metaStories,
      metaReels: state.config.metaReels, metaFeed: state.config.metaFeed, metaOfertas: state.config.metaOfertas,
      diasAlerta: state.config.diasAlerta,
    };
  }
  // state.dias/ponto/humor ainda estão no formato antigo (plano, por data) —
  // envolve tudo isso sob a chave do vendedor escolhido pro "resto".
  state.dias = { [restoId]: state.dias || {} };
  state.ponto = { [restoId]: state.ponto || {} };
  state.humor = { [restoId]: state.humor || {} };
  state._vendedorMigrationDone = true;
  persist(); renderAll();
  renderMigracaoVendedorPanel();
  alert("Migração concluída! Cada vendedor agora vê apenas os próprios dados.");
}
