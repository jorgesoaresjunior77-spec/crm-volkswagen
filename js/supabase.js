

/* ============================= SINCRONIZAÇÃO EM NUVEM (Supabase) =============================
   O banco de dados oficial é o Supabase: a tabela crm_estado tem uma única linha (WORKSPACE_ID)
   com o state inteiro em JSON. Conexão fixa no código — nenhum aparelho precisa ser configurado
   manualmente, todos leem e gravam sempre na mesma linha, e o canal em tempo real propaga as
   mudanças entre computador, celular e qualquer outro navegador quase instantaneamente.
================================================================================================ */
const SUPABASE_URL = "https://eqpuafjokwzsemscwjij.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxcHVhZmpva3d6c2Vtc2N3amlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5OTU5NzQsImV4cCI6MjEwMTU3MTk3NH0.7t-Z29rZ9RARZ2CVFWWwHMZUo12PZS1WAClYF27daDk";
const WORKSPACE_ID = "loja1";

let supabaseClient = null;
let nuvemAssinaturaAtiva = false;
let ignorarProximoEventoRemoto = false;
let ignorarProximoEventoRemotoTimer = null;
let precisaReenviar = false;
let retentativaTimer = null;

function statusNuvem(texto, classe){
  const a = document.getElementById("saveStatus");
  if (a){ a.textContent = texto; a.className = classe; }
}

function iniciarClienteNuvem(){
  if (!window.supabase) { supabaseClient = null; return false; }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function carregarEstadoNuvem(){
  if (!supabaseClient) return;
  statusNuvem("🟡 Carregando dados do banco…", "pending");
  try{
    const { data, error } = await supabaseClient
      .from("crm_estado").select("dados").eq("id", WORKSPACE_ID).maybeSingle();
    if (error) throw error;
    if (data && data.dados){
      // O Supabase é sempre a fonte oficial: o que estiver salvo no banco substitui
      // qualquer cópia antiga que este navegador tivesse guardado localmente.
      state = data.dados;
      aplicarAjustesDeCompatibilidade();
    } else {
      await syncEstadoNuvem(); // banco vazio ainda: sobe o estado local (ex.: dados-padrão) como ponto de partida
    }
    renderAll();
    statusNuvem("🟢 Sincronizado com o banco", "ok");
    assinarMudancasRemotas();
  }catch(err){
    console.error("Erro ao carregar do banco:", err);
    renderAll(); // mantém o que já tinha sido carregado do cache local (loadLocal) como fallback temporário
    statusNuvem("🔴 Sem conexão com o banco — usando cópia local temporária", "err");
  }
}

async function syncEstadoNuvem(){
  if (!supabaseClient) return;
  clearTimeout(retentativaTimer);
  try{
    ignorarProximoEventoRemoto = true;
    clearTimeout(ignorarProximoEventoRemotoTimer);
    // se o eco em tempo real deste próprio envio não chegar por algum motivo (ex.: realtime
    // indisponível), libera a flag sozinho pra não travar a recepção de mudanças de outro aparelho
    ignorarProximoEventoRemotoTimer = setTimeout(()=>{ ignorarProximoEventoRemoto = false; }, 4000);
    const { error } = await supabaseClient
      .from("crm_estado")
      .upsert({ id: WORKSPACE_ID, dados: state, atualizado_em: new Date().toISOString() });
    if (error) throw error;
    precisaReenviar = false;
    statusNuvem("🟢 Sincronizado com o banco", "ok");
  }catch(err){
    console.error("Erro ao salvar no banco:", err);
    ignorarProximoEventoRemoto = false;
    statusNuvem("❌ Falha ao salvar no banco — verifique sua internet", "err");
    precisaReenviar = true;
    retentativaTimer = setTimeout(()=>{ if (precisaReenviar) syncEstadoNuvem(); }, 5000);
  }
}
window.addEventListener("online", ()=>{ if (precisaReenviar) syncEstadoNuvem(); });

/* ============================= FILE SYSTEM ACCESS (pasta) ============================= */
function idbOpen(){
  return new Promise((res, rej)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = ()=> req.result.createObjectStore(STORE);
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}
async function idbSet(key, val){
  const db = await idbOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(val,key);
    tx.oncomplete = ()=>res(); tx.onerror = ()=>rej(tx.error);
  });
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,"readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
  });
}

