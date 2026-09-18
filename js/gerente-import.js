// Construção da política do Gerente Smart a partir de um arquivo de regras importado.
// Função pura (não toca DOM nem `state`) para poder ser testada isoladamente.
//
// Substituição completa: o objeto retornado é sempre a política INTEIRA nova — nenhuma
// regra de uma política anterior sobrevive ou é somada aqui. Quem chama esta função troca
// state.gerente.politica pelo valor retornado (nunca faz merge/push em cima do que já existia).
function construirPoliticaImportada(textoJson, nomeArquivoFallback, dataCarregada){
  const p = JSON.parse(textoJson);
  const regras = Array.isArray(p) ? p : p.regras;
  if (!Array.isArray(regras)) throw new Error('Arquivo sem o campo "regras" (nem é uma lista no formato esperado).');
  if (!regras.length) throw new Error("A lista de regras desse arquivo está vazia — nada foi importado, a política atual continua a mesma.");
  return {
    nome: p.nome || nomeArquivoFallback,
    dataCarregada,
    regras: regras.map(x=>Object.assign({m:"",v:"",c:"",am:[],op:null,de:null,ate:null,nf:0,ti:0,bv:0,rede:0,tot:0,tx:"",obs:""}, x)),
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { construirPoliticaImportada };
