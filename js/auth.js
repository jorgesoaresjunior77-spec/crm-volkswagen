

function mostrarLoginOverlay(){
  const ov = document.getElementById("loginOverlay");
  if (ov) ov.style.display = "flex";
}
function esconderLoginOverlay(){
  const ov = document.getElementById("loginOverlay");
  if (ov) ov.style.display = "none";
}
async function verificarSessaoLogin(){
  if (!supabaseClient){ esconderLoginOverlay(); return; }
  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session){
    currentVendedorEmail = data.session.user.email;
    await carregarEstadoNuvem();
    const v = garantirVendedorNaLista();
    if (v.ativo === false){
      await fazerLogoutVendedor();
      document.getElementById("loginErro").textContent = "Seu acesso foi desativado. Fale com o gerente.";
      return;
    }
    esconderLoginOverlay();
    atualizarInfoVendedorLogado();
  } else {
    atualizarInfoVendedorLogado();
    mostrarLoginOverlay();
  }
}


/* ============================= RENDER: DASHBOARD ============================= */
let pedidosModalMostradoNestaSessao = false;