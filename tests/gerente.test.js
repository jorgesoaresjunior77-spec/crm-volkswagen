// Testes simples (Node puro, sem framework — o projeto não tem nenhum instalado) para
// os dois bugs de bug-tradein-fidelidade.md:
//   1) Importar regras (JSON) deve SUBSTITUIR a política, nunca mesclar/somar.
//   2) Bônus Fidelidade VW: marca "Volkswagen" + regra com ti_fid deve usar ti_fid/tot_fid.
// Rodar com: node tests/gerente.test.js
const assert = require("assert");
const path = require("path");

// crm.js tem um punhado de `document.getElementById(...)` no nível do módulo (fora de
// funções) usados só pra guardar referências de elementos — nunca são chamados durante
// o require em si. Um stub mínimo é suficiente pra carregar o arquivo fora do navegador.
global.document = { getElementById: ()=>({ addEventListener(){}, style:{}, classList:{add(){},remove(){},toggle(){}} }) };

const { tradeInEfetivo } = require(path.join(__dirname, "..", "js", "crm.js"));
const { construirPoliticaImportada } = require(path.join(__dirname, "..", "js", "gerente-import.js"));

let falhas = 0;
function teste(nome, fn){
  try { fn(); console.log(`  ok  - ${nome}`); }
  catch(e){ falhas++; console.log(`FALHA - ${nome}\n       ${e.message}`); }
}

console.log("Bug 2 — tradeInEfetivo (ti_fid / tot_fid):");

// Caso do bug: Nivus Highline (CH24BY), regra real do exemplo do bug report.
const regraComFidelidade = { ti: 10000, ti_fid: 13000, tot: 35300, tot_fid: 38300 };

teste("Outra marca usa ti/tot normais", ()=>{
  const r = tradeInEfetivo(regraComFidelidade, "Outra marca");
  assert.strictEqual(r.ti, 10000);
  assert.strictEqual(r.tot, 35300);
});

teste("Volkswagen com ti_fid preenchido usa ti_fid/tot_fid", ()=>{
  const r = tradeInEfetivo(regraComFidelidade, "Volkswagen");
  assert.strictEqual(r.ti, 13000);
  assert.strictEqual(r.tot, 38300);
});

teste("Volkswagen sem marca escolhida (vazio) mantém ti/tot normais", ()=>{
  const r = tradeInEfetivo(regraComFidelidade, "");
  assert.strictEqual(r.ti, 10000);
  assert.strictEqual(r.tot, 35300);
});

const regraSemFidelidade = { ti: 8000, ti_fid: null, tot: 20000, tot_fid: null };
teste("Volkswagen com ti_fid=null mantém ti/tot (modelo sem bônus Fidelidade)", ()=>{
  const r = tradeInEfetivo(regraSemFidelidade, "Volkswagen");
  assert.strictEqual(r.ti, 8000);
  assert.strictEqual(r.tot, 20000);
});

const regraAntiga = { ti: 5000, tot: 15000 }; // política antiga: campo nem existe
teste("Volkswagen com ti_fid ausente (regra de política antiga) mantém ti/tot", ()=>{
  const r = tradeInEfetivo(regraAntiga, "Volkswagen");
  assert.strictEqual(r.ti, 5000);
  assert.strictEqual(r.tot, 15000);
});

console.log("\nBug 1 — construirPoliticaImportada (substituição completa, não merge):");

teste("Reimportar um arquivo menor descarta 100% das regras antigas (sem sobra/soma)", ()=>{
  const arquivoAntigo = JSON.stringify({ nome: "Política Antiga", regras: [
    {m:"Nivus", v:"Highline", c:"CH24BY", ti:9000},
    {m:"Polo", v:"Track", c:"AAA111", ti:1000},
    {m:"T-Cross", v:"Sense", c:"BBB222", ti:2000},
  ]});
  const politicaAntiga = construirPoliticaImportada(arquivoAntigo, "antigo.json", "2026-08-01");
  assert.strictEqual(politicaAntiga.regras.length, 3);

  // Novo arquivo (a política vigente) tem só 1 regra — bem menor que a antiga.
  const arquivoNovo = JSON.stringify({ nome: "Política Setembro 2026", regras: [
    {m:"Nivus", v:"Highline", c:"CH24BY", ti:10000, ti_fid:13000, tot:35300, tot_fid:38300},
  ]});
  const politicaNova = construirPoliticaImportada(arquivoNovo, "novo.json", "2026-09-01");

  // A política nova não pode conter nem o total (3+1=4) nem nenhuma regra da antiga.
  assert.strictEqual(politicaNova.regras.length, 1, "esperava substituição completa, não soma com a política anterior");
  assert.ok(!politicaNova.regras.some(r=>r.m==="Polo"), "regra 'Polo' da política antiga vazou pra política nova");
  assert.ok(!politicaNova.regras.some(r=>r.m==="T-Cross"), "regra 'T-Cross' da política antiga vazou pra política nova");
});

teste("Arquivo sem campo 'regras' é recusado", ()=>{
  assert.throws(()=>construirPoliticaImportada(JSON.stringify({nome:"sem regras"}), "x.json", "2026-09-01"));
});

teste("Arquivo com lista de regras vazia é recusado", ()=>{
  assert.throws(()=>construirPoliticaImportada(JSON.stringify({regras:[]}), "x.json", "2026-09-01"));
});

teste("Arquivo em formato de array puro (sem wrapper 'regras') também funciona", ()=>{
  const p = construirPoliticaImportada(JSON.stringify([{m:"Taos", v:"Highline", c:"CL24LZ", ti:7000}]), "x.json", "2026-09-01");
  assert.strictEqual(p.regras.length, 1);
});

console.log(falhas ? `\n${falhas} teste(s) falharam.` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
