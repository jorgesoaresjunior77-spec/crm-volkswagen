
let currentVendedorEmail = null;
let currentVendedorPerfil = null; // { nome, ativo, isAdmin }
let verTodosClientesVendedor = false;

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
    .from("profiles").select("nome, ativo, is_admin").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return { nome: data.nome, ativo: data.ativo, isAdmin: data.is_admin };
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
  return true;
}

/* ---- Painel Administração > Vendedores (somente ADMIN, protegido por RLS) ---- */
let listaVendedoresAdmin = [];

async function carregarListaVendedoresAdmin(){
  if (!supabaseClient || !currentVendedorPerfil || !currentVendedorPerfil.isAdmin) return;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, nome, ativo, is_admin, removido_em, created_at")
    .is("removido_em", null)
    .order("created_at", { ascending: true });
  if (error){ console.error("Erro ao carregar vendedores:", error); return; }
  listaVendedoresAdmin = data || [];
  renderVendedores();
}

function renderVendedores(){
  const tbody = document.querySelector("#vendedoresTable tbody");
  if (!tbody) return;
  if (listaVendedoresAdmin.length===0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum vendedor cadastrado ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = listaVendedoresAdmin.map(v=>`
    <tr>
      <td class="left">${v.nome || "—"}</td>
      <td class="left">${v.email}</td>
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
