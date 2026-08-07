

/* ============================= SINCRONIZAÇÃO EM NUVEM (Supabase) =============================
   Cada "loja" (WORKSPACE_ID) tem uma única linha na tabela crm_estado, com o state inteiro em
   JSON. Todo computador conectado com a mesma URL/chave/código da loja lê e grava nessa mesma
   linha, e o canal em tempo real avisa os outros quando alguém salva algo novo.
================================================================================================ */
let supabaseClient = null;
let nuvemAssinaturaAtiva = false;
let ignorarProximoEventoRemoto = false;
let pushNuvemTimer = null;

function carregarConfigNuvem(){
  try{ return JSON.parse(localStorage.getItem("crmVwSyncConfig") || "null"); }
  catch(e){ return null; }
}
function salvarConfigNuvem(cfg){ localStorage.setItem("crmVwSyncConfig", JSON.stringify(cfg)); }

function statusNuvem(texto, classe){
  const a = document.getElementById("saveStatus");
  const b = document.getElementById("syncStatusConfig");
  if (a){ a.textContent = texto; a.className = classe; }
  if (b){ b.textContent = texto; b.style.color = classe==="ok" ? "var(--green)" : classe==="err" ? "var(--red)" : "#B8860B"; }
}

function iniciarClienteNuvem(){
  const cfg = carregarConfigNuvem();
  if (!cfg || !cfg.url || !cfg.key || !cfg.workspace || !window.supabase) { supabaseClient = null; return false; }
  supabaseClient = window.supabase.createClient(cfg.url, cfg.key);
  return true;
}

async function carregarEstadoNuvem(){
  if (!supabaseClient) return;
  const cfg = carregarConfigNuvem();
  statusNuvem("🟡 Buscando dados da nuvem…", "pending");
  try{
    const { data, error } = await supabaseClient
      .from("crm_estado").select("dados").eq("id", cfg.workspace).maybeSingle();
    if (error) throw error;
    if (data && data.dados){
      state = data.dados;
      aplicarAjustesDeCompatibilidade();
      renderAll();
    } else {
      await syncEstadoNuvem(true); // nada na nuvem ainda: sobe o estado local como ponto de partida
    }
    statusNuvem("🟢 Sincronizado com a nuvem", "ok");
    assinarMudancasRemotas();
  }catch(err){
    console.error("Erro ao buscar da nuvem:", err);
    statusNuvem("🔴 Sem conexão com a nuvem - usando dados deste navegador", "err");
  }
}

async function syncEstadoNuvem(forcarAgora){
  if (!supabaseClient) return;
  const cfg = carregarConfigNuvem();
  if (!cfg) return;
  clearTimeout(pushNuvemTimer);
  const enviar = async ()=>{
    try{
      ignorarProximoEventoRemoto = true;
      const { error } = await supabaseClient
        .from("crm_estado")
        .upsert({ id: cfg.workspace, dados: state, atualizado_em: new Date().toISOString() });
      if (error) throw error;
      statusNuvem("🟢 Sincronizado com a nuvem", "ok");
    }catch(err){
      console.error("Erro ao salvar na nuvem:", err);
      statusNuvem("🟡 Salvo neste navegador - sem internet pra sincronizar", "pending");
    }
  };
  if (forcarAgora) await enviar(); else pushNuvemTimer = setTimeout(enviar, 800);
}

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