let folderNeedsReconnect = false;

async function chooseFolder(){
  if (!window.showDirectoryPicker){
    alert("Seu navegador não suporta essa função (funciona no Chrome e Edge). Use Exportar/Importar backup.");
    return;
  }
  try{
    dirHandle = await window.showDirectoryPicker();
    await idbSet("dirHandle", dirHandle);
    folderNeedsReconnect = false;
    const ok = await saveToFolder();
    if (!ok){
      alert("Conectei a pasta, mas não consegui gravar o arquivo nela agora. Tente novamente em alguns segundos, ou use Exportar backup como alternativa.");
    }
    updateFolderStatus();
  }catch(e){ /* usuário cancelou */ }
}

async function saveToFolder(){
  if (!dirHandle) return false;
  try{
    let perm = await dirHandle.queryPermission({mode:"readwrite"});
    if (perm !== "granted"){
      // requestPermission só funciona de fato quando chamado a partir de um gesto do usuário
      // (ex.: clique). Se falhar aqui (chamada automática), sinalizamos para reconectar.
      try{
        perm = await dirHandle.requestPermission({mode:"readwrite"});
      }catch(permErr){ perm = "denied"; }
      if (perm !== "granted"){
        folderNeedsReconnect = true;
        updateFolderStatus();
        document.getElementById("saveStatus").textContent = "⚠️ Pasta desconectada - clique em Reconectar pasta";
        document.getElementById("saveStatus").className = "pending";
        return false;
      }
    }
    const fh = await dirHandle.getFileHandle("crm-vendas-dados.json", {create:true});
    const w = await fh.createWritable();
    await w.write(JSON.stringify(state, null, 2));
    await w.close();
    folderNeedsReconnect = false;
    document.getElementById("saveStatus").textContent = "💾 Salvo no navegador + pasta";
    document.getElementById("saveStatus").className = "ok";
    updateFolderStatus();
    return true;
  }catch(e){
    console.warn("Falha ao salvar na pasta", e);
    folderNeedsReconnect = true;
    document.getElementById("saveStatus").textContent = "⚠️ Falha ao salvar na pasta - clique em Reconectar pasta";
    document.getElementById("saveStatus").className = "pending";
    updateFolderStatus();
    return false;
  }
}

async function tryRestoreFolder(){
  try{
    const handle = await idbGet("dirHandle");
    if (!handle) { updateFolderStatus(); return; }
    dirHandle = handle;
    const perm = await handle.queryPermission({mode:"readwrite"});
    if (perm !== "granted"){
      // sem gesto do usuário ainda nesta sessão: marca como precisando reconectar,
      // mas mantém o handle para o clique do usuário reativar a permissão.
      folderNeedsReconnect = true;
    }
    updateFolderStatus();
  }catch(e){ updateFolderStatus(); }
}

async function reconnectFolder(){
  if (!dirHandle){ chooseFolder(); return; }
  try{
    const perm = await dirHandle.requestPermission({mode:"readwrite"});
    if (perm === "granted"){
      folderNeedsReconnect = false;
      await saveToFolder();
      updateFolderStatus();
    }else{
      alert("Permissão negada. Clique novamente e escolha a pasta para reconectar.");
    }
  }catch(e){
    alert("Não foi possível reconectar. Vamos escolher a pasta novamente.");
    chooseFolder();
  }
}

function updateFolderStatus(){
  const btn = document.getElementById("btnFolder");
  if (!dirHandle){ btn.textContent = "📁 Salvar também numa pasta"; return; }
  btn.textContent = folderNeedsReconnect ? "⚠️ Reconectar pasta" : "📁 Pasta conectada ✓";
}