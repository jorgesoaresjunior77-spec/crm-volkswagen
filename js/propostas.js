
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
