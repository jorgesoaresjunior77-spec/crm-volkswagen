

/* ============================= HELPERS ============================= */
function fmtDate(iso){ if(!iso) return "—"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function diasNoMes(mesRef){ const [y,m]=mesRef.split("-").map(Number); return new Date(y,m,0).getDate(); }

/* ============================= FERIADOS E DIAS ÚTEIS =============================
   Regra de trabalho: segunda a sexta + sábado de manhã. Domingo nunca trabalha.
   Feriados (nacionais, estaduais RS e municipais cadastrados) nunca são dia útil,
   mesmo caindo num sábado. Ligações telefônicas só contam de segunda a sexta. */
function calcularPascoa(ano){
  const a=ano%19, b=Math.floor(ano/100), c=ano%100, d=Math.floor(b/4), e=b%4;
  const f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
  const mes=Math.floor((h+l-7*m+114)/31), dia=((h+l-7*m+114)%31)+1;
  return new Date(ano, mes-1, dia);
}
function addDiasData(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
function dataParaISO(date){ return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); }
function getFeriadosDoAno(ano){
  const pascoa = calcularPascoa(ano);
  const lista = [
    {data:`${ano}-01-01`, nome:"Confraternização Universal", tipo:"Nacional"},
    {data:dataParaISO(addDiasData(pascoa,-47)), nome:"Carnaval (segunda)", tipo:"Facultativo"},
    {data:dataParaISO(addDiasData(pascoa,-46)), nome:"Carnaval (terça)", tipo:"Facultativo"},
    {data:dataParaISO(addDiasData(pascoa,-2)), nome:"Sexta-feira Santa", tipo:"Nacional"},
    {data:`${ano}-04-21`, nome:"Tiradentes", tipo:"Nacional"},
    {data:`${ano}-05-01`, nome:"Dia do Trabalho", tipo:"Nacional"},
    {data:dataParaISO(addDiasData(pascoa,60)), nome:"Corpus Christi", tipo:"Facultativo"},
    {data:`${ano}-09-07`, nome:"Independência do Brasil", tipo:"Nacional"},
    {data:`${ano}-09-20`, nome:"Revolução Farroupilha (RS)", tipo:"Estadual"},
    {data:`${ano}-10-12`, nome:"Nossa Senhora Aparecida", tipo:"Nacional"},
    {data:`${ano}-11-02`, nome:"Finados", tipo:"Nacional"},
    {data:`${ano}-11-15`, nome:"Proclamação da República", tipo:"Nacional"},
    {data:`${ano}-11-20`, nome:"Consciência Negra", tipo:"Nacional"},
    {data:`${ano}-12-25`, nome:"Natal", tipo:"Nacional"},
  ];
  (state.feriadosCustom||[]).filter(f=>f.data && f.data.startsWith(String(ano))).forEach(f=>{
    lista.push({data:f.data, nome:f.nome||"Feriado municipal/regional", tipo:"Municipal"});
  });
  return lista.sort((a,b)=>a.data.localeCompare(b.data));
}
function getFeriado(dataISO){
  const ano = Number(dataISO.slice(0,4));
  return getFeriadosDoAno(ano).find(f=>f.data===dataISO) || null;
}
function diaDaSemana0a6(dataISO){
  const [y,m,d] = dataISO.split("-").map(Number);
  return new Date(y,m-1,d).getDay(); // 0=domingo ... 6=sábado
}
function isDiaUtil(dataISO){
  const dow = diaDaSemana0a6(dataISO);
  if (dow===0) return false; // domingo nunca é dia útil
  if (getFeriado(dataISO)) return false; // feriado nunca é dia útil, mesmo no sábado
  return true; // segunda a sábado, exceto feriado
}
function isDiaComLigacao(dataISO){
  const dow = diaDaSemana0a6(dataISO);
  return isDiaUtil(dataISO) && dow>=1 && dow<=5; // só segunda a sexta, e não feriado
}
function diaUtilAnterior(dataISO){
  let d = new Date(dataISO+"T00:00:00");
  d.setDate(d.getDate()-1);
  let tentativas = 0;
  while (!isDiaUtil(dataParaISO(d)) && tentativas<14){
    d.setDate(d.getDate()-1);
    tentativas++;
  }
  return dataParaISO(d);
}
function diasUteisNoMes(mesRef){
  const dim = diasNoMes(mesRef);
  let count = 0;
  for (let d=1; d<=dim; d++){
    const ds = mesRef+"-"+String(d).padStart(2,"0");
    if (isDiaUtil(ds)) count++;
  }
  return count;
}
function diasComLigacaoNoMes(mesRef){
  const dim = diasNoMes(mesRef);
  let count = 0;
  for (let d=1; d<=dim; d++){
    const ds = mesRef+"-"+String(d).padStart(2,"0");
    if (isDiaComLigacao(ds)) count++;
  }
  return count;
}
function diasUteisRestantesNoMes(mesRef){
  const dim = diasNoMes(mesRef);
  const hoje = new Date();
  const [y,m] = mesRef.split("-").map(Number);
  const ehMesAtual = (hoje.getFullYear()===y && hoje.getMonth()+1===m);
  let count = 0;
  for (let d=1; d<=dim; d++){
    if (ehMesAtual && d < hoje.getDate()) continue; // já passou
    const ds = mesRef+"-"+String(d).padStart(2,"0");
    if (isDiaUtil(ds)) count++;
  }
  return count;
}
function diasUteisDecorridosNoMes(mesRef){
  const hoje = new Date();
  const [y,m] = mesRef.split("-").map(Number);
  const ehMesAtual = (hoje.getFullYear()===y && hoje.getMonth()+1===m);
  const ateODia = ehMesAtual ? hoje.getDate() : diasNoMes(mesRef);
  let count = 0;
  for (let d=1; d<=ateODia; d++){
    const ds = mesRef+"-"+String(d).padStart(2,"0");
    if (isDiaUtil(ds)) count++;
  }
  return count;
}
function feriadosDoMes(mesRef){
  const dim = diasNoMes(mesRef);
  const lista = [];
  for (let d=1; d<=dim; d++){
    const ds = mesRef+"-"+String(d).padStart(2,"0");
    const f = getFeriado(ds);
    if (f) lista.push({...f, diaSemana:["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"][diaDaSemana0a6(ds)]});
  }
  return lista;
}

function diaSemana(iso){
  const d = new Date(iso+"T00:00:00");
  return ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"][d.getDay()];
}
function moneyFmt(v){ return (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }

/* máscara de moeda BR: usuário digita só números, campo formata sozinho como 190.000,00 */
function maskCurrency(el){
  el.addEventListener("input", ()=>{
    let digits = el.value.replace(/\D/g,"");
    if (digits===""){ el.value=""; return; }
    digits = digits.replace(/^0+(?=\d)/,"");
    while (digits.length<3) digits = "0"+digits;
    const cents = digits.slice(-2);
    let intPart = digits.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,".");
    el.value = intPart + "," + cents;
  });
}
function currencyToNumber(str){
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/\./g,"").replace(",","."));
  return isNaN(n) ? 0 : n;
}
function instaGrowthChartSVG(labels, values){
  const w=760, h=220, padL=46, padR=14, padT=18, padB=26;
  const n = labels.length;
  if (n===0 || values.every(v=>v===0)) return `<div class="empty">Sem dados do Instagram cadastrados ainda este mês.</div>`;
  const maxV = Math.max(1, ...values);
  const minV = Math.min(...values);
  const range = Math.max(maxV-minV, 1);
  const stepX = n>1 ? (w-padL-padR)/(n-1) : 0;
  const scaleY = v => h-padB-((v-minV)/range)*(h-padT-padB);
  const pts = values.map((v,i)=>`${(padL+i*stepX).toFixed(1)},${scaleY(v).toFixed(1)}`).join(" ");
  const areaPts = `${padL.toFixed(1)},${(h-padB).toFixed(1)} ${pts} ${(padL+(n-1)*stepX).toFixed(1)},${(h-padB).toFixed(1)}`;
  const lastX = (padL+(n-1)*stepX).toFixed(1);
  const lastY = scaleY(values[n-1]).toFixed(1);
  const skip = n>15 ? Math.ceil(n/10) : 1;
  const xLabels = labels.map((l,i)=> i%skip===0 ? `<text x="${(padL+i*stepX).toFixed(1)}" y="${h-6}" font-size="8.5" text-anchor="middle" fill="#9B948C">${l}</text>` : "").join("");
  const grid = [0,0.5,1].map(f=>{
    const y = h-padB-f*(h-padT-padB);
    const val = Math.round(minV + f*range);
    return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#F0E2D2" stroke-width="1"/>
            <text x="${padL-8}" y="${y+3}" font-size="8.5" text-anchor="end" fill="#9B948C">${val.toLocaleString("pt-BR")}</text>`;
  }).join("");
  const pathLen = 2000;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <defs>
      <linearGradient id="igLineGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#833AB4"/><stop offset="50%" stop-color="#FD1D1D"/><stop offset="100%" stop-color="#FCB045"/>
      </linearGradient>
      <linearGradient id="igAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FD1D1D" stop-opacity="0.28"/><stop offset="100%" stop-color="#FD1D1D" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${areaPts}" fill="url(#igAreaGrad)" class="ig-area"></polygon>
    <polyline points="${pts}" fill="none" stroke="url(#igLineGrad)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" class="ig-line" pathLength="${pathLen}"></polyline>
    <circle cx="${lastX}" cy="${lastY}" r="5" fill="#FD1D1D" class="ig-dot"></circle>
    ${xLabels}
    <style>
      .ig-line{ stroke-dasharray:${pathLen}; stroke-dashoffset:${pathLen}; animation:igDraw 1.4s ease forwards, vizPulseGlow 2.2s ease-in-out infinite 1.4s; }
      .ig-area{ opacity:0; animation:igFade 1.2s ease forwards .6s; }
      .ig-dot{ animation:igPulse 1.6s ease-in-out infinite; }
      @keyframes igDraw{ to{ stroke-dashoffset:0; } }
      @keyframes igFade{ to{ opacity:1; } }
      @keyframes igPulse{ 0%,100%{ r:5; opacity:1; } 50%{ r:8; opacity:.55; } }
    </style>
  </svg>`;
}
/* Gráfico 2: crescimento comparado em % (base = primeiro valor do mês de cada métrica) */
function instaComparChartSVG(labels, seriesArr, colors){
  const w=760, h=210, padL=40, padR=14, padT=18, padB=26;
  const n = labels.length;
  const flat = seriesArr.flat();
  if (n===0 || flat.every(v=>v===0)) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  const maxV = Math.max(0, ...flat), minV = Math.min(0, ...flat);
  const range = Math.max(maxV-minV, 1);
  const stepX = n>1 ? (w-padL-padR)/(n-1) : 0;
  const scaleY = v => h-padB-((v-minV)/range)*(h-padT-padB);
  const zeroY = scaleY(0).toFixed(1);
  const grid = [minV, 0, maxV].map(v=>{
    const y = scaleY(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w-padR}" y2="${y.toFixed(1)}" stroke="#F0E2D2" stroke-width="1"/>
      <text x="${padL-8}" y="${(y+3).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#9B948C">${v.toFixed(0)}%</text>`;
  }).join("");
  const skip = n>15 ? Math.ceil(n/10) : 1;
  const xLabels = labels.map((l,i)=> i%skip===0 ? `<text x="${(padL+i*stepX).toFixed(1)}" y="${h-6}" font-size="8.5" text-anchor="middle" fill="#9B948C">${l}</text>` : "").join("");
  const pathLen = 2000;
  const lines = seriesArr.map((s,si)=>{
    const pts = s.map((v,i)=>`${(padL+i*stepX).toFixed(1)},${scaleY(v).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${colors[si]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"
      pathLength="${pathLen}" style="stroke-dasharray:${pathLen};stroke-dashoffset:${pathLen};animation:icDraw 1.3s ease forwards ${(si*0.25).toFixed(2)}s, vizPulseGlow 2.2s ease-in-out infinite ${(si*0.25+1.3).toFixed(2)}s;"></polyline>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    ${grid}
    <line x1="${padL}" y1="${zeroY}" x2="${w-padR}" y2="${zeroY}" stroke="#C9CDD3" stroke-width="1" stroke-dasharray="3 3"/>
    ${lines}
    ${xLabels}
    <style>@keyframes icDraw{ to{ stroke-dashoffset:0; } }</style>
  </svg>`;
}
/* Gráfico 3: conteúdo publicado (barras) x novos seguidores no dia (linha), escalas normalizadas para comparar picos */
function instaCorrelacaoChartSVG(labels, barVals, lineVals){
  const w=760, h=220, padL=16, padR=16, padT=18, padB=26;
  const n = labels.length;
  if (n===0) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  const areaH = h-padT-padB;
  const maxBar = Math.max(1, ...barVals);
  const maxLine = Math.max(1, ...lineVals.map(v=>Math.abs(v)));
  const stepX = n>0 ? (w-padL-padR)/n : 0;
  const barW = Math.max(stepX*0.46, 2);
  const baseY = h-padB;
  const bars = barVals.map((v,i)=>{
    const bh = (v/maxBar)*areaH*0.85;
    const x = padL+i*stepX+(stepX-barW)/2;
    const y = baseY-bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh,0).toFixed(1)}" fill="#F77737" opacity=".55" rx="2"
      class="corr-bar" style="transform-origin:${x.toFixed(1)}px ${baseY.toFixed(1)}px; animation:corrGrow .6s ease forwards ${(i*0.025).toFixed(2)}s, vizPulseGlow 2.2s ease-in-out infinite ${(i*0.025+0.6).toFixed(2)}s;"></rect>`;
  }).join("");
  const scaleLineY = v => baseY-(Math.max(v,0)/maxLine)*areaH*0.85;
  const pts = lineVals.map((v,i)=>`${(padL+i*stepX+stepX/2).toFixed(1)},${scaleLineY(v).toFixed(1)}`).join(" ");
  const skip = n>15 ? Math.ceil(n/10) : 1;
  const xLabels = labels.map((l,i)=> i%skip===0 ? `<text x="${(padL+i*stepX+stepX/2).toFixed(1)}" y="${h-6}" font-size="8.5" text-anchor="middle" fill="#9B948C">${l}</text>` : "").join("");
  const pathLen = 2000;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    ${bars}
    <polyline points="${pts}" fill="none" stroke="#833AB4" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"
      pathLength="${pathLen}" style="stroke-dasharray:${pathLen};stroke-dashoffset:${pathLen};animation:corrDraw 1.2s ease forwards .5s, vizPulseGlow 2.2s ease-in-out infinite 1.7s;"></polyline>
    ${xLabels}
    <style>
      .corr-bar{ transform:scaleY(0); }
      @keyframes corrGrow{ to{ transform:scaleY(1); } }
      @keyframes corrDraw{ to{ stroke-dashoffset:0; } }
    </style>
  </svg>`;
}
function instaDeltaBarChartSVG(labels, deltas){
  const w=760, h=220, padL=34, padR=14, padT=20, padB=26;
  const n = labels.length;
  if (n===0 || deltas.every(v=>v===0)) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  const maxAbs = Math.max(1, ...deltas.map(v=>Math.abs(v)));
  const areaH = h-padT-padB;
  const zeroY = padT+areaH/2;
  const stepX = (w-padL-padR)/n;
  const barW = Math.max(stepX*0.5, 2);
  const bars = deltas.map((v,i)=>{
    const bh = (Math.abs(v)/maxAbs)*(areaH/2)*0.9;
    const x = padL+i*stepX+(stepX-barW)/2;
    const y = v>=0 ? zeroY-bh : zeroY;
    const cor = v>0 ? "#1FA463" : (v<0 ? "#E23B4E" : "#ccc");
    const labelY = v>=0 ? y-4 : y+bh+12;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh,1).toFixed(1)}" fill="${cor}" rx="2" class="viz-glow"/>
      ${v!==0?`<text x="${(x+barW/2).toFixed(1)}" y="${labelY.toFixed(1)}" font-size="8.5" text-anchor="middle" fill="${cor}" font-weight="700">${v>0?"+":""}${v}</text>`:""}`;
  }).join("");
  const skip = n>15 ? Math.ceil(n/10) : 1;
  const xLabels = labels.map((l,i)=> i%skip===0 ? `<text x="${(padL+i*stepX+stepX/2).toFixed(1)}" y="${h-6}" font-size="8.5" text-anchor="middle" fill="#9B948C">${l}</text>` : "").join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${w-padR}" y2="${zeroY.toFixed(1)}" stroke="#E0DCD3" stroke-width="1"/>
    ${bars}
    ${xLabels}
  </svg>`;
}
function metaVolksChartSVG(dadosPorMes, anoRef){
  const w=900, h=280, padL=44, padR=20, padT=24, padB=34;
  const nomesMesesAbrev = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const maxVal = Math.max(1, ...dadosPorMes.map(d=>Math.max(d.acumVendido, d.acumMeta)));
  const stepX = (w-padL-padR)/(dadosPorMes.length-1 || 1);
  const scaleY = v => h-padB-(v/maxVal)*(h-padT-padB);

  const grid = [0,0.25,0.5,0.75,1].map(f=>{
    const y = h-padB-f*(h-padT-padB);
    return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="rgba(255,255,255,.08)" stroke-width="1"/>
            <text x="${padL-8}" y="${y+3}" font-size="9" text-anchor="end" fill="rgba(255,255,255,.35)">${Math.round(maxVal*f)}</text>`;
  }).join("");

  function linha(campo, cor, glowId){
    const pontos = dadosPorMes.map((d,i)=>`${padL+i*stepX},${scaleY(d[campo])}`).join(" ");
    const pts = dadosPorMes.map((d,i)=>({x:padL+i*stepX, y:scaleY(d[campo])}));
    const dots = pts.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${cor}" stroke="#050310" stroke-width="1.5"/>`).join("");
    return `<polyline points="${pontos}" fill="none" stroke="${cor}" stroke-width="2.5" filter="url(#${glowId})"/>${dots}`;
  }

  const eixoX = dadosPorMes.map((d,i)=>`<text x="${padL+i*stepX}" y="${h-padB+18}" font-size="9.5" text-anchor="middle" fill="rgba(255,255,255,.5)" font-weight="700">${nomesMesesAbrev[d.mes-1]}</text>`).join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <defs>
      <filter id="mvGlowMeta" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="mvGlowVendido" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${grid}
    ${linha("acumMeta","#FF6B4A","mvGlowMeta")}
    ${linha("acumVendido","#00E5FF","mvGlowVendido")}
    ${eixoX}
  </svg>`;
}
function corridaVendasSVG(vendas){
  const laneH = 62, trackTop = 30, trackStartX = 16, W = 980;
  const faixaChegadaW = 34;
  const finishX = W - 60 - faixaChegadaW; // onde comeca o quadriculado
  const maxCarroX = finishX - 78; // limite maximo que um carro pode andar, sem tocar o quadriculado
  const n = vendas.length;
  const H = trackTop + n*laneH + 24;
  const maxComissao = Math.max(...vendas.map(v=>Number(v.comissao)||0), 1);
  const cores = ["#E23B4E","#1FA463","#2E86DE","#F7C600","#833AB4","#FD7E14","#17A398","#C2185B","#6D4C41","#00838F"];

  let svg = `<rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="#0A1E3F"/>`;
  svg += `<rect x="4" y="4" width="${W-8}" height="${H-8}" rx="13" fill="none" stroke="#fff" stroke-width="3"/>`;

  for (let i=0; i<=n; i++){
    const y = trackTop + i*laneH;
    svg += `<line x1="${trackStartX}" y1="${y}" x2="${finishX}" y2="${y}" stroke="#fff" stroke-width="2.5" stroke-dasharray="16 12" opacity=".6"/>`;
  }

  // quadriculado de chegada
  const checkSize = 8.5;
  const checkRows = Math.ceil(H/checkSize);
  for (let row=0; row<checkRows; row++){
    for (let col=0; col<Math.floor(faixaChegadaW/checkSize); col++){
      const par = (row+col)%2===0;
      svg += `<rect x="${finishX+col*checkSize}" y="${row*checkSize}" width="${checkSize}" height="${checkSize}" fill="${par?'#fff':'#111'}"/>`;
    }
  }

  vendas.forEach((v,i)=>{
    const y = trackTop + i*laneH + laneH/2;
    const pct = maxComissao>0 ? Math.min((Number(v.comissao)||0)/maxComissao,1) : 0;
    const x = trackStartX + 8 + pct*(maxCarroX-trackStartX-8);
    const cor = cores[i % cores.length];
    const categoria = categoriaDoCarro(v.carro, v.modelo);
    const nomeCarro = `${v.modelo||""}${v.versao?" "+v.versao:""}`.trim() || v.tipoLabel;
    svg += `
      <g transform="translate(${x},${y-16})" class="viz-glow">
        <text x="30" y="-10" font-size="12" font-weight="800" fill="#fff" stroke="#000" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke fill" text-anchor="middle">#${i+1} · ${moneyFmt(v.comissao)}</text>
        <text x="30" y="48" font-size="9" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round" paint-order="stroke fill" text-anchor="middle">${nomeCarro}</text>
        ${formaCarrinho(categoria, cor)}
      </g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:100%;">${svg}</svg>`;
}
function scoreRingSVG(pct, color){
  const r=40, cx=50, cy=50, circumference=2*Math.PI*r;
  const dash = circumference*Math.min(Math.max(pct,0),1);
  return `<svg viewBox="0 0 100 100" width="100%">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="9"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" class="viz-glow"/>
  </svg>`;
}
function radarChartSVG(labels, values){
  const n = labels.length;
  const cx=150, cy=145, maxR=95;
  const angleStep = (2*Math.PI)/n;
  function pt(i, r){
    const ang = -Math.PI/2 + i*angleStep;
    return {x:cx+r*Math.cos(ang), y:cy+r*Math.sin(ang)};
  }
  let gridHTML = "";
  [0.25,0.5,0.75,1].forEach(frac=>{
    const pts = Array.from({length:n},(_,i)=>pt(i,maxR*frac));
    gridHTML += `<polygon points="${pts.map(p=>p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ")}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`;
  });
  let axisHTML = "";
  for (let i=0;i<n;i++){
    const p = pt(i,maxR);
    axisHTML += `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`;
  }
  const dataPts = values.map((v,i)=> pt(i, maxR*Math.min(Math.max(v,0),100)/100));
  const dataPoly = dataPts.map(p=>p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ");
  let labelHTML = "";
  for (let i=0;i<n;i++){
    const p = pt(i, maxR+24);
    labelHTML += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="11" font-weight="800" fill="rgba(255,255,255,.85)" text-anchor="middle">${labels[i]}</text>`;
  }
  const dotsHTML = dataPts.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#00E5FF" class="viz-glow"/>`).join("");
  return `<svg viewBox="0 0 300 300" width="100%" style="max-width:300px;">
    <defs>
      <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00E5FF"/>
        <stop offset="100%" stop-color="#833AB4"/>
      </linearGradient>
    </defs>
    ${gridHTML}${axisHTML}
    <polygon points="${dataPoly}" fill="url(#radarFill)" fill-opacity=".35" stroke="url(#radarFill)" stroke-width="2.5"/>
    ${dotsHTML}
    ${labelHTML}
  </svg>`;
}
function pizza3DSVG(labels, values, colors){
  const total = values.reduce((a,b)=>a+b,0);
  if (total<=0) return `<div class="empty">Sem dados suficientes ainda.</div>`;
  const cx=140, cy=76, rx=108, ry=56, depth=20, w=300, h=150;
  function pt(cx,cy,rx,ry,angDeg){ const r=angDeg*Math.PI/180; return {x:cx+rx*Math.cos(r), y:cy+ry*Math.sin(r)}; }
  const rightTop = pt(cx,cy,rx,ry,0), leftTop = pt(cx,cy,rx,ry,180);
  const rightBase = pt(cx,cy+depth,rx,ry,0), leftBase = pt(cx,cy+depth,rx,ry,180);
  const wallPath = `M ${rightTop.x.toFixed(1)} ${rightTop.y.toFixed(1)} A ${rx} ${ry} 0 0 1 ${leftTop.x.toFixed(1)} ${leftTop.y.toFixed(1)} L ${leftBase.x.toFixed(1)} ${leftBase.y.toFixed(1)} A ${rx} ${ry} 0 0 0 ${rightBase.x.toFixed(1)} ${rightBase.y.toFixed(1)} Z`;
  let angle=-90;
  const segsHTML = values.map((v,i)=>{
    const sweep=(v/total)*360;
    const end=angle+sweep;
    const p1=pt(cx,cy,rx,ry,angle), p2=pt(cx,cy,rx,ry,end);
    const largeArc = sweep>180?1:0;
    const path=`M ${cx} ${cy} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${rx} ${ry} 0 ${largeArc} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} Z`;
    angle=end;
    return `<path d="${path}" fill="${colors[i]}" stroke="#fff" stroke-width="1.5" class="viz-glow"/>`;
  }).join("");
  const legend = labels.map((l,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:16px;font-size:11.5px;color:var(--text-dim);"><span style="width:10px;height:10px;border-radius:3px;background:${colors[i]};display:inline-block;"></span>${l} · ${values[i]} (${(values[i]/total*100).toFixed(0)}%)</span>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:340px;">
    <path d="${wallPath}" fill="rgba(0,0,0,.28)"/>
    ${segsHTML}
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  </svg><div style="margin-top:8px;">${legend}</div>`;
}
function instaImpactoChartSVG(items){
  const w=760, padL=150, padR=70, rowH=34, gap=10;
  const h = items.length*(rowH+gap)+16;
  if (items.length===0) return `<div class="empty">Sem dados suficientes ainda.</div>`;
  const maxAbs = Math.max(1, ...items.map(it=>Math.abs(it.diferenca)));
  const halfW = (w-padL-padR)/2;
  const midX = padL+halfW;
  const rows = items.map((it,i)=>{
    const y = 12+i*(rowH+gap);
    const bw = (Math.abs(it.diferenca)/maxAbs)*halfW*0.92;
    const cor = it.diferenca>=0 ? "#1FA463" : "#E23B4E";
    const x = it.diferenca>=0 ? midX : midX-bw;
    const barH = rowH*0.6;
    return `<text x="${padL-10}" y="${(y+barH/2+4).toFixed(1)}" font-size="11.5" text-anchor="end" fill="#48474F">${it.label}</text>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(bw,1).toFixed(1)}" height="${barH.toFixed(1)}" rx="5" fill="${cor}" class="viz-glow"/>
      <text x="${(it.diferenca>=0? x+bw+8 : x-8).toFixed(1)}" y="${(y+barH/2+4).toFixed(1)}" font-size="11" text-anchor="${it.diferenca>=0?'start':'end'}" fill="${cor}" font-weight="700">${it.diferenca>=0?"+":""}${it.diferenca.toFixed(1)}/dia</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <line x1="${midX.toFixed(1)}" y1="0" x2="${midX.toFixed(1)}" y2="${h}" stroke="#E0DCD3" stroke-width="1"/>
    ${rows}
  </svg>`;
}

/* ---------- gráficos SVG (sem dependências externas) ---------- */
function hBarChartSVG(labels, values, opts={}){
  const w = opts.width||760, rowH=26, pad=170, gap=8, rightPad=60;
  const h = values.length*(rowH+gap)+10;
  const max = Math.max(1, ...values);
  const rows = values.map((v,i)=>{
    const bw = Math.max(2,(v/max)*(w-pad-rightPad));
    const y = i*(rowH+gap)+5;
    return `<text x="${pad-10}" y="${y+rowH/2+4}" font-size="11.5" text-anchor="end" fill="#48474F">${labels[i]}</text>
            <rect x="${pad}" y="${y}" width="${bw}" height="${rowH}" fill="url(#barGrad)" rx="6" class="viz-glow"></rect>
            <text x="${pad+bw+8}" y="${y+rowH/2+4}" font-size="11.5" fill="#9E0000" font-weight="700">${v}${opts.suffix||""}</text>`;
  }).join("");
  if (values.every(v=>v===0)) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <defs><linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E10600"/><stop offset="100%" stop-color="#FFCE00"/>
    </linearGradient></defs>${rows}</svg>`;
}
function vBarChartSVG(labels, values, opts={}){
  const w = opts.width||500, h = opts.height||220, pad=28, gap=6, top=22;
  const max = Math.max(1, ...values);
  const bw = (w-2*pad)/values.length - gap;
  if (values.every(v=>v===0)) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  const bars = values.map((v,i)=>{
    const bh = (v/max)*(h-pad-top);
    const x = pad + i*(bw+gap);
    const y = h-pad-bh;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="url(#barGradV)" rx="5" class="viz-glow"></rect>
            ${v>0?`<text x="${x+bw/2}" y="${y-4}" font-size="9" text-anchor="middle" fill="#9E0000" font-weight="700">${v}</text>`:""}
            <text x="${x+bw/2}" y="${h-pad+13}" font-size="8.5" text-anchor="middle" fill="#9B948C">${labels[i]}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <defs><linearGradient id="barGradV" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#9E0000"/><stop offset="100%" stop-color="#FFCE00"/>
    </linearGradient></defs>${bars}</svg>`;
}
function competicaoCarrosSVG(itens){
  if (!itens.length) return `<div class="empty">Nenhuma venda registrada ainda.</div>`;
  const w = Math.max(600, itens.length*90), h=280, padL=20, padR=20, padT=44, padB=16;
  const max = Math.max(1, ...itens.map(i=>i.qtd));
  const bw = (w-padL-padR)/itens.length - 14;
  const cores = ["#F7C600","#C0C0C0","#CD7F32","#E10600","#2E86DE","#1FA463","#833AB4","#FD7E14","#17A398","#C2185B","#6D4C41","#00838F"];
  const medalhas = ["🥇","🥈","🥉"];
  const bars = itens.map((item,i)=>{
    const bh = Math.max(46,(item.qtd/max)*(h-padT-padB));
    const x = padL + i*(bw+14);
    const y = h-padB-bh;
    const cor = cores[i%cores.length];
    const cx = x+bw/2, cy = y+bh/2;
    return `<g class="viz-glow">
      ${i<3?`<text x="${cx}" y="${y-24}" font-size="18" text-anchor="middle">${medalhas[i]}</text>`:""}
      <text x="${cx}" y="${y-6}" font-size="11" font-weight="800" text-anchor="middle" fill="#171717" stroke="#fff" stroke-width="3" paint-order="stroke fill">${item.qtd} vendido${item.qtd===1?"":"s"}</text>
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${cor}" ${i===0?'stroke="#F7C600" stroke-width="2"':''}/>
      <text x="${cx}" y="${cy}" font-size="11.5" font-weight="800" text-anchor="middle" fill="#fff" transform="rotate(-90 ${cx} ${cy})">${item.modelo}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${bars}</svg>`;
}
function salarioMesAtualChartSVG(labels, values){
  // GRÁFICO 1 — somente o ano atual, mês a mês (sem meses futuros). Grande e
  // legível: usa width="100%" (escala com o espaço branco disponível do painel,
  // que agora ocupa a largura toda) mas mantém height fixo, então o SVG cresce
  // horizontalmente aproveitando a tela sem esmagar a altura das barras.
  // A largura de cada coluna escala com o maior texto (valor OU nome do mês)
  // para os valores nunca ficarem sobrepostos entre barras vizinhas.
  if (values.length===0 || values.every(v=>v===0)) return `<div class="empty">Sem lançamentos de salário registrados neste ano ainda.</div>`;
  const valoresTxt = values.map(v=>moneyFmt(v).replace("R$","").trim());
  const maiorTxtLen = Math.max(...valoresTxt.map(t=>t.length));
  const maiorLabelLen = Math.max(...labels.map(l=>l.length));
  const colW = Math.max(120, maiorTxtLen*10.5 + 26, maiorLabelLen*9.2 + 20);
  const w = Math.max(760, values.length*colW), h=400, padL=54, padR=20, padT=54, padB=54;
  const max = Math.max(1, ...values);
  const bw = (w-padL-padR)/values.length - 14;
  const idxMax = values.indexOf(Math.max(...values));
  const cores = ["#E10600","#F7C600","#1FA463","#2E86DE","#833AB4","#FD7E14","#17A398","#C2185B","#6D4C41","#00838F","#E23B4E","#0E7C86"];
  const grid = [0,0.5,1].map(f=>{
    const y = h-padB-f*(h-padT-padB);
    return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#E1E3E8" stroke-width="1"/>
            <text x="${padL-10}" y="${y+4}" font-size="11.5" text-anchor="end" fill="#9B948C">${Math.round(max*f/1000)}k</text>`;
  }).join("");
  const bars = values.map((v,i)=>{
    const bh = Math.max(2,(v/max)*(h-padT-padB));
    const x = padL + i*(bw+14);
    const y = h-padB-bh;
    const cor = cores[i%cores.length];
    const destaque = i===idxMax && v>0;
    return `<g class="viz-glow">
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${cor}" ${destaque?'stroke="#F7C600" stroke-width="3"':''}/>
      ${destaque?`<text x="${x+bw/2}" y="${y-30}" font-size="17" text-anchor="middle">🏆</text>`:""}
      <text x="${x+bw/2}" y="${y-10}" font-size="14.5" text-anchor="middle" fill="${destaque?'#B8790F':'#3A3A3A'}" font-weight="800">${valoresTxt[i]}</text>
      <text x="${x+bw/2}" y="${h-padB+24}" font-size="13" text-anchor="middle" fill="#6b7280" font-weight="700">${labels[i]}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${grid}${bars}</svg>`;
}
function salarioHistoricoLinhaSVG(labels, values, larguraPx, alturaPx){
  // GRÁFICO 2 — histórico geral (todos os anos): linha com pontos, preenchendo de verdade
  // a área do card. `larguraPx`/`alturaPx` vêm do tamanho REAL já medido do contêiner (ver
  // renderSalarios) — o viewBox usa esses mesmos valores em pixels (escala 1:1, sem
  // esticar/distorcer texto ou círculos), então o gráfico ocupa exatamente o espaço
  // disponível, em qualquer largura de tela, sem precisar de rolagem horizontal.
  if (values.length===0 || values.every(v=>v===0)) return `<div class="empty">Sem dados suficientes ainda.</div>`;
  const n = values.length;
  const w = Math.max(280, Math.round(larguraPx||760));
  const h = Math.max(200, Math.round(alturaPx||340));
  const padL=42, padR=16, padT=36, padB=48;
  const plotW = w-padL-padR, plotH = h-padT-padB;
  const colW = n>1 ? plotW/(n-1) : plotW;

  const max = Math.max(1, ...values);
  const escalaX = i => padL + i*colW;
  const escalaY = v => padT + plotH - (v/max)*plotH;
  const valoresTxt = values.map(v=>moneyFmt(v).replace("R$","").trim());

  // fonte e ponto escalam com o espaço disponível por coluna, sempre dentro de limites legíveis
  const fontValor = Math.max(9, Math.min(13.5, colW*0.32));
  const fontMes = Math.max(8, Math.min(11.5, colW*0.28));
  const raioPonto = Math.max(2.4, Math.min(5, colW*0.16));

  // com muitos meses, mostra só 1 rótulo a cada N (nunca sobrepõe); a LINHA e os PONTOS
  // continuam representando TODOS os meses — só o texto é que rareia quando aperta.
  // Multiplicador conservador (fonte em negrito) + folga fixa, pra sobrar margem real
  // entre rótulos vizinhos em vez de estimar em cima da hora.
  const passo = larguraTexto => colW>=larguraTexto ? 1 : Math.ceil(larguraTexto/colW);
  const passoMes = passo(Math.max(...labels.map(l=>l.length))*fontMes*0.72 + 6);
  const passoValor = passo(Math.max(...valoresTxt.map(t=>t.length))*fontValor*0.72 + 6);
  // Primeiro e último ponto sempre usam âncora start/end (nunca "middle") — assim o texto
  // cresce PRA DENTRO do gráfico em vez de vazar pra fora da borda do card.
  const anchorDe = i => i===0 ? "start" : (i===n-1 ? "end" : "middle");
  const dxDe = anchor => anchor==="start" ? 4 : (anchor==="end" ? -4 : 0);
  // monta o conjunto de índices visíveis a partir do padrão regular (a cada N), sempre
  // incluindo os `forcados` (pontas + melhor mês) — e limpando qualquer vizinho do padrão
  // que ficaria colado demais em algum forçado, pra nunca colidir com eles. Pontas (índice
  // 0 e n-1) usam âncora start/end, que projeta o texto INTEIRO pra um só lado (em vez de
  // metade pra cada lado, como a âncora "middle") — por isso pedem o dobro de folga.
  function indicesVisiveis(passoUsado, forcados, forcadosNaBorda){
    const idx = new Set();
    for (let i=0;i<n;i++){ if (i % passoUsado === 0) idx.add(i); }
    forcados.forEach(fi=>{
      const alcance = forcadosNaBorda.has(fi) ? passoUsado*2 : passoUsado;
      for (let i=0;i<n;i++){ if (i!==fi && Math.abs(i-fi)<alcance) idx.delete(i); }
    });
    forcados.forEach(fi=>idx.add(fi));
    return idx;
  }

  const idxMax = values.indexOf(max);
  const bordas = new Set(n>1 ? [0, n-1] : [0]);
  const indicesComValor = indicesVisiveis(passoValor, n>1 ? [0, n-1, idxMax] : [0], bordas);
  const indicesComMes = indicesVisiveis(passoMes, n>1 ? [0, n-1] : [0], bordas);

  const grid = [0,0.5,1].map(f=>{
    const y = padT + plotH - f*plotH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w-padR}" y2="${y.toFixed(1)}" stroke="#E1E3E8" stroke-width="1"/>
            <text x="${padL-8}" y="${(y+3).toFixed(1)}" font-size="9" text-anchor="end" fill="#9B948C">${Math.round(max*f/1000)}k</text>`;
  }).join("");

  const pontosLinha = values.map((v,i)=>`${escalaX(i).toFixed(1)},${escalaY(v).toFixed(1)}`).join(" ");
  const areaPath = `M${escalaX(0).toFixed(1)},${(h-padB).toFixed(1)} L${pontosLinha.split(" ").join(" L")} L${escalaX(n-1).toFixed(1)},${(h-padB).toFixed(1)} Z`;

  const marcadores = values.map((v,i)=>{
    const x = escalaX(i), y = escalaY(v);
    const destaque = i===idxMax;
    const anchor = anchorDe(i);
    const dx = dxDe(anchor);
    const paraCima = i%2===0;
    const mostrarValor = indicesComValor.has(i);
    const mostrarMes = indicesComMes.has(i);
    const yValor = paraCima ? y-14 : y+18;
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(destaque?raioPonto+1.4:raioPonto).toFixed(1)}" fill="${destaque?'#F7C600':'#E10600'}" stroke="#fff" stroke-width="1.4" class="viz-glow"/>
      ${mostrarValor?`<text x="${(x+dx).toFixed(1)}" y="${yValor.toFixed(1)}" font-size="${fontValor.toFixed(1)}" text-anchor="${anchor}" fill="${destaque?'#B8790F':'#3A3A3A'}" font-weight="800">${valoresTxt[i]}</text>`:""}
      ${mostrarMes?`<text x="${(x+dx).toFixed(1)}" y="${(h-padB+18).toFixed(1)}" font-size="${fontMes.toFixed(1)}" text-anchor="${anchor}" fill="#8a8f98" font-weight="700">${labels[i]}</text>`:""}
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="histAreaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E10600" stop-opacity="0.22"/><stop offset="100%" stop-color="#E10600" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${areaPath}" fill="url(#histAreaGrad)"/>
    <polyline points="${pontosLinha}" fill="none" stroke="#E10600" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" class="viz-glow"/>
    ${marcadores}
  </svg>`;
}
function salarioTipoChartSVG(tipos, valores, cores){
  const total = valores.reduce((a,b)=>a+b,0);
  if (total===0) return `<div class="empty">Sem lançamentos suficientes ainda.</div>`;
  const w=600, rowH=30, gap=10, padL=118, padR=70;
  const ordenado = tipos.map((t,i)=>({t,v:valores[i],c:cores[i]})).sort((a,b)=>b.v-a.v);
  const max = Math.max(1, ...valores);
  const h = ordenado.length*(rowH+gap)+8;
  const rows = ordenado.map((item,i)=>{
    const bw = Math.max(2,(item.v/max)*(w-padL-padR));
    const y = i*(rowH+gap)+4;
    const pct = total>0 ? ((item.v/total)*100).toFixed(0) : 0;
    return `<g class="viz-glow">
      <text x="${padL-10}" y="${y+rowH/2+4}" font-size="11.5" text-anchor="end" fill="#48474F" font-weight="700">${item.t}</text>
      <rect x="${padL}" y="${y}" width="${w-padL-padR}" height="${rowH}" rx="8" fill="#F2F2F0"/>
      <rect x="${padL}" y="${y}" width="${bw}" height="${rowH}" rx="8" fill="${item.c}"/>
      <text x="${padL+bw+8}" y="${y+rowH/2+4}" font-size="11" fill="${item.c}" font-weight="800">${moneyFmt(item.v).replace("R$","").trim()} <tspan fill="#9B948C" font-weight="600">(${pct}%)</tspan></text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${rows}</svg>`;
}
function donutChartSVG(labels, values, colors, opts={}){
  const size = opts.size||170, r=62, cx=size/2, cy=size/2, strokeW=26;
  const total = values.reduce((a,b)=>a+b,0);
  if (total===0) return `<div class="empty">Sem vendas registradas ainda este mês.</div>`;
  const circumference = 2*Math.PI*r;
  let offset = 0;
  const circles = values.map((v,i)=>{
    const frac = v/total;
    const dash = frac*circumference;
    const rotate = (offset/total)*360 - 90;
    offset += v;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${strokeW}"
             stroke-dasharray="${dash} ${circumference-dash}" transform="rotate(${rotate} ${cx} ${cy})" class="viz-glow"></circle>`;
  }).join("");
  const legend = labels.map((l,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:6px;">
      <span style="width:11px;height:11px;border-radius:50%;background:${colors[i]};display:inline-block;"></span>${l}: <b>${values[i]}</b></div>`).join("");
  return `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${circles}</svg>
    <div>${legend}</div>
  </div>`;
}
function lineChartSVG(labels, seriesArr, colors, opts={}){
  const w = opts.width||760, h = opts.height||220, padL=32, padR=14, padT=14, padB=24;
  const n = labels.length;
  if (n===0 || seriesArr.every(s=>s.every(v=>v===0))) return `<div class="empty">Sem dados suficientes ainda este mês.</div>`;
  const maxV = Math.max(1, ...seriesArr.flat());
  const stepX = n>1 ? (w-padL-padR)/(n-1) : 0;
  const scaleY = v => h-padB-(v/maxV)*(h-padT-padB);
  const grid = [0,0.5,1].map(f=>{
    const y = h-padB-f*(h-padT-padB);
    return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#F0E2D2" stroke-width="1"/>
            <text x="${padL-6}" y="${y+3}" font-size="8.5" text-anchor="end" fill="#9B948C">${Math.round(f*maxV)}</text>`;
  }).join("");
  const paths = seriesArr.map((s,si)=>{
    const pts = s.map((v,i)=>`${(padL+i*stepX).toFixed(1)},${scaleY(v).toFixed(1)}`).join(" ");
    const dots = s.map((v,i)=>`<circle cx="${(padL+i*stepX).toFixed(1)}" cy="${scaleY(v).toFixed(1)}" r="2.4" fill="${colors[si]}"></circle>`).join("");
    return `<polyline points="${pts}" fill="none" stroke="${colors[si]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" class="viz-glow"/>${dots}`;
  }).join("");
  const skip = n>15 ? Math.ceil(n/10) : 1;
  const xLabels = labels.map((l,i)=> i%skip===0 ? `<text x="${(padL+i*stepX).toFixed(1)}" y="${h-6}" font-size="8.5" text-anchor="middle" fill="#9B948C">${l}</text>` : "").join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${grid}${paths}${xLabels}</svg>`;
}
function calcularIdade(anoNascimento, mmdd){
  if (!anoNascimento) return null;
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const [mm,dd] = mmdd.split("-").map(Number);
  const jaFezAniversarioEsteAno = (hoje.getMonth()+1 > mm) || (hoje.getMonth()+1 === mm && hoje.getDate() >= dd);
  return anoAtual - anoNascimento - (jaFezAniversarioEsteAno ? 0 : 1);
}

function limparTelefoneWhats(tel){
  let d = (tel||"").replace(/\D/g,"");
  if (!d) return "";
  if (!d.startsWith("55")) d = "55"+d;
  return d;
}
function linkWhats(tel, msg){
  const num = limparTelefoneWhats(tel);
  const texto = encodeURIComponent(msg);
  return num ? `https://wa.me/${num}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

/* ============================= EVENTOS ============================= */
/* ============================= GERENTE SMART ============================= */
function BRL0G(n){ return "R$ "+Math.round(n||0).toLocaleString("pt-BR"); }
function dtG(s){ return s ? new Date(s+"T12:00:00") : null; }
function NUMFG(n){ return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function isoG(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function moedaInputG(el, campo){
  el.addEventListener("input", e=>{
    const cursorAntes = e.target.selectionStart;
    // Conta dígitos a partir da DIREITA (não da esquerda): os centavos são sempre fixos em 2 casas
    // e o zero à esquerda é só preenchimento de formatação, então contar da esquerda desalinha o
    // cursor quando o número ainda é curto. Contar da direita funciona tanto pra digitar em
    // sequência num campo vazio quanto pra editar um dígito no meio de um número grande.
    const digitosDepoisDoCursor = e.target.value.slice(cursorAntes).replace(/[^\d]/g,"").length;
    const v = e.target.value.replace(/[^\d]/g,"");
    state.gerente.est[campo] = v ? parseInt(v,10)/100 : 0;
    const formatado = state.gerente.est[campo] ? NUMFG(state.gerente.est[campo]) : "";
    e.target.value = formatado;
    let novoCursor = formatado.length;
    if (digitosDepoisDoCursor>0){
      let contados = 0;
      for (let i=formatado.length-1;i>=0;i--){
        if (/\d/.test(formatado[i])) contados++;
        if (contados===digitosDepoisDoCursor){ novoCursor = i; break; }
      }
    }
    e.target.setSelectionRange(novoCursor, novoCursor);
    calcularGerente(); persistDebounced();
  });
}

function docFmtData(iso){
  if (!iso) return { dia:"____", mes:"__________", ano:"____" };
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const [y,m,d] = iso.split("-").map(Number);
  return { dia:String(d).padStart(2,"0"), mes:meses[m-1], ano:String(y) };
}