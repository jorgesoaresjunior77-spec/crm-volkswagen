

const FIPE_API_BASE = "https://fipe.parallelum.com.br/api/v2";
async function fipeFetch(caminho){
  const resp = await fetch(`${FIPE_API_BASE}${caminho}`, { headers: { "accept":"application/json" } });
  if (!resp.ok) throw new Error("Falha na consulta FIPE ("+resp.status+")");
  return resp.json();
}
async function fipeCarregarMarcas(){
  const tipo = document.getElementById("fipeTipo").value;
  const selMarca = document.getElementById("fipeMarca");
  const selModelo = document.getElementById("fipeModelo");
  const selAno = document.getElementById("fipeAno");
  selMarca.innerHTML = `<option value="">Carregando marcas...</option>`;
  selModelo.innerHTML = `<option value="">Escolha a marca primeiro</option>`;
  selModelo.disabled = true;
  selAno.innerHTML = `<option value="">Escolha o modelo primeiro</option>`;
  selAno.disabled = true;
  document.getElementById("fipeResultadoBox").innerHTML = "";
  try{
    const marcas = await fipeFetch(`/${tipo}/brands`);
    selMarca.innerHTML = `<option value="">Selecione a marca</option>` + marcas.map(m=>`<option value="${m.code}">${m.name}</option>`).join("");
  } catch(e){
    selMarca.innerHTML = `<option value="">Erro ao carregar — tente de novo</option>`;
  }
}
async function fipeCarregarModelos(){
  const tipo = document.getElementById("fipeTipo").value;
  const brandId = document.getElementById("fipeMarca").value;
  const selModelo = document.getElementById("fipeModelo");
  const selAno = document.getElementById("fipeAno");
  document.getElementById("fipeResultadoBox").innerHTML = "";
  if (!brandId){ selModelo.innerHTML = `<option value="">Escolha a marca primeiro</option>`; selModelo.disabled = true; return; }
  selModelo.disabled = false;
  selModelo.innerHTML = `<option value="">Carregando modelos...</option>`;
  selAno.innerHTML = `<option value="">Escolha o modelo primeiro</option>`;
  selAno.disabled = true;
  try{
    const modelos = await fipeFetch(`/${tipo}/brands/${brandId}/models`);
    selModelo.innerHTML = `<option value="">Selecione o modelo</option>` + modelos.map(m=>`<option value="${m.code}">${m.name}</option>`).join("");
  } catch(e){
    selModelo.innerHTML = `<option value="">Erro ao carregar — tente de novo</option>`;
  }
}
async function fipeCarregarAnos(){
  const tipo = document.getElementById("fipeTipo").value;
  const brandId = document.getElementById("fipeMarca").value;
  const modelId = document.getElementById("fipeModelo").value;
  const selAno = document.getElementById("fipeAno");
  document.getElementById("fipeResultadoBox").innerHTML = "";
  if (!modelId){ selAno.innerHTML = `<option value="">Escolha o modelo primeiro</option>`; selAno.disabled = true; return; }
  selAno.disabled = false;
  selAno.innerHTML = `<option value="">Carregando anos...</option>`;
  try{
    const anos = await fipeFetch(`/${tipo}/brands/${brandId}/models/${modelId}/years`);
    selAno.innerHTML = `<option value="">Selecione o ano</option>` + anos.map(a=>`<option value="${a.code}">${a.name}</option>`).join("");
  } catch(e){
    selAno.innerHTML = `<option value="">Erro ao carregar — tente de novo</option>`;
  }
}
async function fipeConsultarPreco(){
  const tipo = document.getElementById("fipeTipo").value;
  const brandId = document.getElementById("fipeMarca").value;
  const modelId = document.getElementById("fipeModelo").value;
  const yearId = document.getElementById("fipeAno").value;
  const box = document.getElementById("fipeResultadoBox");
  if (!yearId) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="empty">Consultando...</div>`;
  try{
    const info = await fipeFetch(`/${tipo}/brands/${brandId}/models/${modelId}/years/${yearId}`);
    box.innerHTML = `
      <div style="background:var(--card-tint);border:1.5px solid var(--navy);border-radius:14px;padding:18px 20px;">
        <div style="font-size:10px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:.3px;">${info.brand} · Código FIPE ${info.codeFipe||"—"}</div>
        <div style="font-size:16px;font-weight:800;color:var(--graphite);margin-top:4px;">${info.model}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">Ano modelo ${info.modelYear||"—"} · Combustível: ${info.fuel||"—"}</div>
        <div style="font-size:30px;font-weight:800;color:var(--orange-deep);margin-top:10px;">${info.price}</div>
        <div style="font-size:10.5px;color:var(--text-mute);margin-top:4px;">Referência: ${info.referenceMonth}</div>
      </div>`;
  } catch(e){
    box.innerHTML = `<div class="empty">Não foi possível consultar agora. Tente novamente em instantes.</div>`;
  }
}
let fipeJaCarregado = false;
function renderFipeDetran(){
  if (fipeJaCarregado) return;
  fipeJaCarregado = true;
  fipeCarregarMarcas();
}