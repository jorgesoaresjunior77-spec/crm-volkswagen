

// Escuta mudanças em tempo real nas 7 tabelas que compõem o state (5 coleções +
// vendedor_estado + loja_estado). Como cada uma tem RLS, o Postgres já nem entrega o
// evento pra quem não pode ver aquela linha — um vendedor comum não recebe mais
// notificação nenhuma sobre dados de outro vendedor (antes, o blob inteiro ecoava
// pra todo mundo). Várias tabelas mudam juntas numa gravação só, então agrupamos
// (debounce) antes de recarregar, em vez de recarregar uma vez por tabela.
let _recargaRemotaTimer = null;
function agendarRecargaRemota(){
  clearTimeout(_recargaRemotaTimer);
  _recargaRemotaTimer = setTimeout(()=>{ carregarEstadoNuvem(); }, 400);
}
function assinarMudancasRemotas(){
  if (!supabaseClient || nuvemAssinaturaAtiva) return;
  nuvemAssinaturaAtiva = true;
  const tabelas = ["vendas","propostas","salarios","banco_vw","clientes","vendedor_estado","loja_estado"];
  const canal = supabaseClient.channel("crm_mudancas_"+WORKSPACE_ID);
  tabelas.forEach(t=>{
    canal.on("postgres_changes", { event:"*", schema:"public", table:t }, ()=>{
      if (ignorarProximosEventosRemotos>0){ ignorarProximosEventosRemotos--; return; }
      agendarRecargaRemota();
    });
  });
  canal.subscribe();
}

