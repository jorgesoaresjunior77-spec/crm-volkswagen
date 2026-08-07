
function irParaPedidoCliente(clienteId){
  fecharPedidosModal();
  const btnClientes = document.querySelector('nav button[data-view="clientes"]');
  if (btnClientes) btnClientes.click();
  setTimeout(()=>{
    const linha = document.getElementById("cliente-row-"+clienteId);
    if (!linha) return;
    if (typeof linha.scrollIntoView === "function"){
      linha.scrollIntoView({behavior:"smooth", block:"center"});
    }
    linha.classList.add("linha-destacada");
    setTimeout(()=> linha.classList.remove("linha-destacada"), 2800);
  }, 200);
}

function renderClientes(){
  const cfg = state.config;
  const tbody = document.querySelector("#clientesTable tbody");
  const chk = document.getElementById("chkVerTodosClientes");
  if (chk) chk.checked = verTodosClientesVendedor;
  // Filtra por vendedor logado, a menos que "ver todos" esteja marcado.
  // Clientes sem "criadoPor" (cadastrados antes desse recurso) aparecem para todos.
  const clientesVisiveis = (currentVendedorEmail && !verTodosClientesVendedor)
    ? state.clientes.filter(c => !c.criadoPor || c.criadoPor === currentVendedorEmail)
    : state.clientes;
  if (clientesVisiveis.length===0){
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Nenhum cliente cadastrado ainda.</td></tr>`;
    return;
  }
  function diasSemContatoDe(c){
    if (!c.ultimoContato) return Infinity; // nunca contatado = mais antigo de todos, vai pro final
    return Math.floor((new Date() - new Date(c.ultimoContato+"T00:00:00"))/86400000);
  }
  const clientesOrdenados = [...clientesVisiveis].sort((a,b)=> diasSemContatoDe(a) - diasSemContatoDe(b));
  tbody.innerHTML = clientesOrdenados.map(c=>{
    let diasSemContato = "—", cls="";
    if (c.ultimoContato){
      const dias = diasSemContatoDe(c);
      diasSemContato = dias;
      cls = dias>=cfg.diasAlerta ? "red" : dias>=cfg.diasAlerta/2 ? "yellow" : "green";
    }
    const qtdHist = (c.historico||[]).length;
    return `<tr id="cliente-row-${c.id}">
      <td class="left">${c.nome}</td><td>${c.tel||""}</td><td>${c.cidade||""}</td><td class="left">${c.veiculo||""}</td>
      <td>${moneyFmt(c.valor)}</td><td>${c.origem}</td><td>${fmtDate(c.ultimoContato)}</td>
      <td class="left">${c.obs||""}</td>
      <td>${cls?`<span class="tag ${cls}">${diasSemContato} dias</span>`:"—"}</td>
      <td><button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="abrirHistoricoModal('${c.id}')">📋 ${qtdHist>0?qtdHist:"Ver"}</button></td>
      <td><button class="danger" onclick="delCliente('${c.id}')" title="Excluir">✕</button></td>
    </tr>`;
  }).join("");
}
const CANAL_ICONE = {"WhatsApp":"💬","Ligação":"📞","Presencial":"🏬","Instagram":"📸","Outro":"📌"};
function abrirEmplacamentosModal(){
  renderEmplacamentosModal();
  document.getElementById("emplacamentosModalOverlay").classList.add("open");
}
function fecharEmplacamentosModal(){
  document.getElementById("emplacamentosModalOverlay").classList.remove("open");
}
const PENDENCIA_CATEGORIAS = [
  { key:"emplacamento", flagCampo:"emplacamento", valorCampo:"emplacamentoValor", pagoCampo:"emplacamentoPago", tabelaId:"tblEmplacamentos", tipoSalario:"Emplacamento", icone:"🚙", label:"Emplacamento" },
  { key:"acessorios", flagCampo:null, valorCampo:"acessoriosValor", pagoCampo:"acessoriosPago", tabelaId:"tblAcessorios", tipoSalario:"Acessórios", icone:"🧰", label:"Acessórios" },
  { key:"seguro", flagCampo:null, valorCampo:"seguroValor", pagoCampo:"seguroPago", tabelaId:"tblSeguro", tipoSalario:"Seguros", icone:"🛡️", label:"Seguro" },
];
function renderEmplacamentosModal(){
  const vMesTodas = vendasDoMesAtual();
  let totalGeral=0, totalGeralPago=0, totalGeralAPagar=0;

  PENDENCIA_CATEGORIAS.forEach(cat=>{
    const vMes = vMesTodas.filter(v => cat.flagCampo ? v[cat.flagCampo] : (Number(v[cat.valorCampo])||0)>0);
    const lista = [...vMes].sort((a,b)=> (b.data||"").localeCompare(a.data||""));
    const total = vMes.reduce((s,v)=>s+(Number(v[cat.valorCampo])||0),0);
    const totalPago = vMes.filter(v=>v[cat.pagoCampo]).reduce((s,v)=>s+(Number(v[cat.valorCampo])||0),0);
    const totalAPagar = vMes.filter(v=>!v[cat.pagoCampo]).reduce((s,v)=>s+(Number(v[cat.valorCampo])||0),0);
    totalGeral += total; totalGeralPago += totalPago; totalGeralAPagar += totalAPagar;

    document.querySelector(`#${cat.tabelaId} tbody`).innerHTML = lista.length ? lista.map(v=>`
      <tr>
        <td>${fmtDate(v.data)}</td><td class="left">${v.cliente||""}</td><td class="left">${v.carro||""} ${v.modelo||""}</td>
        <td>${moneyFmt(v[cat.valorCampo])}</td>
        <td><label style="display:flex;align-items:center;gap:6px;justify-content:center;cursor:pointer;">
          <input type="checkbox" ${v[cat.pagoCampo]?"checked":""} onchange="togglePendenciaPago('${cat.key}','${v.id}')" style="width:auto;">
          ${v[cat.pagoCampo]?`<span class="tag green">Pago</span>`:`<span class="tag red">Pendente</span>`}
        </label></td>
      </tr>`).join("") : `<tr><td colspan="5" class="empty">Nenhum registro de ${cat.label.toLowerCase()} este mês.</td></tr>`;
  });

  document.getElementById("emplacamentosResumoCards").innerHTML = [
    ["🧾 Total Geral (as 3 categorias)", moneyFmt(totalGeral)],
    ["🔴 Total a Pagar", moneyFmt(totalGeralAPagar)],
    ["🟢 Total Pago", moneyFmt(totalGeralPago)],
  ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:16px;">${v}</div></div>`).join("");
}
function togglePendenciaPago(catKey, vendaId){
  const cat = PENDENCIA_CATEGORIAS.find(c=>c.key===catKey);
  const v = state.vendas.find(x=>x.id===vendaId);
  if (!v || !cat) return;
  v[cat.pagoCampo] = !v[cat.pagoCampo];
  state.salarios = state.salarios || [];
  const marcador = `${catKey}:${vendaId}`;
  if (v[cat.pagoCampo]){
    const jaExiste = state.salarios.some(s=>s.origemVendaId===marcador);
    if (!jaExiste){
      state.salarios.push({
        id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
        data: todayISO(),
        tipo: cat.tipoSalario,
        valor: Number(v[cat.valorCampo])||0,
        origemVendaId: marcador,
        obs: `${v.cliente||""} — ${v.carro||""} ${v.modelo||""}`.trim(),
      });
    }
  } else {
    state.salarios = state.salarios.filter(s=>s.origemVendaId!==marcador);
  }
  persist(); renderAll();
  renderEmplacamentosModal();
}
function toggleEmplacamentoPago(vendaId){
  togglePendenciaPago("emplacamento", vendaId);
}
function delCliente(id){
  if (!confirm("Excluir este cliente?")) return;
  state.clientes = state.clientes.filter(c=>c.id!==id);
  persist(); renderAll();
}