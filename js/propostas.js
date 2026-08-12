
function delEntrada(k, ts){
  if (!confirm("Excluir este lançamento específico?")) return;
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (id){
    const dias = diasDoVendedor(id);
    dias[k] = (dias[k]||[]).filter(e=>String(e.ts)!==String(ts));
    if (dias[k].length===0) delete dias[k];
  }
  persist(); renderAll();
}
function abrirRelatorioComissao(){
  const vMes = vendasDoMesAtual();
  const porTipo = {};
  vMes.forEach(v=>{
    const t = v.tipoLabel || "Outro";
    if (!porTipo[t]) porTipo[t] = {qtd:0, valor:0, comissao:0};
    porTipo[t].qtd++;
    porTipo[t].valor += Number(v.valor)||0;
    porTipo[t].comissao += Number(v.comissao)||0;
  });
  const emplacTotal = vMes.reduce((s,v)=>s+(Number(v.emplacamentoValor)||0),0);
  const emplacQtd = vMes.filter(v=>v.emplacamento).length;
  const retornoBancoTotal = vMes.reduce((s,v)=>s+(Number(v.retornoBanco)||0),0);
  const vendasComRetorno = vMes.filter(v=>v.retornoBanco>0).length;
  const acessoriosTotalRel = vMes.reduce((s,v)=>s+(Number(v.acessoriosValor)||0),0);
  const vendasComAcessorios = vMes.filter(v=>(Number(v.acessoriosValor)||0)>0).length;
  const seguroTotalRel = vMes.reduce((s,v)=>s+(Number(v.seguroValor)||0),0);
  const vendasComSeguro = vMes.filter(v=>(Number(v.seguroValor)||0)>0).length;
  const comissaoVendas = vMes.reduce((s,v)=>s+(Number(v.comissao)||0),0);
  const linhasVendas = vMes.length
    ? [...vMes].sort((a,b)=>(a.data||"").localeCompare(b.data||"")).map(v=>`
      <tr>
        <td>${fmtDate(v.data)}</td>
        <td>${v.modelo||v.carro||"—"}${v.versao?(" "+v.versao):""}</td>
        <td>${tipoDisplay(v)}</td>
        <td>${moneyFmt(v.valor)}</td>
        <td><b>${moneyFmt(v.comissao)}</b></td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty">Nenhuma venda cadastrada este mês.</td></tr>`;
  const linhasResumo = Object.entries(porTipo).map(([tipo,d])=>`
    <tr style="background:var(--card-tint);">
      <td colspan="3"><b>Subtotal ${tipo}</b> — ${d.qtd} negócio(s)</td>
      <td>${moneyFmt(d.valor)}</td>
      <td><b>${moneyFmt(d.comissao)}</b></td>
    </tr>`).join("");
  const html = `
    <div class="prop-card" style="max-width:none;padding-right:18px;">
      <div class="prop-card-brand">
        <div class="vw-badge">VW</div>
        <div class="brand-name">Relatório de Comissão do Mês</div>
      </div>
      <div class="table-wrap">
        <table style="width:100%;font-size:12.5px;">
          <thead><tr><th>Data</th><th>Carro</th><th>Tipo</th><th>Valor</th><th>Comissão</th></tr></thead>
          <tbody>${linhasVendas}</tbody>
          <tfoot>
            ${linhasResumo}
            <tr style="background:var(--card-tint);"><td colspan="3"><b>Emplacamentos</b> — ${emplacQtd} negócio(s)</td><td></td><td><b>${moneyFmt(emplacTotal)}</b></td></tr>
            <tr style="background:var(--card-tint);"><td colspan="3"><b>Retorno do Banco VW</b> — ${vendasComRetorno} negócio(s)</td><td></td><td><b>${moneyFmt(retornoBancoTotal)}</b></td></tr>
            <tr style="background:var(--card-tint);"><td colspan="3"><b>Acessórios</b> — ${vendasComAcessorios} negócio(s)</td><td></td><td><b>${moneyFmt(acessoriosTotalRel)}</b></td></tr>
            <tr style="background:var(--card-tint);"><td colspan="3"><b>Seguro</b> — ${vendasComSeguro} negócio(s)</td><td></td><td><b>${moneyFmt(seguroTotalRel)}</b></td></tr>
            <tr style="background:var(--orange);"><td colspan="3" style="color:#fff;"><b>Comissão Final do Vendedor</b></td><td></td><td style="color:#fff;"><b>${moneyFmt(comissaoVendas+emplacTotal+retornoBancoTotal+acessoriosTotalRel+seguroTotalRel)}</b></td></tr>
          </tfoot>
        </table>
      </div>
    </div>
    <div class="prop-card-actions" style="position:static;display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="prop-card-close" onclick="fecharRelatorio()" title="Fechar">✕</button>
    </div>`;
  document.getElementById("relatorioContent").innerHTML = html;
  document.getElementById("relatorioOverlay").classList.add("open");
}
function getTaxasList(p){
  if (Array.isArray(p.taxas) && p.taxas.length) return p.taxas;
  if (p.taxaMensal || p.entradaPct || p.parcelas) return [{taxaMensal:p.taxaMensal||0, entradaPct:p.entradaPct||0, parcelas:p.parcelas||0}];
  return [];
}
// Nome/telefone reais do vendedor dono da proposta.
// Usa o próprio perfil logado quando é a proposta dele; usa a lista de
// vendedores (já carregada pro admin) quando é de outro vendedor no modo
// "ver todos".
function infoVendedorParaCard(vendedorId){
  if (currentVendedorPerfil && currentVendedorPerfil.id === vendedorId){
    return { nome: currentVendedorPerfil.nome || "—", telefone: currentVendedorPerfil.telefone || "—" };
  }
  const v = (typeof listaVendedoresAdmin !== "undefined" ? listaVendedoresAdmin : []).find(x=>x.id===vendedorId);
  return { nome: (v && v.nome) || "—", telefone: (v && v.telefone) || "—" };
}
function propostaCardHTML(p){
  const vendedorInfo = infoVendedorParaCard(p.vendedorId);
  // Regra definitiva: ADMIN sempre vê foto + QR code (a marca pessoal dele,
  // usada em toda proposta impressa/exibida); vendedor comum vê só nome+telefone.
  // Depende só do perfil de quem está logado agora — nunca é ocultado globalmente.
  const ehAdminLogado = !!(currentVendedorPerfil && currentVendedorPerfil.isAdmin);
  const taxas = getTaxasList(p);
  const taxasHTML = taxas.length
    ? taxas.map((t,i)=>{
        const parcelaTxt = t.parcelas ? ` · <b>${t.parcelas}x</b> de ${moneyFmt(t.valorPrestacao||0)}` : "";
        return `<div class="taxa-chip"><b>Opção ${i+1}:</b> ${(Number(t.taxaMensal)||0).toFixed(2)}% a.m. · entrada ${(Number(t.entradaPct)||0).toFixed(0)}% (${moneyFmt(t.valorEntrada||0)}) · financiado ${moneyFmt(t.valorFinanciado||0)}${parcelaTxt}</div>`;
      }).join("")
    : `<div class="taxa-chip" style="color:var(--text-mute)">Nenhuma opção de financiamento cadastrada</div>`;
  const prestacoesLegado = Array.isArray(p.prestacoes) ? p.prestacoes : [];
  const prestacoesLegadoHTML = prestacoesLegado.length
    ? `<div class="prop-taxas-label" style="margin-top:6px;">Prestações (proposta antiga)</div>` + prestacoesLegado.map(pr=>`<div class="taxa-chip"><b>${pr.parcelas}x</b> de ${moneyFmt(pr.valor)}</div>`).join("")
    : "";
  const ipvaLabel = p.ipvaMes ? `IPVA (${MESES_IPVA[p.ipvaMes-1]} · ${IPVA_PCT_POR_MES[p.ipvaMes-1].toFixed(2)}%)` : "IPVA";
  return `<div class="prop-card" data-prop-id="${p.id}">
    <div class="prop-card-brand">
      <div class="vw-badge">VW</div>
      <div class="brand-name">Motomecânica Volkswagen</div>
    </div>
    <div class="prop-card-head">
      <div>
        <div class="prop-card-cliente">${p.cliente||"—"}</div>
        <div class="prop-card-sub">${p.whats?"📱 "+p.whats:""}${p.whats&&p.origem?" · ":""}${p.origem||""}</div>
      </div>
      <div class="prop-card-date">${fmtDate(p.data)}</div>
    </div>
    <div class="prop-card-veh">${(p.tipoVeiculo||"0KM")==="Seminovo"?"🚘 SEMINOVO · ":"🚗 0KM · "}${p.carro||""}${p.versao?(" · "+p.versao):""}${p.cor?(" · "+p.cor):""}${(p.anoFab||p.anoModelo)?(" · "+(p.anoFab||"—")+"/"+(p.anoModelo||"—")):""}${p.km?(" · "+Number(p.km).toLocaleString("pt-BR")+" km"):""}${p.modalidade&&p.modalidade!=="Varejo"?(" · 🏷️ "+p.modalidade):""}</div>
    ${p.pacotes ? `<div style="font-size:11.5px;color:var(--text-dim);margin-top:-8px;margin-bottom:12px;"><b style="color:var(--graphite);">Pacotes:</b> ${p.pacotes}</div>` : ""}
    <div class="prop-grid">
      <div><span>Valor de Tabela</span><b>${moneyFmt(p.valorCota)}</b></div>
      <div><span>Valor do Carro com Desconto</span><b style="font-size:16.5px;display:inline-block;padding:3px 9px;border:1px solid var(--orange-tint);border-radius:7px;margin-top:2px;">${moneyFmt(p.valorCarro)}</b></div>
      <div class="prop-interno-only"><span>Desconto NF</span><b>${moneyFmt(p.descontoNF)}</b></div>
      <div class="prop-interno-only"><span>Bônus Varejo</span><b>${moneyFmt(p.bonusVarejo)}</b></div>
      <div class="prop-interno-only">
        <span>Bônus Troca</span>
        <b style="font-weight:500;font-size:10.5px;color:var(--text-dim);">${moneyFmt(p.bonusTroca)}</b>
        <div style="font-size:9px;color:var(--text-mute);font-style:italic;margin-top:2px;">Utilizado apenas quando há troca</div>
      </div>
      <div><span>Avaliação do Veículo Troca</span><b>${moneyFmt(p.avaliacaoTroca)}</b></div>
      <div><span>Avaliação do Veículo de Troca (Ideia)</span><b>${moneyFmt(p.avaliacaoTrocaIdeia)}</b></div>
      <div><span>${ipvaLabel}</span><b>${p.cortesia ? `🎁 Cortesia` : moneyFmt(p.ipva)}</b></div>
      <div><span>Emplacamento</span><b>${p.cortesia ? `🎁 Cortesia` : moneyFmt(p.emplacamento)}</b></div>
      <div class="prop-total"><span>IPVA + Emplacamento</span><b>${p.cortesia ? `🎁 Cortesia (R$ 0,00)` : moneyFmt(p.ipvaEmplacTotal)}</b></div>
      <div class="prop-total prop-valor-final"><span>Valor Final (Carro + IPVA + Emplacamento)</span><b>${moneyFmt((Number(p.valorCarro)||0)+(Number(p.ipvaEmplacTotal)||0))}</b></div>
      <div class="prop-taxas">
        <div class="prop-taxas-label">Opções de Financiamento</div>
        ${taxasHTML}
        ${prestacoesLegadoHTML}
        <div class="prop-banco-nota">Financiamento feito pelo Banco Volks</div>
      </div>
      ${(p.produtosFinanciamentoKeys && p.produtosFinanciamentoKeys.length) ? `<div class="prop-interno-only" style="grid-column:1/-1;background:var(--yellow-bg);border:1px dashed var(--yellow);border-radius:8px;padding:8px 10px;margin-top:4px;">
        <span>🔒 Produtos do Financiamento <i style="font-style:normal;font-weight:500;color:var(--text-mute);">(só você vê, não sai no card impresso)</i></span>
        <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:5px;">
          ${p.produtosFinanciamentoKeys.map(k=>{
            const prod = PRODUTOS_FINANCIAMENTO.find(x=>x.key===k);
            return prod ? `<span class="tag" style="font-size:11px;">${prod.nome}: <b>${String(prod.pontos).replace(".",",")}</b></span>` : "";
          }).join("")}
        </div>
        <b style="font-weight:800;font-size:12.5px;display:block;margin-top:6px;color:var(--orange-deep);">Total: ${String(p.produtosFinanciamentoPontos||0).replace(".",",")} pontos</b>
      </div>` : ""}
    </div>
    <div class="prop-card-footer">
      <div class="prop-vendedor-info">
        ${ehAdminLogado ? `<img src="assets/vendedor-admin-foto.png" alt="${vendedorInfo.nome}" class="prop-vendedor-foto">` : ""}
        <div>
          <div class="prop-vendedor-nome">${vendedorInfo.nome}</div>
          <div class="prop-vendedor-whats">${vendedorInfo.telefone && vendedorInfo.telefone !== "—" ? "💬 " + vendedorInfo.telefone : ""}</div>
        </div>
      </div>
      ${ehAdminLogado ? `<div class="prop-qr-wrap">
        <img src="assets/vendedor-admin-qrcode.png" alt="QR Code Instagram" class="prop-qr-img">
        <div class="prop-qr-legenda">📸 Aponte a câmera para me seguir no Instagram</div>
      </div>` : ""}
    </div>
    <button class="prop-card-editar" onclick="editarProposta('${p.id}')">✏️ Editar esta proposta</button>
    <button class="prop-card-duplicar" onclick="duplicarProposta('${p.id}')">📋 Duplicar Proposta (mesmo cliente, editável)</button>
    <button class="prop-card-excluir" onclick="delProposta('${p.id}')">🗑️ Excluir proposta</button>
    <div class="prop-card-actions">
      <button class="ghost" onclick="imprimirProposta('${p.id}')" title="Imprimir proposta">🖨️</button>
      <button class="ghost" onclick="salvarPropostaImagem('${p.id}')" title="Salvar card como imagem">📷</button>
      <button class="prop-card-close" onclick="fecharPropostaModal()" title="Fechar">✕</button>
    </div>
  </div>`;
}
function imprimirProposta(id){
  const p = state.propostas.find(pr=>pr.id===id);
  if (!p) return;
  const cardHTML = propostaCardHTML(p);
  // O documento não tem nenhuma tag <style> inline (o CSS é todo carregado via
  // <link>), então referenciamos o mesmo arquivo aqui — isso também faz o
  // @media print de css/style.css valer nesta janela.
  const estilos = `<link rel="stylesheet" href="css/style.css">`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Proposta - ${p.cliente||""}</title>${estilos}
    <style>
      @page{ size:A4; margin:10mm; }
      body{ background:#fff; padding:6mm; }
      .prop-card{ max-width:500px; margin:0 auto; box-shadow:none; zoom:1.4; }
      .prop-card-actions{ display:none !important; }
      .prop-card-excluir{ display:none !important; }
      .prop-card-duplicar{ display:none !important; }
      .prop-card-editar{ display:none !important; }
      .prop-interno-only{ display:none !important; }
    </style>
  </head><body>${cardHTML}</body></html>`);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}
function salvarPropostaImagem(id){
  const el = document.querySelector(`.prop-card[data-prop-id="${id}"]`);
  if (!el){ alert("Não encontrei esse card na tela."); return; }
  if (typeof html2canvas === "undefined"){
    alert("Não consegui carregar a ferramenta de captura de imagem. Verifique sua conexão com a internet e tente novamente.");
    return;
  }
  const actions = el.querySelector(".prop-card-actions");
  const btnExcluir = el.querySelector(".prop-card-excluir");
  const btnDuplicar = el.querySelector(".prop-card-duplicar");
  const btnEditar = el.querySelector(".prop-card-editar");
  const internos = el.querySelectorAll(".prop-interno-only");
  if (actions) actions.style.visibility = "hidden";
  if (btnExcluir) btnExcluir.style.display = "none";
  if (btnDuplicar) btnDuplicar.style.display = "none";
  if (btnEditar) btnEditar.style.display = "none";
  internos.forEach(el2=> el2.style.display = "none");
  html2canvas(el, {backgroundColor:"#ffffff", scale:2, useCORS:true}).then(canvas=>{
    if (actions) actions.style.visibility = "visible";
    if (btnExcluir) btnExcluir.style.display = "";
    if (btnDuplicar) btnDuplicar.style.display = "";
    if (btnEditar) btnEditar.style.display = "";
    internos.forEach(el2=> el2.style.display = "");
    canvas.toBlob(blob=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const p = state.propostas.find(pr=>pr.id===id) || {};
      const nomeArq = `Proposta_${(p.cliente||"cliente")}_${(p.carro||"")}_${p.data||""}`.replace(/[^\w\-]+/g,"_");
      a.download = nomeArq+".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }).catch(err=>{
    if (actions) actions.style.visibility = "visible";
    if (btnExcluir) btnExcluir.style.display = "";
    if (btnDuplicar) btnDuplicar.style.display = "";
    if (btnEditar) btnEditar.style.display = "";
    internos.forEach(el2=> el2.style.display = "");
    console.error("Erro ao gerar imagem do card:", err);
    alert("Não consegui gerar a imagem do card. Tente novamente.");
  });
}
function propostaSummaryHTML(p){
  const anoTxt = (p.anoFab||p.anoModelo) ? `${p.anoFab||"—"}/${p.anoModelo||"—"}` : "";
  return `<div class="prop-summary-card" onclick="abrirPropostaModal('${p.id}')">
    <div class="prop-summary-cliente">${p.cliente||"—"}</div>
    <div class="prop-summary-veh">${p.carro||""}${p.versao?" · "+p.versao:""}${p.cor?" · "+p.cor:""}${anoTxt?" · "+anoTxt:""}</div>
    ${p.pacotes ? `<div class="prop-summary-pacotes">🧩 ${p.pacotes}</div>` : ""}
    ${p.modalidade&&p.modalidade!=="Varejo" ? `<div class="prop-summary-pacotes">🏷️ ${p.modalidade}</div>` : ""}
    <div class="prop-summary-hint">Toque para ver a proposta completa</div>
  </div>`;
}
function abrirPropostaModal(id){
  const p = state.propostas.find(pr=>pr.id===id);
  if (!p) return;
  document.getElementById("propostaModalContent").innerHTML = propostaCardHTML(p);
  document.getElementById("propostaModalOverlay").classList.add("open");
}
function fecharPropostaModal(){
  document.getElementById("propostaModalOverlay").classList.remove("open");
  document.getElementById("propostaModalContent").innerHTML = "";
}
function renderPropostas(){
  const box = document.getElementById("propostasBox");
  const propostasVisiveis = filtrarPorVendedor(state.propostas);
  const total = propostasVisiveis.length;
  document.getElementById("propostasCount").textContent = total ? `${total} proposta${total>1?"s":""} no total` : "";
  if (total===0){
    box.innerHTML = `<div class="empty">Nenhuma proposta cadastrada ainda este mês.</div>`;
    return;
  }
  function montarGrupoModelos(lista){
    const grupos = {};
    lista.forEach(p=>{
      const key = CARRO_ORDER.includes(p.carro) ? p.carro : "OUTROS";
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(p);
    });
    const ordem = [...CARRO_ORDER, "OUTROS"];
    return ordem.filter(k=>grupos[k] && grupos[k].length).map(k=>{
      const subLista = [...grupos[k]].sort((a,b)=> (b.data||"").localeCompare(a.data||""));
      const cards = subLista.map(p=>propostaSummaryHTML(p)).join("");
      return `<div class="prop-group">
        <div class="prop-group-title">${k} <span>${subLista.length} proposta${subLista.length>1?"s":""}</span></div>
        <div class="prop-cards">${cards}</div>
      </div>`;
    }).join("");
  }
  const zeroKm = propostasVisiveis.filter(p=> (p.tipoVeiculo||"0KM")==="0KM");
  const seminovos = propostasVisiveis.filter(p=> p.tipoVeiculo==="Seminovo");
  let html = "";
  if (zeroKm.length){
    html += `<div class="prop-categoria">
      <div class="prop-categoria-title">🚗 Carros 0KM <span>${zeroKm.length} proposta${zeroKm.length>1?"s":""}</span></div>
      ${montarGrupoModelos(zeroKm)}
    </div>`;
  }
  if (seminovos.length){
    html += `<div class="prop-categoria">
      <div class="prop-categoria-title prop-categoria-semi">🚘 Carros Seminovos <span>${seminovos.length} proposta${seminovos.length>1?"s":""}</span></div>
      ${montarGrupoModelos(seminovos)}
    </div>`;
  }
  box.innerHTML = html;
}
function preencherFormularioProposta(p){
  document.getElementById("pOrigem").value = p.origem || "Instagram";
  document.getElementById("pTipoVeiculo").value = p.tipoVeiculo || "0KM";
  document.getElementById("pModalidade").value = p.modalidade || "Varejo";
  document.getElementById("pCarro").value = p.carro || "";
  document.getElementById("pVersao").value = p.versao || "";
  document.getElementById("pCor").value = p.cor || "";
  document.getElementById("pAnoFab").value = p.anoFab || "";
  document.getElementById("pAnoModelo").value = p.anoModelo || "";
  document.getElementById("pKm").value = p.km || "";
  atualizarCamposProposta();
  if (document.getElementById("pPacotes")) document.getElementById("pPacotes").value = p.pacotes || "";
  document.getElementById("pCota").value = p.valorCota ? moneyFmt(p.valorCota).replace("R$","").trim() : "";
  document.getElementById("pValorCarro").value = p.valorCarro ? moneyFmt(p.valorCarro).replace("R$","").trim() : "";
  document.getElementById("pDescontoNF").value = p.descontoNF ? moneyFmt(p.descontoNF).replace("R$","").trim() : "";
  document.getElementById("pBonusVarejo").value = p.bonusVarejo ? moneyFmt(p.bonusVarejo).replace("R$","").trim() : "";
  document.getElementById("pBonusTroca").value = p.bonusTroca ? moneyFmt(p.bonusTroca).replace("R$","").trim() : "";
  document.getElementById("pAvaliacaoTroca").value = p.avaliacaoTroca ? moneyFmt(p.avaliacaoTroca).replace("R$","").trim() : "";
  document.getElementById("pAvaliacaoTrocaIdeia").value = p.avaliacaoTrocaIdeia ? moneyFmt(p.avaliacaoTrocaIdeia).replace("R$","").trim() : "";
  document.getElementById("pEmplacamento").value = p.emplacamento ? moneyFmt(p.emplacamento).replace("R$","").trim() : "1.400,00";
  document.getElementById("pIpvaMes").value = p.ipvaMes || "";
  document.getElementById("pObsBonusFabrica").value = p.obsBonusFabrica || document.getElementById("pObsBonusFabrica").value;
  popularProdutosFinanciamento();
  marcarProdutosFinanciamento(p.produtosFinanciamentoKeys || []);

  cortesiaAtiva = !!p.cortesia;
  document.getElementById("pBtnCortesia").classList.toggle("ativo", cortesiaAtiva);
  document.getElementById("pBtnCortesia").textContent = cortesiaAtiva ? "🎁 Cortesia (ativada)" : "🎁 Cortesia";

  document.getElementById("pTaxasContainer").innerHTML = "";
  const taxas = getTaxasList(p);
  if (taxas.length){ taxas.forEach(t=> addTaxaRow(t)); } else { addTaxaRow(); }

  updateIpva();
  updateAllValorEntrada();
  updatePropostaTotal();

  const formPropEl = document.getElementById("formProposta");
  if (formPropEl && typeof formPropEl.scrollIntoView === "function"){
    formPropEl.scrollIntoView({behavior:"smooth", block:"start"});
  }
}
function duplicarProposta(id){
  const p = state.propostas.find(pr=>pr.id===id);
  if (!p) return;
  fecharPropostaModal();
  document.querySelector('nav button[data-view="clientes"]').click();

  document.getElementById("pEditId").value = "";
  document.getElementById("pCliente").value = p.cliente || "";
  document.getElementById("pWhats").value = p.whats || "";
  document.getElementById("pData").value = todayISO();
  preencherFormularioProposta(p);
  document.getElementById("pBtnSubmit").textContent = "Salvar proposta";
  document.getElementById("pBtnCancelarEdicao").style.display = "none";
}
function editarProposta(id){
  const p = state.propostas.find(pr=>pr.id===id);
  if (!p) return;
  fecharPropostaModal();
  document.querySelector('nav button[data-view="clientes"]').click();

  document.getElementById("pEditId").value = p.id;
  document.getElementById("pCliente").value = p.cliente || "";
  document.getElementById("pWhats").value = p.whats || "";
  document.getElementById("pData").value = p.data || todayISO();
  preencherFormularioProposta(p);
  document.getElementById("pBtnSubmit").textContent = "Salvar alterações";
  document.getElementById("pBtnCancelarEdicao").style.display = "inline-block";
  document.getElementById("pCliente").focus();
}
function delProposta(id){
  if (!confirm("Excluir esta proposta?")) return;
  state.propostas = state.propostas.filter(p=>p.id!==id);
  persist(); renderAll();
  fecharPropostaModal();
}
function delHistoricoEntrada(clienteId, entradaId){
  const c = state.clientes.find(x=>x.id===clienteId);
  if (!c) return;
  if (!confirm("Excluir este registro do histórico?")) return;
  c.historico = (c.historico||[]).filter(h=>h.id!==entradaId);
  persist(); renderAll();
  renderHistoricoLista(c);
}
function parseTaxasElegiveis(tx){
  if (!tx) return [];
  return tx.split(" · ").map(chip=>{
    const partes = chip.split("|").map(s=>s.trim());
    if (partes.length!==3) return null;
    const m = partes[1].match(/(\d+(?:,\d+)?)\s*%/);
    if (!m) return null;
    return { label: chip, taxa: partes[0], entradaPct: parseFloat(m[1].replace(",",".")), prazo: partes[2] };
  }).filter(Boolean);
}
function selecionarTaxaGerente(label){
  state.gerente.est.taxaEscolhidaLabel = label;
  calcularGerente();
  persist();
}
function atualizarCamposProposta(){
  const isSeminovo = document.getElementById("pTipoVeiculo").value === "Seminovo";
  document.getElementById("pKmWrap").style.display = isSeminovo ? "block" : "none";
}
let cortesiaAtiva = false;
function updatePropostaTotal(){
  const ipva = currencyToNumber(document.getElementById("pIpva").value);
  const emplac = currencyToNumber(document.getElementById("pEmplacamento").value);
  document.getElementById("pIpvaEmplacTotal").value = cortesiaAtiva ? "Cortesia (R$ 0,00)" : moneyFmt(ipva+emplac);
}

/* IPVA por mês: janeiro 3% caindo 0,25% ao mês até dezembro 0,25%, sobre o valor do carro */
const MESES_IPVA = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const IPVA_PCT_POR_MES = MESES_IPVA.map((_,i)=> +(3 - i*0.25).toFixed(2));
function updateIpva(){
  const mes = +document.getElementById("pIpvaMes").value;
  const carro = currencyToNumber(document.getElementById("pValorCarro").value);
  if (!mes){ document.getElementById("pIpva").value = ""; updatePropostaTotal(); return; }
  const pct = IPVA_PCT_POR_MES[mes-1];
  document.getElementById("pIpva").value = moneyFmt(carro*pct/100).replace("R$","").trim();
  updatePropostaTotal();
}

/* Opções de Financiamento: cada opção junta taxa mensal, entrada, valor da entrada, valor financiado, parcelas e valor da prestação num único bloco */
const OPCOES_ENTRADA = [10,20,30,40,50,60,70,80,90,100];
const OPCOES_PARCELAS = [12,18,24,30,36,48,60];
function updateValorEntrada(row){
  if (!row) return;
  const carro = currencyToNumber(document.getElementById("pValorCarro").value);
  const pct = +row.querySelector(".entradaPctInput").value || 0;
  const valorEntrada = carro*pct/100;
  row.querySelector(".valorEntradaDisplay").value = moneyFmt(valorEntrada).replace("R$","").trim();
  row.querySelector(".valorFinanciadoDisplay").value = moneyFmt(Math.max(carro-valorEntrada,0)).replace("R$","").trim();
}
function updateValorFinanciadoFromEntrada(row){
  if (!row) return;
  const carro = currencyToNumber(document.getElementById("pValorCarro").value);
  const valorEntrada = currencyToNumber(row.querySelector(".valorEntradaDisplay").value);
  row.querySelector(".valorFinanciadoDisplay").value = moneyFmt(Math.max(carro-valorEntrada,0)).replace("R$","").trim();
  // valor digitado manualmente pode não bater com nenhuma opção fixa de % — desmarca o select
  row.querySelector(".entradaPctInput").value = "";
}
function updateAllValorEntrada(){
  document.querySelectorAll("#pTaxasContainer .taxa-row").forEach(row=>{
    // só recalcula pela % se o campo de valor da entrada ainda não tiver sido preenchido manualmente
    if (!currencyToNumber(row.querySelector(".valorEntradaDisplay").value)) updateValorEntrada(row);
    else updateValorFinanciadoFromEntrada(row);
  });
}

function taxaRowHTML(v){
  v = v || {};
  const entradaOpts = OPCOES_ENTRADA.map(o=>`<option value="${o}" ${String(v.entradaPct)===String(o)?"selected":""}>${o}%</option>`).join("");
  const parcelasOpts = OPCOES_PARCELAS.map(o=>`<option value="${o}" ${String(v.parcelas)===String(o)?"selected":""}>${o}x</option>`).join("");
  return `<div class="taxa-row">
    <button type="button" class="danger btnRemoveTaxa" title="Remover esta opção">✕</button>
    <div class="taxa-row-title">Opção de Financiamento</div>
    <div class="taxa-row-grid">
      <div><label>Taxa Mensal (%)</label><input type="number" min="0" step="0.01" class="taxaMensalInput" placeholder="0,00" value="${v.taxaMensal!=null?v.taxaMensal:''}"></div>
      <div><label>Entrada (%)</label><select class="entradaPctInput"><option value="">Selecione</option>${entradaOpts}</select></div>
      <div><label>Valor da Entrada (R$) <span style="font-weight:500;color:var(--text-mute);text-transform:none;letter-spacing:0;">— pode digitar direto</span></label><input type="text" inputmode="decimal" class="valorEntradaDisplay" placeholder="0,00" style="font-weight:800;" value="${v.valorEntrada!=null?moneyFmt(v.valorEntrada).replace('R$','').trim():''}"></div>
      <div><label>Valor Financiado</label><input type="text" class="valorFinanciadoDisplay" readonly placeholder="0,00" style="font-weight:800;color:var(--orange-deep);" value="${v.valorFinanciado!=null?moneyFmt(v.valorFinanciado).replace('R$','').trim():''}"></div>
      <div><label>Parcelas</label><select class="parcelasSelect"><option value="">Selecione</option>${parcelasOpts}</select></div>
      <div><label>Valor da Prestação (R$)</label><input type="text" inputmode="decimal" class="valorPrestacaoInput" placeholder="0,00" value="${v.valorPrestacao!=null?v.valorPrestacao:''}"></div>
    </div>
  </div>`;
}
function addTaxaRow(v){
  document.getElementById("pTaxasContainer").insertAdjacentHTML("beforeend", taxaRowHTML(v));
  const rows = document.querySelectorAll("#pTaxasContainer .taxa-row");
  const novaLinha = rows[rows.length-1];
  if (!v || v.valorEntrada==null) updateValorEntrada(novaLinha); // linha nova/sem dado salvo: calcula pela %
  maskCurrency(novaLinha.querySelector(".valorPrestacaoInput"));
  maskCurrency(novaLinha.querySelector(".valorEntradaDisplay"));
  novaLinha.querySelector(".valorEntradaDisplay").addEventListener("input", ()=> updateValorFinanciadoFromEntrada(novaLinha));
}
function resetTaxasContainer(){
  document.getElementById("pTaxasContainer").innerHTML = "";
  addTaxaRow();
}
function collectTaxas(){
  const carro = currencyToNumber(document.getElementById("pValorCarro").value);
  return Array.from(document.querySelectorAll("#pTaxasContainer .taxa-row")).map(row=>{
    const entradaPct = +row.querySelector(".entradaPctInput").value || 0;
    const valorEntrada = currencyToNumber(row.querySelector(".valorEntradaDisplay").value);
    return {
      taxaMensal: +row.querySelector(".taxaMensalInput").value || 0,
      entradaPct: entradaPct,
      valorEntrada: valorEntrada,
      valorFinanciado: Math.max(carro-valorEntrada,0),
      parcelas: +row.querySelector(".parcelasSelect").value || 0,
      valorPrestacao: currencyToNumber(row.querySelector(".valorPrestacaoInput").value),
    };
  }).filter(t=>t.taxaMensal>0 || t.entradaPct>0 || t.parcelas>0 || t.valorPrestacao>0);
}

let comissaoVisivel = true;
function atualizarVisualComissao(){
  const card = document.getElementById("btnComissaoFinal");
  const valorEl = document.getElementById("comissaoFinalValor");
  const olho = document.getElementById("olhoComissaoBtn");
  const valorNegociosEl = document.getElementById("valorNegociosMesValor");
  if (comissaoVisivel){
    card.classList.remove("comissao-oculta");
    card.classList.add("comissao-visivel");
    valorEl.textContent = valorEl.dataset.real || "R$ 0,00";
    olho.textContent = "👁️";
    if (valorNegociosEl) valorNegociosEl.textContent = valorNegociosEl.dataset.real || "R$ 0,00";
  } else {
    card.classList.remove("comissao-visivel");
    card.classList.add("comissao-oculta");
    valorEl.textContent = "R$ ••••••";
    olho.textContent = "🙈";
    if (valorNegociosEl) valorNegociosEl.textContent = "R$ ••••••";
  }
}
