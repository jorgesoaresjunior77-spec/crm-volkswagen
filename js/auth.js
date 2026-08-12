

function mostrarLoginOverlay(){
  const ov = document.getElementById("loginOverlay");
  const app = document.getElementById("appShell");
  if (ov) ov.style.display = "flex";
  if (app) app.style.display = "none";
}
function esconderLoginOverlay(){
  const ov = document.getElementById("loginOverlay");
  const app = document.getElementById("appShell");
  if (ov) ov.style.display = "none";
  if (app) app.style.display = "block";
}
function mostrarTrocarSenhaOverlay(){
  const ov = document.getElementById("trocarSenhaOverlay");
  if (ov) ov.style.display = "flex";
}
function esconderTrocarSenhaOverlay(){
  const ov = document.getElementById("trocarSenhaOverlay");
  if (ov) ov.style.display = "none";
}
async function verificarSessaoLogin(){
  if (!supabaseClient){ mostrarLoginOverlay(); return; }
  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session){
    await autenticarEControlarAcesso(data.session.user);
  } else {
    atualizarInfoVendedorLogado();
    mostrarLoginOverlay();
  }
}


/* ============================= RENDER: DASHBOARD ============================= */
let pedidosModalMostradoNestaSessao = false;