const CAMPOS_DIA = ["ligInvalido","ligNao","ligAtendCom","ligAtendSem","wpp","sto","ree","feed","ofe","nov","ret","vis","td","prop","ven","avaliados","segLiquido","interacoes"];
function diaSum(k){
  const lista = diasDoVendedorAtual()[k] || [];
  const acc = {ligInvalido:0,ligNao:0,ligAtendCom:0,ligAtendSem:0,wpp:0,sto:0,ree:0,feed:0,ofe:0,nov:0,ret:0,vis:0,td:0,prop:0,ven:0,avaliados:0,segLiquido:0,interacoes:0};
  lista.forEach(e=>{ CAMPOS_DIA.forEach(f=>{ acc[f]+= Number(e[f])||0; }); });
  if (!isDiaComLigacao(k)){
    // ligações só contam de segunda a sexta (e em dia útil) — sábado e feriados não entram na conta
    acc.ligInvalido = 0; acc.ligNao = 0; acc.ligAtendCom = 0; acc.ligAtendSem = 0;
  }
  acc.lig = acc.ligAtendCom + acc.ligAtendSem + acc.ligNao; // total de ligações = atendidas com interesse + sem interesse + não atendidas
  return acc;
}
function diasDoMesAtual(){
  return Object.keys(diasDoVendedorAtual()).filter(k=>k.startsWith(state.config.mesRef)).sort();
}
function diaInstaSnapshot(k){
  const entries = diasDoVendedorAtual()[k] || [];
  const snap = {seg:0, painel:0, insights:0, posts:0};
  entries.forEach(e=>{
    if (e.seg) snap.seg = e.seg;
    if (e.painel) snap.painel = e.painel;
    if (e.insights) snap.insights = e.insights;
    if (e.posts) snap.posts = e.posts;
  });
  return snap;
}
/* Preenche os dias sem lançamento com o último valor conhecido (esses números são "o total até agora", não somam por dia) */
function instaSeriesForward(dias, campo){
  let last = 0;
  return dias.map(k=>{
    const v = diaInstaSnapshot(k)[campo];
    if (v) last = v;
    return last;
  });
}
function fmtInstaUnidade(raw, unidade){
  return (raw||0).toLocaleString("pt-BR") + " " + unidade;
}
function fmtInstaDelta(delta){
  if (!delta) return "";
  const sinal = delta>0 ? "+" : "";
  return `${sinal}${delta.toLocaleString("pt-BR")} este mês`;
}
function gerarInsightsInstagram(dias, contentSeries, deltaSeg){
  const insights = [];
  const diasSemPostar = contentSeries.filter(v=>v===0).length;
  const totalConteudo = contentSeries.reduce((a,b)=>a+b,0);
  const totalGanho = deltaSeg.reduce((a,b)=>a+Math.max(b,0),0);
  if (dias.length===0){
    insights.push("Cadastre os dados do Instagram no Controle Diário para começar a ver recomendações aqui.");
    return insights;
  }
  if (diasSemPostar>0){
    insights.push(`Você ficou <b>${diasSemPostar} dia(s)</b> sem publicar stories, reels ou feed este mês — postar todos os dias ajuda a manter o alcance.`);
  }
  if (totalConteudo>0 && totalGanho>0){
    const media = totalGanho/totalConteudo;
    insights.push(`Em média, cada conteúdo publicado (stories+reels+feed) esteve associado a cerca de <b>${media.toFixed(1)} novos seguidores</b> no dia.`);
  }
  let melhorIdx=-1, melhorGanho=-Infinity;
  deltaSeg.forEach((v,i)=>{ if (v>melhorGanho){ melhorGanho=v; melhorIdx=i; } });
  if (melhorIdx>=0 && melhorGanho>0){
    insights.push(`Seu melhor dia de crescimento foi <b>${fmtDate(dias[melhorIdx])}</b>, com +${melhorGanho.toLocaleString("pt-BR")} seguidores.`);
  }
  if (totalConteudo>0 && totalGanho<=0){
    insights.push(`Você publicou conteúdo, mas o número de seguidores não cresceu — vale testar horários diferentes ou outro formato de conteúdo.`);
  }
  if (insights.length===0){
    insights.push("Continue registrando os dados diariamente para receber recomendações mais precisas.");
  }
  return insights;
}
function categoriaDoCarro(carro, modelo){
  const n = `${carro||""} ${modelo||""}`.toUpperCase();
  if (n.includes("SAVEIRO") || n.includes("AMAROK")) return "pickup";
  if (n.includes("TAOS") || n.includes("TCROSS") || n.includes("T-CROSS") || n.includes("NIVUS") || n.includes("TERA") || n.includes("TIGUAN")) return "suv";
  if (n.includes("VIRTUS") || n.includes("JETTA")) return "sedan";
  return "hatch"; // POLO e demais
}
function formaCarrinho(categoria, cor){
  if (categoria === "suv"){
    return `
      <rect x="0" y="9" width="60" height="19" rx="6" fill="${cor}"/>
      <path d="M8 9 L14 -7 Q16 -9 20 -9 L42 -9 Q46 -9 48 -7 L54 9 Z" fill="${cor}"/>
      <rect x="16.5" y="-6" width="12" height="10.5" rx="1.5" fill="#BEE7FF" opacity=".88"/>
      <rect x="30" y="-6" width="12" height="10.5" rx="1.5" fill="#BEE7FF" opacity=".88"/>
      <circle cx="15" cy="30" r="8" fill="#111"/><circle cx="15" cy="30" r="3.2" fill="#999"/>
      <circle cx="45" cy="30" r="8" fill="#111"/><circle cx="45" cy="30" r="3.2" fill="#999"/>
      <circle cx="30" cy="2.5" r="5.7" fill="#fff" stroke="${cor}" stroke-width="1.3"/>
      <text x="30" y="5" font-size="6" font-weight="800" fill="${cor}" text-anchor="middle">VW</text>`;
  }
  if (categoria === "pickup"){
    return `
      <rect x="0" y="13" width="25" height="15" rx="2.5" fill="${cor}"/>
      <line x1="4" y1="13" x2="4" y2="4" stroke="${cor}" stroke-width="3"/>
      <rect x="23" y="9" width="35" height="19" rx="5" fill="${cor}"/>
      <path d="M29 9 L33 -6 Q35 -8 38 -8 L47 -8 Q50 -8 51 -6 L54 9 Z" fill="${cor}"/>
      <rect x="36.5" y="-5" width="13" height="10.5" rx="1.5" fill="#BEE7FF" opacity=".88"/>
      <circle cx="13" cy="30" r="7.5" fill="#111"/><circle cx="13" cy="30" r="3" fill="#999"/>
      <circle cx="46" cy="30" r="7.5" fill="#111"/><circle cx="46" cy="30" r="3" fill="#999"/>
      <circle cx="41" cy="2.5" r="5.2" fill="#fff" stroke="${cor}" stroke-width="1.2"/>
      <text x="41" y="4.7" font-size="5.5" font-weight="800" fill="${cor}" text-anchor="middle">VW</text>`;
  }
  if (categoria === "sedan"){
    return `
      <rect x="0" y="12" width="63" height="16" rx="6" fill="${cor}"/>
      <path d="M10 12 Q14 -3 24 -3 L40 -3 Q47 -3 51 7 L59 12 Z" fill="${cor}"/>
      <rect x="15" y="-1" width="11" height="10" rx="1.5" fill="#BEE7FF" opacity=".88"/>
      <rect x="28" y="-1" width="15" height="10" rx="1.5" fill="#BEE7FF" opacity=".88"/>
      <circle cx="15.5" cy="29" r="7" fill="#111"/><circle cx="15.5" cy="29" r="2.8" fill="#999"/>
      <circle cx="47.5" cy="29" r="7" fill="#111"/><circle cx="47.5" cy="29" r="2.8" fill="#999"/>
      <circle cx="30" cy="1.5" r="5.7" fill="#fff" stroke="${cor}" stroke-width="1.3"/>
      <text x="30" y="4" font-size="6" font-weight="800" fill="${cor}" text-anchor="middle">VW</text>`;
  }
  return `
    <rect x="0" y="12" width="56" height="16" rx="6" fill="${cor}"/>
    <path d="M6 12 Q14 -2 26 -2 L38 -2 Q46 -2 50 12 Z" fill="${cor}"/>
    <rect x="14" y="1.5" width="20" height="10" rx="2" fill="#BEE7FF" opacity=".88"/>
    <circle cx="14" cy="29.5" r="7" fill="#111"/><circle cx="14" cy="29.5" r="2.8" fill="#999"/>
    <circle cx="42" cy="29.5" r="7" fill="#111"/><circle cx="42" cy="29.5" r="2.8" fill="#999"/>
    <circle cx="28" cy="6" r="5.7" fill="#fff" stroke="${cor}" stroke-width="1.3"/>
    <text x="28" y="8.5" font-size="6" font-weight="800" fill="${cor}" text-anchor="middle">VW</text>`;
}
function renderMetaVolks(){
  const cfg = state.config;
  state.metasVolks = state.metasVolks || {};
  const registroMes = state.metasVolks[cfg.mesRef] || {};
  const metaCarros = registroMes.metaCarros || 0;
  const qtdVendedores = registroMes.qtdVendedores || 0;
  const cotaIndividual = qtdVendedores>0 ? metaCarros/qtdVendedores : 0;
  // conta só 0KM varejo (não entra Seminovo nem VD)
  const vendidos0kmVarejoMes = vendasDoMesAtual().filter(v=>v.tipoLabel==="0KM").length;
  const faltamCota = Math.max(cotaIndividual - vendidos0kmVarejoMes, 0);

  document.getElementById("metaVolksResumoBox").innerHTML = metaCarros ? `
    <div class="mv-kpi destaque">
      <div class="rot">Sua Cota Individual</div>
      <div class="n">${cotaIndividual.toFixed(1).replace(".",",")} carros</div>
      <div class="sub">${metaCarros} carros ÷ ${qtdVendedores || 0} vendedor${qtdVendedores===1?"":"es"}</div>
    </div>
    <div class="mv-kpi">
      <div class="rot">Você Vendeu (0KM Varejo)</div>
      <div class="n">${vendidos0kmVarejoMes}</div>
      <div class="sub">não conta Seminovo nem VD</div>
    </div>
    <div class="mv-kpi">
      <div class="rot">${faltamCota>0 ? "Falta pra bater sua cota" : "Sua cota"}</div>
      <div class="n">${faltamCota>0 ? faltamCota.toFixed(1).replace(".",",") : "🎉"}</div>
      <div class="sub">${faltamCota>0 ? "carros" : "cota individual batida!"}</div>
    </div>
  ` : `<div class="empty" style="color:rgba(255,255,255,.55);">Configure a Meta Volks do mês em Configurações pra ver o resumo aqui.</div>`;

  const anoRef = Number(cfg.mesRef.split("-")[0]);
  let acumVendido = 0, acumMeta = 0;
  const dadosPorMes = [];
  for (let mm=1; mm<=12; mm++){
    const chave = `${anoRef}-${String(mm).padStart(2,"0")}`;
    const vendidosNoMes = filtrarPorVendedor(state.vendas).filter(v=>(v.data||"").slice(0,7)===chave && v.tipoLabel==="0KM").length;
    const registroDoMes = state.metasVolks[chave] || {};
    const cotaNoMes = registroDoMes.qtdVendedores>0 ? (registroDoMes.metaCarros||0)/registroDoMes.qtdVendedores : 0;
    acumVendido += vendidosNoMes;
    acumMeta += cotaNoMes;
    dadosPorMes.push({ mes:mm, acumVendido, acumMeta });
  }
  document.getElementById("metaVolksChartBox").innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:8px;font-size:11px;color:rgba(255,255,255,.7);">
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#00E5FF;box-shadow:0 0 6px #00E5FF;display:inline-block;"></span>Seu Acumulado Vendido (0KM Varejo)</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#FF6B4A;box-shadow:0 0 6px #FF6B4A;display:inline-block;"></span>Sua Cota Individual Acumulada</span>
    </div>
    ${metaVolksChartSVG(dadosPorMes, anoRef)}`;
}
function renderInstagram(){
  const cfg = {...state.config, ...metasDoVendedorAtual()};
  const dias = diasDoMesAtual();
  const labels = dias.map(k=>k.slice(8,10));
  const seriesSeg = instaSeriesForward(dias, "seg");
  const seriesPainel = instaSeriesForward(dias, "painel");
  const seriesInsights = instaSeriesForward(dias, "insights");

  let atual = {seg:0, painel:0, insights:0, posts:0};
  for (let i=0;i<dias.length;i++){
    const snap = diaInstaSnapshot(dias[i]);
    if (snap.seg||snap.painel||snap.insights||snap.posts) atual = {...atual, ...Object.fromEntries(Object.entries(snap).filter(([,v])=>v))};
  }
  const segLiquidoMes = totalMes("segLiquido");
  const interacoesMes = totalMes("interacoes");
  const cards = [
    ["Seguidores", fmtInstaUnidade(atual.seg, "Mil"), "linear-gradient(135deg,#833AB4,#C13584)"],
    ["Painel Profissional", fmtInstaUnidade(atual.painel, "Mil"), "linear-gradient(135deg,#C13584,#E1306C)"],
    ["Insights do Criador", fmtInstaUnidade(atual.insights, "Mil"), "linear-gradient(135deg,#FD1D1D,#F56040)"],
    ["Posts", fmtInstaUnidade(atual.posts, "Unidades"), "linear-gradient(135deg,#F77737,#FCAF45)"],
    ["Seguidores Líquidos (mês)", (segLiquidoMes>=0?"+":"")+segLiquidoMes.toLocaleString("pt-BR"), "linear-gradient(135deg,#405DE6,#5B51D8)"],
    ["Interações (mês)", fmtInstaUnidade(interacoesMes, "Mil"), "linear-gradient(135deg,#E1306C,#F77737)"],
  ];
  document.getElementById("instaKpis").innerHTML = cards.map(([l,v,g],i)=>
    `<div class="insta-kpi" style="background:${g};animation-delay:${(i*0.08).toFixed(2)}s;">
      <div class="insta-kpi-label">${l}</div>
      <div class="insta-kpi-value">${v}</div>
    </div>`).join("");

  const primeiroSeg = seriesSeg.find(v=>v>0) || 0;
  const delta = primeiroSeg ? (seriesSeg[seriesSeg.length-1]-primeiroSeg) : 0;
  const deltaEl = document.getElementById("instaDelta");
  deltaEl.textContent = fmtInstaDelta(delta);
  deltaEl.style.color = delta>0 ? "var(--green)" : (delta<0 ? "var(--red)" : "");
  document.getElementById("chartInstaGrowth").innerHTML = instaGrowthChartSVG(labels, seriesSeg);

  /* Gráfico comparativo em % */
  function pctSeries(serie){
    const base = serie.find(v=>v>0);
    if (!base) return serie.map(()=>0);
    return serie.map(v=> v ? ((v-base)/base)*100 : 0);
  }
  const comparColors = ["#833AB4","#E1306C","#F56040"];
  document.getElementById("chartInstaCompar").innerHTML = instaComparChartSVG(
    labels, [pctSeries(seriesSeg), pctSeries(seriesPainel), pctSeries(seriesInsights)], comparColors
  );
  document.getElementById("legendInstaCompar").innerHTML = ["Seguidores","Painel Profissional","Insights do Criador"].map((nm,i)=>
    `<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${comparColors[i]};margin-right:5px;"></span>${nm}</span>`).join("");

  /* Gráfico conteúdo x ganho de seguidores */
  const contentSeries = dias.map(k=>{ const d=diaSum(k); return (d.sto||0)+(d.ree||0)+(d.feed||0); });
  const primeiroIdxComDados = seriesSeg.findIndex(v=>v>0);
  const deltaSeg = seriesSeg.map((v,i)=> (primeiroIdxComDados===-1 || i<=primeiroIdxComDados) ? 0 : v-seriesSeg[i-1]);
  document.getElementById("chartInstaCorrelacao").innerHTML = instaCorrelacaoChartSVG(labels, contentSeries, deltaSeg);

  /* Gráfico de ganho/perda diário com valores exatos */
  document.getElementById("chartInstaDeltaDiario").innerHTML = instaDeltaBarChartSVG(labels, deltaSeg);

  /* Estatísticas de crescimento */
  const deltasValidos = deltaSeg.filter((v,i)=> primeiroIdxComDados!==-1 && i>primeiroIdxComDados);
  const totalGanho = deltasValidos.reduce((a,b)=>a+b,0);
  const mediaDiaria = deltasValidos.length ? totalGanho/deltasValidos.length : 0;
  let melhorIdx=-1, melhorVal=-Infinity;
  deltaSeg.forEach((v,i)=>{ if (primeiroIdxComDados!==-1 && i>primeiroIdxComDados && v>melhorVal){ melhorVal=v; melhorIdx=i; } });
  const seguidoresAtuais = seriesSeg[seriesSeg.length-1] || 0;
  const faltaMeta = Math.max((cfg.metaSeguidores||0)-seguidoresAtuais, 0);
  const diasParaMeta = mediaDiaria>0 ? Math.ceil(faltaMeta/mediaDiaria) : null;

  const statCards = [
    ["Seguidores Atuais", seguidoresAtuais.toLocaleString("pt-BR")],
    ["Crescimento no Mês", (delta>=0?"+":"")+delta.toLocaleString("pt-BR")],
    ["Média por Dia", (mediaDiaria>=0?"+":"")+mediaDiaria.toFixed(1)],
    ["Melhor Dia", melhorIdx>=0 ? `${fmtDate(dias[melhorIdx])} (+${melhorVal})` : "—"],
    ["Dias até a Meta", faltaMeta===0 && cfg.metaSeguidores>0 ? "Meta atingida!" : (diasParaMeta!=null ? diasParaMeta+" dias" : "—")],
  ];
  document.getElementById("instaStatsCards").innerHTML = statCards.map(([l,v])=>
    `<div class="insta-stat-card"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join("");

  /* Meta de seguidores */
  const metaInput = document.getElementById("instaMetaInput");
  if (document.activeElement !== metaInput) metaInput.value = cfg.metaSeguidores || "";
  const pctMeta = cfg.metaSeguidores>0 ? Math.min(seguidoresAtuais/cfg.metaSeguidores,1) : 0;
  document.getElementById("instaMetaBar").style.width = (pctMeta*100)+"%";
  document.getElementById("instaMetaLabel").textContent = cfg.metaSeguidores>0
    ? `${seguidoresAtuais.toLocaleString("pt-BR")} / ${cfg.metaSeguidores.toLocaleString("pt-BR")} (${(pctMeta*100).toFixed(0)}%)`
    : "Defina uma meta ao lado";
  /* Estimativa de dias até a meta, com base no crescimento líquido médio (Seguidores Líquidos) */
  const entradasComSegLiquido = Object.values(diasDoVendedorAtual()).flat().filter(e=>e && e.segLiquido);
  const mediaLiquidaDiaria = entradasComSegLiquido.length>=2
    ? entradasComSegLiquido.reduce((s,e)=>s+Number(e.segLiquido||0),0)/entradasComSegLiquido.length
    : null;
  const diasParaMetaLiquido = (mediaLiquidaDiaria!=null && mediaLiquidaDiaria>0) ? Math.ceil(faltaMeta/mediaLiquidaDiaria) : null;
  const estimativaTxt = (cfg.metaSeguidores>0 && faltaMeta>0)
    ? (diasParaMetaLiquido!=null
        ? `Estimativa: aproximadamente ${diasParaMetaLiquido} dia(s) para atingir ${cfg.metaSeguidores.toLocaleString("pt-BR")} seguidores.`
        : "Estimativa indisponível: registre mais dados de seguidores.")
    : "";

  const metaMsg = document.getElementById("instaMetaMsg");
  if (cfg.metaSeguidores>0 && seguidoresAtuais>=cfg.metaSeguidores){
    metaMsg.innerHTML = `🎉 Meta atingida! Que tal subir a meta para ${(cfg.metaSeguidores+2000).toLocaleString("pt-BR")}?`;
    metaMsg.style.color = "var(--green)";
  } else if (cfg.metaSeguidores>0){
    metaMsg.innerHTML = `Faltam ${faltaMeta.toLocaleString("pt-BR")} seguidores${diasParaMeta?` · no ritmo atual, cerca de ${diasParaMeta} dia(s)`:""}<br><span style="opacity:.85;">${estimativaTxt}</span>`;
    metaMsg.style.color = "var(--text-dim)";
  } else {
    metaMsg.textContent = "";
  }

  /* Onde melhorar: impacto de cada atividade no ganho de seguidores */
  const atividadesImpacto = [
    {label:"Dias com Stories", campo:"sto"},
    {label:"Dias com Reels", campo:"ree"},
    {label:"Dias com Feed", campo:"feed"},
    {label:"Dias com Ofertas", campo:"ofe"},
  ];
  const impacto = atividadesImpacto.map(a=>{
    const com=[], sem=[];
    dias.forEach((k,i)=>{
      if (i===0) return;
      const d = diaSum(k);
      if ((d[a.campo]||0)>0) com.push(deltaSeg[i]); else sem.push(deltaSeg[i]);
    });
    const mediaCom = com.length ? com.reduce((x,y)=>x+y,0)/com.length : 0;
    const mediaSem = sem.length ? sem.reduce((x,y)=>x+y,0)/sem.length : 0;
    return {label:a.label, diferenca: Math.round((mediaCom-mediaSem)*10)/10};
  });
  document.getElementById("chartInstaMelhorias").innerHTML = instaImpactoChartSVG(impacto);

  /* Recomendações automáticas */
  const insights = gerarInsightsInstagram(dias, contentSeries, deltaSeg);
  const melhorAtividade = impacto.slice().sort((a,b)=>b.diferenca-a.diferenca)[0];
  if (melhorAtividade && melhorAtividade.diferenca>0){
    insights.push(`<b>${melhorAtividade.label}</b> é a atividade mais associada ao crescimento: em média +${melhorAtividade.diferenca.toFixed(1)} seguidores/dia a mais que nos dias sem essa atividade.`);
  }
  document.getElementById("instaInsightsList").innerHTML = insights.map(t=>`<li>${t}</li>`).join("");

  /* ===================== GROWTH INTELLIGENCE ===================== */
  {
    // Consistência agora olha só os últimos 7 dias corridos (não a média acumulada do mês),
    // pra reagir de verdade quando o ritmo de postagem cai nos dias recentes.
    let totalFeed7=0, totalReels7=0, totalStories7=0;
    for (let i=0;i<7;i++){
      const dRef = new Date();
      dRef.setDate(dRef.getDate()-i);
      const dsRef = dataParaISO(dRef);
      const somaRef = diaSum(dsRef);
      totalFeed7 += somaRef.feed||0;
      totalReels7 += somaRef.ree||0;
      totalStories7 += somaRef.sto||0;
    }
    const totalStoMes = totalMes("sto"), totalReeMes = totalMes("ree"), totalFeedMes = totalMes("feed");

    // Benchmarks 2026 (consenso de mercado: Hootsuite, Buffer, Later, SocialPilot): Feed 3-5x/semana, Reels 3-5x/semana, Stories quase diárias
    const scoreFeed = Math.min((totalFeed7/4)*100, 100);
    const scoreReels = Math.min((totalReels7/4)*100, 100);
    const scoreStories = Math.min((totalStories7/7)*100, 100);
    const consistencia = Math.round((scoreFeed+scoreReels+scoreStories)/3);

    const totalConteudo = totalStoMes+totalReeMes+totalFeedMes;
    let diversidade = 0;
    if (totalConteudo>0){
      const pSto=totalStoMes/totalConteudo, pRee=totalReeMes/totalConteudo, pFeed=totalFeedMes/totalConteudo;
      const desvio = Math.abs(pSto-1/3)+Math.abs(pRee-1/3)+Math.abs(pFeed-1/3);
      diversidade = Math.round(Math.max(0, 100-desvio*100));
    }

    const hoje2 = new Date();
    const diaDoMes = hoje2.getDate();
    const totalDiasMes = diasNoMes(cfg.mesRef);
    const metaProporcional = cfg.metaSeguidores>0 ? Math.max((cfg.metaSeguidores-primeiroSeg)*(diaDoMes/totalDiasMes),0) : 0;
    let crescimento;
    if (cfg.metaSeguidores>0 && metaProporcional>0){
      crescimento = Math.round(Math.min(Math.max((delta/metaProporcional)*100,0),100));
    } else if (delta>0){ crescimento = 70; }
    else if (delta===0){ crescimento = 40; }
    else { crescimento = 15; }

    const painelAtual = seriesPainel[seriesPainel.length-1]||0;
    const painelPrimeiro = seriesPainel.find(v=>v>0)||0;
    const painelDeltaPct = painelPrimeiro>0 ? ((painelAtual-painelPrimeiro)/painelPrimeiro)*100 : 0;
    const alcance = painelPrimeiro>0 ? Math.round(Math.min(Math.max((painelDeltaPct/10)*100,0),100)) : 50;

    const scoreTotal = Math.round(consistencia*0.35 + diversidade*0.20 + crescimento*0.25 + alcance*0.20);
    const corScore = scoreTotal>=70 ? "#1FA463" : scoreTotal>=40 ? "#F7C600" : "#E23B4E";

    document.getElementById("radarChartGrowth").innerHTML = radarChartSVG(
      ["Consistência","Diversidade","Crescimento","Alcance"], [consistencia, diversidade, crescimento, alcance]
    );
    document.getElementById("growthScoreRing").innerHTML = scoreRingSVG(scoreTotal/100, corScore);
    const scoreEl = document.getElementById("growthScoreValue");
    scoreEl.textContent = scoreTotal;
    scoreEl.style.color = corScore;
    scoreEl.style.textShadow = `0 0 14px ${corScore}`;

    document.getElementById("growthMetricsCards").innerHTML = [
      ["📅 Consistência", consistencia, "Últimos 7 dias: Feed/Reels/Stories vs. ritmo recomendado 2026 (3-5x/semana + Stories quase todo dia)"],
      ["🎨 Diversidade", diversidade, "Equilíbrio entre Stories, Reels e Feed — nada concentrado demais num só formato"],
      ["📈 Crescimento", crescimento, "Ritmo de ganho de seguidores comparado à sua meta proporcional ao mês"],
      ["👁️ Alcance", alcance, "Evolução do Painel Profissional no período, como referência de exposição"],
    ].map(([l,v,desc])=>`
      <div class="growth-metric-card">
        <div class="growth-metric-top"><span>${l}</span><b>${v}</b></div>
        <div class="growth-metric-bar"><div class="growth-metric-fill" style="width:${v}%;"></div></div>
        <div class="growth-metric-desc">${desc}</div>
      </div>`).join("");

    const dicasAlgoritmo = [
      "Nos primeiros segundos de um Reels, boa parte das pessoas já decide se continua assistindo. Comece com uma cena forte ou uma pergunta direta, sem logo ou introdução.",
      "Compartilhamentos por DM valem bem mais que curtidas para o algoritmo te mostrar pra gente nova. Pense: “isso é algo que alguém mandaria pra um amigo?”",
      "Salvamentos pesam mais que curtidas no ranqueamento. Listas, dicas e passo a passo tendem a ser mais salvos do que posts só bonitos.",
      "O ritmo recomendado em 2026 é de 3 a 5 Reels e 3 a 5 posts no feed por semana, com Stories quase todo dia — consistência pesa mais que picos isolados.",
      "Contas que somem por uma semana sentem queda real de alcance depois. Prefira postar um pouco, mas sem parar, do que postar muito e sumir.",
      "Carrosséis continuam fortes: rendem bem mais engajamento que uma imagem única, porque prendem a pessoa rolando mais tempo dentro do post.",
      "Use poucas hashtags (3 a 5), bem específicas do seu nicho. Hashtag em excesso hoje é quase tratada como spam pelo algoritmo.",
      "Responder comentários e DMs na primeira hora depois de postar conta como sinal de engajamento — isso ajuda o post a alcançar mais gente.",
      "Vídeo reaproveitado de outra rede (com marca d'água) perde bastante alcance. Grave pensando especificamente no Instagram.",
      "Palavras-chave na legenda e na bio ajudam mais a ser encontrado hoje do que hashtags — escreva pensando em como alguém buscaria um carro ou revendedora.",
    ];
    const diaDoAno = Math.floor((hoje2 - new Date(hoje2.getFullYear(),0,0)) / 86400000);
    document.getElementById("algoritmoTipBox").innerHTML = `<b>💡 Insight do Algoritmo (2026):</b> ${dicasAlgoritmo[diaDoAno % dicasAlgoritmo.length]}`;
  }
}
function totalMes(campo){
  return diasDoMesAtual().reduce((s,k)=>s+diaSum(k)[campo],0);
}
function vendasDoMesAtual(){
  return filtrarPorVendedor(state.vendas).filter(v=>v.data && v.data.startsWith(state.config.mesRef)).sort((a,b)=>a.data.localeCompare(b.data));
}
// Zera retornoBanco/pontuacao/total de uma venda (usado quando um prêmio do
// Banco VW é apagado, pra não deixar valor "fantasma" na venda de origem).
function resetarRetornoBancoDaVenda(vendaId){
  const v = state.vendas.find(x=>x.id===vendaId);
  if (!v) return;
  v.retornoBanco = 0;
  v.pontuacao = 0;
  v.total = (Number(v.comissao)||0) + (Number(v.emplacamentoValor)||0) + (Number(v.acessoriosValor)||0) + (Number(v.seguroValor)||0);
}
let competicaoCarrosEscopo = "mes";
function renderCompeticaoCarros(){
  const vendasConsideradas = competicaoCarrosEscopo==="mes" ? vendasDoMesAtual() : filtrarPorVendedor(state.vendas);
  const contagem = {};
  vendasConsideradas.forEach(v=>{
    const modelo = (v.modelo||"").trim() || (v.carro||"").trim() || "Sem modelo";
    contagem[modelo] = (contagem[modelo]||0)+1;
  });
  const itens = Object.entries(contagem).map(([modelo,qtd])=>({modelo,qtd})).sort((a,b)=>b.qtd-a.qtd);
  document.getElementById("competicaoCarrosBox").innerHTML = competicaoCarrosSVG(itens);
  document.getElementById("btnCompMes").classList.toggle("pill-ativo", competicaoCarrosEscopo==="mes");
  document.getElementById("btnCompGeral").classList.toggle("pill-ativo", competicaoCarrosEscopo==="geral");
}
function metaProgressRow(label, atual, meta){
  const pctv = meta>0 ? Math.min(atual/meta,1) : 0;
  const cls = pctv>=1 ? "green" : pctv>=0.7 ? "yellow" : "red";
  return `<div style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:var(--graphite-2);margin-bottom:6px;">
      <span>${label}</span><span class="tag ${cls}">${atual} / ${meta}</span>
    </div>
    <div class="progress-wrap" style="height:16px;"><div class="progress-bar" style="width:${(pctv*100).toFixed(0)}%"></div></div>
  </div>`;
}
function renderMetasProgress(){
  const cfg = {...state.config, ...metasDoVendedorAtual()};
  const dim = diasUteisNoMes(cfg.mesRef);
  const dimLig = diasComLigacaoNoMes(cfg.mesRef);
  const metas = [
    ["Ligações", totalMes("lig"), (cfg.metaLig||0)*dimLig],
    ["WhatsApp", totalMes("wpp"), (cfg.metaWpp||0)*dim],
    ["Stories", totalMes("sto"), (cfg.metaStories||0)*dim],
    ["Reels", totalMes("ree"), (cfg.metaReels||0)*dim],
    ["Postagem no Feed", totalMes("feed"), (cfg.metaFeed||0)*dim],
    ["Ofertas do Mês", totalMes("ofe"), (cfg.metaOfertas||0)*dim],
  ];
  document.getElementById("metasProgress").innerHTML = metas.map(([l,a,m])=>metaProgressRow(l,a,m)).join("");
}
/* ============================= GERADOR DE POSTAGENS ============================= */
const POST_FORMATOS = {
  carrossel: {
    nome: "Carrossel",
    ideias: [
      "5 motivos pra escolher o {carro}",
      "Tour completo por dentro do {carro}",
      "Tudo que o {carro} tem de série — desliza pra ver",
      "Antes de comprar, veja esses detalhes do {carro}",
      "Espaço interno e porta-malas do {carro}: cabe tudo?",
      "5 detalhes do {carro} que pouca gente repara",
      "Do zero ao emplacado: a jornada de comprar um {carro}",
      "{carro}: ficha técnica em 5 slides",
      "As cores disponíveis do {carro} — qual combina com você?",
      "O que vem de série x o que é opcional no {carro}",
      "Comparando o {carro} com a geração anterior",
      "Um dia inteiro rodando com o {carro}: o que reparei",
    ],
    legendas: [
      p => `Bora conhecer de perto o ${p.carro}${p.ano?" "+p.ano:""}? 🚗\n\nDeslize pro lado e veja tudo que ele tem pra te oferecer${p.assunto?" — hoje o assunto é "+p.assunto:""}. Qualquer dúvida, chama no direct! 💬`,
      p => `${p.carro} por dentro e por fora 🔍\n\n${p.assunto||"Cada detalhe pensado pra sua rotina"}. Desliza o carrossel e me conta nos comentários o que mais chamou sua atenção!`,
      p => `Poucas pessoas conhecem esses detalhes do ${p.carro}... 👀\n\n${p.assunto||"Preparei esse carrossel especialmente pra te mostrar de perto"}. Vem comigo!`,
      p => `Já pensou em ter um ${p.carro} na garagem? 🔑\n\n${p.assunto||"Separei os principais pontos que fazem esse carro valer a pena"}. Segue o fio 🧵`,
      p => `Comprar carro é decisão que começa muito antes da loja — começa aqui no feed 📲\n\nPor isso trouxe o ${p.carro} de todos os ângulos${p.assunto?", com foco em "+p.assunto:""}.`,
    ],
    roteiros: [
      p => `Não é vídeo — é carrossel de fotos. Sequência sugerida:\n1. Foto externa (frente 3/4) com o nome do modelo\n2. Detalhe do design (rodas, faróis ou grade)\n3. Painel e interior\n4. Porta-malas / espaço interno\n5. Slide final com "Chama no direct" e seu contato`,
      p => `Sequência com foco em comparação:\n1. Foto do ${p.carro} atual\n2. Foto do modelo anterior (se tiver)\n3. Lista com 3 diferenças principais\n4. Detalhe de algo que melhorou\n5. Chamada pra vir testar pessoalmente`,
      p => `Sequência estilo "jornada do cliente":\n1. Cliente chegando na loja\n2. Momento do test-drive\n3. Assinatura da proposta\n4. Entrega das chaves\n5. Cliente saindo com o carro — pergunte se pode usar essa história como exemplo`,
    ],
  },
  estatica: {
    nome: "Estática",
    ideias: [
      "Foto de capa do {carro} recém-chegado na loja",
      "Detalhe em close do acabamento do {carro}",
      "O {carro} estacionado, pronto pra entrega",
      "Vitrine da loja com o {carro} em destaque",
      "Carro da Semana: {carro}",
      "Antes e depois: {carro} seminovo revisado",
      "Pôr do sol com o {carro} em primeiro plano",
      "Detalhe do painel do {carro} ligado",
      "{carro} emplacado, pronto pra rodar",
    ],
    legendas: [
      p => `Olha só que chegada! O ${p.carro}${p.ano?" "+p.ano:""} já está aqui na loja${p.assunto?", com "+p.assunto:""}. 😍\n\nVem conhecer de perto — te espero aqui!`,
      p => `${p.carro} chamando atenção só de estar parado 🤩\n\n${p.assunto||"Detalhes que fazem a diferença na hora de escolher"}.`,
      p => `Essa é a cara de quem tá pronto pra rodar 🚗💨\n\n${p.carro}${p.assunto?" — "+p.assunto:""}. Manda mensagem que eu reservo pra você conhecer.`,
      p => `Carro bonito é carro que a gente quer fotografar de novo 📸\n\n${p.carro}${p.ano?" "+p.ano:""} na loja, esperando por você.`,
    ],
    roteiros: null,
  },
  reacao: {
    nome: "Reação",
    ideias: [
      "Reação de cliente ao ver o {carro} pela primeira vez",
      "Minha reação ao dirigir o {carro}",
      "Reagindo aos detalhes escondidos do {carro}",
      "Reação ao ouvir o preço do {carro} com desconto",
      "Testando o porta-malas do {carro} ao vivo",
      "Reagindo aos comentários dos seguidores sobre o {carro}",
    ],
    legendas: [
      p => `Não teve como segurar a reação com o ${p.carro}! 😲🚗\n\n${p.assunto?p.assunto+". ":""}Vem sentir de perto essa experiência também.`,
      p => `A cara de quem viu o ${p.carro} de pertinho pela primeira vez 😳\n\n${p.assunto||"Alguns carros a gente só entende quando vê ao vivo"}.`,
      p => `Reagi assim porque não esperava... 🫣\n\n${p.assunto||"O "+p.carro+" surpreende até quem trabalha com carro todo dia"}.`,
    ],
    roteiros: [
      p => `1. Comece com a câmera já ligada e uma expressão de surpresa genuína.\n2. Mostre o motivo da reação (${p.assunto||"um detalhe do carro que te impressionou"}).\n3. Explique em poucas palavras por que aquilo é um diferencial.\n4. Finalize convidando a pessoa a vir testar/conhecer.`,
      p => `1. Grave o momento exato em que você (ou o cliente) vê o carro de perto.\n2. Não corte a reação genuína, mesmo que exagerada.\n3. Legende na tela o que está acontecendo.\n4. Feche com "e você, já viu de perto?"`,
    ],
  },
  batalha: {
    nome: "Batalha/Comparação",
    ideias: [
      "{carro} vs concorrente direto — qual leva a melhor?",
      "Versão de entrada vs versão top do {carro}",
      "Zero KM vs Seminovo: qual escolher?",
      "{carro} automático vs manual: prós e contras",
      "Financiar vs pagar à vista o {carro}: o que compensa mais?",
      "{carro} vs modelo do ano passado: valeu a pena esperar?",
    ],
    legendas: [
      p => `Batalha de hoje: ${p.assunto || "comparando opções pra você decidir com informação"} 🥊\n\nComenta aqui embaixo qual você escolheria!`,
      p => `Duelo direto, sem enrolação ⚔️\n\n${p.assunto || "Coloquei lado a lado pra você ver a diferença de verdade"}. Qual time você é?`,
      p => `Antes de decidir, compara aqui 👇\n\n${p.assunto || "Separei os pontos que realmente pesam na hora de escolher"}.`,
    ],
    roteiros: [
      p => `1. Apresente as duas opções lado a lado.\n2. Compare 3 pontos objetivos (preço, equipamento, consumo ou espaço).\n3. Dê sua opinião como especialista, sem menosprezar nenhuma opção.\n4. Pergunte pro público qual prefere, pra gerar comentários.`,
      p => `1. Divida a tela ou alterne rápido entre as duas opções.\n2. Para cada uma, cite 1 vantagem e 1 desvantagem real.\n3. Conclua com uma recomendação baseada em perfil de uso (família, cidade, viagem).\n4. Convide pra tirar dúvidas no direct.`,
    ],
  },
  perguntas: {
    nome: "Caixa de Perguntas",
    ideias: [
      "Manda sua dúvida sobre o {carro} que eu respondo",
      "Caixinha de perguntas: financiamento e condições",
      "Pergunta o que quiser sobre comprar carro 0KM ou seminovo",
      "Tira-dúvidas sobre troca de carro usado",
      "Pergunte sobre o processo de test-drive do {carro}",
      "Caixinha: o que você quer saber sobre revisão e garantia",
    ],
    legendas: [
      p => `Abri a caixinha! 📬 Pode perguntar sobre ${p.assunto || ("o "+p.carro+", financiamento, troca ou qualquer dúvida")} — vou responder por aqui nos stories.`,
      p => `Hoje é dia de tirar dúvida 🙋\n\n${p.assunto||"Sobre o "+p.carro+" ou qualquer coisa sobre comprar carro"}, pode perguntar sem vergonha.`,
      p => `Vocês perguntam, eu respondo 📲\n\n${p.assunto||"Manda a dúvida que talvez todo mundo tenha, mas ninguém pergunta"}.`,
    ],
    roteiros: [
      p => `1. Story 1: caixinha de perguntas com o texto "Pergunta o que quiser sobre ${p.assunto||p.carro}".\n2. Junte as perguntas que chegarem.\n3. Grave stories de resposta, uma pergunta por story, direto e simples.\n4. No final, deixe seu contato pra quem quiser continuar a conversa.`,
      p => `1. Anuncie no feed que a caixinha está aberta nos stories.\n2. Fixe a pergunta mais comum recebida em destaque.\n3. Responda com vídeo curto (não só texto), fica mais pessoal.\n4. Repita esse formato semanalmente pra criar hábito no público.`,
    ],
  },
  enquete: {
    nome: "Enquete",
    ideias: [
      "Enquete: qual cor combina mais com o {carro}?",
      "Zero KM ou Seminovo — o que você prefere?",
      "Câmbio manual ou automático: qual sua escolha?",
      "Enquete: qual detalhe importa mais pra você num carro?",
      "SUV ou hatch: qual estilo você prefere no dia a dia?",
      "Comprar à vista ou financiado: o que você faria?",
    ],
    legendas: [
      p => `Vem votar! 📊 ${p.assunto || ("Sobre o "+p.carro)} — qual você escolhe?`,
      p => `Enquete rápida de hoje 🗳️\n\n${p.assunto||"Quero saber a opinião de vocês sobre isso"}. Vota aí nos stories!`,
      p => `Duas opções, uma escolha 🤔\n\n${p.assunto||"Depois eu conto o resultado por aqui"}.`,
    ],
    roteiros: [
      p => `1. Foto ou vídeo curto mostrando as duas opções da enquete.\n2. Adicione o sticker de enquete do Instagram com as opções bem claras.\n3. Depois de algumas horas, responda o resultado em outro story.`,
      p => `1. Comece com uma pergunta direta na tela.\n2. Mostre rapidamente as duas alternativas sendo comparadas.\n3. Use o sticker de enquete logo em seguida.\n4. No dia seguinte, poste o resultado com um comentário engraçado ou surpreso.`,
    ],
  },
  loja: {
    nome: "Dia na Loja",
    ideias: [
      "Bastidores de um dia normal na concessionária",
      "Chegada de um cliente satisfeito buscando o carro novo",
      "Equipe se preparando para atender bem",
      "Um dia na vida de um vendedor de carros",
      "Bastidores da preparação de um carro pra entrega",
      "Nossa equipe em ação — quem cuida de você aqui",
    ],
    legendas: [
      p => `Um dia por aqui na Motomecânica Volkswagen 🏬✨\n\n${p.assunto || "Sempre prontos pra te atender bem, do primeiro contato até a entrega das chaves"}.`,
      p => `Por trás de cada venda tem uma equipe que se importa de verdade 🤝\n\n${p.assunto||"Um pouquinho do nosso dia a dia aqui na loja"}.`,
      p => `Bastidores que pouca gente vê 👀\n\n${p.assunto||"É assim que preparamos tudo pra te receber bem"}.`,
    ],
    roteiros: [
      p => `1. Mostre a loja aberta, ambiente organizado.\n2. Grave um momento real de atendimento (com autorização do cliente) ou dos bastidores.\n3. Fale rapidamente sobre o que torna o atendimento de vocês diferente.\n4. Convide quem estiver pensando em trocar de carro a passar na loja.`,
      p => `1. Comece com a equipe se preparando antes da loja abrir.\n2. Mostre um momento de bastidor (organização, limpeza dos carros, reunião rápida).\n3. Encerre com um recado direto e simpático pro seguidor.`,
    ],
  },
  seminovos: {
    nome: "Foco Seminovos",
    ideias: [
      "Seminovo revisado: {carro} pronto pra rodar",
      "Vantagens de comprar um seminovo com garantia",
      "Seminovo em conta boa demais: {carro}",
      "Antes e depois: como preparamos um seminovo pra venda",
      "Seminovo x 0KM: o que muda no bolso",
      "Procedência: como avaliamos cada seminovo antes de vender",
    ],
    legendas: [
      p => `Seminovo de confiança 🚘 ${p.carro}${p.ano?" "+p.ano:""}, revisado e pronto pra você.\n\n${p.assunto || "Procedência garantida e condições facilitadas"}. Vem ver!`,
      p => `Nem todo seminovo é igual 🔍\n\n${p.assunto||"O nosso passa por revisão completa antes de chegar até você"}. ${p.carro} esperando por um novo dono.`,
      p => `Economia sem abrir mão de qualidade 💰\n\n${p.carro} seminovo, ${p.assunto||"com toda procedência que você precisa pra comprar tranquilo"}.`,
    ],
    roteiros: [
      p => `1. Mostre o carro por fora e por dentro, destacando o estado de conservação.\n2. Fale sobre a revisão/garantia que o seminovo passou.\n3. Comente sobre economia comparado a um 0KM.\n4. Chame pra vir ver pessoalmente.`,
      p => `1. Mostre o processo de inspeção do carro (itens verificados).\n2. Destaque um detalhe que prova a procedência (documentação, histórico).\n3. Feche reforçando a confiança de comprar seminovo com garantia da loja.`,
    ],
  },
  zerokm: {
    nome: "Foco Zero KM",
    ideias: [
      "0KM na garagem: {carro} pronto pra entrega",
      "Cheirinho de carro novo: {carro} 0KM",
      "Condições especiais no {carro} 0KM esse mês",
      "Primeiro carro 0KM: por onde começar",
      "Configurações disponíveis do {carro} 0KM",
      "Da fábrica direto pra sua garagem: {carro}",
    ],
    legendas: [
      p => `Aquele cheirinho de carro novo 😍 ${p.carro}${p.ano?" "+p.ano:""} 0KM.\n\n${p.assunto || "Com condições especiais esse mês"}. Chama no direct e peça sua proposta!`,
      p => `Zero quilômetro, zero surpresa 🚗✨\n\n${p.carro}${p.assunto?" — "+p.assunto:""}. Vem garantir o seu.`,
      p => `Tudo novo, tudo seu 🔑\n\n${p.carro} 0KM${p.assunto?", "+p.assunto:""}. Fala comigo pra simular as condições.`,
    ],
    roteiros: [
      p => `1. Abra com o carro ainda com plástico de proteção ou brilhando na vitrine.\n2. Destaque 2-3 diferenciais do modelo.\n3. Fale sobre a condição/promoção do mês.\n4. Encerre com chamada clara pra ação (WhatsApp/direct).`,
      p => `1. Mostre o carro sendo preparado para entrega.\n2. Liste rapidamente os itens de série mais procurados.\n3. Convide o seguidor a simular parcelas com você.`,
    ],
  },
  posvendas: {
    nome: "Pós-Vendas",
    ideias: [
      "Revisão programada: por que não pular nenhuma",
      "Dica rápida de manutenção pro seu Volkswagen",
      "Oficina Volkswagen: peças originais fazem diferença",
      "Sinais de que seu carro precisa de revisão",
      "Cuidados antes de uma viagem longa",
      "Como funciona a garantia de fábrica",
    ],
    legendas: [
      p => `Cuidar do seu carro é cuidar do seu investimento 🔧\n\n${p.assunto || "Agende sua revisão com quem entende de Volkswagen"}.`,
      p => `Seu carro também merece atenção depois da compra 🛠️\n\n${p.assunto||"Separei uma dica rápida pra você não esquecer"}.`,
      p => `Prevenir é sempre mais barato que remediar 💡\n\n${p.assunto||"Fica de olho nesses sinais"}.`,
    ],
    roteiros: [
      p => `1. Mostre a oficina/equipe técnica trabalhando.\n2. Explique de forma simples ${p.assunto||"a importância da revisão em dia"}.\n3. Reforce o diferencial de usar peças originais.\n4. Convide o seguidor a agendar a revisão.`,
      p => `1. Liste rapidamente 3 sinais de alerta que o carro dá.\n2. Explique o que cada um pode significar, sem alarmismo.\n3. Convide a marcar uma avaliação gratuita ou revisão na loja.`,
    ],
  },
  generico: {
    nome: "Genérico/Institucional",
    ideias: [
      "Bom dia com motivação pra quem está pensando em trocar de carro",
      "Curiosidade sobre a Volkswagen que pouca gente sabe",
      "Por que comprar na concessionária faz diferença",
      "Nossa história: como a loja começou",
      "O futuro dos carros: elétricos e novas tecnologias",
      "O que considerar antes de trocar de carro",
    ],
    legendas: [
      p => `${p.assunto || "Mais um dia motivado por aqui"} 🚗✨\n\nSe você está pensando em trocar de carro, chama a gente — vamos te ajudar do jeito certo.`,
      p => `Curiosidade do dia 💡\n\n${p.assunto||"Separei algo que talvez você não soubesse sobre a Volkswagen"}.`,
      p => `Comprar na concessionária certa faz toda diferença 🤝\n\n${p.assunto||"Conta com a gente pra te ajudar do jeito certo, sem pressa e sem pressão"}.`,
    ],
    roteiros: [
      p => `1. Grave uma fala curta e direta olhando pra câmera.\n2. Fale sobre ${p.assunto||"o tema do dia"} de forma simples.\n3. Feche reforçando que está à disposição pra ajudar.`,
      p => `1. Comece com uma pergunta que gere identificação ("já pensou em...?").\n2. Compartilhe ${p.assunto||"uma reflexão rápida sobre o tema"}.\n3. Encerre convidando a pessoa a comentar sua opinião.`,
    ],
  },
};
function gerarHashtagsPostagem(formatoKey){
  const base = ["#Volkswagen","#VW","#MotomecanicaVolkswagen","#ConcessionariaVW"];
  const regional = ["#Lajeado","#LajeadoRS","#ValeDoTaquari","#RS","#SerraGaucha"];
  const porFormato = {
    carrossel:["#CarrosselInstagram"], estatica:["#CarroNovo"], reacao:["#Reels","#ReelsInstagram"],
    batalha:["#Comparativo"], perguntas:["#TiraDuvidas"], enquete:["#Enquete"],
    loja:["#BastidoresDaLoja"], seminovos:["#Seminovos","#CarroSeminovo"], zerokm:["#ZeroKm","#0km"],
    posvendas:["#PosVenda","#RevisaoVW","#OficinaVW"], generico:["#MundoVW"],
  };
  return [...base, ...regional, ...(porFormato[formatoKey]||[])].join(" ");
}
function datasEntre(inicio, fim){
  if (!inicio || !fim) return [];
  const datas = [];
  let d = new Date(inicio+"T00:00:00");
  const fimD = new Date(fim+"T00:00:00");
  if (fimD < d) return [];
  let seguranca = 0;
  while (d <= fimD && seguranca<366){
    datas.push(dataParaISO(d));
    d.setDate(d.getDate()+1);
    seguranca++;
  }
  return datas;
}
function intercalarTarefas(qtdReels, qtdStories, qtdFeed){
  const filas = { Reels:qtdReels, Stories:qtdStories, Feed:qtdFeed };
  const tarefas = [];
  while (filas.Reels>0 || filas.Stories>0 || filas.Feed>0){
    if (filas.Reels>0){ tarefas.push("Reels"); filas.Reels--; }
    if (filas.Stories>0){ tarefas.push("Stories"); filas.Stories--; }
    if (filas.Feed>0){ tarefas.push("Feed"); filas.Feed--; }
  }
  return tarefas;
}
function embaralhar(lista){
  const copia = [...lista];
  for (let i=copia.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
function sortear(lista){
  return lista[Math.floor(Math.random()*lista.length)];
}
function gerarIdeiasPostagem(cfgGer){
  const {carros, versao, ano, assunto, qtdReels, qtdStories, qtdFeed, formatos, dataInicio, dataFim} = cfgGer;
  const formatosEscolhidos = formatos.length ? formatos : Object.keys(POST_FORMATOS);
  const carrosEscolhidos = carros.length ? carros : [""]; // "" = sem carro específico
  const usaVersaoAno = carrosEscolhidos.length===1; // versão/ano só fazem sentido com 1 modelo só
  const datasPlano = datasEntre(dataInicio, dataFim);

  // sorteia a ordem das datas, pra nao empilhar sempre o mesmo tipo/carro no mesmo dia quando o plano tem varios dias
  const datasEmbaralhadas = datasPlano.length ? embaralhar(datasPlano) : [];
  const tarefas = embaralhar(intercalarTarefas(qtdReels, qtdStories, qtdFeed));

  return tarefas.map((tipo, idx)=>{
    const carro = sortear(carrosEscolhidos); // sorteio do carro — não fica preso a uma ordem fixa
    const formatoKey = sortear(formatosEscolhidos); // sorteio do formato também
    const tpl = POST_FORMATOS[formatoKey];
    const anoUsado = usaVersaoAno ? ano : "";
    const versaoUsada = usaVersaoAno ? versao : "";
    const carroTxt = carro ? `${carro}${versaoUsada?" "+versaoUsada:""}` : "";
    const ideiaTexto = sortear(tpl.ideias).replace(/\{carro\}/g, carroTxt||"o carro");
    const paramsTexto = {carro:carroTxt||"nosso veículo", ano:anoUsado, assunto};
    return {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6)+idx,
      tipo, formatoKey, formatoNome: tpl.nome,
      ideia: ideiaTexto,
      legenda: sortear(tpl.legendas)(paramsTexto),
      roteiro: (tipo!=="Feed" && tpl.roteiros) ? sortear(tpl.roteiros)(paramsTexto) : null,
      hashtags: gerarHashtagsPostagem(formatoKey),
      carro, versao:versaoUsada, ano:anoUsado, assunto,
      dataAgendada: datasEmbaralhadas.length ? datasEmbaralhadas[idx % datasEmbaralhadas.length] : null,
      feito: false,
      dataGerado: todayISO(),
    };
  });
}
function postCardHTML(p, editavel){
  const coresFormato = {carrossel:"#833AB4",estatica:"#2E86DE",reacao:"#F7C600",batalha:"#E10600",perguntas:"#17A398",enquete:"#0E7C86",loja:"#1FA463",seminovos:"#6D4C41",zerokm:"#1a1a1a",posvendas:"#C2185B",generico:"#8a8f98"};
  const corBadge = coresFormato[p.formatoKey] || "#8a8f98";
  return `<div class="post-card ${p.feito?'post-feito':''}" data-id="${p.id}">
    <div class="post-card-badges">
      ${p.dataAgendada?`<span class="post-badge" style="background:var(--orange-deep);">📅 ${fmtDate(p.dataAgendada)}</span>`:""}
      <span class="post-badge" style="background:#1a1a1a;">${p.tipo}</span>
      <span class="post-badge" style="background:${corBadge};">${p.formatoNome}</span>
      ${p.carro?`<span class="post-badge" style="background:var(--border-light);color:var(--text-dim);">${p.carro}${p.versao?" "+p.versao:""}</span>`:""}
    </div>
    <div class="post-card-titulo">${p.ideia}</div>
    <div class="post-card-secao">
      <div class="post-card-secao-label"><span>📝 Legenda pronta</span><button type="button" class="post-btn-copiar" onclick="copiarTextoPost(this,'legenda-${p.id}')">Copiar</button></div>
      <div class="post-card-secao-texto" id="legenda-${p.id}">${p.legenda}</div>
    </div>
    ${p.roteiro ? `<div class="post-card-secao">
      <div class="post-card-secao-label"><span>🎬 Roteiro de fala</span><button type="button" class="post-btn-copiar" onclick="copiarTextoPost(this,'roteiro-${p.id}')">Copiar</button></div>
      <div class="post-card-secao-texto" id="roteiro-${p.id}">${p.roteiro}</div>
    </div>` : ""}
    <div class="post-card-secao">
      <div class="post-card-secao-label"><span>🏷️ Hashtags</span><button type="button" class="post-btn-copiar" onclick="copiarTextoPost(this,'hash-${p.id}')">Copiar</button></div>
      <div class="post-card-secao-texto" id="hash-${p.id}" style="color:var(--navy);">${p.hashtags}</div>
    </div>
    <div class="post-card-footer">
      <label class="post-check-feito">
        <input type="checkbox" ${p.feito?"checked":""} onchange="togglePostagemFeita('${p.id}')"> ${p.feito?"Postado ✅":"Marcar como postado"}
      </label>
      <button class="danger" onclick="delPostagem('${p.id}')" title="Excluir">✕</button>
    </div>
  </div>`;
}
function copiarTextoPost(btn, elId){
  const texto = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(texto).then(()=>{
    const original = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(()=>{ btn.textContent = original; }, 1500);
  }).catch(()=>{ alert("Não foi possível copiar automaticamente. Selecione o texto manualmente."); });
}
function togglePostagemFeita(id){
  const p = state.postagens.find(x=>x.id===id);
  if (!p) return;
  p.feito = !p.feito;
  persist(); renderPostagens();
}
function delPostagem(id){
  if (!confirm("Excluir esta postagem?")) return;
  state.postagens = state.postagens.filter(p=>p.id!==id);
  persist(); renderPostagens();
}
function renderPostagens(){
  const historico = [...(state.postagens||[])].sort((a,b)=>{
    // pendentes primeiro; entre pendentes, ordena por data agendada (as sem data ficam no fim); feitas ficam no fim, mais recentes primeiro
    if (a.feito !== b.feito) return a.feito ? 1 : -1;
    if (!a.feito){
      const da = a.dataAgendada || "9999-99-99", db = b.dataAgendada || "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      return (b.dataGerado||"").localeCompare(a.dataGerado||"");
    }
    return (b.dataGerado||"").localeCompare(a.dataGerado||"");
  });
  const pendentes = historico.filter(p=>!p.feito).length;
  document.getElementById("postagensHistoricoResumo").textContent = historico.length
    ? `${historico.length} ${historico.length===1?"postagem":"postagens"} no total · ${pendentes} pendente${pendentes===1?"":"s"}`
    : "";
  document.getElementById("postagensHistoricoBox").innerHTML = historico.length
    ? historico.map(p=>postCardHTML(p,true)).join("")
    : `<div class="empty">Nenhuma postagem gerada ainda. Use o gerador acima pra começar.</div>`;
}
function renderTendencia(){
  const dias = diasDoMesAtual();
  const labels = dias.map(k=>k.slice(8,10));

  const seriesLig = [
    dias.map(k=>diaSum(k).ligNao||0),
    dias.map(k=>diaSum(k).ligAtendSem||0),
    dias.map(k=>diaSum(k).ligAtendCom||0),
    dias.map(k=>diaSum(k).ligInvalido||0),
    dias.map(k=>diaSum(k).wpp||0),
  ];
  const coresLig = ["#8a8f98","#E10600","#1FA463","#C98A12","#2E86DE"];
  document.getElementById("chartTendenciaLig").innerHTML = lineChartSVG(labels, seriesLig, coresLig);
  const nomesLig = ["Não Atendidas","Atendidas Sem Interesse","Atendidas Com Interesse","Inválidos","WhatsApp"];
  document.getElementById("legendTendenciaLig").innerHTML = nomesLig.map((nm,i)=>
    `<span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:3px;background:${coresLig[i]};display:inline-block;"></span>${nm}</span>`).join("");

  const seriesConteudo = [
    dias.map(k=>diaSum(k).sto||0),
    dias.map(k=>diaSum(k).ree||0),
    dias.map(k=>diaSum(k).feed||0),
    dias.map(k=>diaSum(k).ofe||0),
  ];
  const coresConteudo = ["#E10600","#C98A12","#7A4FE0","#0E7C86"];
  document.getElementById("chartTendenciaConteudo").innerHTML = lineChartSVG(labels, seriesConteudo, coresConteudo);
  const nomesConteudo = ["Stories","Reels","Postagem no Feed","Ofertas do Mês"];
  document.getElementById("legendTendenciaConteudo").innerHTML = nomesConteudo.map((nm,i)=>
    `<span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:3px;background:${coresConteudo[i]};display:inline-block;"></span>${nm}</span>`).join("");
}
function renderConversaoFunil(){
  const contatos = totalMes("nov")+totalMes("ret");
  const vis = totalMes("vis"), td = totalMes("td"), prop = totalMes("prop"), ven = vendasDoMesAtual().length;
  const labels = ["Contatos → Visitas","Visitas → Test Drive","Test Drive → Proposta","Proposta → Venda","Contatos → Venda (geral)"];
  const vals = [
    contatos>0 ? Math.round(vis/contatos*1000)/10 : 0,
    vis>0 ? Math.round(td/vis*1000)/10 : 0,
    td>0 ? Math.round(prop/td*1000)/10 : 0,
    prop>0 ? Math.round(ven/prop*1000)/10 : 0,
    contatos>0 ? Math.round(ven/contatos*1000)/10 : 0,
  ];
  document.getElementById("chartConversao").innerHTML = hBarChartSVG(labels, vals, {suffix:"%"});
}
function renderActivityCalendar(){
  const cfg = state.config;
  const dim = diasNoMes(cfg.mesRef);
  const [y,m] = cfg.mesRef.split("-").map(Number);
  const firstDow = new Date(y,m-1,1).getDay();
  const dows = ["D","S","T","Q","Q","S","S"];
  const vendasPorDia = {};
  vendasDoMesAtual().forEach(v=>{
    if (!vendasPorDia[v.data]) vendasPorDia[v.data] = [];
    vendasPorDia[v.data].push(v);
  });
  let maxScore = 1;
  const scores = {};
  for (let d=1; d<=dim; d++){
    const ds = y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    const s = diaSum(ds);
    const score = (s.lig||0)+(s.wpp||0)+(s.sto||0)+(s.ree||0)+(s.feed||0)+(s.ofe||0)+(s.nov||0)+(s.ret||0)+(s.vis||0)+(s.td||0)+(s.prop||0);
    scores[d] = score;
    if (score>maxScore) maxScore = score;
  }
  let html = dows.map(d=>`<div style="text-align:center;font-size:10px;font-weight:800;color:var(--text-mute);padding-bottom:4px;">${d}</div>`).join("");
  for (let i=0;i<firstDow;i++) html += `<div></div>`;
  for (let d=1; d<=dim; d++){
    const ds = y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    const vendasDoDia = vendasPorDia[ds] || [];
    const hasSale = vendasDoDia.length>0;
    const intensity = scores[d]/maxScore;
    const bg = scores[d]>0 ? `rgba(20,80,196,${(0.14+intensity*0.6).toFixed(2)})` : "var(--card-tint)";
    const resumoVendas = vendasDoDia.map(v=>`${v.cliente||"Cliente"} — ${v.carro||""} ${v.modelo||""}`.trim()).join(" | ");
    const rotuloCurto = vendasDoDia.length===1
      ? `${(vendasDoDia[0].modelo||vendasDoDia[0].carro||"").slice(0,9)}`
      : (vendasDoDia.length>1 ? `${vendasDoDia.length} vendas` : "");
    html += `<div class="${hasSale?'dia-com-venda':(scores[d]>0?'viz-glow':'')}" title="${hasSale?resumoVendas.replace(/"/g,'&quot;'):''}" style="aspect-ratio:1;border-radius:8px;border:1px solid var(--border);background:${hasSale?'':bg};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;font-size:11px;font-weight:700;color:${hasSale?'#fff':'var(--graphite-2)'};padding:2px;text-align:center;overflow:hidden;">
      <span>${d}</span>
      ${hasSale?`<span style="font-size:7.5px;font-weight:800;line-height:1.15;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${rotuloCurto}</span>`:''}
    </div>`;
  }
  document.getElementById("calBox").innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;">${html}</div>`;
}
function renderCharts(){
  const cfg = state.config;
  const funilLabels = ["1. Ligações","2. Conversas (WhatsApp)","3. Interessados (Novos)","4. Visitas","5. Test Drive","6. Proposta","7. Venda"];
  const funilVals = [totalMes("lig"),totalMes("wpp"),totalMes("nov"),totalMes("vis"),totalMes("td"),totalMes("prop"),vendasDoMesAtual().length];
  document.getElementById("chartFunil").innerHTML = hBarChartSVG(funilLabels, funilVals);

  const nDias = diasNoMes(cfg.mesRef);
  const contagemPorDia = new Array(nDias).fill(0);
  vendasDoMesAtual().forEach(v=>{
    const dia = Number(v.data.slice(8,10));
    if (dia>=1 && dia<=nDias) contagemPorDia[dia-1]++;
  });
  const labelsDias = Array.from({length:nDias},(_,i)=>String(i+1));
  document.getElementById("chartVendasDia").innerHTML = vBarChartSVG(labelsDias, contagemPorDia);

  const vMes = vendasDoMesAtual();
  const n0km = vMes.filter(v=>v.tipoLabel==="0KM").length;
  const nSemi = vMes.filter(v=>v.tipoLabel==="Seminovo").length;
  const nVD = vMes.filter(v=>v.tipoLabel==="VD").length;
  const nConsorcio = vMes.filter(v=>v.tipoLabel==="Consórcio").length;
  const nRepasse = vMes.filter(v=>v.tipoLabel==="Repasses").length;
  document.getElementById("chartTipo").innerHTML = donutChartSVG(
    ["Carro 0KM","Seminovo","Venda Direta (VD)","Consórcio","Repasses"], [n0km,nSemi,nVD,nConsorcio,nRepasse], ["#E10600","#48474F","#FFCE00","#833AB4","#1C8FC9"]
  );

  renderMetasProgress();
  renderTendencia();
  renderConversaoFunil();
  renderActivityCalendar();
  renderInstagram();
}
function renderMensagemDia(){
  const cfg = state.config;
  const hoje = new Date();
  const diaDoAno = Math.floor((hoje - new Date(hoje.getFullYear(),0,0)) / 86400000);
  const principios = [
    { texto:"Você fica mais forte com o fracasso do que com o sucesso.", autor:"Jordan Belfort" },
    { texto:"Se falta coragem para começar, você já terminou.", autor:"Joe Girard" },
    { texto:"Você pode mudar seu cérebro só de pensar diferente.", autor:"Dr. Joe Dispenza" },
    { texto:"Se você aprender a usar sua mente, qualquer coisa é possível.", autor:"Wim Hof" },
    { texto:"A chave para o sucesso é consistência, não intensidade.", autor:"Andrew Huberman" },
    { texto:"Esteja disposto a se redefinir todos os dias.", autor:"Deepak Chopra" },
    { texto:"Se você tem coragem pra começar, você tem coragem pra ter sucesso.", autor:"Mel Robbins" },
    { texto:"Nada é impossível, a menos que você pense que é.", autor:"Paramahansa Yogananda" },
    { texto:"Sem ação, as melhores intenções do mundo não passam de intenções.", autor:"Jordan Belfort" },
    { texto:"O elevador para o sucesso está quebrado. Use as escadas, um degrau de cada vez.", autor:"Joe Girard" },
    { texto:"Aprender é criar novas conexões. Cada coisa nova que você aprende muda fisicamente o seu cérebro.", autor:"Dr. Joe Dispenza" },
    { texto:"O limite não é o céu. O limite é a mente.", autor:"Wim Hof" },
    { texto:"Aquilo em que você foca, cresce.", autor:"Andrew Huberman" },
    { texto:"O sucesso vem quando as pessoas agem juntas; o fracasso costuma acontecer sozinho.", autor:"Deepak Chopra" },
    { texto:"Comece antes de estar pronto. Não se prepare, comece.", autor:"Mel Robbins" },
    { texto:"A época do fracasso é o melhor momento pra plantar as sementes do sucesso.", autor:"Paramahansa Yogananda" },
    { texto:"Jogar seguro e não correr riscos é um atalho para a pobreza.", autor:"Jordan Belfort" },
    { texto:"Vendedores são formados, não nascem prontos. Se eu consegui, você consegue.", autor:"Joe Girard" },
    { texto:"Mude sua mente, mude sua vida.", autor:"Dr. Joe Dispenza" },
    { texto:"O medo é só uma construção da mente.", autor:"Wim Hof" },
    { texto:"O desafio é a porta de entrada para a mudança do cérebro.", autor:"Andrew Huberman" },
    { texto:"Em meio ao movimento e ao caos, mantenha a quietude dentro de você.", autor:"Deepak Chopra" },
    { texto:"Você não controla o que sente. Mas sempre pode escolher como age.", autor:"Mel Robbins" },
    { texto:"Faça o seu melhor e depois relaxe.", autor:"Paramahansa Yogananda" },
    { texto:"A única coisa entre você e seu sonho é a vontade de tentar.", autor:"Jordan Belfort" },
    { texto:"A confiança é a base de todo relacionamento.", autor:"Joe Girard" },
    { texto:"O cérebro pensa, mas o coração sabe.", autor:"Dr. Joe Dispenza" },
    { texto:"O poder está dentro de todos nós. Qualquer coisa pode ser superada indo pra dentro de si.", autor:"Wim Hof" },
    { texto:"O medo é uma sensação. A coragem é uma decisão.", autor:"Andrew Huberman" },
    { texto:"Persiga a excelência, esqueça o sucesso — o sucesso vem como consequência.", autor:"Deepak Chopra" },
    { texto:"A confiança é uma habilidade, não um traço de personalidade.", autor:"Mel Robbins" },
    { texto:"Viva cada momento por completo, e o futuro vai cuidar de si mesmo.", autor:"Paramahansa Yogananda" },
    { texto:"Você não é o seu passado — é o que você aprende com ele.", autor:"Jordan Belfort" },
    { texto:"Comece fazendo o necessário; depois o possível; de repente você faz o impossível.", autor:"Joe Girard" },
    { texto:"Seus pensamentos são incrivelmente poderosos. Escolha-os com sabedoria.", autor:"Dr. Joe Dispenza" },
    { texto:"Não tente moldar a situação; molde a si mesmo.", autor:"Wim Hof" },
    { texto:"Aprenda a gerar motivação a partir do próprio esforço, não só da recompensa no final.", autor:"Andrew Huberman" },
    { texto:"Siga sempre suas paixões. Nunca pergunte se isso é realista.", autor:"Deepak Chopra" },
    { texto:"Você está a uma decisão de distância de uma vida completamente diferente.", autor:"Mel Robbins" },
    { texto:"Mantenha-se calmo, sereno, sempre no comando de si mesmo.", autor:"Paramahansa Yogananda" },
    { texto:"Olhe para trás só para aprender a olhar pra frente.", autor:"Joe Girard" },
    { texto:"Não dá pra criar um futuro novo vivendo preso ao seu passado.", autor:"Dr. Joe Dispenza" },
    { texto:"A mente sob controle é sua melhor amiga; a mente vagando é sua pior inimiga.", autor:"Wim Hof" },
    { texto:"Busque luz do sol antes da tela — todo dia, mesmo nublado.", autor:"Andrew Huberman" },
    { texto:"A gratidão abre a porta para o poder e a criatividade do universo.", autor:"Deepak Chopra" },
    { texto:"Você não precisa de mais confiança. Precisa de mais coragem.", autor:"Mel Robbins" },
    { texto:"Mude você mesmo e terá feito sua parte em mudar o mundo.", autor:"Paramahansa Yogananda" },
    { texto:"Cuide da sua saúde agora, antes que ela cuide de você.", autor:"Joe Girard" },
    { texto:"Mude sua energia, mude sua vida.", autor:"Dr. Joe Dispenza" },
    { texto:"Nós somos capazes de muito mais do que pensamos.", autor:"Wim Hof" },
    { texto:"A forma mais rápida de mudar sua vida é mudar seus hábitos.", autor:"Mel Robbins" },
    { texto:"Nesse poder de autocontrole está a semente da liberdade eterna.", autor:"Paramahansa Yogananda" },
    { texto:"Ouse sonhar grande, depois aja pra fazer acontecer.", autor:"Joe Girard" },
    { texto:"Seja gentil com os outros — assim você aprende o segredo de ser gentil com você mesmo.", autor:"Paramahansa Yogananda" },
    { texto:"Existe um ímã no seu coração que atrai amigos verdadeiros: pensar nos outros primeiro.", autor:"Paramahansa Yogananda" },
    { texto:"A gentileza é a luz que dissolve todas as paredes entre as pessoas.", autor:"Paramahansa Yogananda" },
    { texto:"Domine sua mente e ela será sua melhor amiga.", autor:"Paramahansa Yogananda" },
    { texto:"A verdadeira autoanálise é a maior arte do progresso.", autor:"Paramahansa Yogananda" },
  ];
  const principio = principios[diaDoAno % principios.length];

  const hojeISO = todayISO();
  const humorHoje = humorMedioDoDia(hojeISO);
  const vMesMsg = vendasDoMesAtual();
  const vendidosMsg = vMesMsg.filter(v=>v.tipoLabel!=="Consórcio").length;
  const metasMsg = metasDoVendedorAtual();
  const metaTotalMsg = (metasMsg.metaVendas||0) + (metasMsg.metaSeminovos||0) + (metasMsg.metaVD||0);
  const faltam = Math.max(metaTotalMsg-vendidosMsg,0);

  let observacao;
  if (humorHoje!=null && humorHoje>=2.34){
    observacao = `Você registrou um humor bom hoje (${humorParaEmoji(humorHoje)}) — esse é o tipo de dia pra fazer aquela ligação que você vem adiando.`;
  } else if (humorHoje!=null && humorHoje<1.67){
    observacao = `Notei que seu humor hoje está mais baixo (${humorParaEmoji(humorHoje)}). Tudo bem ter dias assim — o importante é não parar de agir só porque o ânimo caiu um pouco.`;
  } else if (faltam===0 && metaTotalMsg>0){
    observacao = `Você já bateu sua meta de ${metaTotalMsg} carros este mês. Esse é o momento de manter o ritmo, não de relaxar — quem sustenta o ritmo depois de bater a meta é quem cresce de verdade.`;
  } else if (faltam>0){
    observacao = `Faltam ${faltam} carro${faltam>1?"s":""} para você bater a meta do mês. Cada ligação de hoje conta pra isso.`;
  } else {
    observacao = "Comece o dia registrando sua primeira atividade — colocar o primeiro número no sistema já destrava o resto do dia.";
  }

  document.getElementById("mensagemDiaTexto").innerHTML = `${observacao}<br><span style="opacity:.8;font-size:12px;font-style:italic;">💬 "${principio.texto}" <span style="opacity:.7;font-style:normal;font-weight:700;">— ${principio.autor}</span></span>`;
}
function renderBannerPedidos(){
  // Lembrete operacional PESSOAL: mesmo o admin, que recebe (via RLS) as linhas de
  // todo mundo em state.clientes, só deve ver aqui os PRÓPRIOS pedidos — nunca os
  // de outro vendedor automaticamente. filtrarPorVendedor() é o mesmo filtro usado
  // em todo o resto do app (respeita o "ver todos" quando o admin liga por conta
  // própria, mas nunca aparece sozinho pra ele).
  const pedidos = filtrarPorVendedor(state.clientes||[]).filter(c=>c.veiculo && c.veiculo.trim()!=="");
  const btn = document.getElementById("btnVerPedidos");
  if (pedidos.length===0){ btn.style.display = "none"; return; }
  btn.style.display = "inline-block";
  document.getElementById("pedidosCount").textContent = pedidos.length;
  const nome = state.config.vendedor || "Vendedor";
  document.getElementById("pedidosModalTexto").textContent =
    `${nome}, na sua lista de pedidos de carros, você tem esses veículos aguardando. Olhe o estoque e verifique se entrou algo para oferecer ao cliente:`;
  document.getElementById("pedidosModalLista").innerHTML = pedidos.map(c=>
    `<li onclick="irParaPedidoCliente('${c.id}')" style="cursor:pointer;" title="Toque pra ver esse cliente na tela de Clientes">
      <b>${c.veiculo}</b> — ${c.nome||"cliente"}${c.cidade?(" · "+c.cidade):""}${c.tel?(" · 📱 "+c.tel):""} <span style="color:var(--orange-deep);font-weight:800;">→</span>
    </li>`
  ).join("");
  if (!pedidosModalMostradoNestaSessao){
    pedidosModalMostradoNestaSessao = true;
    abrirPedidosModal();
  }
}
function abrirPedidosModal(){
  document.getElementById("pedidosModalOverlay").classList.add("open");
}
function fecharPedidosModal(){
  document.getElementById("pedidosModalOverlay").classList.remove("open");
}
/* ============================= BOLHAS FÍSICAS (estilo crypto bubbles) ============================= */
const bolhaSistemas = {};
function criarClusterBolhas(containerId, itens){
  const box = document.getElementById(containerId);
  if (!box) return;
  const w = box.clientWidth || 400;
  const h = box.clientHeight || 270;
  let sistema = bolhaSistemas[containerId];
  if (!sistema){ sistema = { bolhas: [], box }; bolhaSistemas[containerId] = sistema; }

  itens.forEach((item, i)=>{
    let b = sistema.bolhas[i];
    const raio = item.raio || 62;
    if (!b){
      b = {
        x: Math.random()*Math.max(w-raio*2,10)+raio,
        y: Math.random()*Math.max(h-raio*2,10)+raio,
        vx: (Math.random()-0.5)*0.22,
        vy: (Math.random()-0.5)*0.22,
        r: raio,
        el: document.createElement("div"),
      };
      b.el.className = "bolha";
      box.appendChild(b.el);
      sistema.bolhas[i] = b;
    }
    b.r = raio;
    b.el.style.width = b.el.style.height = (raio*2)+"px";
    b.el.style.background = item.cor;
    b.el.title = item.titulo || "";
    b.el.onclick = item.onClick || null;
    const estiloValor = item.fonteMenor ? ` style="font-size:9.5px;line-height:1.25;"` : "";
    b.el.innerHTML = `<div class="bolha-label">${item.label}</div><div class="bolha-valor"${estiloValor}>${item.valor}</div>`;
  });
  while (sistema.bolhas.length > itens.length){
    const removida = sistema.bolhas.pop();
    removida.el.remove();
  }
}
let bolhasLoopAtivo = false;
function iniciarLoopBolhas(){
  if (bolhasLoopAtivo) return;
  bolhasLoopAtivo = true;
  function passo(){
    Object.values(bolhaSistemas).forEach(sistema=>{
      const w = sistema.box.clientWidth || 400;
      const h = sistema.box.clientHeight || 270;
      const bolhas = sistema.bolhas;
      bolhas.forEach(b=>{
        b.x += b.vx; b.y += b.vy;
        if (b.x - b.r < 0){ b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x + b.r > w){ b.x = w-b.r; b.vx = -Math.abs(b.vx); }
        if (b.y - b.r < 0){ b.y = b.r; b.vy = Math.abs(b.vy); }
        if (b.y + b.r > h){ b.y = h-b.r; b.vy = -Math.abs(b.vy); }
      });
      for (let i=0;i<bolhas.length;i++){
        for (let j=i+1;j<bolhas.length;j++){
          const a = bolhas[i], c = bolhas[j];
          const dx = c.x-a.x, dy = c.y-a.y;
          const dist = Math.sqrt(dx*dx+dy*dy) || 0.01;
          const minDist = a.r+c.r;
          if (dist < minDist){
            const overlap = (minDist-dist)/2;
            const nx = dx/dist, ny = dy/dist;
            a.x -= nx*overlap; a.y -= ny*overlap;
            c.x += nx*overlap; c.y += ny*overlap;
            const avn = a.vx*nx + a.vy*ny;
            const cvn = c.vx*nx + c.vy*ny;
            a.vx += (cvn-avn)*nx*0.5; a.vy += (cvn-avn)*ny*0.5;
            c.vx += (avn-cvn)*nx*0.5; c.vy += (avn-cvn)*ny*0.5;
          }
        }
      }
      bolhas.forEach(b=>{ b.el.style.transform = `translate(${b.x-b.r}px, ${b.y-b.r}px)`; });
    });
    requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

function renderDashboard(){
  renderBannerPedidos();
  renderMensagemDia();
  const cfg = {...state.config, ...metasDoVendedorAtual()};

  {
    const feriadosMes = feriadosDoMes(cfg.mesRef);
    const wrap = document.getElementById("feriadosPanelWrap");
    if (feriadosMes.length===0){
      wrap.style.display = "none";
    } else {
      wrap.style.display = "block";
      document.getElementById("feriadosLista").innerHTML = feriadosMes.map(f=>
        `<li><b>${fmtDate(f.data)}</b> (${f.diaSemana}) — ${f.nome} <span style="color:var(--text-mute);font-size:11px;">[${f.tipo}]</span></li>`
      ).join("");
    }
  }
  const vMes = vendasDoMesAtual();
  const comissaoTotal = vMes.reduce((s,v)=>s+(Number(v.comissao)||0),0);
  const emplacamentoTotal = vMes.reduce((s,v)=>s+(Number(v.emplacamentoValor)||0),0);
  const retornoBancoTotal = vMes.reduce((s,v)=>s+(Number(v.retornoBanco)||0),0);
  const hoje = new Date();
  const [y,m] = cfg.mesRef.split("-").map(Number);
  const ultimoDia = new Date(y, m, 0);
  let diasRestantes = diasUteisRestantesNoMes(cfg.mesRef);

  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  sincronizarSeletorMesAno(y, m);

  const emplacQtd = vMes.filter(v=>v.emplacamento).length;
  const vendidos0km = vMes.filter(v=>v.tipoLabel==="0KM").length;
  const valor0km = vMes.filter(v=>v.tipoLabel==="0KM").reduce((s,v)=>s+(Number(v.valor)||0),0);
  const vendidosSemi = vMes.filter(v=>v.tipoLabel==="Seminovo").length;
  const valorSemi = vMes.filter(v=>v.tipoLabel==="Seminovo").reduce((s,v)=>s+(Number(v.valor)||0),0);
  const vendidosVD = vMes.filter(v=>v.tipoLabel==="VD").length;
  const valorVD = vMes.filter(v=>v.tipoLabel==="VD").reduce((s,v)=>s+(Number(v.valor)||0),0);
  const vendidosConsorcio = vMes.filter(v=>v.tipoLabel==="Consórcio").length;
  const valorConsorcio = vMes.filter(v=>v.tipoLabel==="Consórcio").reduce((s,v)=>s+(Number(v.valor)||0),0);
  const vendidosRepasse = vMes.filter(v=>v.tipoLabel==="Repasses").length;
  const valorRepasse = vMes.filter(v=>v.tipoLabel==="Repasses").reduce((s,v)=>s+(Number(v.valor)||0),0);
  const valoresNegocios = valor0km + valorSemi + valorConsorcio + valorVD + valorRepasse; // valor dos produtos/negócios (emplacamento NÃO entra aqui)
  const qtdNegocios = vendidos0km + vendidosSemi + vendidosConsorcio + vendidosVD + vendidosRepasse; // usado no card de comissão (inclui consórcio e repasses)
  const acessoriosTotal = vMes.reduce((s,v)=>s+(Number(v.acessoriosValor)||0),0);
  const seguroTotal = vMes.reduce((s,v)=>s+(Number(v.seguroValor)||0),0);
  const comissaoFinal = comissaoTotal + emplacamentoTotal + retornoBancoTotal + acessoriosTotal + seguroTotal;

  {
    const vendasFinanciadas = vMes.filter(v=>v.pontuacao>0);
    const vendasSemFinanc = vMes.length - vendasFinanciadas.length;
    const pctFinanciado = vMes.length ? (vendasFinanciadas.length/vMes.length*100) : 0;
    const pontuacaoMediaF = vendasFinanciadas.length ? vendasFinanciadas.reduce((s,v)=>s+Number(v.pontuacao),0)/vendasFinanciadas.length : 0;
    const maiorPontuacao = vendasFinanciadas.length ? Math.max(...vendasFinanciadas.map(v=>Number(v.pontuacao))) : 0;
    const retornoMedioPorCarro = vendasFinanciadas.length ? retornoBancoTotal/vendasFinanciadas.length : 0;

    document.getElementById("financDonutBox").innerHTML = donutChartSVG(
      ["Financiado","Sem financiamento"], [vendasFinanciadas.length, vendasSemFinanc], ["#1C8FC9","#E1E3E8"], {size:170}
    );
    document.getElementById("financDonutLegenda").innerHTML = `
      <span><i style="background:#1C8FC9;"></i> Financiado (${vendasFinanciadas.length})</span>
      <span><i style="background:#E1E3E8;"></i> Sem financ. (${vendasSemFinanc})</span>`;

    document.getElementById("financKpisBox").innerHTML = `
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">🚗</span>
        <div class="financ-kpi-label">Carros com Financiamento</div>
        <div class="financ-kpi-value">${vendasFinanciadas.length} de ${vMes.length}</div>
        <div class="financ-kpi-sub">${pctFinanciado.toFixed(0)}% das vendas do mês foram financiadas</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">📊</span>
        <div class="financ-kpi-label">Pontuação Média</div>
        <div class="financ-kpi-value">${pontuacaoMediaF.toFixed(2)}</div>
        <div class="financ-kpi-sub">Maior pontuação do mês: ${maiorPontuacao.toFixed(2)}</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">🏦</span>
        <div class="financ-kpi-label">Retorno do Banco VW</div>
        <div class="financ-kpi-value">${moneyFmt(retornoBancoTotal)}</div>
        <div class="financ-kpi-sub">já somado à sua comissão total do mês</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">💵</span>
        <div class="financ-kpi-label">Retorno Médio por Carro</div>
        <div class="financ-kpi-value">${moneyFmt(retornoMedioPorCarro)}</div>
        <div class="financ-kpi-sub">média entre os carros financiados</div>
      </div>`;

    const vendasFinanciadasOrdenadas = [...vendasFinanciadas].sort((a,b)=>Number(b.pontuacao)-Number(a.pontuacao));
    document.getElementById("financListaBox").innerHTML = vendasFinanciadasOrdenadas.length ? vendasFinanciadasOrdenadas.map(v=>`
      <div class="financ-item">
        <div class="financ-item-pontos">${Number(v.pontuacao).toFixed(2)}</div>
        <div class="financ-item-info">
          <div class="financ-item-nome">${v.cliente||"—"} · ${v.modelo||v.carro||""}${v.versao?" "+v.versao:""}</div>
          <div class="financ-item-sub">${fmtDate(v.data)} · ${tipoDisplay(v)}</div>
        </div>
        <div class="financ-item-retorno">${v.retornoBanco?moneyFmt(v.retornoBanco):"—"}</div>
      </div>`).join("") : `<div class="empty">Nenhuma venda financiada registrada este mês ainda.</div>`;
  }

  {
    const vendasOrdenadas = [...vMes].sort((a,b)=>(Number(b.comissao)||0)-(Number(a.comissao)||0));
    document.getElementById("corridaVendasBox").innerHTML = vendasOrdenadas.length
      ? corridaVendasSVG(vendasOrdenadas)
      : `<div class="empty">Nenhuma venda registrada este mês ainda. Assim que você lançar uma venda, o carrinho entra na pista! 🏁</div>`;
  }

  // Total de Carros / velocímetro Geral: consórcio NÃO entra aqui (só conta no card de negócios/comissão acima)
  const qtdCarros = vendidos0km + vendidosSemi + vendidosVD;
  const metaTotalGeral = (cfg.metaVendas||0) + (cfg.metaSeminovos||0) + (cfg.metaVD||0);
  const metaDiariaNec = diasRestantes>0 ? Math.max(metaTotalGeral-qtdCarros,0)/diasRestantes : 0;
  const faltamParaMeta = Math.max(metaTotalGeral - qtdCarros, 0);

  const cardsTop = [
    ["🎯 Total de Carros (Meta do Mês)", `${qtdCarros} de ${metaTotalGeral} <span style="font-size:12px;font-weight:700;color:${faltamParaMeta===0?'var(--green)':'var(--text-dim)'};display:block;margin-top:4px;">${faltamParaMeta===0?'🎉 Meta batida!':`Falta${faltamParaMeta===1?'':'m'} apenas ${faltamParaMeta} carro${faltamParaMeta===1?'':'s'} para bater sua meta`}</span>`],
    ["📅 Dias Úteis Restantes", `${diasRestantes} dia${diasRestantes===1?"":"s"}`],
    ["🔥 Meta Diária Necessária", `${metaDiariaNec.toFixed(2)} carros/dia`],
  ];
  document.getElementById("dashCardsTop").innerHTML = cardsTop.map(([l,v])=>
    `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");

  const cardsBottom = [
    ["🚗 Carros Vendidos (Zero KM)", `${vendidos0km} · ${moneyFmt(valor0km)}`],
    ["🚘 Carros Seminovos", `${vendidosSemi} · ${moneyFmt(valorSemi)}`],
    ["🤝 Venda Direta (VD)", `${vendidosVD} · ${moneyFmt(valorVD)}`],
    ["🪙 Consórcios do Mês", `${vendidosConsorcio} · ${moneyFmt(valorConsorcio)}`],
    ["🔁 Repasses do Mês", `${vendidosRepasse} · ${moneyFmt(valorRepasse)}`],
    ["🏦 Retorno do Banco VW", `${moneyFmt(retornoBancoTotal)}`],
  ];
  const emplacVendasMes = vMes.filter(v=>v.emplacamento);
  const acessoriosVendasMes = vMes.filter(v=>(Number(v.acessoriosValor)||0)>0);
  const seguroVendasMes = vMes.filter(v=>(Number(v.seguroValor)||0)>0);
  const pendenciaTotalGeral = emplacamentoTotal + acessoriosVendasMes.reduce((s,v)=>s+(Number(v.acessoriosValor)||0),0) + seguroVendasMes.reduce((s,v)=>s+(Number(v.seguroValor)||0),0);
  const pendenciaTotalPago = emplacVendasMes.filter(v=>v.emplacamentoPago).reduce((s,v)=>s+(Number(v.emplacamentoValor)||0),0)
    + acessoriosVendasMes.filter(v=>v.acessoriosPago).reduce((s,v)=>s+(Number(v.acessoriosValor)||0),0)
    + seguroVendasMes.filter(v=>v.seguroPago).reduce((s,v)=>s+(Number(v.seguroValor)||0),0);
  const pendenciaTotalAPagar = pendenciaTotalGeral - pendenciaTotalPago;
  document.getElementById("dashCardsBottom").innerHTML = cardsBottom.map(([l,v])=>
    `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("") + `
    <div class="card card-clicavel" onclick="abrirEmplacamentosModal()" style="cursor:pointer;">
      <div class="label">🧾 Emplac. + Acessórios + Seguro <span style="font-weight:600;opacity:.7;">— toque para ver</span></div>
      <div class="value" style="font-size:13px;line-height:1.5;">
        Total: ${moneyFmt(pendenciaTotalGeral)}<br>
        <span style="color:var(--red);font-size:12px;">A Pagar: ${moneyFmt(pendenciaTotalAPagar)}</span><br>
        <span style="color:var(--green);font-size:12px;">Pago: ${moneyFmt(pendenciaTotalPago)}</span>
      </div>
    </div>`;

  {
    document.getElementById("qtdNegociosValor").textContent = qtdNegocios;
    const elValor = document.getElementById("comissaoFinalValor");
    elValor.dataset.real = moneyFmt(comissaoFinal);
    document.getElementById("valorNegociosMesValor").dataset.real = moneyFmt(valoresNegocios);
    atualizarVisualComissao();
  }

  function faceParaPct(p){ return p<0.33 ? "😢" : p<0.66 ? "😐" : "😄"; }
  function polar(cx,cy,r,angDeg){
    const rad = angDeg*Math.PI/180;
    return {x:cx+r*Math.cos(rad), y:cy-r*Math.sin(rad)};
  }
  function gaugeSVG(pct, gaugeId){
    const cx=100, cy=100, r=78, sw=16;
    const p1=polar(cx,cy,r,180), p2=polar(cx,cy,r,0);
    const needleAngle = 180-Math.min(Math.max(pct,0),1)*180;
    const cssRotFinal = 90-needleAngle;
    const gradId = `fireGrad-${gaugeId}`;
    return `<svg viewBox="0 0 200 118" width="100%" style="max-width:220px;">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" class="fire-stop-a"/>
          <stop offset="35%" class="fire-stop-b"/>
          <stop offset="65%" class="fire-stop-c"/>
          <stop offset="100%" class="fire-stop-d"/>
        </linearGradient>
      </defs>
      <path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${r} ${r} 0 0 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}"
        stroke="url(#${gradId})" stroke-width="${sw}" fill="none" stroke-linecap="round" class="gauge-fire-arc"/>
      <g class="gauge-needle-group" data-final="${cssRotFinal}" style="transform-origin:${cx}px ${cy}px; transform:rotate(-90deg);">
        <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy-(r-24)}" stroke="var(--graphite)" stroke-width="4" stroke-linecap="round"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="7" fill="var(--graphite)"/>
      <text x="${cx}" y="${cy-32}" text-anchor="middle" font-size="20" font-weight="800" fill="var(--graphite)">${Math.round(pct*100)}%</text>
    </svg>`;
  }
  function animarAgulhas(container){
    container.querySelectorAll(".gauge-needle-group").forEach(g=>{
      requestAnimationFrame(()=> requestAnimationFrame(()=>{
        g.style.transform = `rotate(${g.dataset.final}deg)`;
      }));
    });
  }

  const pctGeral = metaTotalGeral>0 ? Math.min(qtdCarros/metaTotalGeral,1) : 0;
  document.getElementById("gaugeGeral").innerHTML = gaugeSVG(pctGeral, "geral");
  document.getElementById("progLabelGeral").textContent = `${faceParaPct(pctGeral)} ${qtdCarros} de ${metaTotalGeral} carros (${(pctGeral*100).toFixed(0)}%)`;

  const pct = cfg.metaVendas>0 ? Math.min(vendidos0km/cfg.metaVendas,1) : 0;
  document.getElementById("gaugeVendas").innerHTML = gaugeSVG(pct, "vendas");
  document.getElementById("progLabel").textContent = `${faceParaPct(pct)} ${vendidos0km} de ${cfg.metaVendas} carros (${(pct*100).toFixed(0)}%)`;

  const pctSemi = cfg.metaSeminovos>0 ? Math.min(vendidosSemi/cfg.metaSeminovos,1) : 0;
  document.getElementById("gaugeSemi").innerHTML = gaugeSVG(pctSemi, "semi");
  document.getElementById("progLabelSemi").textContent = `${faceParaPct(pctSemi)} ${vendidosSemi} de ${cfg.metaSeminovos||0} (${(pctSemi*100).toFixed(0)}%)`;

  const pctConsorcio = cfg.metaConsorcios>0 ? Math.min(vendidosConsorcio/cfg.metaConsorcios,1) : 0;
  document.getElementById("gaugeConsorcio").innerHTML = gaugeSVG(pctConsorcio, "consorcio");
  document.getElementById("progLabelConsorcio").textContent = `${faceParaPct(pctConsorcio)} ${vendidosConsorcio} de ${cfg.metaConsorcios||0} (${(pctConsorcio*100).toFixed(0)}%)`;

  const pctVD = cfg.metaVD>0 ? Math.min(vendidosVD/cfg.metaVD,1) : 0;
  document.getElementById("gaugeVD").innerHTML = gaugeSVG(pctVD, "vd");
  document.getElementById("progLabelVD").textContent = `${faceParaPct(pctVD)} ${vendidosVD} de ${cfg.metaVD||0} (${(pctVD*100).toFixed(0)}%)`;

  const pctRepasse = cfg.metaRepasses>0 ? Math.min(vendidosRepasse/cfg.metaRepasses,1) : 0;
  document.getElementById("gaugeRepasse").innerHTML = gaugeSVG(pctRepasse, "repasse");
  document.getElementById("progLabelRepasse").textContent = `${faceParaPct(pctRepasse)} ${vendidosRepasse} de ${cfg.metaRepasses||0} (${(pctRepasse*100).toFixed(0)}%)`;

  animarAgulhas(document.querySelector(".gauges-row"));

  const dias = diasDoMesAtual();

  /* ===================== META DE SALÁRIO (SOMENTE 0KM + SEMINOVO + VD + REPASSES) ===================== */
  {
    const vElegiveis = vMes.filter(v=> v.tipoLabel==="0KM" || v.tipoLabel==="Seminovo" || v.tipoLabel==="VD" || v.tipoLabel==="Repasses");
    const comissaoGanha = vElegiveis.reduce((s,v)=>s+(Number(v.comissao)||0)+(Number(v.retornoBanco)||0),0);
    const valorVendido = vElegiveis.reduce((s,v)=>s+(Number(v.valor)||0),0);
    const metaSalario = cfg.metaSalario || 0;
    const faltaComissao = Math.max(metaSalario-comissaoGanha, 0);
    const taxaMediaPadrao = ((0.5+0.7+(Number(cfg.taxaVD)||0)+0.3)/4)/100;
    const taxaMedia = valorVendido>0 ? (comissaoGanha/valorVendido) : taxaMediaPadrao;
    const valorNecessario = taxaMedia>0 ? faltaComissao/taxaMedia : 0;
    const pctMetaSalario = metaSalario>0 ? Math.min(comissaoGanha/metaSalario,1) : 0;
    const ritmoDiario = diasRestantes>0 ? faltaComissao/diasRestantes : faltaComissao;

    const metaSalarioInput = document.getElementById("metaSalarioInput");
    if (document.activeElement !== metaSalarioInput) metaSalarioInput.value = metaSalario || "";
    document.getElementById("gaugeSalario").innerHTML = gaugeSVG(pctMetaSalario, "salario");
    document.getElementById("labelSalario").textContent = `${faceParaPct(pctMetaSalario)} ${moneyFmt(comissaoGanha)} de ${moneyFmt(metaSalario)} (${(pctMetaSalario*100).toFixed(0)}%)`;
    animarAgulhas(document.getElementById("gaugeSalario").parentElement);

    document.getElementById("statsSalarioCards").innerHTML = [
      ["💰 Comissão Ganha (0KM+Semi+VD+Repasses+Retorno Banco)", moneyFmt(comissaoGanha)],
      ["📉 Falta para a Meta", moneyFmt(faltaComissao)],
      ["🚗 Valor em Vendas Necessário", moneyFmt(valorNecessario)],
      ["📅 Ritmo Diário Necessário", moneyFmt(ritmoDiario)+"/dia"],
      ["📐 Taxa Média Efetiva Usada", `${(taxaMedia*100).toFixed(2)}%${valorVendido>0?" (real deste mês)":" (estimativa: 0KM 0,5% · Semi 0,7% · VD "+((Number(cfg.taxaVD)||0)).toFixed(2)+"% · Repasses 0,3%)"}`],
    ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:18px;">${v}</div></div>`).join("");

    // Impacto das atividades nos dias com venda elegível
    const datasComVenda = new Set(vElegiveis.map(v=>v.data));
    const atividadesVenda = [
      {label:"Ligações", get:d=>d.lig||0},
      {label:"WhatsApp", get:d=>d.wpp||0},
      {label:"Rede Social (Stories+Reels+Feed)", get:d=>(d.sto||0)+(d.ree||0)+(d.feed||0)},
      {label:"Ofertas do Mês", get:d=>d.ofe||0},
    ];
    const impactoVendas = atividadesVenda.map(a=>{
      const com=[], sem=[];
      dias.forEach(k=>{
        const d = diaSum(k);
        const val = a.get(d);
        if (datasComVenda.has(k)) com.push(val); else sem.push(val);
      });
      const mediaCom = com.length ? com.reduce((x,y)=>x+y,0)/com.length : 0;
      const mediaSem = sem.length ? sem.reduce((x,y)=>x+y,0)/sem.length : 0;
      return {label:a.label, diferenca: Math.round((mediaCom-mediaSem)*10)/10};
    });
    document.getElementById("chartImpactoVendas").innerHTML = instaImpactoChartSVG(impactoVendas);

    const insights = [];
    if (faltaComissao>0){
      insights.push(`Você precisa de mais <b>${moneyFmt(valorNecessario)}</b> em carros vendidos (0KM, Seminovo ou VD) para bater os ${moneyFmt(metaSalario)} de salário.`);
      insights.push(`Você precisa de mais <b>${moneyFmt(faltaComissao)}</b> em comissões para atingir o salário${diasRestantes>0?` — algo como ${moneyFmt(ritmoDiario)} por dia até o fim do mês`:""}.`);
    } else if (metaSalario>0){
      insights.push(`🎉 Meta de salário batida! Você já garantiu ${moneyFmt(comissaoGanha)} em comissões de 0KM, Seminovo e VD esse mês.`);
    } else {
      insights.push("Defina uma meta de salário ao lado para começar a acompanhar.");
    }
    const melhorAtividadeVenda = impactoVendas.slice().sort((a,b)=>b.diferenca-a.diferenca)[0];
    if (datasComVenda.size>0 && melhorAtividadeVenda && melhorAtividadeVenda.diferenca>0){
      insights.push(`Nos dias em que você fechou negócio, a atividade mais presente foi <b>${melhorAtividadeVenda.label}</b> (em média +${melhorAtividadeVenda.diferenca.toFixed(1)} a mais que nos dias sem venda) — vale reforçar essa frente.`);
    }
    insights.push(`Dica do mercado de carro 0KM: contato por telefone dentro das primeiras 24h de um lead costuma converter mais do que só mensagem de texto; vídeos curtos (Reels) mostrando o carro por dentro/por fora geram mais alcance que fotos paradas; e follow-up ativo por WhatsApp — sem esperar o cliente responder — é um dos maiores diferenciais para fechar venda de carro 0KM.`);
    document.getElementById("salarioInsightsList").innerHTML = insights.map(t=>`<li>${t}</li>`).join("");
  }

  /* ===================== CENTRAL DE LIGAÇÕES ===================== */
  {
    const totalLigMes = totalMes("lig");
    const totalAtendCom = totalMes("ligAtendCom");
    const totalAtendSem = totalMes("ligAtendSem");
    const totalAtend = totalAtendCom + totalAtendSem;
    const totalNao = totalMes("ligNao");
    const totalInvalido = totalMes("ligInvalido");
    const baseAtend = totalAtend+totalNao;
    const pctAtend = baseAtend>0 ? totalAtend/baseAtend : 0;

    document.getElementById("statsLigacoesCards").innerHTML = [
      ["📞 Total de Ligações", totalLigMes],
      ["🙂 Atendidas Com Interesse", totalAtendCom],
      ["😐 Atendidas Sem Interesse", totalAtendSem],
      ["🚫 Ligações Não Atendidas", totalNao],
      ["☎️ Telefones Inválidos", totalInvalido],
      ["📊 % de Atendimento", baseAtend>0 ? (pctAtend*100).toFixed(0)+"%" : "—"],
    ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:18px;">${v}</div></div>`).join("");

    document.getElementById("chartLigacoesPizza").innerHTML = pizza3DSVG(
      ["Com Interesse","Sem Interesse","Não Atendidas","Inválidos"],
      [totalAtendCom, totalAtendSem, totalNao, totalInvalido],
      ["#1FA463","#F7C600","#E23B4E","#8B8B8B"]
    );
    document.getElementById("gaugeAtendimento").innerHTML = gaugeSVG(pctAtend, "atendimento");
    document.getElementById("labelAtendimento").textContent = `${faceParaPct(pctAtend)} ${(pctAtend*100).toFixed(0)}%`;
    animarAgulhas(document.getElementById("gaugeAtendimento").parentElement);
  }

  /* ===================== HUMOR x DESEMPENHO ===================== */
  {
    const humorAtual = humorDoVendedorAtual();
    const diasComHumor = dias.filter(k=> (humorAtual[k]||[]).length>0);
    const mediasDoMes = diasComHumor.map(k=>humorMedioDoDia(k));
    const mediaGeral = mediasDoMes.length ? mediasDoMes.reduce((a,b)=>a+b,0)/mediasDoMes.length : null;
    const totalRegistrosHumor = diasComHumor.reduce((s,k)=>s+(humorAtual[k]||[]).length,0);

    document.getElementById("statsHumorCards").innerHTML = [
      ["😊 Humor Médio do Mês", mediaGeral!=null ? `${humorParaEmoji(mediaGeral)} ${mediaGeral.toFixed(1)}` : "—"],
      ["📅 Dias com Humor Registrado", diasComHumor.length],
      ["📝 Total de Registros", totalRegistrosHumor],
      ["📞 Ligações do Mês", totalMes("lig")],
      ["🚗 Vendas do Mês (0KM+Semi+VD)", vMes.filter(v=>["0KM","Seminovo","VD"].includes(v.tipoLabel)).length],
    ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    // agrupa dias por faixa de humor e calcula médias de ligações e vendas naquele dia
    const datasVendaEl = new Set(vMes.filter(v=>["0KM","Seminovo","VD"].includes(v.tipoLabel)).map(v=>v.data));
    const faixas = [
      {label:"😢 Triste", min:0, max:1.67},
      {label:"😐 Indiferente", min:1.67, max:2.34},
      {label:"😊 Feliz", min:2.34, max:99},
    ];
    const linhasHumor = faixas.map(f=>{
      const diasFaixa = diasComHumor.filter(k=>{ const m2=humorMedioDoDia(k); return m2>=f.min && m2<f.max; });
      const mediaLig = diasFaixa.length ? diasFaixa.reduce((s,k)=>s+(diaSum(k).lig||0),0)/diasFaixa.length : 0;
      const mediaVen = diasFaixa.length ? diasFaixa.reduce((s,k)=> s+(datasVendaEl.has(k)?1:0),0)/diasFaixa.length : 0;
      return {label:f.label, dias:diasFaixa.length, mediaLig, mediaVen};
    });
    document.querySelector("#tblHumorDesempenho tbody").innerHTML = diasComHumor.length
      ? linhasHumor.map(r=>`<tr><td>${r.label}</td><td>${r.dias}</td><td>${r.mediaLig.toFixed(1)}</td><td>${r.mediaVen.toFixed(2)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">Registre seu humor ao longo do mês para ver essa comparação.</td></tr>`;

    const humorInsights = [];
    if (diasComHumor.length===0){
      humorInsights.push("Toque nos emojis no Controle Diário para começar a registrar seu humor — quanto mais registros, mais precisa fica essa análise.");
    } else {
      const feliz = linhasHumor[2], triste = linhasHumor[0];
      if (feliz.dias>0 && triste.dias>0){
        if (feliz.mediaVen > triste.mediaVen){
          humorInsights.push(`Nos dias em que você registrou humor <b>feliz</b>, a média de vendas foi maior (${feliz.mediaVen.toFixed(2)} vs ${triste.mediaVen.toFixed(2)} nos dias tristes) — seu estado de espírito parece influenciar o resultado.`);
        } else if (triste.mediaVen > feliz.mediaVen){
          humorInsights.push(`Curiosamente, os dias com humor <b>triste</b> tiveram mais vendas em média — talvez a pressão do momento ajude a fechar negócio, mas cuidado para isso não virar um padrão de desgaste.`);
        }
      }
      const melhorFaixaLig = linhasHumor.filter(r=>r.dias>0).sort((a,b)=>b.mediaLig-a.mediaLig)[0];
      if (melhorFaixaLig){
        humorInsights.push(`Você faz mais ligações em dias de humor <b>${melhorFaixaLig.label.replace(/^[^ ]+ /,"")}</b> (média de ${melhorFaixaLig.mediaLig.toFixed(1)} ligações).`);
      }
    }
    document.getElementById("humorInsightsList").innerHTML = humorInsights.map(t=>`<li>${t}</li>`).join("");
  }

  const decorridos = diasUteisDecorridosNoMes(cfg.mesRef);
  const totalDiasUteisMes = diasUteisNoMes(cfg.mesRef);
  const projecao = decorridos>0 ? (qtdNegocios/decorridos)*totalDiasUteisMes : 0;
  document.getElementById("projectionBox").textContent =
    qtdNegocios>0 || dias.length>0
      ? `📈 Se você continuar nesse ritmo, deve fechar aproximadamente ${projecao.toFixed(1)} carros neste mês.`
      : "📈 Cadastre os dados do dia para ver a projeção.";

  const t = todayISO();
  const hojeData = diaSum(t);
  const rows = [
    ["Ligações", hojeData.lig||0, cfg.metaLig],
    ["WhatsApp", hojeData.wpp||0, cfg.metaWpp],
    ["Stories", hojeData.sto||0, cfg.metaStories],
    ["Reels", hojeData.ree||0, cfg.metaReels],
    ["Postagem no Feed", hojeData.feed||0, cfg.metaFeed],
    ["Ofertas do Mês", hojeData.ofe||0, cfg.metaOfertas],
  ];
  document.querySelector("#todayTable tbody").innerHTML = rows.map(([l,v,meta])=>{
    const pctv = meta>0 ? v/meta : 0;
    const cls = pctv>=1 ? "green" : pctv>=0.7 ? "yellow" : "red";
    return `<tr><td class="left">${l}</td><td>${v}</td><td>${meta}</td><td><span class="tag ${cls}">${(pctv*100).toFixed(0)}%</span></td></tr>`;
  }).join("");

  // ranking rápido
  let streak = 0;
  for (let i=dias.length-1;i>=0;i--){
    const d = diaSum(dias[i]);
    const bateu = (d.lig||0)>=cfg.metaLig && (d.wpp||0)>=cfg.metaWpp && (d.sto||0)>=cfg.metaStories && (d.ree||0)>=cfg.metaReels;
    if (bateu) streak++; else break;
  }
  const totalLig = totalMes("lig"), totalWpp = totalMes("wpp");
  const totalSto = totalMes("sto"), totalRee = totalMes("ree"), totalFeed = totalMes("feed"), totalOfe = totalMes("ofe");
  const totalProp = totalMes("prop"), totalAvaliados = totalMes("avaliados");
  const taxaConv = totalLig>0 ? (qtdNegocios/totalLig*100).toFixed(1)+"%" : "— (sem ligações no mês)";
  const taxaFechamento = totalProp>0 ? (qtdNegocios/totalProp*100).toFixed(1)+"%" : "— (sem propostas no mês)";
  const taxaAvaliadoVenda = totalAvaliados>0 ? (qtdNegocios/totalAvaliados*100).toFixed(1)+"%" : "— (sem avaliações no mês)";
  document.getElementById("rankCards").innerHTML = [
    ["🔥 Sequência batendo metas", `${streak} dias`],
    ["📞 Total de Ligações", totalLig],
    ["💬 Total de WhatsApp", totalWpp],
    ["📚 Total de Stories", totalSto],
    ["🎬 Total de Reels", totalRee],
    ["📸 Postagens no Feed", totalFeed],
    ["🏷️ Ofertas do Mês", totalOfe],
    ["🚘 Carros Avaliados", totalAvaliados],
    ["🎯 Taxa de Conversão Geral", `${taxaConv}`],
    ["🤝 Taxa de Fechamento (Vendas/Propostas)", `${taxaFechamento}`],
    ["📋 Conversão Avaliação → Venda", `${taxaAvaliadoVenda}`],
  ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:20px">${v}</div></div>`).join("");
}

/* ============================= RENDER: CONTROLE DIÁRIO ============================= */
let expandedDays = new Set();
function toggleDiaExpand(k){
  if (expandedDays.has(k)) expandedDays.delete(k); else expandedDays.add(k);
  renderControle();
}
/* ============================= HUMOR DO DIA ============================= */
const HUMOR_EMOJI = {1:"😢", 2:"😐", 3:"😊"};
const HUMOR_LABEL = {1:"Triste", 2:"Indiferente", 3:"Feliz"};
function registrarHumor(valor){
  const hoje = todayISO();
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (!id) return;
  const humor = humorDoVendedor(id);
  if (!humor[hoje]) humor[hoje] = [];
  humor[hoje].push({valor, ts: Date.now()});
  persist();
  renderHumorHoje();
  renderDashboard();
}
function humorMedioDoDia(k){
  const lista = humorDoVendedorAtual()[k] || [];
  if (lista.length===0) return null;
  return lista.reduce((s,h)=>s+h.valor,0)/lista.length;
}
function humorParaEmoji(media){
  if (media==null) return "—";
  if (media < 1.67) return HUMOR_EMOJI[1];
  if (media < 2.34) return HUMOR_EMOJI[2];
  return HUMOR_EMOJI[3];
}
function renderHumorHoje(){
  const el = document.getElementById("humorResumoHoje");
  if (!el) return;
  const hoje = todayISO();
  const lista = humorDoVendedorAtual()[hoje] || [];
  if (lista.length===0){
    el.innerHTML = `<span>Nenhum humor registrado hoje ainda. Toque num emoji sempre que quiser marcar como está se sentindo.</span>`;
    return;
  }
  const media = humorMedioDoDia(hoje);
  const qtd = {1:0,2:0,3:0};
  lista.forEach(h=> qtd[h.valor]++);
  el.innerHTML = `
    <span>😢 <b>${qtd[1]}</b></span>
    <span>😐 <b>${qtd[2]}</b></span>
    <span>😊 <b>${qtd[3]}</b></span>
    <span>Média de hoje: <b>${humorParaEmoji(media)} ${media.toFixed(1)}</b> (${lista.length} registro${lista.length>1?"s":""})</span>
  `;
}
function renderControle(){
  const cfg = {...state.config, ...metasDoVendedorAtual()};
  const dias = diasDoMesAtual();
  const tbody = document.querySelector("#controleTable tbody");
  if (dias.length===0){
    tbody.innerHTML = `<tr><td colspan="21" class="empty">Nenhum lançamento este mês ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = dias.map(k=>{
    const d = diaSum(k);
    const qtd = (diasDoVendedorAtual()[k]||[]).length;
    const bateu = (d.lig||0)>=cfg.metaLig && (d.wpp||0)>=cfg.metaWpp && (d.sto||0)>=cfg.metaStories && (d.ree||0)>=cfg.metaReels && (d.feed||0)>=(cfg.metaFeed||0) && (d.ofe||0)>=(cfg.metaOfertas||0);
    const aberto = expandedDays.has(k);
    let linha = `<tr>
      <td>${fmtDate(k)}</td><td>${diaSemana(k)}</td>
      <td>${d.lig||0}</td><td>${d.ligInvalido||0}</td><td>${d.ligNao||0}</td><td>${d.ligAtendCom||0}</td><td>${d.ligAtendSem||0}</td>
      <td>${d.wpp||0}</td><td>${d.sto||0}</td><td>${d.ree||0}</td><td>${d.feed||0}</td><td>${d.ofe||0}</td>
      <td>${d.nov||0}</td><td>${d.ret||0}</td><td>${d.vis||0}</td><td>${d.td||0}</td><td>${d.prop||0}</td><td>${d.ven||0}</td><td>${d.avaliados||0}</td>
      <td><span class="tag ${bateu?'green':'red'}">${bateu?'✔ bateu':'✗'}</span></td>
      <td><button class="ghost" style="padding:4px 8px;font-size:11px;" onclick="toggleDiaExpand('${k}')">${qtd}x ${aberto?'▲':'▼'}</button></td>
      <td><button class="danger" onclick="delDia('${k}')" title="Excluir todos os lançamentos do dia">✕</button></td>
    </tr>`;
    if (aberto){
      const entradas = (diasDoVendedorAtual()[k]||[]);
      const subRows = entradas.map((e,idx)=>{
        const hora = e.ts ? new Date(e.ts).toLocaleTimeString("pt-BR",{hour:'2-digit',minute:'2-digit'}) : `#${idx+1}`;
        const ligTotalEntrada = (Number(e.ligAtendCom)||0)+(Number(e.ligAtendSem)||0);
        return `<tr class="controle-sub-linha" style="background:rgba(20,80,196,.07);">
          <td colspan="2" style="text-align:right;font-size:11px;color:var(--grey-dark);">🕒 ${hora}</td>
          <td>${ligTotalEntrada}</td><td>${e.ligInvalido||0}</td><td>${e.ligNao||0}</td><td>${e.ligAtendCom||0}</td><td>${e.ligAtendSem||0}</td>
          <td>${e.wpp||0}</td><td>${e.sto||0}</td><td>${e.ree||0}</td><td>${e.feed||0}</td><td>${e.ofe||0}</td>
          <td>${e.nov||0}</td><td>${e.ret||0}</td><td>${e.vis||0}</td><td>${e.td||0}</td><td>${e.prop||0}</td><td>${e.ven||0}</td><td>${e.avaliados||0}</td>
          <td></td><td></td>
          <td><button class="danger" onclick="delEntrada('${k}','${e.ts}')" title="Excluir este lançamento">✕</button></td>
        </tr>`;
      }).join("");
      linha += subRows;
    }
    return linha;
  }).join("");
}
function delDia(k){
  if (!confirm("Excluir o lançamento de "+fmtDate(k)+"?")) return;
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (id) delete diasDoVendedor(id)[k];
  persist(); renderAll();
}

/* ============================= RENDER: VENDAS ============================= */
function tipoDisplay(v){
  if (v.tipoLabel==="0KM") return "0KM (0,5%)";
  if (v.tipoLabel==="Seminovo") return "Seminovo (0,7%)";
  if (v.tipoLabel==="Consórcio") return "Consórcio (1%)";
  if (v.tipoLabel==="Repasses") return "Repasses (0,3%)";
  return `VD (${(Number(v.taxa)*100).toFixed(2)}%)`;
}
function fecharRelatorio(){
  document.getElementById("relatorioOverlay").classList.remove("open");
}
function renderVendas(){
  renderCompeticaoCarros();
  const tbody = document.querySelector("#vendasTable tbody");
  const tfoot = document.querySelector("#vendasTable tfoot");
  const vendasVisiveis = filtrarPorVendedor(state.vendas);
  if (vendasVisiveis.length===0){
    tbody.innerHTML = `<tr><td colspan="16" class="empty">Nenhuma venda registrada ainda.</td></tr>`;
    tfoot.innerHTML = "";
    return;
  }
  const lista = [...vendasVisiveis].sort((a,b)=> (b.data||"").localeCompare(a.data||""));
  tbody.innerHTML = lista.map(v=>{
    const anoTxt = (v.anoFab||v.anoModelo) ? `${v.anoFab||"—"}/${v.anoModelo||"—"}` : "—";
    return `<tr>
      <td>${fmtDate(v.data)}</td><td class="left">${v.carro||""}</td><td class="left">${v.modelo||""}</td>
      <td class="left">${v.versao||""}</td><td class="left">${v.cor||"—"}</td><td>${anoTxt}</td><td class="left">${v.origemCliente||"—"}</td>
      <td class="left">${v.cliente||""}</td>
      <td>${moneyFmt(v.valor)}</td><td>${tipoDisplay(v)}</td>
      <td>${v.emplacamento?moneyFmt(v.emplacamentoValor||50):"—"}</td>
      <td>${v.pontuacao?Number(v.pontuacao).toFixed(2):"—"}</td>
      <td>${v.retornoBanco?moneyFmt(v.retornoBanco):"—"}</td>
      <td>${moneyFmt(v.comissao)}</td><td><b>${moneyFmt(v.total)}</b></td>
      <td style="display:flex;gap:6px;">
        <button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="editarVenda('${v.id}')" title="Editar">✏️ Editar</button>
        <button class="danger" onclick="delVenda('${v.id}')" title="Excluir">✕</button>
      </td>
    </tr>`;
  }).join("");
  const totalValor = vendasVisiveis.reduce((s,v)=>s+(Number(v.valor)||0),0);
  const totalEmplac = vendasVisiveis.reduce((s,v)=>s+(Number(v.emplacamentoValor)||0),0);
  const totalRetornoBanco = vendasVisiveis.reduce((s,v)=>s+(Number(v.retornoBanco)||0),0);
  const totalComissao = vendasVisiveis.reduce((s,v)=>s+(Number(v.comissao)||0),0);
  const totalGeral = vendasVisiveis.reduce((s,v)=>s+(Number(v.total)||0),0);
  tfoot.innerHTML = `<tr><td colspan="8">TOTAL (todas as vendas)</td><td>${moneyFmt(totalValor)}</td><td></td>
    <td>${moneyFmt(totalEmplac)}</td><td></td><td>${moneyFmt(totalRetornoBanco)}</td><td>${moneyFmt(totalComissao)}</td><td>${moneyFmt(totalGeral)}</td><td></td></tr>`;
}
function editarVenda(id){
  const v = state.vendas.find(x=>x.id===id);
  if (!v) return;
  document.querySelector('nav button[data-view="vendas"]').click();
  document.getElementById("vEditId").value = v.id;
  document.getElementById("vTipo").value = v.tipoLabel==="VD" ? "VD" : v.tipoLabel==="Consórcio" ? "CONSORCIO" : v.tipoLabel==="Repasses" ? "REPASSE" : String(v.taxa);
  document.getElementById("vData").value = v.data;
  document.getElementById("vCarro").value = v.carro||"";
  document.getElementById("vModelo").value = v.modelo||"";
  document.getElementById("vVersao").value = v.versao||"";
  document.getElementById("vCor").value = v.cor||"";
  document.getElementById("vAnoFab").value = v.anoFab||"";
  document.getElementById("vAnoModelo").value = v.anoModelo||"";
  document.getElementById("vOrigem").value = v.origemCliente || "Porta Loja";
  document.getElementById("vCliente").value = v.cliente||"";
  document.getElementById("vValor").value = moneyFmt(v.valor).replace("R$","").trim();
  document.getElementById("vEmplac").value = v.emplacamento ? "sim" : "nao";
  document.getElementById("vAcessorios").value = v.acessoriosValor ? moneyFmt(v.acessoriosValor).replace("R$","").trim() : "";
  document.getElementById("vSeguro").value = v.seguroValor ? moneyFmt(v.seguroValor).replace("R$","").trim() : "";
  atualizarCamposVenda();
  document.getElementById("vBtnSubmit").textContent = "Salvar alterações";
  document.getElementById("vBtnCancelarEdicao").style.display = "inline-block";
  const formEl = document.getElementById("formVenda");
  if (formEl && typeof formEl.scrollIntoView === "function"){
    formEl.scrollIntoView({behavior:"smooth", block:"start"});
  }
}
function cancelarEdicaoVenda(){
  document.getElementById("formVenda").reset();
  document.getElementById("vEditId").value = "";
  document.getElementById("vCarro").value = "Volkswagen";
  document.getElementById("vData").value = todayISO();
  document.getElementById("vBtnSubmit").textContent = "Registrar venda";
  document.getElementById("vBtnCancelarEdicao").style.display = "none";
  atualizarCamposVenda();
}
function delVenda(id){
  if (!confirm("Excluir esta venda?")) return;
  state.vendas = state.vendas.filter(v=>v.id!==id);
  // Sem isso, o(s) prêmio(s) do Banco VW ligados a essa venda (origemVendaId) ficavam
  // "fantasmas": a venda de origem some, mas o valor continuava no histórico e nos
  // totais do Banco VW pra sempre, porque nada os desvinculava/apagava.
  state.bancoVW = (state.bancoVW||[]).filter(b=>b.origemVendaId!==id);
  persist(); renderAll();
}


/* ============================= RENDER: EXTRATO ============================= */
function renderExtrato(){
  const mesInput = document.getElementById("extMes");
  const mes = mesInput.value || state.config.mesRef;
  mesInput.value = mes;
  const lista = filtrarPorVendedor(state.vendas).filter(v=>v.data && v.data.startsWith(mes)).sort((a,b)=>a.data.localeCompare(b.data));
  const [y,m] = mes.split("-").map(Number);
  const nomeMes = new Date(y,m-1,1).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  document.getElementById("extratoTitulo").textContent = `Extrato de Vendas — ${nomeMes}`;

  const totalValor = lista.reduce((s,v)=>s+(Number(v.valor)||0),0);
  const totalComissao = lista.reduce((s,v)=>s+(Number(v.comissao)||0),0);
  const totalEmplac = lista.reduce((s,v)=>s+(Number(v.emplacamentoValor)||0),0);
  const totalRetornoBanco = lista.reduce((s,v)=>s+(Number(v.retornoBanco)||0),0);
  const totalGeral = lista.reduce((s,v)=>s+(Number(v.total)||0),0);

  document.getElementById("extratoCards").innerHTML = [
    ["Total de Vendas", `${lista.length} carros`],
    ["Valor Total Vendido", moneyFmt(totalValor)],
    ["Total de Comissão", moneyFmt(totalComissao)],
    ["Total de Emplacamento", moneyFmt(totalEmplac)],
    ["Total Retorno Banco VW", moneyFmt(totalRetornoBanco)],
    ["Total a Receber", moneyFmt(totalGeral)],
  ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:19px">${v}</div></div>`).join("");

  const tbody = document.querySelector("#extratoTable tbody");
  const tfoot = document.querySelector("#extratoTable tfoot");
  if (lista.length===0){
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Nenhuma venda registrada neste mês.</td></tr>`;
    tfoot.innerHTML = "";
    return;
  }
  tbody.innerHTML = lista.map(v=>`<tr>
    <td>${fmtDate(v.data)}</td><td class="left">${v.carro||""}</td><td class="left">${v.modelo||""}</td>
    <td class="left">${v.versao||""}</td><td class="left">${v.cliente||""}</td>
    <td>${moneyFmt(v.valor)}</td><td>${tipoDisplay(v)}</td>
    <td>${v.emplacamento?moneyFmt(v.emplacamentoValor||50):"—"}</td>
    <td>${v.retornoBanco?moneyFmt(v.retornoBanco):"—"}</td>
    <td>${moneyFmt(v.comissao)}</td><td><b>${moneyFmt(v.total)}</b></td>
  </tr>`).join("");
  tfoot.innerHTML = `<tr><td colspan="5">TOTAL</td><td>${moneyFmt(totalValor)}</td><td></td>
    <td>${moneyFmt(totalEmplac)}</td><td>${moneyFmt(totalRetornoBanco)}</td><td>${moneyFmt(totalComissao)}</td><td>${moneyFmt(totalGeral)}</td></tr>`;
}

/* ============================= RENDER: AGENDA DE CONTATOS ============================= */
const CARRO_ORDER = ["POLO","SAVEIRO","TERA","NIVUS","VIRTUS","JETTA","TCROSS","TAOS","TIGUAN","AMAROK"];
function imprimirRelatorioLigacoes(){
  const cfg = state.config;
  const dias = diasDoMesAtual();
  const [y,m] = cfg.mesRef.split("-").map(Number);
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const nomeMes = `${meses[m-1]}/${y}`;

  let totNao=0, totSem=0, totCom=0, totInv=0, totWpp=0;
  const linhas = dias.map(k=>{
    const d = diaSum(k);
    const nao=d.ligNao||0, sem=d.ligAtendSem||0, com=d.ligAtendCom||0, inv=d.ligInvalido||0, wpp=d.wpp||0;
    totNao+=nao; totSem+=sem; totCom+=com; totInv+=inv; totWpp+=wpp;
    const totalDia = nao+sem+com+inv;
    if (totalDia===0 && wpp===0) return "";
    return `<tr><td>${fmtDate(k)}</td><td>${nao}</td><td>${sem}</td><td>${com}</td><td>${inv}</td><td>${wpp}</td><td><b>${totalDia}</b></td></tr>`;
  }).join("");
  const totalGeral = totNao+totSem+totCom+totInv;
  const taxaInteresse = totalGeral>0 ? ((totCom/totalGeral)*100).toFixed(1) : "0,0";
  const taxaAtendimento = totalGeral>0 ? (((totSem+totCom)/totalGeral)*100).toFixed(1) : "0,0";
  const vendedor = cfg.vendedor || "";

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório de Ligações — ${nomeMes}</title>
    <style>
      @page{ size:A4; margin:14mm; }
      *{ box-sizing:border-box; }
      body{ font-family:Arial, Helvetica, sans-serif; color:#171717; margin:0; }
      h1{ font-size:19px; margin:0 0 2px; }
      .sub{ color:#666; font-size:11.5px; margin-bottom:16px; }
      .resumo{ display:flex; border:1px solid #E1E3E8; border-radius:8px; overflow:hidden; margin-bottom:18px; }
      .resumo div{ flex:1; padding:10px 12px; border-right:1px solid #E1E3E8; }
      .resumo div:last-child{ border-right:none; }
      .resumo .rot{ font-size:9px; text-transform:uppercase; color:#888; font-weight:700; }
      .resumo .n{ font-size:17px; font-weight:800; margin-top:3px; }
      table{ width:100%; border-collapse:collapse; font-size:11.5px; }
      th{ text-align:center; padding:6px 4px; border-bottom:2px solid #171717; font-size:10px; text-transform:uppercase; }
      td{ text-align:center; padding:5px 4px; border-bottom:1px solid #eee; }
      tfoot td{ border-top:2px solid #171717; border-bottom:none; font-weight:800; background:#FAFAF8; }
    </style>
  </head><body>
    <h1>📞 Relatório de Ligações — ${nomeMes}</h1>
    <div class="sub">Motomecânica Volkswagen de Lajeado ${vendedor?"— "+vendedor:""} · gerado em ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR").slice(0,5)}</div>

    <div class="resumo">
      <div><div class="rot">Não Atendidas</div><div class="n">${totNao}</div></div>
      <div><div class="rot">Atend. Sem Interesse</div><div class="n">${totSem}</div></div>
      <div><div class="rot">Atend. Com Interesse</div><div class="n">${totCom}</div></div>
      <div><div class="rot">Inválidos</div><div class="n">${totInv}</div></div>
      <div><div class="rot">WhatsApp</div><div class="n">${totWpp}</div></div>
      <div><div class="rot">Taxa de Interesse</div><div class="n">${taxaInteresse}%</div></div>
    </div>

    <table>
      <thead><tr><th>Data</th><th>Não Atend.</th><th>Atend. Sem Int.</th><th>Atend. Com Int.</th><th>Inválidos</th><th>WhatsApp</th><th>Total Ligações</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="7" style="padding:14px;color:#888;">Nenhum lançamento registrado neste mês.</td></tr>`}</tbody>
      <tfoot><tr><td>TOTAL DO MÊS</td><td>${totNao}</td><td>${totSem}</td><td>${totCom}</td><td>${totInv}</td><td>${totWpp}</td><td>${totalGeral}</td></tr></tfoot>
    </table>

    <div style="font-size:10.5px;color:#888;margin-top:14px;">Taxa de atendimento (chegou a falar com alguém): ${taxaAtendimento}% · Taxa de interesse sobre o total de ligações: ${taxaInteresse}%</div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}

function baixarRoteiroLigacoes(){
  const vendedor = state.config.vendedor || "Junior";
  const msgLigacao = (state.config.roteiroLigacaoMsg || DEFAULT_STATE.config.roteiroLigacaoMsg).replace(/\{vendedor\}/g, vendedor).replace(/\n/g,"<br>");
  const msgWhats = (state.config.roteiroWhatsMsg || DEFAULT_STATE.config.roteiroWhatsMsg).replace(/\{vendedor\}/g, vendedor).replace(/\n/g,"<br>");
  function gerarBolinhas(){
    let html = "";
    for (let i=1; i<=30; i++){ html += `<span class="roteiro-bolinha">${i}</span>`; }
    return html;
  }
  const secoes = ["LIGAÇÕES NÃO ATENDIDAS","LIGAÇÕES ATENDIDAS SEM INTERESSE","LIGAÇÕES ATENDIDAS COM INTERESSE","TELEFONES INVÁLIDOS","MENSAGENS WHATSAPP"];
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Roteiro de Ligações</title>
    <style>
      @page{ size:A4; margin:10mm; }
      *{ box-sizing:border-box; }
      body{ font-family:Arial, Helvetica, sans-serif; color:#171717; margin:0; padding:8mm; }
      h1{ font-size:30px; margin:0 0 4px; }
      .roteiro-sub{ color:#666; font-size:15px; margin-bottom:16px; }
      .roteiro-scripts{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:20px; }
      .roteiro-script{ font-size:15px; line-height:1.55; background:#FAFAF8; border:1.5px solid #E1E3E8; border-radius:12px; padding:16px 18px; }
      .roteiro-script b{ display:block; font-size:13px; letter-spacing:.3px; margin-bottom:8px; }
      .roteiro-secoes{ display:flex; flex-direction:column; }
      .roteiro-secao{ border-top:1.5px dashed #ccc; padding-top:14px; margin-top:14px; }
      .roteiro-secao:first-child{ border-top:none; padding-top:0; margin-top:0; }
      .roteiro-secao h3{ font-size:15px; letter-spacing:.3px; margin:0 0 8px; border-bottom:2px solid #171717; padding-bottom:6px; }
      .roteiro-bolinhas{ display:flex; flex-wrap:wrap; gap:5px; }
      .roteiro-bolinha{
        width:34px; height:34px; border-radius:50%; border:2px solid #171717; display:flex; align-items:center; justify-content:center;
        font-weight:700; font-size:13px; flex-shrink:0;
      }
    </style>
  </head><body>
    <h1>📞 Roteiro de Ligações</h1>
    <div class="roteiro-sub">Motomecânica Volkswagen de Lajeado — ${vendedor}</div>
    <div class="roteiro-scripts">
      <div class="roteiro-script"><b>SCRIPT DA LIGAÇÃO</b>${msgLigacao}</div>
      <div class="roteiro-script" style="border-color:#25D366;background:#F0FBF3;"><b style="color:#128C4A;">💬 SUGESTÃO PARA WHATSAPP</b>${msgWhats}</div>
    </div>
    <div class="roteiro-secoes">
      ${secoes.map(s=>`<div class="roteiro-secao"><h3>${s}</h3><div class="roteiro-bolinhas">${gerarBolinhas()}</div></div>`).join("")}
    </div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}
function abrirHistoricoModal(clienteId){
  const c = state.clientes.find(x=>x.id===clienteId);
  if (!c) return;
  document.getElementById("historicoClienteId").value = clienteId;
  document.getElementById("historicoNomeCliente").textContent = c.nome || "";
  document.getElementById("hData").value = todayISO();
  document.getElementById("hHora").value = new Date().toTimeString().slice(0,5);
  document.getElementById("hCanal").value = "WhatsApp";
  document.getElementById("hObs").value = "";
  renderHistoricoLista(c);
  document.getElementById("historicoModalOverlay").classList.add("open");
}
function fecharHistoricoModal(){
  document.getElementById("historicoModalOverlay").classList.remove("open");
}
function renderHistoricoLista(c){
  const lista = [...(c.historico||[])].sort((a,b)=> (b.data+b.hora).localeCompare(a.data+a.hora));
  document.getElementById("historicoLista").innerHTML = lista.length ? `
    <div style="font-size:11px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px;border-top:1px solid var(--border-light);padding-top:12px;">Registros anteriores</div>
    <ul style="margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:8px;">
      ${lista.map(h=>`
        <li style="background:var(--card-tint);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;font-size:12.5px;position:relative;">
          <b>${CANAL_ICONE[h.canal]||"📌"} ${h.canal}</b> — ${fmtDate(h.data)} às ${h.hora}
          ${h.obs?`<div style="color:var(--text-dim);margin-top:4px;">${h.obs}</div>`:""}
          <button class="danger" style="position:absolute;top:8px;right:8px;font-size:13px;" onclick="delHistoricoEntrada('${c.id}','${h.id}')" title="Excluir">✕</button>
        </li>`).join("")}
    </ul>` : `<div class="empty" style="border-top:1px solid var(--border-light);padding-top:14px;">Nenhum contato registrado ainda para este cliente.</div>`;
}

/* ============================= RENDER: CONFIG ============================= */
function renderConfig(){
  // Metas (metaVendas, metaSalario, etc.) são por vendedor — cada um define a
  // própria; o resto (mesRef, vendedor, concessionaria, roteiros) é da loja toda.
  const c = {...state.config, ...metasDoVendedorAtual()};
  document.getElementById("cfgMes").value = c.mesRef;
  document.getElementById("cfgMeta").value = c.metaVendas;
  document.getElementById("cfgMetaSemi").value = c.metaSeminovos;
  document.getElementById("cfgMetaConsorcio").value = c.metaConsorcios;
  document.getElementById("cfgMetaVD").value = c.metaVD;
  document.getElementById("cfgMetaRepasse").value = c.metaRepasses;
  {
    state.metasVolks = state.metasVolks || {};
    const mv = state.metasVolks[c.mesRef] || {};
    document.getElementById("cfgMetaVolksCarros").value = mv.metaCarros || "";
    document.getElementById("cfgMetaVolksVendedores").value = mv.qtdVendedores || "";
  }
  document.getElementById("cfgLig").value = c.metaLig;
  document.getElementById("cfgWpp").value = c.metaWpp;
  document.getElementById("cfgSto").value = c.metaStories;
  document.getElementById("cfgRee").value = c.metaReels;
  document.getElementById("cfgFeed").value = c.metaFeed;
  document.getElementById("cfgOfe").value = c.metaOfertas;
  document.getElementById("cfgAlerta").value = c.diasAlerta;
  document.getElementById("cfgTaxaVD").value = c.taxaVD;
  document.getElementById("cfgVendedor").value = c.vendedor;
  document.getElementById("cfgConc").value = c.concessionaria;
  const campoLig = document.getElementById("cfgRoteiroLigacao");
  const campoWhats = document.getElementById("cfgRoteiroWhats");
  if (document.activeElement !== campoLig) campoLig.value = c.roteiroLigacaoMsg || "";
  if (document.activeElement !== campoWhats) campoWhats.value = c.roteiroWhatsMsg || "";

  const lista = [...(state.feriadosCustom||[])].sort((a,b)=>(a.data||"").localeCompare(b.data||""));
  const tbody = document.querySelector("#tblFeriadosCustom tbody");
  tbody.innerHTML = lista.length ? lista.map((f,i)=>
    `<tr><td>${fmtDate(f.data)}</td><td class="left">${f.nome}</td><td><button class="danger" onclick="delFeriadoCustom(${i})" title="Excluir">✕</button></td></tr>`
  ).join("") : `<tr><td colspan="3" class="empty">Nenhum feriado municipal/regional cadastrado ainda.</td></tr>`;
  renderVendedores();
}
function delFeriadoCustom(idx){
  if (!confirm("Excluir este feriado?")) return;
  state.feriadosCustom.splice(idx,1);
  persist(); renderAll();
}


/* ============================= SALÁRIOS ============================= */
const MESES_SAL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
function popularSelectsSalario(){
  const dia = document.getElementById("salDia");
  const mes = document.getElementById("salMes");
  const ano = document.getElementById("salAno");
  if (dia.children.length===0){
    for (let d=1; d<=31; d++){ const o=document.createElement("option"); o.value=d; o.textContent=String(d).padStart(2,"0"); dia.appendChild(o); }
  }
  if (mes.children.length===0){
    MESES_SAL.forEach((m,i)=>{ const o=document.createElement("option"); o.value=i+1; o.textContent=m; mes.appendChild(o); });
  }
  if (ano.children.length===0){
    const anoAtual = new Date().getFullYear();
    for (let a=anoAtual-5; a<=anoAtual+2; a++){ const o=document.createElement("option"); o.value=a; o.textContent=a; ano.appendChild(o); }
  }
  const hoje = new Date();
  dia.value = hoje.getDate();
  mes.value = hoje.getMonth()+1;
  ano.value = hoje.getFullYear();
}
function salarioMesChave(iso){ return iso.slice(0,7); }
const TIPOS_SALARIO = [
  {key:"Banco", label:"Salário Banco", icone:"💳"},
  {key:"Cartão", label:"Salário Cartão", icone:"🏦"},
  {key:"Prêmios", label:"Salário Prêmios", icone:"🏆"},
  {key:"13º Salário", label:"13º Salário", icone:"🎁"},
  {key:"Férias", label:"Férias", icone:"🏖️"},
  {key:"Emplacamento", label:"Emplacamento", icone:"🚙"},
  {key:"Consórcios", label:"Consórcios", icone:"🪙"},
  {key:"Acessórios", label:"Acessórios", icone:"🧰"},
  {key:"Seguros", label:"Seguros", icone:"🛡️"},
];
function renderSalarios(){
  const salarios = filtrarPorVendedor(state.salarios || []);
  const cfg = state.config;

  // resumo do mês de referência configurado
  const doMes = salarios.filter(s=>salarioMesChave(s.data)===cfg.mesRef);
  const totaisMes = TIPOS_SALARIO.map(t=>doMes.filter(s=>s.tipo===t.key).reduce((a,s)=>a+(Number(s.valor)||0),0));
  const totMes = totaisMes.reduce((a,b)=>a+b,0);
  const totGeral = salarios.reduce((a,s)=>a+(Number(s.valor)||0),0);

  const cardsResumo = TIPOS_SALARIO.map((t,i)=>[`${t.icone} ${t.label} (${cfg.mesRef})`, moneyFmt(totaisMes[i])]);
  cardsResumo.push([`💰 Total do Mês (${cfg.mesRef})`, moneyFmt(totMes)]);
  cardsResumo.push(["📊 Total Geral (todos os períodos)", moneyFmt(totGeral)]);
  document.getElementById("salarioResumoCards").innerHTML = cardsResumo
    .map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");

  // agrupamento por mês (todos os períodos)
  const porMes = {};
  salarios.forEach(s=>{
    const chave = salarioMesChave(s.data);
    if (!porMes[chave]) porMes[chave] = Object.fromEntries(TIPOS_SALARIO.map(t=>[t.key,0]));
    porMes[chave][s.tipo] = (porMes[chave][s.tipo]||0) + (Number(s.valor)||0);
  });
  const mesesOrdenados = Object.keys(porMes).sort();

  document.getElementById("chartSalarioMes").innerHTML = salarioMesChartSVG(
    mesesOrdenados.map(m=>m.slice(5,7)+"/"+m.slice(2,4)),
    mesesOrdenados.map(m=>Math.round(TIPOS_SALARIO.reduce((a,t)=>a+porMes[m][t.key],0)))
  );
  const coresPorTipo = ["#2E86DE","#1FA463","#F7C600","#833AB4","#FD7E14","#17A398","#C2185B"];
  document.getElementById("chartSalarioTipo").innerHTML = salarioTipoChartSVG(
    TIPOS_SALARIO.map(t=>t.label),
    TIPOS_SALARIO.map(t=>Math.round(salarios.filter(s=>s.tipo===t.key).reduce((a,s)=>a+(Number(s.valor)||0),0))),
    coresPorTipo
  );

  { // ===== Panorama / Insights de Salário =====
    const totaisPorMes = mesesOrdenados.map(m=>({mes:m, total:TIPOS_SALARIO.reduce((a,t)=>a+porMes[m][t.key],0)}));
    const comValor = totaisPorMes.filter(x=>x.total>0);
    const melhorMes = comValor.length ? comValor.reduce((a,b)=>b.total>a.total?b:a) : null;
    const piorMes = comValor.length ? comValor.reduce((a,b)=>b.total<a.total?b:a) : null;
    const mediaMensal = comValor.length ? comValor.reduce((s,x)=>s+x.total,0)/comValor.length : 0;

    const totaisPorTipo = TIPOS_SALARIO.map(t=>({t, total:salarios.filter(s=>s.tipo===t.key).reduce((a,s)=>a+(Number(s.valor)||0),0)}));
    const melhorTipo = totaisPorTipo.reduce((a,b)=>b.total>a.total?b:a, totaisPorTipo[0]);

    // sazonalidade: agrupa por mês do calendário (Jan, Fev...) juntando todos os anos, pra ver se algum mês do ano se destaca
    const porMesCalendario = {};
    salarios.forEach(s=>{
      const mm = s.data.slice(5,7);
      porMesCalendario[mm] = (porMesCalendario[mm]||0) + (Number(s.valor)||0);
    });
    const anosPresentes = new Set(salarios.map(s=>s.data.slice(0,4))).size;
    const chaveMesCalendarioTop = Object.keys(porMesCalendario).length ? Object.entries(porMesCalendario).reduce((a,b)=>b[1]>a[1]?b:a)[0] : null;

    const fmtMes = (m)=> m ? `${MESES_SAL[Number(m.mes.slice(5,7))-1]}/${m.mes.slice(2,4)}` : "—";

    document.getElementById("salarioInsightKpis").innerHTML = `
      <div class="financ-kpi-card salario-kpi-destaque">
        <span class="financ-kpi-icon">🏆</span>
        <div class="financ-kpi-label">Melhor Mês</div>
        <div class="financ-kpi-value">${melhorMes?fmtMes(melhorMes):"—"}</div>
        <div class="financ-kpi-sub">${melhorMes?moneyFmt(melhorMes.total):"sem dados ainda"}</div>
      </div>
      <div class="financ-kpi-card salario-kpi-alerta">
        <span class="financ-kpi-icon">📉</span>
        <div class="financ-kpi-label">Mês mais fraco</div>
        <div class="financ-kpi-value">${piorMes?fmtMes(piorMes):"—"}</div>
        <div class="financ-kpi-sub">${piorMes?moneyFmt(piorMes.total):"sem dados ainda"}</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">📊</span>
        <div class="financ-kpi-label">Média Mensal</div>
        <div class="financ-kpi-value">${moneyFmt(mediaMensal)}</div>
        <div class="financ-kpi-sub">com base em ${comValor.length} ${comValor.length===1?"mês":"meses"} com lançamento</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">${TIPOS_SALARIO.find(t=>t.key===melhorTipo.t.key)?.icone||"💰"}</span>
        <div class="financ-kpi-label">Categoria que mais rende</div>
        <div class="financ-kpi-value">${melhorTipo.total>0?melhorTipo.t.label:"—"}</div>
        <div class="financ-kpi-sub">${melhorTipo.total>0?moneyFmt(melhorTipo.total)+" no total":"sem dados ainda"}</div>
      </div>
      <div class="financ-kpi-card">
        <span class="financ-kpi-icon">📅</span>
        <div class="financ-kpi-label">Melhor Época do Ano</div>
        <div class="financ-kpi-value">${chaveMesCalendarioTop?MESES_SAL[Number(chaveMesCalendarioTop)-1]:"—"}</div>
        <div class="financ-kpi-sub">${anosPresentes>=2?"considerando os anos já registrados":"precisa de mais de 1 ano de histórico pra confirmar o padrão"}</div>
      </div>`;
  }

  document.getElementById("tblSalariosMesHead").innerHTML =
    `<tr><th>Mês</th>${TIPOS_SALARIO.map(t=>`<th>${t.label}</th>`).join("")}<th>Total</th></tr>`;
  const tbodyMes = document.querySelector("#tblSalariosMes tbody");
  tbodyMes.innerHTML = mesesOrdenados.length ? mesesOrdenados.slice().reverse().map(m=>{
    const d = porMes[m];
    const total = TIPOS_SALARIO.reduce((a,t)=>a+d[t.key],0);
    const [y,mm] = m.split("-");
    return `<tr><td>${MESES_SAL[Number(mm)-1]}/${y}</td>${TIPOS_SALARIO.map(t=>`<td>${moneyFmt(d[t.key])}</td>`).join("")}<td><b>${moneyFmt(total)}</b></td></tr>`;
  }).join("") : `<tr><td colspan="${TIPOS_SALARIO.length+2}" class="empty">Nenhum salário cadastrado ainda.</td></tr>`;

  const tbody = document.querySelector("#tblSalarios tbody");
  tbody.innerHTML = salarios.length ? [...salarios].sort((a,b)=>(b.data||"").localeCompare(a.data||"")).map(s=>`
    <tr>
      <td>${fmtDate(s.data)}</td>
      <td>${s.tipo}</td>
      <td class="left">${s.obs ? s.obs+(s.origemVendaId?" <span style='color:var(--text-mute);font-size:10px;'>(automático)</span>":"") : "—"}</td>
      <td>${moneyFmt(s.valor)}</td>
      <td style="display:flex;gap:6px;justify-content:center;">
        ${!s.origemVendaId ? `<button class="ghost" style="padding:4px 10px;font-size:11px;" onclick="editarSalario('${s.id}')" title="Editar">✏️</button>` : ""}
        <button class="danger" onclick="delSalario('${s.id}')" title="Excluir">✕</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">Nenhum salário cadastrado ainda.</td></tr>`;
}
function delSalario(id){
  if (!confirm("Excluir este lançamento de salário?")) return;
  state.salarios = state.salarios.filter(s=>s.id!==id);
  persist(); renderAll();
}
function gerarExtratoSalarioPeriodo(){
  const inicio = document.getElementById("salExtratoInicio").value;
  const fim = document.getElementById("salExtratoFim").value;
  const box = document.getElementById("salExtratoResultado");
  if (!inicio || !fim){ box.innerHTML = `<div class="empty">Escolha a data de início e a data de fim.</div>`; return; }
  if (fim < inicio){ box.innerHTML = `<div class="empty">A data de fim precisa ser depois da data de início.</div>`; return; }

  const lista = [...filtrarPorVendedor(state.salarios||[])].filter(s=>s.data>=inicio && s.data<=fim).sort((a,b)=>(a.data||"").localeCompare(b.data||""));
  const totalPeriodo = lista.reduce((s,x)=>s+(Number(x.valor)||0),0);
  const porTipo = {};
  lista.forEach(s=>{ porTipo[s.tipo] = (porTipo[s.tipo]||0) + (Number(s.valor)||0); });

  const cardsResumo = [
    ["📅 Período", `${fmtDate(inicio)} até ${fmtDate(fim)}`],
    ["🧾 Lançamentos", `${lista.length}`],
    ["💰 Total do Período", moneyFmt(totalPeriodo)],
  ].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value" style="font-size:16px;">${v}</div></div>`).join("");

  const linhasPorTipo = Object.entries(porTipo).sort((a,b)=>b[1]-a[1])
    .map(([tipo,valor])=>`<span class="tag" style="margin:3px 4px 3px 0;">${tipo}: <b>${moneyFmt(valor)}</b></span>`).join("");

  const linhasTabela = lista.length ? lista.map(s=>`
    <tr>
      <td>${fmtDate(s.data)}</td><td>${s.tipo}</td>
      <td class="left">${s.obs||"—"}</td>
      <td>${moneyFmt(s.valor)}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="empty">Nenhum lançamento nesse período.</td></tr>`;

  box.innerHTML = `
    <div class="cards" style="margin-bottom:14px;">${cardsResumo}</div>
    <div style="margin-bottom:14px;">${linhasPorTipo}</div>
    <div class="table-wrap">
      <table><thead><tr><th>Data</th><th>Tipo</th><th>Origem</th><th>Valor</th></tr></thead><tbody>${linhasTabela}</tbody></table>
    </div>`;
}

/* ============================= PONTO / HORAS EXTRAS ============================= */
let pontoMesAtual = new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0");
function abrirPontoModal(dataStr){
  const reg = pontoDoVendedorAtual()[dataStr] || {};
  document.getElementById("pontoData").value = dataStr;
  document.getElementById("pontoModalTitulo").textContent = "Registro de "+fmtDate(dataStr);
  document.getElementById("pontoEntrada").value = reg.entrada || "";
  document.getElementById("pontoSaida").value = reg.saida || "";
  document.getElementById("pontoForaCidade").checked = !!reg.foraCidade;
  document.getElementById("pontoTransporte").value = reg.transporte || "carro";
  document.getElementById("pontoCarroTipo").value = reg.carroTipo || "loja";
  document.getElementById("pontoObs").value = reg.obs || "";
  atualizarCamposPonto();
  document.getElementById("btnExcluirPonto").style.display = pontoDoVendedorAtual()[dataStr] ? "block" : "none";
  document.getElementById("pontoModalOverlay").classList.add("open");
}
function fecharPontoModal(){
  document.getElementById("pontoModalOverlay").classList.remove("open");
}
function atualizarCamposPonto(){
  const foraCidade = document.getElementById("pontoForaCidade").checked;
  document.getElementById("pontoTransporteWrap").style.display = foraCidade ? "block" : "none";
  const ehCarro = document.getElementById("pontoTransporte").value === "carro";
  document.getElementById("pontoCarroTipoWrap").style.display = (foraCidade && ehCarro) ? "block" : "none";
}
function diasDoMesPonto(mesRef){
  const dim = diasNoMes(mesRef);
  const dias = [];
  for (let d=1; d<=dim; d++) dias.push(mesRef+"-"+String(d).padStart(2,"0"));
  return dias;
}
/* ============================= ANIVERSÁRIOS / DATAS ESPECIAIS ============================= */
let calAnivMesAtual = new Date().getMonth()+1;
let calAnivAnoAtual = new Date().getFullYear();
function popularSelectsCalAniv(){
  const selMes = document.getElementById("calAnivMes");
  const selAno = document.getElementById("calAnivAno");
  if (selMes.children.length===0){
    MESES_SAL.forEach((m,i)=>{ const o=document.createElement("option"); o.value=i+1; o.textContent=m; selMes.appendChild(o); });
  }
  if (selAno.children.length===0){
    const anoBase = new Date().getFullYear();
    for (let a=anoBase+2; a>=1940; a--){ const o=document.createElement("option"); o.value=a; o.textContent=a; selAno.appendChild(o); }
  }
  selMes.value = calAnivMesAtual;
  selAno.value = calAnivAnoAtual;
}
function aniversariosDoDia(mmdd){
  return (state.aniversarios||[]).filter(a=>a.data===mmdd);
}
function renderCalAniversarios(){
  popularSelectsCalAniv();
  const y = calAnivAnoAtual, m = calAnivMesAtual;
  const mesRef = y+"-"+String(m).padStart(2,"0");
  const dim = diasNoMes(mesRef);
  const firstDow = new Date(y,m-1,1).getDay();
  const dows = ["D","S","T","Q","Q","S","S"];
  let html = dows.map(d=>`<div style="text-align:center;font-size:10px;font-weight:800;color:var(--text-mute);padding-bottom:4px;">${d}</div>`).join("");
  for (let i=0;i<firstDow;i++) html += `<div></div>`;
  for (let d=1; d<=dim; d++){
    const mmdd = String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    const anivs = aniversariosDoDia(mmdd);
    const ehNatal = (m===12 && d===25);
    const ehAnoNovo = (m===1 && d===1);
    let bg = "var(--card-tint)";
    if (anivs.length) bg = "rgba(240,98,146,.22)";
    if (ehNatal) bg = "rgba(31,122,63,.22)";
    if (ehAnoNovo) bg = "rgba(255,206,0,.22)";
    html += `<div class="cal-day-clicavel" onclick="abrirAniversarioModal('${mmdd}')" style="cursor:pointer;aspect-ratio:1;border-radius:6px;border:1px solid var(--border);background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;font-size:10px;font-weight:700;color:var(--graphite-2);">
      <span>${d}</span>
      <span style="font-size:8px;">${anivs.length?"🎂":""}${ehNatal?"🎄":""}${ehAnoNovo?"🎆":""}</span>
    </div>`;
  }
  document.getElementById("calAnivBox").innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">${html}</div>`;

  const todosOrdenados = [...(state.aniversarios||[])].sort((a,b)=>(a.data||"").localeCompare(b.data||""));
  const tbody = document.querySelector("#tblAniversarios tbody");
  tbody.innerHTML = todosOrdenados.length ? todosOrdenados.map(a=>{
    const [mm,dd] = a.data.split("-");
    const idade = calcularIdade(a.anoNascimento, a.data);
    return `<tr><td>${dd}/${mm}</td><td class="left">${a.nome}</td><td>${a.whats||"—"}</td><td>${a.anoNascimento||"—"}</td><td>${idade!=null?idade+" anos":"—"}</td><td class="left">${a.obs||""}</td>
      <td><button class="danger" onclick="delAniversarioDireto('${a.id}')" title="Excluir">✕</button></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">Nenhum aniversário cadastrado ainda. Clique num dia do calendário pra adicionar.</td></tr>`;
}
function abrirAniversarioModal(mmdd){
  const [mm,dd] = mmdd.split("-");
  document.getElementById("aniData").value = mmdd;
  document.getElementById("aniversarioModalTitulo").textContent = `🎂 Aniversariantes — ${dd}/${mm}`;
  limparFormAniversario();
  renderListaAniversariosDoDia(mmdd);
  document.getElementById("aniversarioModalOverlay").classList.add("open");
}
function fecharAniversarioModal(){
  document.getElementById("aniversarioModalOverlay").classList.remove("open");
}
function limparFormAniversario(){
  document.getElementById("aniEditId").value = "";
  document.getElementById("aniNome").value = "";
  document.getElementById("aniWhats").value = "";
  document.getElementById("aniAnoNasc").value = "";
  document.getElementById("aniObs").value = "";
  document.getElementById("aniFormTitulo").textContent = "+ Adicionar aniversariante";
  document.getElementById("aniBtnSubmit").textContent = "Salvar aniversariante";
  document.getElementById("btnCancelarEdicaoAniversario").style.display = "none";
}
function renderListaAniversariosDoDia(mmdd){
  const lista = aniversariosDoDia(mmdd);
  document.getElementById("aniversarioListaExistentes").innerHTML = lista.length ? `
    <div style="font-size:11px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:.3px;margin-bottom:10px;">${lista.length} aniversariante${lista.length>1?"s":""} neste dia</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${lista.map(a=>{
        const idade = calcularIdade(a.anoNascimento, mmdd);
        return `
        <div style="background:var(--card-tint);border:1px solid var(--border-light);border-radius:10px;padding:10px 40px 10px 12px;position:relative;font-size:12.5px;">
          <b>🎂 ${a.nome}</b>${a.whats?` <span style="color:var(--text-dim);">· ${a.whats}</span>`:""}
          ${a.anoNascimento?` <span style="color:var(--text-dim);">· Nasc. ${a.anoNascimento}${idade!=null?` · ${idade} anos`:""}</span>`:""}
          ${a.obs?`<div style="color:var(--text-dim);margin-top:3px;">${a.obs}</div>`:""}
          <div style="position:absolute;top:8px;right:8px;display:flex;gap:4px;">
            <button class="ghost" style="padding:3px 7px;font-size:11px;" onclick="editarAniversario('${a.id}')" title="Editar">✏️</button>
            <button class="danger" onclick="delAniversarioDireto('${a.id}')" title="Excluir">✕</button>
          </div>
        </div>`;
      }).join("")}
    </div>` : `<div class="empty">Nenhum aniversariante neste dia ainda. Adicione um abaixo.</div>`;
}
function editarAniversario(id){
  const a = state.aniversarios.find(x=>x.id===id);
  if (!a) return;
  document.getElementById("aniEditId").value = a.id;
  document.getElementById("aniNome").value = a.nome;
  document.getElementById("aniWhats").value = a.whats||"";
  document.getElementById("aniAnoNasc").value = a.anoNascimento||"";
  document.getElementById("aniObs").value = a.obs||"";
  document.getElementById("aniFormTitulo").textContent = `Editando: ${a.nome}`;
  document.getElementById("aniBtnSubmit").textContent = "Salvar alterações";
  document.getElementById("btnCancelarEdicaoAniversario").style.display = "inline-block";
}
function delAniversarioDireto(id){
  if (!confirm("Excluir este aniversariante?")) return;
  const mmdd = document.getElementById("aniData").value;
  state.aniversarios = state.aniversarios.filter(a=>a.id!==id);
  persist(); renderAll();
  if (mmdd) renderListaAniversariosDoDia(mmdd);
}
function renderDatasEspeciais(){
  if (!document.getElementById("datasEspeciaisWrap")) return;
  const hojeISO = todayISO();
  const [anoAtualStr, mesAtualStr, diaAtualStr] = hojeISO.split("-");
  const mmddHoje = mesAtualStr+"-"+diaAtualStr;
  const anoNum = Number(anoAtualStr);
  const cards = [];

  aniversariosDoDia(mmddHoje).forEach(a=>{
    const idadeHoje = calcularIdade(a.anoNascimento, mmddHoje);
    const msg = `Olá ${a.nome}! Muito obrigado pela confiança em nós ao longo desse tempo 🙏 Passando aqui pra desejar um Feliz Aniversário! 🎂🎉 Que esse novo ano seja incrível!`;
    cards.push(`
      <div class="data-especial-panel data-especial-aniversario">
        <div class="data-especial-icone anivBolo">🎂<span class="decor decor1">🎉</span><span class="decor decor2">✨</span></div>
        <div style="flex:1;min-width:0;">
          <div class="data-especial-titulo">🎈 Aniversário Hoje</div>
          <div class="data-especial-texto">${a.nome}${idadeHoje!=null?` — completando ${idadeHoje} anos`:""}</div>
          <div class="data-especial-msg">${msg}</div>
          <a class="data-especial-btn-whats" href="${linkWhats(a.whats, msg)}" target="_blank" rel="noopener">💬 Enviar mensagem no WhatsApp</a>
        </div>
      </div>`);
  });

  const natalISO = `${anoNum}-12-25`;
  const avisoNatal = diaUtilAnterior(natalISO);
  if (hojeISO === avisoNatal){
    const msgBase = `Feliz Natal! 🎄🎅 Que esse Natal seja repleto de alegria, paz e realizações junto da sua família. Muito obrigado por fazer parte da nossa jornada esse ano!`;
    const botoes = (state.aniversarios||[]).length
      ? (state.aniversarios||[]).map(a=>`<a class="data-especial-btn-whats" style="margin:2px 4px 2px 0;" href="${linkWhats(a.whats, `Olá ${a.nome}! ${msgBase}`)}" target="_blank" rel="noopener">💬 ${a.nome}</a>`).join("")
      : `<a class="data-especial-btn-whats" href="${linkWhats('', msgBase)}" target="_blank" rel="noopener">💬 Enviar mensagem no WhatsApp</a>`;
    cards.push(`
      <div class="data-especial-panel data-especial-natal" style="align-items:flex-start;">
        <div class="data-especial-icone natalPapai">🎅<span class="decor decor1">🎄</span><span class="decor decor2">❄️</span></div>
        <div style="flex:1;min-width:0;">
          <div class="data-especial-titulo">🎄 Natal se aproxima</div>
          <div class="data-especial-texto">Hoje é seu último dia útil antes do Natal — mande a mensagem pros seus clientes, um por um</div>
          <div class="data-especial-msg">${msgBase}</div>
          <div style="display:flex;flex-wrap:wrap;">${botoes}</div>
        </div>
      </div>`);
  }

  const proximoAnoNovoISO = `${anoNum+1}-01-01`;
  const avisoAnoNovo = diaUtilAnterior(proximoAnoNovoISO);
  if (hojeISO === avisoAnoNovo){
    const msgBase = `Mais um ano se encerrando... obrigado por fazer parte dele com a gente! Que o ano que chega venha com muitas conquistas e realizações. Feliz Ano Novo! 🎆✨`;
    const botoes = (state.aniversarios||[]).length
      ? (state.aniversarios||[]).map(a=>`<a class="data-especial-btn-whats" style="margin:2px 4px 2px 0;" href="${linkWhats(a.whats, `Olá ${a.nome}! ${msgBase}`)}" target="_blank" rel="noopener">💬 ${a.nome}</a>`).join("")
      : `<a class="data-especial-btn-whats" href="${linkWhats('', msgBase)}" target="_blank" rel="noopener">💬 Enviar mensagem no WhatsApp</a>`;
    cards.push(`
      <div class="data-especial-panel data-especial-anonovo" style="align-items:flex-start;">
        <div class="data-especial-icone anoNovoFogos">🎆<span class="decor decor1">✨</span><span class="decor decor2">✨</span><span class="decor decor3">🎇</span></div>
        <div style="flex:1;min-width:0;">
          <div class="data-especial-titulo">🎆 Ano Novo se aproxima</div>
          <div class="data-especial-texto">Hoje é seu último dia útil antes da virada do ano — mande a mensagem pros seus clientes, um por um</div>
          <div class="data-especial-msg">${msgBase}</div>
          <div style="display:flex;flex-wrap:wrap;">${botoes}</div>
        </div>
      </div>`);
  }

  document.getElementById("datasEspeciaisWrap").innerHTML = cards.join("");
}
function renderPontoCalendario(){
  const pontoAtual = pontoDoVendedorAtual();
  const [y,m] = pontoMesAtual.split("-").map(Number);
  document.getElementById("pontoMesLabel").textContent = `${MESES_SAL[m-1]} / ${y}`;
  const dim = diasNoMes(pontoMesAtual);
  const firstDow = new Date(y,m-1,1).getDay();
  const dows = ["D","S","T","Q","Q","S","S"];
  let html = dows.map(d=>`<div style="text-align:center;font-size:10px;font-weight:800;color:var(--text-mute);padding-bottom:4px;">${d}</div>`).join("");
  for (let i=0;i<firstDow;i++) html += `<div></div>`;
  for (let d=1; d<=dim; d++){
    const ds = pontoMesAtual+"-"+String(d).padStart(2,"0");
    const reg = pontoAtual[ds];
    const temHora = reg && (reg.entrada || reg.saida);
    const temViagem = reg && reg.foraCidade;
    const bg = reg ? (temViagem ? "rgba(255,206,0,.25)" : "rgba(204,0,0,.12)") : "var(--card-tint)";
    html += `<div class="cal-day-clicavel" onclick="abrirPontoModal('${ds}')" style="cursor:pointer;aspect-ratio:1;border-radius:8px;border:1px solid var(--border);background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;font-size:11px;font-weight:700;color:var(--graphite-2);">
      <span>${d}</span>
      <span style="font-size:9px;">${temHora?"🕒":""}${temViagem?"✈️":""}</span>
    </div>`;
  }
  document.getElementById("pontoCalBox").innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;">${html}</div>`;

  const registrosDoMes = diasDoMesPonto(pontoMesAtual).filter(ds=>pontoAtual[ds]);
  const tbody = document.querySelector("#tblPonto tbody");
  tbody.innerHTML = registrosDoMes.length ? registrosDoMes.map(ds=>{
    const r = pontoAtual[ds];
    const viagemTxt = r.foraCidade ? `✈️ ${r.transporte==="carro"?("Carro ("+(r.carroTipo==="loja"?"da loja":"próprio")+")"):r.transporte}` : "—";
    return `<tr><td>${fmtDate(ds)}</td><td>${r.entrada||"—"}</td><td>${r.saida||"—"}</td><td>${viagemTxt}</td><td>${r.obs||""}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">Nenhum registro de ponto este mês.</td></tr>`;
}
function delPonto(){
  const ds = document.getElementById("pontoData").value;
  const id = currentVendedorPerfil && currentVendedorPerfil.id;
  if (!ds || !id || !pontoDoVendedor(id)[ds]) return;
  if (!confirm("Excluir o registro de ponto desse dia?")) return;
  delete pontoDoVendedor(id)[ds];
  persist(); renderAll();
  fecharPontoModal();
}

function renderAll(){ renderDashboard(); renderMetaVolks(); renderControle(); renderVendas(); renderPropostas(); renderClientes(); renderConfig(); renderCharts(); renderExtrato(); renderSalarios(); renderPontoCalendario(); renderHumorHoje(); renderCalAniversarios(); renderDatasEspeciais(); renderPostagens(); renderGerentePoliticaAtualBox(); renderGerenteForm(); renderBancoVWView(); renderFipeDetran(); atualizarAvisoDiaControle(); }
function chaveVersaoG(r){ return r.m+" · "+r.v; }
function regrasBaseGerente(){
  const REGRAS=[];
  function add(m,v,c,am,op,de,ate,nf,nfr,ti,tir,bv,bvr,tot,tx,obs){
    REGRAS.push({m,v,c,am,op,de,ate,nf,ti,bv,rede:nfr+tir+bvr,tot,tx,obs:obs||""});
  }
/* POLO TRACK */
const PT=["23/24","24/24","24/25","25/25","25/26"];
const PTX="0% | 80% | 12x · 0,99% | 30% | 48x · 1,19% | 30% | 60x · GO40 · Sempre Novo";
add("Polo","Track","R111Q4",PT,null,"2025-07-11","2025-08-31",4815,0,1500,285,1885,2100,10585,PTX);
add("Polo","Track","R111Q4",PT,null,"2025-09-01","2026-06-30",2900,0,3415,285,1885,2100,10585,PTX);
add("Polo","Track","R111Q4",["26/26"],null,"2026-01-01","2026-06-30",2900,0,3415,285,1885,1215,9700,PTX);
add("Polo","Track","R111Q4",["26/26"],null,"2026-07-01","2026-07-31",4785,0,3415,285,0,1215,9700,PTX);
add("Polo","Track / First Edition","R111Q4 · R11YQ4",["23/23","23/24","24/24","24/25","25/25","25/26"],null,null,"2025-02-28",0,0,1500,0,7165,2850,11515,PTX);
add("Polo","Track / First Edition","R111Q4 · R11YQ4",["23/24","24/24","24/25","25/25","25/26"],null,"2025-03-01","2025-04-10",0,0,1500,0,9080,2850,13430,PTX);
add("Polo","Track / First Edition","R111Q4 · R11YQ4",["23/24","24/24","24/25","25/25","25/26"],null,"2025-04-11","2025-04-30",1915,0,1500,285,7165,2850,13715,PTX);
add("Polo","Track","R111Q4",["23/23","23/24","24/24","24/25","25/25"],null,"2025-05-01","2025-07-10",4815,0,1500,285,4265,2850,13715,PTX);
add("Polo","Track","R111Q4",["25/26"],null,"2025-04-11","2025-06-12",1915,0,1500,285,7165,2850,13715,PTX);
add("Polo","Track","R111Q4",["25/26"],null,"2025-06-13","2025-07-10",4815,0,1500,285,4265,2850,13715,PTX);

/* POLO demais */
const PS=["24/24","24/25","25/25","25/26","26/26"];
add("Polo","Sense","BZ3SK3",PS,null,null,"2026-03-31",0,0,0,0,3000,2000,5000,"0,99% | 50% | 48x · 0% | 80% | 12x · Sempre Novo");
add("Polo","Sense","BZ3SK3",PS,null,"2026-04-01","2026-07-31",3000,2000,0,0,0,0,5000,"0,99% | 50% | 48x · 0% | 80% | 12x · Sempre Novo");
const PHX="0,99% | 50% | 48x · 0% | 80% | 12x · GO40 · Sempre Novo";
add("Polo","Highline","BZ33K3",["24/25","25/25","25/26"],null,null,"2025-06-30",0,0,0,0,11840,1660,13500,PHX);
add("Polo","Highline","BZ33K3",["24/25","25/25","25/26","26/26"],null,"2025-07-01","2026-06-30",7000,0,0,0,4840,1660,13500,PHX);
add("Polo","Highline","BZ33K3",["24/25","25/25","25/26","26/26"],null,"2026-07-01","2026-07-31",11840,0,0,0,0,1660,13500,PHX);
const PA=["23/23","23/24","24/24","24/25","25/25","25/26"];
add("Polo","MPI","BZ38Q4",PA,1,null,null,0,0,2000,0,2500,0,4500,"0% | 80% | 12x · GO40 · Sempre Novo");
add("Polo","MPI","BZ38Q4",PA,2,null,null,0,0,2000,0,1500,0,3500,"0,99% | 30% | 48x · 1,19% | 30% | 60x");
add("Polo","TSI","BZ32K4",PA,null,null,null,0,0,3000,0,3000,0,6000,"0% | 80% | 12x · GO40 · Sempre Novo");
add("Polo","Comfortline","BZ32K3",PA,null,null,null,0,0,0,0,4000,0,4000,"0,99% | 60% | 36x · 0% | 80% | 12x · Sempre Novo");
add("Polo","GTS","BZ39NY",PA,null,null,null,0,0,0,0,0,0,0,"0% | 70% | 18x · 0% | 80% | 12x · GO40 · Sempre Novo");

/* TERA */
const TE=["25/26","26/26"];
add("Tera","MPI","DF12Q4",TE,null,null,"2026-06-30",0,0,3200,1000,2000,1000,7200,"0,99% | 30% | 48x · 0% | 80% | 12x · GO40 · Sempre Novo");
add("Tera","MPI","DF12Q4",TE,null,"2026-07-01","2026-07-31",2000,0,3200,1000,0,1000,7200,"0,99% | 30% | 48x · 0% | 80% | 12x · GO40 · Sempre Novo");
add("Tera","TSI","DF13K4",TE,null,null,null,0,0,0,0,0,0,0,"0,99% | 30% | 48x · 0% | 80% | 12x · GO40");
add("Tera","Comfort TSI AT","DF13K3",TE,null,null,"2026-06-30",0,0,8700,1300,2000,1200,13200,"0% | 60% | 18x · 0,99% | 40% | 48x · GO40");
add("Tera","Comfort TSI AT","DF13K3",TE,null,"2026-07-01","2026-07-31",2000,0,8700,1300,0,1200,13200,"0% | 60% | 18x · 0,99% | 40% | 48x · GO40");
add("Tera","Highline","DF14K3",TE,null,null,"2026-06-30",0,0,11000,2000,2000,1200,16200,"0% | 60% | 18x · 0,99% | 40% | 48x · GO40");
add("Tera","Highline","DF14K3",TE,null,"2026-07-01","2026-07-31",2000,0,11000,2000,0,1200,16200,"0% | 60% | 18x · 0,99% | 40% | 48x · GO40");

/* VIRTUS */
add("Virtus","Sense","BZ4AK4",["24/25","25/25","25/26","26/26"],null,null,null,0,0,0,0,0,0,0,"GO40 · 0,99% | 50% | 48x · 0% | 80% | 12x");
add("Virtus","TSI MT / AT","BZ42K4 · BZ42K3",["24/24","24/25","25/25","25/26","26/26"],null,null,null,0,0,4000,0,1500,1000,6500,"GO40 · 0,99% | 30% | 48x · 0% | 80% | 12x");
const VCX="GO40 · 0% | 60% | 24x · 0,69% | 60% | 36x";
add("Virtus","Comfortline","BZ43BY",["23/24","24/24","24/25","25/25","25/26"],null,null,"2025-05-31",0,0,4000,0,6000,2000,12000,VCX);
add("Virtus","Comfortline","BZ43BY",["23/24","24/24","24/25","25/25"],null,"2025-06-01","2026-07-31",6000,0,4000,2000,0,0,12000,VCX);
add("Virtus","Comfortline","BZ43BY",["25/26"],null,null,"2025-07-13",4000,0,4000,2000,2000,0,12000,VCX);
add("Virtus","Comfortline","BZ43BY",["25/26","26/26"],null,"2025-07-14","2026-07-31",6000,0,4000,2000,0,0,12000,VCX);
const VHX="GO40 · 0% | 60% | 24x";
add("Virtus","Highline","BZ44BY",["24/24","24/25","25/25","25/26"],null,null,"2025-05-31",0,0,5090,0,9410,2000,16500,VHX);
add("Virtus","Highline","BZ44BY",["24/24","24/25","25/25"],null,"2025-06-01","2026-07-31",5000,0,5090,0,4410,2000,16500,VHX);
add("Virtus","Highline","BZ44BY",["25/26"],null,null,"2025-07-13",3000,0,5090,0,6410,2000,16500,VHX);
add("Virtus","Highline","BZ44BY",["25/26","26/26"],null,"2025-07-14","2026-06-30",5000,0,5090,0,4410,2000,16500,VHX);
add("Virtus","Highline","BZ44BY",["25/26","26/26"],null,"2026-07-01","2026-07-31",9410,0,5090,0,0,2000,16500,VHX);
add("Virtus","Exclusive","BZ47NY",["24/24","24/25","25/25","25/26"],null,null,"2025-05-31",0,0,7000,0,5000,2000,14000,VHX);
add("Virtus","Exclusive","BZ47NY",["24/24","24/25","25/25"],null,"2025-06-01","2026-07-31",5000,0,7000,2000,0,0,14000,VHX);
add("Virtus","Exclusive","BZ47NY",["25/26"],null,null,"2025-07-13",3000,0,7000,2000,2000,0,14000,VHX);
add("Virtus","Exclusive","BZ47NY",["25/26","26/26"],null,"2025-07-14","2026-07-31",5000,0,7000,2000,0,0,14000,VHX);

/* NIVUS */
add("Nivus","Sense","CH21BY",["24/25","25/25","25/26","26/26","26/27"],null,null,null,0,0,0,0,0,0,0,"GO40 · 0,99% | 50% | 36x · 0% | 80% | 12x");
const NC1="GO40 · 0,99% | 40% | 48x",NC2="0% | 60% | 24x";
add("Nivus","Comfortline","CH23BY",["24/25","25/26"],1,null,"2025-04-30",0,0,10000,1600,7400,0,19000,NC1);
add("Nivus","Comfortline","CH23BY",["24/25","25/26"],2,null,"2025-04-30",0,0,8000,1600,7400,0,17000,NC2);
add("Nivus","Comfortline","CH23BY",["24/25","25/25"],1,"2025-05-01","2025-12-31",5000,0,10000,1600,2400,0,19000,NC1);
add("Nivus","Comfortline","CH23BY",["24/25","25/25"],2,"2025-05-01","2025-12-31",5000,0,8000,1600,2400,0,17000,NC2);
add("Nivus","Comfortline","CH23BY",["25/26"],1,"2025-05-01","2025-06-12",2000,0,10000,1600,5400,0,19000,NC1);
add("Nivus","Comfortline","CH23BY",["25/26"],2,"2025-05-01","2025-06-12",2000,0,8000,1600,5400,0,17000,NC2);
add("Nivus","Comfortline","CH23BY",["25/26"],1,"2025-06-13","2025-12-31",5000,0,10000,1600,2400,0,19000,NC1);
add("Nivus","Comfortline","CH23BY",["25/26"],2,"2025-06-13","2025-12-31",5000,0,8000,1600,2400,0,17000,NC2);
add("Nivus","Comfortline","CH23BY",["24/25","25/25","25/26","26/26","26/27"],1,"2026-01-01","2026-07-31",7400,0,10000,1600,0,0,19000,NC1);
add("Nivus","Comfortline","CH23BY",["24/25","25/25","25/26","26/26","26/27"],2,"2026-01-01","2026-07-31",7400,0,8000,1600,0,0,17000,NC2);
const NH1="GO40 · 0,99% | 40% | 48x",NH2="0% | 60% | 30x";
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],1,null,"2025-04-30",0,0,10000,2500,17500,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],2,null,"2025-04-30",0,0,8000,2500,17500,0,28000,NH2);
add("Nivus","Highline","CH24BY",["24/25","25/25"],1,"2025-05-01","2025-07-13",13000,0,10000,2500,4500,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25"],2,"2025-05-01","2025-07-13",13000,0,8000,2500,4500,0,28000,NH2);
add("Nivus","Highline","CH24BY",["25/26"],1,"2025-05-01","2025-06-30",10000,0,10000,2500,7500,0,30000,NH1);
add("Nivus","Highline","CH24BY",["25/26"],2,"2025-05-01","2025-06-30",10000,0,8000,2500,7500,0,28000,NH2);
add("Nivus","Highline","CH24BY",["25/26"],1,"2025-07-01","2025-07-13",13000,0,10000,2500,4500,0,30000,NH1);
add("Nivus","Highline","CH24BY",["25/26"],2,"2025-07-01","2025-07-13",13000,0,8000,2500,4500,0,28000,NH2);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],1,"2025-07-14","2025-07-31",14800,0,10000,2500,2700,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],2,"2025-07-14","2025-07-31",14800,0,8000,2500,2700,0,28000,NH2);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],1,"2025-08-01","2025-11-30",12800,0,10000,2500,4700,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],2,"2025-08-01","2025-11-30",12800,0,8000,2500,4700,0,28000,NH2);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],1,"2025-12-01","2025-12-31",14800,0,10000,2500,2700,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26"],2,"2025-12-01","2025-12-31",14800,0,8000,2500,2700,0,28000,NH2);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26","26/26","26/27"],1,"2026-01-01","2026-07-31",17500,0,10000,2500,0,0,30000,NH1);
add("Nivus","Highline","CH24BY",["24/25","25/25","25/26","26/26","26/27"],2,"2026-01-01","2026-07-31",17500,0,8000,2500,0,0,28000,NH2);
add("Nivus","GTS","CH29NY",["25/26","26/26","26/27"],null,null,null,0,0,16000,0,0,0,16000,"GO40 · 0% | 70% | 18x");

/* T-CROSS */
add("T-Cross","Seleção (pacote PSB/PS2/PS3)","BF3PB3",["26/26"],null,null,null,0,0,0,0,0,0,0,"0% | 60% | 18x · 0,99% | 40% | 48x");
add("T-Cross","Sense","BF3PB3",["24/25","25/26","26/26"],null,null,null,0,0,0,0,0,0,0,"0% | 70% | 18x");
const TC1="GO40 · 0,99% | 40% | 48x · 0% | 80% | 12x",TC2="0% | 60% | 24x";
add("T-Cross","200 TSI","BF32B3",["24/25","25/26"],1,null,"2025-04-30",0,0,9500,2000,10000,0,21500,TC1);
add("T-Cross","200 TSI","BF32B3",["24/25","25/26"],2,null,"2025-04-30",0,0,6500,2000,10000,0,18500,TC2);
add("T-Cross","200 TSI","BF32B3",["25/26"],1,"2025-05-01","2025-06-30",2000,0,9500,2000,8000,0,21500,TC1);
add("T-Cross","200 TSI","BF32B3",["25/26"],2,"2025-05-01","2025-06-30",2000,0,6500,2000,8000,0,18500,TC2);
add("T-Cross","200 TSI","BF32B3",["24/25","25/25"],1,"2025-05-01","2025-12-31",5000,0,9500,0,5000,2000,21500,TC1);
add("T-Cross","200 TSI","BF32B3",["24/25","25/25"],2,"2025-05-01","2025-12-31",5000,0,6500,0,5000,2000,18500,TC2);
add("T-Cross","200 TSI","BF32B3",["25/26"],1,"2025-07-01","2025-12-31",5000,0,9500,0,5000,2000,21500,TC1);
add("T-Cross","200 TSI","BF32B3",["25/26"],2,"2025-07-01","2025-12-31",5000,0,6500,0,5000,2000,18500,TC2);
add("T-Cross","200 TSI","BF32B3",["24/25","25/25","25/26","26/26"],1,"2026-01-01","2026-06-30",7500,0,9500,0,2500,2000,21500,TC1);
add("T-Cross","200 TSI","BF32B3",["24/25","25/25","25/26","26/26"],2,"2026-01-01","2026-06-30",7500,0,6500,0,2500,2000,18500,TC2);
add("T-Cross","200 TSI","BF32B3",["24/25","25/25","25/26","26/26"],1,"2026-07-01","2026-07-31",0,0,9500,0,0,2000,11500,TC1,"Realinhamento de preço");
add("T-Cross","200 TSI","BF32B3",["24/25","25/25","25/26","26/26"],2,"2026-07-01","2026-07-31",0,0,6500,0,0,2000,8500,TC2,"Realinhamento de preço");
add("T-Cross","Rock in Rio","BF32B3 · PAO",["26/26"],1,"2026-06-01","2026-06-30",7500,0,9500,0,2730,2000,21730,TC1);
add("T-Cross","Rock in Rio","BF32B3 · PAO",["26/26"],2,"2026-06-01","2026-06-30",7500,0,6500,0,2730,2000,18730,TC2);
add("T-Cross","Rock in Rio","BF32B3 · PAO",["26/26"],1,"2026-07-01","2026-07-31",0,0,9500,0,230,2000,11730,TC1,"Realinhamento de preço");
add("T-Cross","Rock in Rio","BF32B3 · PAO",["26/26"],2,"2026-07-01","2026-07-31",0,0,6500,0,230,2000,8730,TC2,"Realinhamento de preço");
const TCC="GO40 · 0% | 60% | 30x";
add("T-Cross","Comfortline","BF33B3",["25/26"],null,null,"2025-04-30",0,0,8500,0,23500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["24/25","25/25"],null,"2025-05-01","2025-06-25",7000,0,8500,0,21000,2500,39000,TCC);
add("T-Cross","Comfortline","BF33B3",["24/25","25/25"],null,"2025-06-26","2025-06-30",11500,0,8500,0,16500,2500,39000,TCC);
add("T-Cross","Comfortline","BF33B3",["25/26"],null,"2025-05-01","2025-06-25",4000,0,8500,0,19500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["24/25","25/25"],null,"2025-07-01","2025-11-30",7000,0,8500,0,16500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["25/26"],null,"2025-06-26","2025-11-30",7000,0,8500,0,16500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["24/25","25/25","25/26"],null,"2025-12-01","2025-12-31",13000,0,8500,0,10500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["24/25","25/25","25/26","26/26"],null,"2026-01-01","2026-06-30",16000,0,8500,0,7500,2500,34500,TCC);
add("T-Cross","Comfortline","BF33B3",["26/26"],null,"2026-07-01","2026-07-22",11000,0,8500,0,2500,2500,24500,TCC,"Realinhamento de preço");
add("T-Cross","Comfortline","BF33B3",["26/26"],null,"2026-07-23","2026-07-31",13500,0,8500,0,0,2500,24500,TCC);
const TCH="GO40 · 0% | 60% | 30x";
add("T-Cross","Highline","BF34N3",["24/25","25/25","25/26"],null,"2025-01-01","2025-04-30",0,0,11500,0,20800,2000,34300,TCH,"Também vale para faturados até 17.11.2024");
add("T-Cross","Highline","BF34N3",["25/26"],null,"2025-05-01","2025-06-30",6000,0,11500,0,14800,2000,34300,TCH);
add("T-Cross","Highline","BF34N3",["24/25","25/25"],null,"2025-05-01","2025-06-30",10000,0,11500,0,10800,2000,34300,TCH);
add("T-Cross","Highline","BF34N3",["24/25","25/25","25/26"],null,"2025-07-01","2025-12-31",10000,0,11500,0,10800,2000,34300,TCH);
add("T-Cross","Highline","BF34N3",["24/25","25/25","25/26","26/26"],null,"2026-01-01","2026-06-30",13300,0,11500,0,7500,2000,34300,TCH);
add("T-Cross","Highline","BF34N3",["26/26"],null,"2026-07-01","2026-07-22",8300,0,11500,0,2500,2000,24300,TCH,"Realinhamento de preço");
add("T-Cross","Highline","BF34N3",["26/26"],null,"2026-07-23","2026-07-31",10800,0,11500,0,0,2000,24300,TCH);
add("T-Cross","Extreme","BF3XN3",["25/26"],null,"2025-01-01","2025-04-30",0,0,11500,0,21000,2000,34500,TCH,"Também vale para faturados até 17.11.2024");
add("T-Cross","Extreme","BF3XN3",["25/26"],null,"2025-05-01","2025-06-30",6000,0,11500,0,15000,2000,34500,TCH);
add("T-Cross","Extreme","BF3XN3",["25/26"],null,"2025-07-01","2025-12-31",10000,0,11500,0,11000,2000,34500,TCH);
add("T-Cross","Extreme","BF3XN3",["25/26","26/26"],null,"2026-01-01","2026-06-30",13500,0,11500,0,7500,2000,34500,TCH);
add("T-Cross","Extreme","BF3XN3",["26/26"],null,"2026-07-01","2026-07-22",8500,0,11500,0,2500,2000,24500,TCH,"Realinhamento de preço");
add("T-Cross","Extreme","BF3XN3",["26/26"],null,"2026-07-23","2026-07-31",11000,0,11500,0,0,2000,24500,TCH);

/* TAOS */
const TA="GO40 · 0% | 60% | 24x · 0,69% | 40% | 36x";
add("Taos","Highline (geração anterior)","CQ14LY",["23/24","24/24"],null,"2024-02-01","2024-10-09",0,0,0,0,35500,6500,42000,TA);
add("Taos","Highline (geração anterior)","CQ14LY",["23/23","23/24","24/24"],null,"2024-10-10","2025-02-06",21000,6500,0,0,14500,0,42000,TA);
add("Taos","Highline (geração anterior)","CQ14LY",["23/23","23/24","24/24"],null,"2025-02-07","2025-03-31",26000,6500,0,0,9500,0,42000,TA);
add("Taos","Comfortline","CQ13LZ",["25/25"],null,"2025-04-01","2025-05-31",11000,6500,10000,0,7500,0,35000,TA);
add("Taos","Comfortline","CQ13LZ",["25/25"],null,"2025-06-01","2025-11-17",5000,0,10000,0,7500,6500,29000,TA);
add("Taos","Comfortline","CQ13LZ",["25/25"],null,"2025-11-18","2026-05-31",9500,6500,10000,0,3000,0,29000,TA);
add("Taos","Highline","CQ14LZ",["25/25"],null,"2025-04-01","2026-05-31",20000,6500,13000,0,9500,0,49000,TA,"⚠ Validade a conferir: provável 31.05.2025");
add("Taos","Highline","CQ14LZ",["25/25"],null,"2025-06-01","2025-11-17",10000,0,13000,0,9500,6500,39000,TA);
add("Taos","Highline","CQ14LZ",["25/25"],null,"2025-11-18","2026-05-31",19500,6500,13000,0,0,0,39000,TA);
add("Taos","Comfortline (novo)","CL23LZ",["25/26","26/26"],null,null,null,0,0,10000,0,3000,3000,16000,"GO40 · 0% | 50% | 24x · 0,69% | 50% | 36x");
add("Taos","Highline (novo)","CL24LZ",["25/26","26/26"],null,null,null,0,0,13000,3000,0,0,16000,"GO40 · 0% | 50% | 24x · 0,69% | 50% | 36x");

/* JETTA / TIGUAN / SAVEIRO / AMAROK */
add("Jetta","GLI (novo)","BU59VZ",["25/26","26/26"],null,null,"2026-07-12",0,0,0,0,20000,2000,22000,"GO40 · 0% | 60% | 18x");
add("Jetta","GLI (novo)","BU59VZ",["25/26","26/26"],null,"2026-07-13","2026-07-31",0,0,0,0,0,2000,2000,"GO40 · 0% | 60% | 18x","Realinhamento de preço");
add("Tiguan","Nova Tiguan","RM14QJ",["26/26"],null,null,null,0,0,0,0,0,0,0,"0% | 80% | 12x · 0,99% | 60% | 24x · GO40");
const TG=["23/24","24/24","24/25"],TG1="0,49% | 60% | 24x",TG2="0% | 60% | 24x";
add("Tiguan","All Space","BJ25VS",TG,1,null,"2025-04-30",0,0,11000,0,35000,5000,51000,TG1);
add("Tiguan","All Space","BJ25VS",TG,2,null,"2025-04-30",0,0,0,0,35000,5000,40000,TG2);
add("Tiguan","All Space","BJ25VS",TG,1,"2025-05-01","2025-08-07",9000,5000,11000,0,26000,0,51000,TG1);
add("Tiguan","All Space","BJ25VS",TG,2,"2025-05-01","2025-08-07",9000,5000,0,0,26000,0,40000,TG2);
add("Tiguan","All Space","BJ25VS",TG,1,"2025-08-08","2025-09-30",20000,5000,11000,0,15000,0,51000,TG1);
add("Tiguan","All Space","BJ25VS",TG,2,"2025-08-08","2025-09-30",20000,5000,0,0,15000,0,40000,TG2);
add("Tiguan","All Space","BJ25VS",TG,1,"2025-10-01","2026-07-31",35000,5000,11000,0,0,0,51000,TG1);
add("Tiguan","All Space","BJ25VS",TG,2,"2025-10-01","2026-07-31",35000,5000,0,0,0,0,40000,TG2);
const SV="0,99% | 50% | 36x · 0% | 80% | 12x";
add("Saveiro","Robust SC","5URNU4",["25/25","25/26","26/26"],null,null,"2026-02-08",0,0,4000,0,12000,0,16000,SV);
add("Saveiro","Robust SC","5URNU4",["26/26","26/27"],null,"2026-02-09","2026-07-31",12000,0,4000,0,0,0,16000,SV,"Desconto em nota e bônus varejo de R$ 12.000 válidos até 30/09/2026");
add("Saveiro","Trendline SC / Robust DC","5URTU4 · 5UKNU4",["25/25","25/26","26/26","26/27"],null,null,null,0,0,4000,0,0,0,4000,SV);
add("Saveiro","Extreme","5UK8U4",["25/25","25/26","26/26","26/27"],null,null,null,0,0,8000,0,0,0,8000,SV);
const AM=["24/25","25/25","25/26","26/26"],AMX="0% | 60% | 24x · 0% | 80% | 12x";
add("Amarok","Highline","AGDC8A",AM,null,null,null,0,0,40000,0,0,0,40000,AMX);
add("Amarok","Extreme","AGDD8A",AM,null,null,null,0,0,45000,0,0,0,45000,AMX);

  return REGRAS;
}
function novaPoliticaGerente(){
  return { nome:"Julho 2026 (política inicial de exemplo)", dataCarregada: todayISO(), regras: regrasBaseGerente() };
}


let ultimoResultadoGerente = null;
function inicializarEstadoGerente(){
  state.gerente = state.gerente || {};
  if (!state.gerente.politica) state.gerente.politica = novaPoliticaGerente();
  state.gerente.historico = state.gerente.historico || [];
  state.gerente.regrasConfig = state.gerente.regrasConfig || {
    paginasExcluir: [],
    instrucoesExtras: "Desconsiderar cards de ofertas com foto do carro (peças de propaganda, não regras).\nDesconsiderar participação rede (valores em vermelho na circular) — ela não entra em nenhum cálculo.",
    ignorarAntes2026: true,
  };
  state.gerente.est = state.gerente.est || {modelo:"", versao:"", ano:"", fat:"", dias:null, preco:0, usado:0, gerPct:3, op:null};
}

function renderGerentePoliticaAtualBox(){
  const p = state.gerente.politica;
  document.getElementById("gerentePoliticaAtualBox").innerHTML = p ? `
    <b>📌 Política atual</b><br>${p.nome}<br>${p.regras.length} regras · carregada em ${fmtDate(p.dataCarregada)}
  ` : `Nenhuma política carregada ainda.`;
}
function renderGerenteForm(){
  const p = state.gerente.politica;
  const est = state.gerente.est;
  const modelos = [...new Set(p.regras.map(r=>r.m))].sort();
  const sel = document.getElementById("g-modelo");
  sel.innerHTML = '<option value="">—</option>'+modelos.map(m=>`<option>${m}</option>`).join("");
  if (est.modelo && modelos.includes(est.modelo)){ sel.value = est.modelo; popVersoesG(); }
  document.getElementById("g-dias").value = est.dias!=null ? est.dias : "";
  document.getElementById("g-fat").value = est.fat || "";
  // Nunca reescreve um campo de moeda que está com foco (usuário digitando):
  // um re-render disparado por realtime/outro evento no meio da digitação não
  // pode resetar valor/cursor do campo (era a causa do valor "tremendo").
  const campoPreco = document.getElementById("g-preco");
  if (document.activeElement !== campoPreco) campoPreco.value = est.preco ? NUMFG(est.preco) : "";
  const campoUsado = document.getElementById("g-usado");
  if (document.activeElement !== campoUsado) campoUsado.value = est.usado ? NUMFG(est.usado) : "";
  document.getElementById("g-ger").value = String(est.gerPct).replace(".",",");
  document.getElementById("g-cor").value = est.cor || "";
  document.getElementById("g-pacotes").value = est.pacotes || "";
  diasEstoqueG();
  calcularGerente();
}
function popVersoesG(){
  const p = state.gerente.politica;
  const est = state.gerente.est;
  const vs = [...new Set(p.regras.filter(r=>r.m===est.modelo).map(chaveVersaoG))];
  const s = document.getElementById("g-versao");
  s.innerHTML = '<option value="">—</option>'+vs.map(v=>`<option value="${v.replace(/"/g,"&quot;")}">${v.split(" · ").slice(1).join("  ·  ")}</option>`).join("");
  s.disabled = !est.modelo;
  if (est.versao && vs.includes(est.versao)){ s.value = est.versao; popAnosG(); }
  else { est.versao=""; document.getElementById("g-ano").disabled=true; document.getElementById("g-ano").innerHTML=""; }
}
function popAnosG(){
  const p = state.gerente.politica;
  const est = state.gerente.est;
  const regrasVersao = p.regras.filter(r=>chaveVersaoG(r)===est.versao);
  const codigoPorAno = {};
  regrasVersao.forEach(r=> r.am.forEach(a=>{ if(!codigoPorAno[a]) codigoPorAno[a] = r.c; }));
  const anos = [...new Set(regrasVersao.flatMap(r=>r.am))].sort();
  const s = document.getElementById("g-ano");
  s.innerHTML = '<option value="">—</option>'+anos.map(a=>`<option value="${a}">${a}${codigoPorAno[a]?"  ·  "+codigoPorAno[a]:""}</option>`).join("");
  s.disabled = false;
  if (est.ano && anos.includes(est.ano)) s.value = est.ano; else est.ano = "";
}
const HOJE_G = (()=>{ const d=new Date(); d.setHours(12,0,0,0); return d; })();
function diasEstoqueG(){
  const el = document.getElementById("g-dias-estoque");
  const est = state.gerente.est;
  if (!est.fat){ el.textContent = "Calculada a partir dos dias. Se a data do sistema for outra, corrija aqui."; return; }
  const d = Math.round((HOJE_G - dtG(est.fat))/864e5);
  if (d<0){ el.textContent = "Data futura — confira os dias."; return; }
  el.textContent = `Faturado em ${dtG(est.fat).toLocaleDateString("pt-BR")}, contando de hoje (${HOJE_G.toLocaleDateString("pt-BR")}).`;
}

function buscarG(){
  const est = state.gerente.est;
  const p = state.gerente.politica;
  if (!est.versao || !est.ano || !est.fat) return [];
  const f = dtG(est.fat);
  return p.regras.filter(r=>{
    if (chaveVersaoG(r)!==est.versao) return false;
    if (!r.am.includes(est.ano)) return false;
    if (r.de && f<dtG(r.de)) return false;
    if (r.ate && f>dtG(r.ate)) return false;
    return true;
  });
}
function linhaG(rot, val, cls, marca){
  return `<div class="g-lin ${cls||""} ${!val?"nula":""}">
    <span class="rotulo">${rot}${marca?` <span style="font-size:9.5px;font-weight:800;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:${marca[1]==='g'?'var(--orange-tint)':'var(--green-bg)'};color:${marca[1]==='g'?'var(--orange-deep)':'var(--green)'};">${marca[0]}</span>`:""}</span>
    <span class="val">${val?moneyFmt(val):"—"}</span></div>`;
}
// REGRA FIXA DE NEGÓCIO (permanente, não depende da política importada):
// Polo Track e Tera MPI sempre têm desconto de gerente travado em 2%.
// Depende de "m" ser o modelo puro ("Polo"/"Tera") e "v" conter o nome da versão
// ("Track"/"MPI") — nunca o código —, conforme a regra fixa de exibição do app.
const REGRAS_DESCONTO_GERENTE_FIXO = [
  { m:"Polo", vContem:"track", pct:2 },
  { m:"Tera", vContem:"mpi", pct:2 },
];
function descontoGerenteFixo(reg){
  const m = (reg.m||"").trim().toLowerCase();
  const v = (reg.v||"").trim().toLowerCase();
  const achado = REGRAS_DESCONTO_GERENTE_FIXO.find(r => m===r.m.toLowerCase() && v.includes(r.vContem));
  return achado ? achado.pct : null;
}
function atualizarCampoDescontoGerenteUI(gerPctFixo){
  const campo = document.getElementById("g-ger");
  const nota = document.getElementById("g-ger-nota");
  if (gerPctFixo!=null){
    campo.value = String(gerPctFixo).replace(".",",");
    campo.disabled = true;
    campo.title = "Travado pela regra fixa da loja para este modelo/versão.";
    nota.textContent = `🔒 Travado em ${String(gerPctFixo).replace(".",",")}% — regra fixa da loja pra esse modelo/versão.`;
    nota.style.color = "var(--orange-deep)";
    nota.style.fontWeight = "700";
  } else {
    campo.disabled = false;
    campo.title = "";
    campo.value = String(state.gerente.est.gerPct).replace(".",",");
    nota.textContent = "Calculado sobre o valor já com desconto de nota fiscal e bônus varejo.";
    nota.style.color = "";
    nota.style.fontWeight = "";
  }
}
function calcularGerente(){
  const est = state.gerente.est;
  const box = document.getElementById("g-box-opcoes"), alvo = document.getElementById("gerenteResultadoConteudo");
  const achadas = buscarG();

  const ops = [...new Set(achadas.filter(r=>r.op).map(r=>r.op))].sort();
  if (ops.length>1){
    box.hidden = false;
    if (!est.op) est.op = ops[0];
    const linhasPorOp = ops.map(o=>achadas.find(x=>x.op===o));
    // Cada opção usa SEMPRE a taxa (r.tx) e o trade-in (r.ti) da sua PRÓPRIA linha
    // de regra — nunca um "split" adivinhado por posição/contagem de chips. Essa
    // é a mesma fonte de verdade usada mais abaixo, no cálculo central, quando uma
    // opção é selecionada (reg = achadas.find(op===est.op)) — garante que o painel
    // esquerdo nunca mostre uma taxa vinculada a um trade-in que não é o dela.
    document.getElementById("g-opcoes").innerHTML = ops.map((o,idx)=>{
      const r = linhasPorOp[idx];
      return `<div class="g-opt ${est.op===o?'sel':''}" data-op="${o}">
        <span class="t">${r.tx||"—"}</span><span class="v">trade-in ${BRL0G(r.ti)}</span></div>`;
    }).join("");
    document.querySelectorAll("#g-opcoes .g-opt").forEach(el=>{
      el.addEventListener("click", ()=>{ est.op = +el.dataset.op; calcularGerente(); persist(); });
    });
  } else { box.hidden = true; est.op = null; }

  if (!est.versao || !est.ano || !est.fat){
    document.getElementById("btnImprimirResultadoGerente").style.display = "none";
    document.getElementById("g-ger-valor").value = ""; atualizarCampoDescontoGerenteUI(null);
    ultimoResultadoGerente = null;
    alvo.innerHTML = `<div class="empty">Preencha o veículo ao lado. Modelo, versão, ano e data de faturamento definem qual regra se aplica.</div>`;
    return;
  }
  if (!achadas.length){
    document.getElementById("btnImprimirResultadoGerente").style.display = "none";
    document.getElementById("g-ger-valor").value = ""; atualizarCampoDescontoGerenteUI(null);
    ultimoResultadoGerente = null;
    alvo.innerHTML = `<div class="g-aviso"><b>Nenhuma regra cobre essa combinação</b>
      Não há ação para ${est.versao.split(" · ").slice(1).join(" ")} ${est.ano} faturado em ${dtG(est.fat).toLocaleDateString("pt-BR")}.
      Confira o ano modelo e a data, ou veja se a política tem uma lacuna nessa faixa.</div>`;
    return;
  }

  const cands = ops.length>1 ? achadas.filter(r=>r.op===est.op) : achadas;
  const reg = cands[0], conflito = cands.length>1;

  // REGRA FIXA DE NEGÓCIO: Polo Track e Tera MPI sempre têm desconto de gerente travado em 2%,
  // independente do que estiver digitado no campo — vale pra qualquer política carregada.
  const gerPctFixo = descontoGerenteFixo(reg);
  const gerPctEfetivo = gerPctFixo!=null ? gerPctFixo : est.gerPct;
  atualizarCampoDescontoGerenteUI(gerPctFixo);

  const bonusVW = reg.nf + reg.ti + reg.bv;
  const naNota = est.preco - reg.nf;
  const subtotal1 = naNota;                 // depois do desconto em nota fiscal
  const subtotal2 = subtotal1 - reg.bv;      // depois do bônus varejo
  // desconto de gerente incide sobre o valor JÁ COM desconto de nota fiscal e bônus varejo — não sobre o preço de tabela
  const descGer = subtotal2 * (gerPctEfetivo/100);
  document.getElementById("g-ger-valor").value = est.preco ? NUMFG(descGer) : "";
  const precoFim = subtotal2 - descGer;
  const credito = est.usado + reg.ti;
  const saldo = precoFim - credito;

  let avisos = "";
  if (gerPctFixo!=null) avisos += `<div class="g-aviso info"><b>🔒 Desconto de gerente travado em ${String(gerPctFixo).replace(".",",")}%</b>Regra fixa da loja: ${reg.m} ${reg.v} sempre usa ${String(gerPctFixo).replace(".",",")}% de desconto de gerente, não importa o que estiver no campo ao lado.</div>`;
  if (conflito) avisos += `<div class="g-aviso"><b>Duas regras se aplicam a esse veículo</b>A política tem faixas de faturamento sobrepostas aqui. Está sendo usada a primeira; confira no histórico de políticas antes de fechar.</div>`;
  if (reg.obs) avisos += `<div class="g-aviso amarelo"><b>${reg.obs.startsWith("⚠")?"Verificar":"Observação"}</b>${reg.obs.replace("⚠ ","")}</div>`;

  const rede = reg.rede||0;
  const somaComp = reg.nf+reg.ti+reg.bv;
  const bate = Math.abs(somaComp+rede-reg.tot)<1;
  const cor = bate ? "var(--text-dim)" : "var(--red)";

  const taxasParsed = parseTaxasElegiveis(reg.tx).sort((a,b)=>{
    const ra = parseFloat(String(a.taxa).replace("%","").replace(",",".")) || 0;
    const rb = parseFloat(String(b.taxa).replace("%","").replace(",",".")) || 0;
    return ra-rb; // melhor taxa (menor juros) primeiro
  });

  document.getElementById("btnImprimirResultadoGerente").style.display = "inline-block";
  ultimoResultadoGerente = { est:{...est}, reg, bonusVW, naNota, subtotal1, subtotal2, precoFim, credito, saldo, descGer, conflito, rede, bate, taxasParsed, gerPctEfetivo, gerPctFixo };

  const chipsHTML = taxasParsed.length ? taxasParsed.map(t=>`<span class="g-taxa-chip">${t.label}</span>`).join("") :
    (reg.tx ? reg.tx.split(" · ").map(t=>`<span class="g-taxa-chip">${t}</span>`).join("") : '<span class="g-taxa-chip">—</span>');

  let blocosNegociacaoPorTaxa = "";
  if (est.preco){
    const listaTaxas = taxasParsed.length ? taxasParsed : [null];
    blocosNegociacaoPorTaxa = listaTaxas.map((t,i)=>{
      const tituloTaxa = t ? `${i===0?"🥇 Melhor taxa":"💳 Opção "+(i+1)}: ${t.taxa} de juros · entrada mínima ${String(t.entradaPct).replace(".",",")}% · ${t.prazo}` : "💳 Sem taxa cadastrada nessa regra";
      const entradaNecessaria = t ? precoFim * (t.entradaPct/100) : 0;
      const faltaEntrada = entradaNecessaria - credito;
      return `
      <div class="g-etapa g-bloco-taxa">
        <div class="g-etapa-titulo" style="font-size:12px;">${tituloTaxa}</div>
        ${t ? `
          ${linhaG(`Entrada mínima exigida (${String(t.entradaPct).replace(".",",")}% do preço final)`, entradaNecessaria)}
          ${linhaG("Já garantido (valor do usado + trade-in)", credito, "abate", ["cliente","g"])}
          ${faltaEntrada>0.5
            ? linhaG("Falta para completar a entrada", faltaEntrada, "ger", ["falta","g"])
            : `<div class="g-lin abate"><span class="rotulo">Entrada já coberta — sobra pro financiamento</span><span class="val">${moneyFmt(Math.abs(faltaEntrada))}</span></div>`}
        ` : `<div class="nota-g">O cliente pode pagar à vista — nenhuma taxa se aplica.</div>`}
        <div class="g-etapa-total">Saldo a pagar nessa opção: <b>${moneyFmt(Math.abs(saldo))}</b></div>
      </div>`;
    }).join("");
  }

  alvo.innerHTML = `
  ${avisos}
  <div class="g-resumo">
    <div><div class="rot">Bônus da fábrica</div><div class="n">${BRL0G(bonusVW)}</div>
      <div class="peq">NF ${BRL0G(reg.nf)} · trade ${BRL0G(reg.ti)} · varejo ${BRL0G(reg.bv)}</div></div>
    <div><div class="rot">Total na circular</div><div class="n" style="color:${cor}">${BRL0G(reg.tot)}</div>
      <div class="peq" style="color:${cor}">${bate?(rede?"inclui "+BRL0G(rede)+" de participação rede, fora do cálculo":"sem participação rede"):"não bate — confira a regra"}</div></div>
    <div><div class="rot">Regra aplicada</div><div class="peq" style="margin-top:5px;line-height:1.45;">${reg.m} ${reg.v}${est.cor?" · "+est.cor:""}<br>${est.ano} · fat. ${dtG(est.fat).toLocaleDateString("pt-BR")}${est.pacotes?"<br>🧩 "+est.pacotes:""}</div></div>
  </div>

  ${est.preco ? `
  <div class="g-etapa">
    <div class="g-etapa-titulo">1️⃣ Desconto em Nota Fiscal</div>
    ${linhaG("Preço de tabela", est.preco)}
    ${linhaG("− Desconto em nota fiscal", reg.nf, "abate", ["fábrica","f"])}
    <div class="g-etapa-total">Total após NF: <b>${moneyFmt(subtotal1)}</b></div>
  </div>

  <div class="g-etapa">
    <div class="g-etapa-titulo">2️⃣ Bônus Varejo</div>
    ${linhaG("Subtotal (após NF)", subtotal1)}
    ${linhaG("− Bônus varejo", reg.bv, "abate", ["fábrica","f"])}
    <div class="g-etapa-total">Total após bônus: <b>${moneyFmt(subtotal2)}</b></div>
  </div>

  <div class="g-etapa g-etapa-final">
    <div class="g-etapa-titulo">3️⃣ Desconto de Gerente</div>
    ${linhaG("Subtotal (após bônus)", subtotal2)}
    ${linhaG(`− Desconto de gerente (${String(gerPctEfetivo).replace(".",",")}%)`, descGer, "ger", [gerPctFixo!=null?"fixo":"você","g"])}
    <div class="g-preco-final">Preço Final ao Cliente<span>${moneyFmt(precoFim)}</span></div>
  </div>

  <div class="g-etapa">
    <div class="g-etapa-titulo">🚙 Carro do Cliente</div>
    ${linhaG("Valor pago no usado", est.usado)}
    ${linhaG("+ Trade-in da ação", reg.ti, "abate", ["fábrica","f"])}
    <div class="g-etapa-total">Crédito do usado: <b>${moneyFmt(credito)}</b></div>
  </div>

  ${blocosNegociacaoPorTaxa}

  <div class="g-fecho">
    <div class="rot">${saldo>=0?"Saldo a pagar pelo cliente":"A devolver ao cliente"}<br><span style="font-size:10px;font-weight:500;opacity:.8;">preço final − carro do cliente</span></div>
    <div class="num ${saldo<0?"neg":""}">${moneyFmt(Math.abs(saldo))}</div>
  </div>` : `
  <div style="color:var(--text-dim);font-size:13px;padding:10px 0;">
    Informe o preço de tabela para ver o desconto de gerente, o preço final e o saldo.<br>
    O trade-in dessa regra é <b>${moneyFmt(reg.ti)}</b> e entra no crédito do usado.
  </div>`}

  <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-light);">
    <div style="font-size:11px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px;">Taxas elegíveis <span style="font-weight:500;text-transform:none;">— detalhadas acima, uma negociação por taxa</span></div>
    ${chipsHTML}
    <div class="nota-g" style="margin-top:8px;">Formato: taxa | entrada mínima | prazo. Se o cliente for pagar à vista, nenhuma taxa se aplica.</div>
  </div>`;
}

function imprimirResultadoGerente(){
  const r = ultimoResultadoGerente;
  if (!r){ alert("Calcule um resultado antes de imprimir."); return; }
  const { est, reg, bonusVW, naNota, subtotal1, subtotal2, precoFim, credito, saldo, descGer, conflito, rede, bate, gerPctEfetivo, gerPctFixo } = r;
  const vendedor = (state.config && state.config.vendedor) || "";
  const linhaImp = (rot, val, corTxt)=> `<tr><td>${rot}</td><td style="text-align:right;${corTxt?`color:${corTxt};`:''}">${val!=null?moneyFmt(val):"—"}</td></tr>`;
  const listaTaxasImp = (r.taxasParsed && r.taxasParsed.length) ? r.taxasParsed : [null];
  const blocosPaginasImp = listaTaxasImp.map((t,i)=>{
    const tituloTaxa = t ? `${i===0?"🥇 Melhor Taxa":"💳 Opção "+(i+1)}: ${t.taxa} de juros · entrada mínima ${String(t.entradaPct).replace(".",",")}% · ${t.prazo}` : "💳 Sem taxa cadastrada nessa regra (à vista)";
    const entradaNecessaria = t ? precoFim * (t.entradaPct/100) : 0;
    const faltaEntrada = entradaNecessaria - credito;
    const blocoEntradaImp = t ? `
    <div class="tit">Entrada — ${tituloTaxa}</div>
    <table>
      ${linhaImp(`Entrada mínima exigida (${String(t.entradaPct).replace(".",",")}%)`, entradaNecessaria)}
      ${linhaImp("Já garantido (usado + trade-in)", credito, "#1FA463")}
      ${faltaEntrada>0.5 ? linhaImp("Falta para completar a entrada", faltaEntrada, "#9E0000") : linhaImp("Entrada já coberta — sobra", Math.abs(faltaEntrada), "#1FA463")}
    </table>` : `<div class="aviso">Cliente pagando à vista — nenhuma taxa se aplica.</div>`;

    return `
    <div class="pagina-taxa" ${i>0 ? 'style="page-break-before:always;"' : ''}>
      <h1>🤵 Gerente Smart — Simulação de Negociação</h1>
      <div class="sub">Motomecânica Volkswagen de Lajeado ${vendedor?"— "+vendedor:""} · ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR").slice(0,5)}${listaTaxasImp.length>1?` · Página ${i+1} de ${listaTaxasImp.length}`:""}</div>

      <div class="tit" style="margin-top:0;background:#171717;color:#fff;padding:8px 10px;border-radius:6px;">${tituloTaxa}</div>

      ${conflito?`<div class="aviso"><b>Atenção:</b> mais de uma regra cobre esse veículo nessa data — confira a política antes de fechar.</div>`:""}
      ${reg.obs?`<div class="aviso">${reg.obs.replace("⚠ ","")}</div>`:""}

      <div class="resumo">
        <div><div class="rot">Veículo</div><div class="n" style="font-size:13px;">${reg.m} ${reg.v}${est.cor?" · "+est.cor:""}</div></div>
        <div><div class="rot">Ano modelo</div><div class="n">${est.ano}</div></div>
        <div><div class="rot">Faturamento</div><div class="n" style="font-size:13px;">${dtG(est.fat).toLocaleDateString("pt-BR")}</div></div>
        <div><div class="rot">Bônus da fábrica</div><div class="n">${moneyFmt(bonusVW)}</div></div>
      </div>
      ${est.pacotes?`<div style="font-size:11.5px;color:#666;margin:-10px 0 14px;">🧩 Pacotes: ${est.pacotes}</div>`:""}

      ${est.preco ? `
      <div class="etapa">
        <div class="tit" style="margin-top:0;">1️⃣ Desconto em Nota Fiscal</div>
        <table>
          ${linhaImp("Preço de tabela", est.preco)}
          ${linhaImp("− Desconto em nota fiscal", reg.nf, "#1FA463")}
        </table>
        <div class="etapa-total">Total após NF: <b>${moneyFmt(subtotal1)}</b></div>
      </div>
      <div class="etapa">
        <div class="tit" style="margin-top:0;">2️⃣ Bônus Varejo</div>
        <table>
          ${linhaImp("Subtotal (após NF)", subtotal1)}
          ${linhaImp("− Bônus varejo", reg.bv, "#1FA463")}
        </table>
        <div class="etapa-total">Total após bônus: <b>${moneyFmt(subtotal2)}</b></div>
      </div>
      <div class="etapa etapa-final">
        <div class="tit" style="margin-top:0;">3️⃣ Desconto de Gerente</div>
        <table>
          ${linhaImp("Subtotal (após bônus)", subtotal2)}
          ${linhaImp(`− Desconto de gerente (${String(gerPctEfetivo).replace(".",",")}%)${gerPctFixo!=null?" 🔒":""}`, descGer, "#9E0000")}
        </table>
        <div class="preco-final">Preço Final ao Cliente<b>${moneyFmt(precoFim)}</b></div>
      </div>

      <div class="tit">Carro do cliente</div>
      <table>
        ${linhaImp("Valor pago no usado", est.usado)}
        ${linhaImp("+ Trade-in da ação", reg.ti, "#1FA463")}
        ${linhaImp("= Crédito do usado", credito)}
      </table>

      ${blocoEntradaImp}

      <div class="fecho">
        <div>${saldo>=0?"Saldo a pagar pelo cliente":"A devolver ao cliente"}<br><span style="font-size:10px;opacity:.75;">preço final − carro do cliente</span></div>
        <div class="num">${moneyFmt(Math.abs(saldo))}</div>
      </div>` : `<div class="aviso">Preço de tabela não informado nessa simulação.</div>`}

      <div style="font-size:10.5px;color:#888;margin-top:12px;">Total impresso na circular: ${moneyFmt(reg.tot)}${rede?` (inclui ${moneyFmt(rede)} de participação rede, fora do cálculo)`:""}${!bate?" — atenção: os valores não batem, confira a regra na política.":""}</div>
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Simulação — ${reg.m} ${reg.v}</title>
    <style>
      @page{ size:A4; margin:14mm; }
      *{ box-sizing:border-box; }
      body{ font-family:Arial, Helvetica, sans-serif; color:#171717; margin:0; }
      h1{ font-size:19px; margin:0 0 2px; }
      .sub{ color:#666; font-size:11.5px; margin-bottom:16px; }
      table{ width:100%; border-collapse:collapse; font-size:13px; margin-bottom:6px; border:1.5px solid #B8B8B8; border-radius:6px; overflow:hidden; }
      td{ padding:8px 10px; border-bottom:1.5px solid #B8B8B8; }
      tr:last-child td{ border-bottom:none; }
      tr:nth-child(even) td{ background:#F2F2EF; }
      td:first-child{ border-right:1px solid #D8D8D5; font-weight:600; color:#333; }
      td:last-child{ font-weight:800; }
      .tit{ font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.4px; color:#9E0000; margin:16px 0 6px; }
      .resumo{ display:flex; gap:0; border:1.5px solid #B8B8B8; border-radius:8px; overflow:hidden; margin-bottom:16px; }
      .resumo div{ flex:1; padding:10px 12px; border-right:1.5px solid #B8B8B8; }
      .resumo div:last-child{ border-right:none; }
      .resumo .rot{ font-size:9.5px; text-transform:uppercase; color:#888; font-weight:700; }
      .resumo .n{ font-size:16px; font-weight:800; margin-top:3px; }
      .etapa{ background:#FAFAF8; border:1.5px solid #B8B8B8; border-radius:8px; padding:12px 14px; margin-bottom:12px; }
      .etapa-total{ text-align:right; font-size:13px; padding-top:6px; border-top:1.5px solid #B8B8B8; margin-top:2px; }
      .etapa-final{ background:#FBEEED; border-color:#9E0000; }
      .preco-final{ text-align:right; border-top:2px solid #9E0000; margin-top:10px; padding-top:10px; font-size:11px; font-weight:800; text-transform:uppercase; color:#666; }
      .preco-final b{ display:block; font-size:26px; color:#9E0000; margin-top:2px; }
      .fecho{ margin-top:16px; background:#1a1a1a; color:#fff; padding:14px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; }
      .fecho .num{ font-size:24px; font-weight:800; }
      .taxas{ font-size:12px; margin-top:6px; }
      .aviso{ background:#FFF3DA; border-left:3px solid #C98A12; padding:8px 10px; font-size:11.5px; margin-bottom:10px; }
      .pagina-taxa{ min-height:0; }
    </style>
  </head><body>${blocosPaginasImp}</body></html>`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}
/* ============================= BANCO VW — PRÊMIO DE FINANCIAMENTO ============================= */
const TABELAS_BANCO_VW = {
  "15": { nome:"15", regraPropria:false },
  "TaxaZero": { nome:"Taxa Zero", regraPropria:false },
  "50": { nome:"50", regraPropria:false },
  "75": { nome:"75", regraPropria:false },
  "120": { nome:"120", regraPropria:false },
  "Combate": { nome:"Combate", regraPropria:false },
  "100": { nome:"100", regraPropria:true, porPonto:100, pctFinanciado:0.005 },
  "150": { nome:"150", regraPropria:true, porPonto:100, pctFinanciado:0.01 },
};
function inicializarEstadoBancoVW(){
  state.bancoVW = state.bancoVW || [];
  state.bancoVWEst = state.bancoVWEst || { vendaOrigemId:"", tabela:"15", valor:0, pontos:0 };
}
function calcularPremioBancoVW(tabelaKey, valorFinanciado, pontos){
  const tab = TABELAS_BANCO_VW[tabelaKey];
  if (tab.regraPropria){
    const porPontos = pontos * tab.porPonto;
    const porFinanciado = valorFinanciado * tab.pctFinanciado;
    return { premio: porPontos+porFinanciado, detalhes:{ tipo:"propria", porPontos, porFinanciado, pctFinanciado:tab.pctFinanciado } };
  }
  let baseCrua = valorFinanciado < 50000 ? 100 : (valorFinanciado < 100000 ? 125 : 150);
  const abaixoDeUmPonto = pontos < 1;
  const base = abaixoDeUmPonto ? baseCrua*0.75 : baseCrua;
  const porPontos = pontos*100;
  const bonus = pontos>=2.5 ? 100 : (pontos>=1.25 ? 50 : 0);
  const premio = base + porPontos + bonus;
  return { premio, detalhes:{ tipo:"faixa", baseCrua, base, abaixoDeUmPonto, porPontos, bonus } };
}
function renderTabelaNotaBancoVW(){
  const tabelaKey = document.getElementById("bv-tabela").value;
  const tab = TABELAS_BANCO_VW[tabelaKey];
  const nota = document.getElementById("bv-tabela-nota");
  if (tab.regraPropria){
    nota.textContent = `Regra própria: R$100 por ponto + ${(tab.pctFinanciado*100).toFixed(1).replace(".",",")}% do valor financiado.`;
  } else {
    nota.textContent = "Regra por faixa: base conforme o valor financiado + R$100 por ponto + bônus (não cumulativo).";
  }
}
function popularOrigemVendaBancoVW(){
  const sel = document.getElementById("bv-venda-origem");
  const todasVendas = [...filtrarPorVendedor(state.vendas||[])].sort((a,b)=>(b.data||"").localeCompare(a.data||""));
  sel.innerHTML = '<option value="">— Preencher manualmente —</option>' + todasVendas.map(v=>
    `<option value="${v.id}">${fmtDate(v.data)} · ${v.cliente||"—"} · ${v.carro||""} ${v.modelo||""}${v.pontuacao?" · "+Number(v.pontuacao).toFixed(2)+" pts":""}</option>`
  ).join("");
}

let ultimoResultadoBancoVW = null;
function calcularEExibirBancoVW(){
  const est = state.bancoVWEst;
  const alvo = document.getElementById("bvResultadoConteudo");
  const btnImprimir = document.getElementById("btnImprimirPremioBancoVW");
  const aplicarWrap = document.getElementById("bv-aplicar-wrap");
  if (!est.valor && !est.pontos){
    alvo.innerHTML = `<div class="empty">Preencha o valor financiado e os pontos do contrato pra calcular o prêmio.</div>`;
    btnImprimir.style.display = "none";
    aplicarWrap.style.display = "none";
    ultimoResultadoBancoVW = null;
    return;
  }
  const tabelaKey = est.tabela;
  const tab = TABELAS_BANCO_VW[tabelaKey];
  const { premio, detalhes } = calcularPremioBancoVW(tabelaKey, est.valor, est.pontos);
  aplicarWrap.style.display = est.vendaOrigemId ? "block" : "none";
  ultimoResultadoBancoVW = { est:{...est}, tabelaNome:tab.nome, premio, detalhes };
  btnImprimir.style.display = "inline-block";

  let corpo = "";
  if (detalhes.tipo==="propria"){
    corpo = `
      <div class="g-etapa">
        <div class="g-etapa-titulo">Tabela ${tab.nome} — regra própria</div>
        ${linhaG(`Pontos × R$100 (${String(est.pontos).replace(".",",")} × 100)`, detalhes.porPontos)}
        ${linhaG(`${(detalhes.pctFinanciado*100).toFixed(1).replace(".",",")}% do valor financiado`, detalhes.porFinanciado)}
      </div>`;
  } else {
    corpo = `
      <div class="g-etapa">
        <div class="g-etapa-titulo">Base pela faixa do valor financiado</div>
        ${linhaG("Base cheia", detalhes.baseCrua)}
        ${detalhes.abaixoDeUmPonto ? linhaG("Ajuste (75% — contrato com menos de 1 ponto)", detalhes.base, "ger", ["ajuste","g"]) : `<div class="g-lin"><span class="rotulo">Sem ajuste (1 ponto ou mais)</span><span class="val">${moneyFmt(detalhes.base)}</span></div>`}
      </div>
      <div class="g-etapa">
        <div class="g-etapa-titulo">Pontos e bônus</div>
        ${linhaG(`Pontos × R$100 (${String(est.pontos).replace(".",",")} × 100)`, detalhes.porPontos)}
        ${detalhes.bonus>0 ? linhaG(`Bônus (${est.pontos>=2.5?"2,50 pts ou mais":"1,25 pt ou mais"})`, detalhes.bonus, "abate", ["bônus","f"]) : `<div class="g-lin nula"><span class="rotulo">Sem bônus (precisa de 1,25 ponto ou mais)</span><span class="val">—</span></div>`}
      </div>`;
  }

  alvo.innerHTML = `
    <div class="g-resumo">
      <div><div class="rot">Tabela</div><div class="n" style="font-size:16px;">${tab.nome}</div></div>
      <div><div class="rot">Valor Financiado</div><div class="n" style="font-size:16px;">${moneyFmt(est.valor)}</div></div>
      <div><div class="rot">Pontos do Contrato</div><div class="n" style="font-size:16px;">${String(est.pontos).replace(".",",")}</div></div>
    </div>
    ${corpo}
    <div class="g-etapa g-etapa-final" style="border-color:#1C8FC9;background:#EAF4FC;">
      <div class="g-preco-final" style="border-top-color:#1C8FC9;">
        Prêmio do Vendedor<span style="color:#0B2E4E;">${moneyFmt(premio)}</span>
      </div>
    </div>`;
}
function renderTblBancoVW(){
  const lista = [...filtrarPorVendedor(state.bancoVW||[])].sort((a,b)=>(b.data||"").localeCompare(a.data||""));
  document.getElementById("bvHistoricoResumo").textContent = lista.length
    ? `${lista.length} ${lista.length===1?"prêmio":"prêmios"} · total ${moneyFmt(lista.reduce((s,x)=>s+x.premio,0))}`
    : "";
  const tbody = document.querySelector("#tblBancoVW tbody");
  const tfoot = document.querySelector("#tblBancoVW tfoot");
  if (!lista.length){
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum prêmio salvo ainda.</td></tr>`;
    tfoot.innerHTML = "";
    return;
  }
  tbody.innerHTML = lista.map(x=>`
    <tr>
      <td>${fmtDate(x.data)}</td>
      <td class="left">${x.origem||"—"}</td>
      <td>${x.tabelaNome}</td>
      <td>${moneyFmt(x.valor)}</td>
      <td>${String(x.pontos).replace(".",",")}</td>
      <td><b>${moneyFmt(x.premio)}</b></td>
      <td><button class="danger" onclick="delPremioBancoVW('${x.id}')" title="Excluir">✕</button></td>
    </tr>`).join("");
  const totalPremio = lista.reduce((s,x)=>s+x.premio,0);
  tfoot.innerHTML = `<tr><td colspan="5">TOTAL</td><td>${moneyFmt(totalPremio)}</td><td></td></tr>`;
}
function delPremioBancoVW(id){
  if (!confirm("Excluir este prêmio do histórico?")) return;
  const item = (state.bancoVW||[]).find(x=>x.id===id);
  state.bancoVW = state.bancoVW.filter(x=>x.id!==id);
  if (item && item.origemVendaId) resetarRetornoBancoDaVenda(item.origemVendaId);
  persist(); renderAll(); // não só renderTblBancoVW() — a comissão/gráficos/extrato também precisam refletir o valor zerado
}
function imprimirPremioBancoVW(){
  const r = ultimoResultadoBancoVW;
  if (!r){ alert("Calcule um prêmio antes de imprimir."); return; }
  const vendedor = (state.config && state.config.vendedor) || "";
  const linhaImp = (rot, val, corTxt)=> `<tr><td>${rot}</td><td style="text-align:right;${corTxt?`color:${corTxt};`:''}">${val!=null?moneyFmt(val):"—"}</td></tr>`;
  let corpo = "";
  if (r.detalhes.tipo==="propria"){
    corpo = `<table>
      ${linhaImp(`Pontos × R$100`, r.detalhes.porPontos)}
      ${linhaImp(`${(r.detalhes.pctFinanciado*100).toFixed(1).replace(".",",")}% do valor financiado`, r.detalhes.porFinanciado)}
    </table>`;
  } else {
    corpo = `<table>
      ${linhaImp("Base pela faixa", r.detalhes.baseCrua)}
      ${r.detalhes.abaixoDeUmPonto ? linhaImp("Ajuste (75%)", r.detalhes.base, "#9E0000") : ""}
      ${linhaImp("Pontos × R$100", r.detalhes.porPontos)}
      ${r.detalhes.bonus>0 ? linhaImp("Bônus", r.detalhes.bonus, "#1FA463") : ""}
    </table>`;
  }
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Prêmio Banco VW</title>
    <style>
      @page{ size:A4; margin:14mm; } *{box-sizing:border-box;}
      body{ font-family:Arial, Helvetica, sans-serif; color:#171717; margin:0; }
      h1{ font-size:19px; margin:0 0 2px; }
      .sub{ color:#666; font-size:11.5px; margin-bottom:16px; }
      table{ width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px; }
      td{ padding:6px 4px; border-bottom:1px solid #eee; }
      .resumo{ display:flex; border:1px solid #E1E3E8; border-radius:8px; overflow:hidden; margin-bottom:16px; }
      .resumo div{ flex:1; padding:10px 12px; border-right:1px solid #E1E3E8; }
      .resumo div:last-child{ border-right:none; }
      .resumo .rot{ font-size:9.5px; text-transform:uppercase; color:#888; font-weight:700; }
      .resumo .n{ font-size:16px; font-weight:800; margin-top:3px; }
      .fecho{ margin-top:16px; background:#0B2E4E; color:#fff; padding:14px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; }
      .fecho .num{ font-size:26px; font-weight:800; }
    </style>
  </head><body>
    <h1>🏦 Banco VW — Prêmio do Vendedor</h1>
    <div class="sub">Motomecânica Volkswagen de Lajeado ${vendedor?"— "+vendedor:""} · ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR").slice(0,5)}</div>
    <div class="resumo">
      <div><div class="rot">Tabela</div><div class="n">${r.tabelaNome}</div></div>
      <div><div class="rot">Valor Financiado</div><div class="n">${moneyFmt(r.est.valor)}</div></div>
      <div><div class="rot">Pontos</div><div class="n">${String(r.est.pontos).replace(".",",")}</div></div>
    </div>
    ${corpo}
    <div class="fecho"><div>Prêmio do Vendedor</div><div class="num">${moneyFmt(r.premio)}</div></div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}
/* ============================= DOCUMENTOS ============================= */
const DOC_PROCESSOS_PROCURACAO = [
  "Alteração de Características do Veículo","Inclusão de Restrição Financeira",
  "Liberação de Restrição Financeira","Reserva de Placa",
  "Alteração de restrição financeira","Solicitação de aut. para alt. Características",
  "Alteração de endereço de entrega","Solicitação de autorização para Remarcação de Chassi",
  "Licença especial de Trânsito","Correção de informações do veículo",
  "Solicitação de cópia do CRLV","Solicitação de Certidão",
  "Baixa Simples de veículo","Solicitação de Cópia de documentos",
  "Baixa para outra UF","Solicitação de Vistoria",
  "Mudança para placa única","Correção de Restrições",
  "Primeiro Emplacamento","Correção de Município",
  "Alteração de informações do Proprietário","Cancelamento de Processo",
  "Alteração de informações do Veículo","Restrição por Transferência",
  "Transferência de propriedade veículo outra UF","Correção de informações do proprietário",
  "Transferência de propriedade de veículo do RS","Comunicação de venda",
  "Troca de município de veículo de outra UF","Correção de chassi",
  "Troca de município de veículo do RS","2ª via do CRV/CRLV",
  "Fornecimento de Placa de Experiência ou de Fabricante","2ª via do CRLV",
  "Renovação de placa de experiência ou de fabricante","Outros",
];
const DOC_PROCURADORES_FIXOS = [
  { nome:"MEIDE MARIA DIEDRICH", cpf:"629.097.890-04" },
  { nome:"LUCIANA DE ANDRADE", cpf:"680.961.430-34" },
  { nome:"MARLEI DIEDRICH", cpf:"944.598.780-20" },
  { nome:"FABRICIO HENRIQUE BALD", cpf:"038.861.330-01" },
  { nome:"ELISANDRA DIEDRICH", cpf:"826.991.270-00" },
];
/* ============================= FIPE & DETRAN ============================= */
/* ============================= PRODUTOS DO FINANCIAMENTO ============================= */
const PRODUTOS_FINANCIAMENTO = [
  { grupo:"Seguro", key:"seguro_basico", nome:"Seguro Básico", pontos:0.75 },
  { grupo:"Seguro", key:"seguro_normal", nome:"Seguro Normal", pontos:1 },
  { grupo:"Seguro", key:"seguro_plus", nome:"Seguro Plus", pontos:1.5 },
  { grupo:"Outros", key:"outros_gap", nome:"GAP", pontos:0.25 },
  { grupo:"Outros", key:"outros_ap", nome:"AP", pontos:0.15 },
  { grupo:"Outros", key:"outros_franquia", nome:"Franquia", pontos:0.25 },
  { grupo:"Garantia Estendida Essencial", key:"garantia_essencial_6", nome:"Essencial 6 meses", pontos:0.25 },
  { grupo:"Garantia Estendida Essencial", key:"garantia_essencial_12", nome:"Essencial 12 meses", pontos:0.5 },
  { grupo:"Garantia Estendida Essencial", key:"garantia_essencial_24", nome:"Essencial 24 meses", pontos:1 },
  { grupo:"Garantia Estendida Total", key:"garantia_total_6", nome:"Total 6 meses", pontos:0.25 },
  { grupo:"Garantia Estendida Total", key:"garantia_total_12", nome:"Total 12 meses", pontos:0.75 },
  { grupo:"Garantia Estendida Total", key:"garantia_total_24", nome:"Total 24 meses", pontos:1.25 },
  { grupo:"Pequenos Reparos", key:"protege_24", nome:"Protege 24 meses", pontos:0.25 },
  { grupo:"Pequenos Reparos", key:"protege_36", nome:"Protege 36 meses", pontos:0.35 },
  { grupo:"Pequenos Reparos", key:"protege_plus_24", nome:"Protege Plus 24 meses", pontos:0.5 },
  { grupo:"Pequenos Reparos", key:"protege_plus_36", nome:"Protege Plus 36 meses", pontos:0.6 },
];
function popularProdutosFinanciamento(){
  const box = document.getElementById("pProdutosFinanciamentoBox");
  if (box.children.length) return; // já populado
  const grupos = [...new Set(PRODUTOS_FINANCIAMENTO.map(p=>p.grupo))];
  box.innerHTML = grupos.map(g=>{
    const itens = PRODUTOS_FINANCIAMENTO.filter(p=>p.grupo===g);
    return `<div style="margin-bottom:10px;">
      <div style="font-size:10px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px;">${g}</div>
      <div class="doc-check-grid">
        ${itens.map(p=>`<label><input type="checkbox" class="prod-financ-chk" data-key="${p.key}" data-pontos="${p.pontos}"> ${p.nome} <span style="color:var(--orange-deep);font-weight:800;">(${String(p.pontos).replace(".",",")})</span></label>`).join("")}
      </div>
    </div>`;
  }).join("");
  document.querySelectorAll(".prod-financ-chk").forEach(chk=>{
    chk.addEventListener("change", atualizarTotalProdutosFinanciamento);
  });
}
function atualizarTotalProdutosFinanciamento(){
  const marcados = [...document.querySelectorAll(".prod-financ-chk:checked")];
  const total = marcados.reduce((s,c)=>s+parseFloat(c.dataset.pontos),0);
  document.getElementById("pProdutosPontosTotal").textContent = total.toFixed(2).replace(".",",").replace(/,00$/,"").replace(/(,\d)0$/,"$1");
}
function coletarProdutosFinanciamentoSelecionados(){
  return [...document.querySelectorAll(".prod-financ-chk:checked")].map(c=>c.dataset.key);
}
function marcarProdutosFinanciamento(keys){
  document.querySelectorAll(".prod-financ-chk").forEach(c=>{ c.checked = (keys||[]).includes(c.dataset.key); });
  atualizarTotalProdutosFinanciamento();
}

function inicializarEstadoDocumentos(){
  state.documentos = state.documentos || { procuracao:{}, autorizacao:{}, retirada:{}, pedidovd:{} };
}
function popularProcessosProcuracao(){
  const box = document.getElementById("doc-proc-processos");
  if (!box || box.children.length) return; // já populado
  box.innerHTML = DOC_PROCESSOS_PROCURACAO.map((p,i)=>
    `<label><input type="checkbox" class="doc-proc-processo-chk" data-idx="${i}"> ${p}</label>`
  ).join("");
}
function abrirDocumentos(){
  document.getElementById("configDropdown").classList.remove("open");
  const btn = document.querySelector('nav button[data-view="config"]');
  document.querySelectorAll("nav button[data-view]").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-documentos").classList.add("active");
  popularProcessosProcuracao();
  carregarCamposDocumentos();
}

const DOC_CAMPOS_SIMPLES = {
  procuracao: ["proc-nome","proc-cpf","proc-ci","proc-veiculo","proc-chassi","proc-placas","proc-data","proc-endereco","proc-tel","proc-email"],
  autorizacao: ["aut-nome","aut-rg","aut-cpf","aut-veiculo","aut-marca","aut-anofab","aut-anomod","aut-cor","aut-chassi","aut-placa","aut-terc-nome","aut-terc-rg","aut-terc-cpf","aut-data"],
  retirada: ["ret-nome","ret-rg","ret-cpf","ret-veiculo","ret-chassi","ret-data"],
  pedidovd: ["vd-nome","vd-cpf","vd-cnpjmatriz","vd-ie","vd-uf","vd-qtd","vd-modelo","vd-cor","vd-opcionais","vd-desconto","vd-preco","vd-pep-motivo","vd-comp1-nome","vd-comp1-cpf","vd-comp2-nome","vd-comp2-cpf","vd-test-nome","vd-test-cpf","vd-vendedor-nome","vd-vendedor-cpf"],
};
function salvarCamposDocumentos(){
  state.documentos = state.documentos || {};
  Object.keys(DOC_CAMPOS_SIMPLES).forEach(doc=>{
    state.documentos[doc] = state.documentos[doc] || {};
    DOC_CAMPOS_SIMPLES[doc].forEach(id=>{
      const el = document.getElementById("doc-"+id);
      if (el) state.documentos[doc][id] = el.value;
    });
  });
  state.documentos.procuracao.semtel = document.getElementById("doc-proc-semtel").checked;
  state.documentos.procuracao.sememail = document.getElementById("doc-proc-sememail").checked;
  state.documentos.procuracao.autoriza = document.getElementById("doc-proc-autoriza").value;
  state.documentos.procuracao.processos = [...document.querySelectorAll(".doc-proc-processo-chk:checked")].map(c=>+c.dataset.idx);
  state.documentos.pedidovd.pagamento = document.getElementById("doc-vd-pagamento").value;
  state.documentos.pedidovd.clausula = document.getElementById("doc-vd-clausula").value;
  state.documentos.pedidovd.pep = document.getElementById("doc-vd-pep").value;
  persist();
}
function carregarCamposDocumentos(){
  state.documentos = state.documentos || {};
  Object.keys(DOC_CAMPOS_SIMPLES).forEach(doc=>{
    const dados = state.documentos[doc] || {};
    DOC_CAMPOS_SIMPLES[doc].forEach(id=>{
      const el = document.getElementById("doc-"+id);
      if (el && dados[id]!=null) el.value = dados[id];
    });
  });
  const p = state.documentos.procuracao || {};
  document.getElementById("doc-proc-semtel").checked = !!p.semtel;
  document.getElementById("doc-proc-sememail").checked = !!p.sememail;
  if (p.autoriza) document.getElementById("doc-proc-autoriza").value = p.autoriza;
  (p.processos||[]).forEach(idx=>{
    const chk = document.querySelector(`.doc-proc-processo-chk[data-idx="${idx}"]`);
    if (chk) chk.checked = true;
  });
  const vd = state.documentos.pedidovd || {};
  if (vd.pagamento) document.getElementById("doc-vd-pagamento").value = vd.pagamento;
  if (vd.clausula) document.getElementById("doc-vd-clausula").value = vd.clausula;
  if (vd.pep) document.getElementById("doc-vd-pep").value = vd.pep;
  // pré-preenche o responsável pela venda com o nome configurado, se ainda vazio
  if (!document.getElementById("doc-vd-vendedor-nome").value && state.config.vendedor){
    document.getElementById("doc-vd-vendedor-nome").value = state.config.vendedor;
  }
}
function abrirJanelaImpressaoDoc(titulo, corpoHtml){
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${titulo}</title>
    <style>
      @page{ size:A4; margin:18mm; }
      *{ box-sizing:border-box; }
      body{ font-family:Arial, Helvetica, sans-serif; color:#171717; margin:0; font-size:13px; line-height:1.6; }
      h1{ font-size:15px; text-align:center; margin:0 0 4px; text-transform:uppercase; letter-spacing:.5px; }
      h2{ font-size:12px; text-align:center; margin:0 0 20px; color:#444; font-weight:600; }
      .campo{ display:inline-block; border-bottom:1px solid #171717; min-width:120px; padding:0 4px; font-weight:600; }
      .linha{ margin-bottom:10px; }
      table{ width:100%; border-collapse:collapse; margin:12px 0; font-size:12px; }
      th, td{ border:1px solid #999; padding:6px 8px; text-align:left; }
      th{ background:#f0f0f0; font-size:10.5px; text-transform:uppercase; }
      .assinaturas{ margin-top:50px; display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; }
      .assinatura-box{ flex:1; min-width:180px; text-align:center; }
      .assinatura-linha{ border-top:1px solid #171717; margin-top:46px; padding-top:6px; font-size:11.5px; }
      .aviso-legal{ font-size:11px; color:#333; text-align:justify; margin-top:14px; }
      .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; }
      .chk-list{ columns:2; column-gap:24px; font-size:11px; margin:10px 0; }
      .chk-list div{ break-inside:avoid; margin-bottom:3px; }
    </style>
  </head><body>${corpoHtml}</body></html>`;
  const w = window.open("", "_blank");
  if (!w){ alert("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.focus(); w.print(); }, 350);
}

function renderBancoVWView(){
  popularOrigemVendaBancoVW();
  const est = state.bancoVWEst;
  document.getElementById("bv-venda-origem").value = est.vendaOrigemId || "";
  document.getElementById("bv-tabela").value = est.tabela || "15";
  document.getElementById("bv-valor").value = est.valor ? NUMFG(est.valor) : "";
  document.getElementById("bv-pontos").value = est.pontos ? String(est.pontos).replace(".",",") : "";
  renderTabelaNotaBancoVW();
  calcularEExibirBancoVW();
  renderTblBancoVW();
}


/* ===== Regra Atual ===== */
function renderRegraPaginasBox(){
  const lista = state.gerente.regrasConfig.paginasExcluir;
  document.getElementById("regraPaginasBox").innerHTML = lista.length ? lista.map((f,i)=>`
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--text-dim);">Da página</span>
      <input type="number" min="1" value="${f.de||''}" style="width:80px;" onchange="atualizarFaixaPagina(${i},'de',this.value)">
      <span style="font-size:12px;color:var(--text-dim);">até a página</span>
      <input type="number" min="1" value="${f.ate||''}" style="width:80px;" onchange="atualizarFaixaPagina(${i},'ate',this.value)">
      <button type="button" class="danger" onclick="removerFaixaPagina(${i})" title="Remover">✕</button>
    </div>`).join("") : `<div class="empty" style="padding:10px;">Nenhuma faixa de página excluída ainda.</div>`;
}
function atualizarFaixaPagina(i, campo, valor){
  state.gerente.regrasConfig.paginasExcluir[i][campo] = +valor || null;
}
function removerFaixaPagina(i){
  state.gerente.regrasConfig.paginasExcluir.splice(i,1);
  renderRegraPaginasBox();
}
function abrirRegraAtualModal(){
  document.getElementById("regraInstrucoesExtras").value = state.gerente.regrasConfig.instrucoesExtras || "";
  document.getElementById("regraIgnorarAntes2026").checked = state.gerente.regrasConfig.ignorarAntes2026;
  renderRegraPaginasBox();
  document.getElementById("regraAtualModalOverlay").classList.add("open");
}
function fecharRegraAtualModal(){
  document.getElementById("regraAtualModalOverlay").classList.remove("open");
}

/* ===== Histórico de Políticas ===== */
function abrirHistoricoPoliticasModal(){
  renderHistoricoPoliticasModalBox();
  document.getElementById("historicoPoliticasModalOverlay").classList.add("open");
}
function fecharHistoricoPoliticasModal(){
  document.getElementById("historicoPoliticasModalOverlay").classList.remove("open");
}
function renderHistoricoPoliticasModalBox(){
  const hist = [...(state.gerente.historico||[])].reverse();
  const atual = state.gerente.politica;
  document.getElementById("historicoPoliticasBox").innerHTML = `
    <div style="background:var(--orange-tint);border:1px solid var(--orange-deep);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;">
      <b style="color:var(--orange-deep);">🟢 Em uso agora:</b> ${atual.nome} — ${atual.regras.length} regras, carregada em ${fmtDate(atual.dataCarregada)}
    </div>
    ${hist.length ? hist.map(h=>`
      <div style="background:var(--card-tint);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:12.5px;">
        <b>${h.nome}</b><br><span style="color:var(--text-dim);">${h.qtdRegras} regras · carregada em ${fmtDate(h.dataCarregada)}</span>
      </div>`).join("") : `<div class="empty">Nenhuma política anterior neste histórico ainda.</div>`}
  `;
}

/* ===== Leitura de PDF ===== */
const gDz = document.getElementById("gerenteDropzone");
const gInp = document.getElementById("gerenteArquivoPdf");
const gSt = document.getElementById("gerenteStatusLeitura");

function montarEsquemaGerente(){
  const cfg = state.gerente.regrasConfig;
  let extra = "";
  if (cfg.paginasExcluir && cfg.paginasExcluir.length){
    const faixas = cfg.paginasExcluir.filter(f=>f.de&&f.ate).map(f=>`página ${f.de} até ${f.ate}`).join("; ");
    if (faixas) extra += `\nIGNORE completamente o conteúdo das seguintes faixas de página, não leia nem extraia nada delas: ${faixas}.`;
  }
  if (cfg.ignorarAntes2026){
    extra += `\nNão inclua no resultado nenhuma regra cujos anos modelo sejam TODOS anteriores a 2026 (por exemplo, uma linha só com "23/24", "24/24", "24/25", sem nenhum ano 25/26, 26/26, 26/27 ou mais recente). Se uma linha misturar anos antigos e 2026 em diante, inclua normalmente, com todos os anos.`;
  }
  if (cfg.instrucoesExtras && cfg.instrucoesExtras.trim()){
    extra += `\nRegras adicionais definidas pelo usuário, sempre obedeça:\n${cfg.instrucoesExtras.trim()}`;
  }
  return `Devolva SOMENTE um array JSON, sem markdown e sem texto antes ou depois. Cada item:
{"m":modelo,"v":versão,"c":código do modelo,"am":[anos modelo como "24/25"],"op":1 ou 2 ou null,
"de":"AAAA-MM-DD" ou null,"ate":"AAAA-MM-DD" ou null,
"nf":desconto em nota,"ti":trade-in,"bv":bônus varejo,"rede":soma das participações rede da linha,
"tot":o total impresso na coluna Total,"tx":"taxas separadas por · ","obs":""}
Regras: "de"/"ate" são as datas de FATURAMENTO NO ATACADO, não a data de venda no varejo — isso é o que define a validade de cada regra, com base em quantos dias o carro está em estoque.
"op" só é preenchido quando a mesma linha tem 1ª e 2ª opção ligadas a taxas de financiamento diferentes — é a segunda coisa que define o bônus, depois da validade. Quando o cliente for pagar à vista, isso não muda o cálculo.
NUNCA inclua Participação Rede em nf, ti ou bv. Ela aparece em VERMELHO na circular, como
"+ Participação Rede R$ 2.000", e fica fora do cálculo: se o Bônus Varejo mostra
"R$ 7.500 + Participação Rede R$ 2.000", então bv = 7500 e rede = 2000.
Some todas as participações rede da linha no campo "rede".
IGNORE os cards de "Sugestão de anúncio" — a foto do carro com a tarja de oferta ao lado
("a partir de R$ 119.990", "Bônus de até R$ 34.500", "Taxa 0% em 30x"). São peças de
propaganda, não regras, e os números deles não podem entrar em nenhum campo.
Valores em número puro, sem R$ nem ponto de milhar. Ausente = 0. Sem data = null.
REGRA FIXA DE EXIBIÇÃO DO APP (permanente, vale para toda política atual e futura — NUNCA quebre
esta separação):
"m" (Modelo) tem que ser SOMENTE o nome comercial do carro, sem a versão junto — ex: "Polo",
"T-Cross", "Virtus", "Nivus", "Tera", "Taos", "Jetta", "Saveiro", "Amarok", "Tiguan". NUNCA escreva
"Polo Track" ou "T-Cross Sense" no campo "m" — "Track" e "Sense" são versão, não modelo.
"v" (Versão) tem que ser o NOME da versão/acabamento, em texto, nunca o código — ex: "Track",
"Sense", "Comfortline", "Highline", "Extreme", "200 TSI", "GLI", "GTS", "Rock in Rio". NUNCA repita
o código do campo "c" dentro de "v".
"c" (código) é o código interno do modelo (ex: "BF3PB3") e é o ÚNICO campo dos três que pode mudar
de valor entre um ano-modelo e outro dentro da MESMA versão (ex: "T-Cross Sense" 25/26 e 26/26 usam
código BF3PB3, mas 26/27 já usa BF3PB5 — mesmo assim "m" continua "T-Cross" e "v" continua "Sense"
nas duas linhas; só "c" e "am" mudam).
No Gerente Smart o veículo é sempre selecionado nesta ordem, de cima para baixo: 1) Modelo, 2)
Versão, 3) Ano Modelo. O app agrupa a Versão só por "modelo · versão" (sem o código), então toda
versão com o mesmo nome cai num único item da lista de Versão, e o código correto de cada ano
aparece dentro do seletor de Ano Modelo, um nível abaixo. Se "m" ou "v" vierem errados (com
versão dentro do modelo, ou código dentro da versão), esse agrupamento quebra e o mesmo carro
aparece duplicado ou fragmentado por ano — por isso essa separação é obrigatória em toda política,
atual e futura.${extra}`;
}
async function lerPoliticaPdf(file){
  if (file.type!=="application/pdf"){ gSt.innerHTML = '<div class="nota-g" style="color:var(--red);">Só consigo ler PDF.</div>'; return; }
  gSt.innerHTML = '<div class="nota-g">📖 Lendo o PDF… costuma levar cerca de um minuto.</div>';
  try{
    const b64 = await new Promise((res,rej)=>{
      const fr = new FileReader();
      fr.onload = ()=>res(fr.result.split(",")[1]);
      fr.onerror = ()=>rej(new Error("Não consegui abrir o arquivo."));
      fr.readAsDataURL(file);
    });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:4000, messages:[{role:"user", content:[
        {type:"document", source:{type:"base64", media_type:"application/pdf", data:b64}},
        {type:"text", text:"Extraia todas as linhas das tabelas de ações comerciais deste PDF da Volkswagen.\n"+montarEsquemaGerente()}
      ]}]})
    });
    if (!resp.ok) throw new Error("A leitura falhou (HTTP "+resp.status+").");
    const data = await resp.json();
    const txt = data.content.map(i=>i.type==="text"?i.text:"").join("").replace(/```json|```/g,"").trim();
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr) || !arr.length) throw new Error("Não encontrei tabelas de ações nesse PDF.");

    if (state.gerente.politica){
      state.gerente.historico.push({ nome: state.gerente.politica.nome, dataCarregada: state.gerente.politica.dataCarregada, qtdRegras: state.gerente.politica.regras.length });
    }
    state.gerente.politica = {
      nome: file.name.replace(/\.pdf$/i,""),
      dataCarregada: todayISO(),
      regras: arr.map(x=>Object.assign({m:"",v:"",c:"",am:[],op:null,de:null,ate:null,nf:0,ti:0,bv:0,rede:0,tot:0,tx:"",obs:""}, x)),
    };
    state.gerente.est = {modelo:"", versao:"", ano:"", fat:"", dias:null, preco:0, usado:0, gerPct:state.gerente.est.gerPct||3, op:null};
    persist();
    renderGerentePoliticaAtualBox();
    renderGerenteForm();
    gSt.innerHTML = `<div class="nota-g" style="color:var(--green);font-weight:700;">✅ Li ${arr.length} regras de "${file.name}". Já é a política em uso — confira o cálculo antes de fechar negócio.</div>`;
  }catch(e){
    gSt.innerHTML = `<div class="nota-g" style="color:var(--red);"><b>${e.message}</b> A política anterior continua ativa.<br><br>
      Isso é esperado aqui fora do site do Claude. Use "📋 Copiar instruções para o Claude" acima, converse com ele numa aba separada anexando o PDF, peça o arquivo .json, e depois clique em "⬆️ Importar regras (JSON)".</div>`;
  }
}

function popularSeletorMesAno(){
  const selMes = document.getElementById("headerMesSelect");
  const selAno = document.getElementById("headerAnoSelect");
  const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  selMes.innerHTML = nomesMeses.map((nm,i)=>`<option value="${i+1}">${nm}</option>`).join("");
  const anoAtual = new Date().getFullYear();
  const anos = [];
  for (let a=anoAtual-2; a<=anoAtual+2; a++) anos.push(a);
  selAno.innerHTML = anos.map(a=>`<option value="${a}">${a}</option>`).join("");
}
function sincronizarSeletorMesAno(y, m){
  const selMes = document.getElementById("headerMesSelect");
  const selAno = document.getElementById("headerAnoSelect");
  if (selMes.value !== String(m)) selMes.value = String(m);
  if (selAno.value !== String(y)) selAno.value = String(y);
}
function mudarMesRefManual(){
  const m = String(document.getElementById("headerMesSelect").value).padStart(2,"0");
  const y = document.getElementById("headerAnoSelect").value;
  state.config.mesRef = `${y}-${m}`;
  persist();
  renderAll();
}
function atualizarAvisoDiaControle(){
  if (!state) return; // dados ainda não carregados nesta fase do script
  const ds = document.getElementById("cData").value;
  const wrap = document.getElementById("cAvisoDiaWrap");
  if (!ds){ wrap.style.display = "none"; return; }
  const feriado = getFeriado(ds);
  const dow = diaDaSemana0a6(ds);
  if (feriado){
    wrap.style.display = "block";
    wrap.textContent = `📅 ${fmtDate(ds)} é feriado (${feriado.nome} — ${feriado.tipo}). Esse dia não conta como dia útil, e as ligações não entram na meta.`;
  } else if (dow===0){
    wrap.style.display = "block";
    wrap.textContent = `📅 ${fmtDate(ds)} é domingo — não conta como dia útil.`;
  } else if (dow===6){
    wrap.style.display = "block";
    wrap.textContent = `📅 ${fmtDate(ds)} é sábado — conta como dia útil, mas as ligações desse dia não entram no total (você só liga de segunda a sexta).`;
  } else {
    wrap.style.display = "none";
  }
}
function atualizarCamposVenda(){
  const isConsorcio = document.getElementById("vTipo").value === "CONSORCIO";
  document.getElementById("vCarro").required = !isConsorcio;
  document.getElementById("vModelo").required = !isConsorcio;
  document.getElementById("vConsorcioHint").style.display = isConsorcio ? "block" : "none";
  document.getElementById("vValorLabel").textContent = isConsorcio ? "Valor do Consórcio (R$)" : "Valor do Carro (R$)";
  document.getElementById("vVersaoLabel").textContent = isConsorcio ? "Versão / Observação" : "Versão";
}
function atualizarAvisoVersaoAno(){
  const qtdMarcados = document.querySelectorAll('input[name="postCarroSel"]:checked').length;
  const versaoEl = document.getElementById("postVersao");
  const anoEl = document.getElementById("postAno");
  const hint = document.getElementById("postVersaoHint");
  const ativo = qtdMarcados<=1;
  versaoEl.disabled = !ativo;
  anoEl.disabled = !ativo;
  versaoEl.style.opacity = ativo ? 1 : .4;
  anoEl.style.opacity = ativo ? 1 : .4;
  hint.textContent = ativo ? "(só com 1 modelo)" : "⚠️ ignorado — mais de 1 modelo marcado";
  hint.style.color = ativo ? "var(--text-mute)" : "var(--red)";
}
function editarSalario(id){
  const s = state.salarios.find(x=>x.id===id);
  if (!s) return;
  document.getElementById("salEditId").value = s.id;
  document.getElementById("salDia").value = Number(s.data.slice(8,10));
  document.getElementById("salMes").value = Number(s.data.slice(5,7));
  document.getElementById("salAno").value = s.data.slice(0,4);
  document.getElementById("salTipo").value = s.tipo;
  document.getElementById("salValor").value = moneyFmt(s.valor).replace("R$","").trim();
  document.getElementById("salBtnSubmit").textContent = "Salvar alterações";
  document.getElementById("salBtnCancelarEdicao").style.display = "inline-block";
  const formEl = document.getElementById("formSalario");
  if (formEl && typeof formEl.scrollIntoView === "function"){
    formEl.scrollIntoView({behavior:"smooth", block:"start"});
  }
}
function cancelarEdicaoSalario(){
  document.getElementById("salEditId").value = "";
  document.getElementById("salValor").value = "";
  document.getElementById("salBtnSubmit").textContent = "Salvar salário";
  document.getElementById("salBtnCancelarEdicao").style.display = "none";
}