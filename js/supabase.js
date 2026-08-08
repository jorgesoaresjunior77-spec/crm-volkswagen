

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
    renderAll();
    statusNuvem("🔴 Sem conexão com o banco de dados", "err");
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