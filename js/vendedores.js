
let currentVendedorEmail = null;
let verTodosClientesVendedor = false;
function atualizarInfoVendedorLogado(){
  const info = document.getElementById("vendedorLogadoInfo");
  const btnOut = document.getElementById("btnLogoutVendedor");
  if (currentVendedorEmail){
    if (info) info.textContent = "👤 " + currentVendedorEmail;
    if (btnOut) btnOut.style.display = "block";
  } else {
    if (info) info.textContent = "";
    if (btnOut) btnOut.style.display = "none";
  }
}
async function fazerLogoutVendedor(){
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentVendedorEmail = null;
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginSenha").value = "";
  atualizarInfoVendedorLogado();
  document.getElementById("configDropdown").classList.remove("open");
  mostrarLoginOverlay();
}

/* ---- Gestão de vendedores (sem precisar entrar no Supabase) ---- */
function garantirVendedorNaLista(){
  if (!state.vendedores) state.vendedores = [];
  let v = state.vendedores.find(x=>x.email===currentVendedorEmail);
  if (!v){
    v = { email: currentVendedorEmail, nome: "", ativo: true, criadoEm: new Date().toISOString() };
    state.vendedores.push(v);
    persist(); syncEstadoNuvem(true);
  }
  return v;
}
function renderVendedores(){
  const tbody = document.querySelector("#vendedoresTable tbody");
  if (!tbody) return;
  const lista = state.vendedores || [];
  if (lista.length===0){
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Nenhum vendedor cadastrado ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map((v,i)=>`
    <tr>
      <td class="left">${v.nome || "—"}</td>
      <td class="left">${v.email}</td>
      <td>${v.ativo!==false ? `<span class="tag green">Ativo</span>` : `<span class="tag red">Desativado</span>`}</td>
      <td><button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="toggleVendedorAtivo(${i})">${v.ativo!==false ? "Desativar" : "Reativar"}</button></td>
    </tr>`).join("");
}
function toggleVendedorAtivo(idx){
  const v = state.vendedores[idx];
  if (!v) return;
  v.ativo = v.ativo===false ? true : false;
  persist(); syncEstadoNuvem(true); renderVendedores();
}