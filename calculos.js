/* Cálculos puros usados pelo app (sem DOM), testados em tests/. */

/* IR regressivo da renda fixa tributada, pelo número de dias */
const aliquotaIR = d => d <= 180 ? .225 : d <= 360 ? .20 : d <= 720 ? .175 : .15;

/* trader-budget: pesos → teto por ativo com redistribuição → descarta fatias abaixo do mínimo → arredonda.
 * x.lim é um teto individual (ex.: descontando o que a pessoa já tem da ação); senão vale `cap`. */
function dimensionar(cands, total, cap, minOrdem = 100) {
  let xs = cands.map(c => ({ ...c }));
  const lim = x => x.lim ?? cap;
  for (let pass = 0; pass < 10; pass++) {
    xs.forEach(x => x.cap = false);
    let resto = total, livres = [...xs];
    while (livres.length) {
      const sw = livres.reduce((s, x) => s + x.w, 0);
      livres.forEach(x => x.v = resto * x.w / sw);
      const over = livres.filter(x => x.v > lim(x));
      if (!over.length) break;
      over.forEach(x => { x.v = lim(x); x.cap = true; resto -= lim(x); });
      livres = livres.filter(x => !x.cap);
    }
    const peq = xs.filter(x => x.v < minOrdem);
    if (!peq.length || peq.length === xs.length) break;
    xs = xs.filter(x => x.v >= minOrdem);
  }
  const usado = xs.reduce((s, x) => s + x.v, 0);
  xs.forEach(x => x.v = Math.floor(x.v));
  const alvo = xs.filter(x => !x.cap).sort((a, b) => b.v - a.v)[0];
  if (alvo) alvo.v += Math.round(usado - xs.reduce((s, x) => s + x.v, 0));
  return { linhas: xs.filter(x => x.v > 0), sobra: Math.max(0, total - usado) };
}

/* aporte sem vender nada: completa primeiro as classes abaixo do alvo; o que sobrar segue os pesos-alvo */
function distribuirAporte(atual, alvo, aporte) {
  const total = Object.values(atual).reduce((a, b) => a + b, 0) + aporte, def = {}, out = {};
  Object.keys(alvo).forEach(k => def[k] = Math.max(0, alvo[k] * total - (atual[k] || 0)));
  const D = Object.values(def).reduce((a, b) => a + b, 0);
  Object.keys(alvo).forEach(k => out[k] = D >= aporte ? aporte * def[k] / (D || 1) : def[k] + (aporte - D) * alvo[k]);
  return out;
}

/* evolução do patrimônio no eixo de datas, com as quantidades de hoje:
 * - item cotado (precos alinhados ao eixo): valor = quantidade de hoje × preço do dia; com proventos, soma o DY diário acumulado
 * - item de renda fixa/fundo: valor de hoje descontado para trás pelo índice de crescimento (CDI do dia × % do CDI, ou taxa pré)
 * itens: [{ chave, grupo, v, precos?: number[], dy?, cresc?: number[] }] — cresc é o índice acumulado alinhado ao eixo (último = hoje) */
function evolucaoCarteira(eixo, itens, opt = {}) {
  const n = eixo.length, total = new Array(n).fill(0), grupos = {}, ativos = {};
  itens.forEach(it => {
    if (!(it.v > 0)) return;
    let s;
    if (it.precos) {
      const ult = it.precos[n - 1], q = ult ? it.v / ult : 0;
      let acum = 0;
      s = it.precos.map((p, i) => {
        if (opt.proventos && it.dy && i > 0) acum += q * (it.precos[i - 1] || 0) * it.dy / 252;
        return p == null ? null : q * p + acum;
      });
      if (opt.proventos && it.dy) { const fim = s[n - 1]; s = s.map(x => x == null ? null : x - (fim - it.v)); }  // termina no valor de hoje
    } else if (it.cresc) {
      const hoje = it.cresc[n - 1];
      s = it.cresc.map(c => it.v * c / hoje);
    } else s = new Array(n).fill(it.v);
    ativos[it.chave] = s;
    const g = grupos[it.grupo] || (grupos[it.grupo] = new Array(n).fill(0));
    s.forEach((x, i) => { const v = x ?? s.find(y => y != null) ?? 0; g[i] += v; total[i] += v; });
  });
  return { total, grupos, ativos };
}
/* índice acumulado a partir de taxas diárias (ex.: CDI do Banco Central em % ao dia), alinhado ao eixo */
function indiceAcumulado(eixo, taxasPorDia, mult = 1) {
  let acc = 1; const out = [];
  eixo.forEach(t => { acc *= 1 + (taxasPorDia(t) || 0) * mult; out.push(acc); });
  return out;
}
/* série em % a partir do primeiro valor válido */
const rentabilidade = s => { const b = s.find(x => x != null && x !== 0); return s.map(x => x == null || !b ? null : (x / b - 1) * 100); };

/* instituições com liquidação decretada pelo Banco Central: o dinheiro de CDB/LCI/LCA depende do FGC */
const LIQUIDADAS = [{ re: /\bMASTER\b|\bLETSBANK\b/i, nome: 'conglomerado do Banco Master', quando: 'novembro de 2025' }];
const TIPOS_BANCARIOS = new Set(['CDB', 'LCI', 'LCA', 'LC', 'RDB']);
const instituicaoLiquidada = h => TIPOS_BANCARIOS.has(h.tipo) ? LIQUIDADAS.find(l => l.re.test(`${h.inst || ''} ${h.ativo || ''}`)) || null : null;

/* um período (em pregões) cabe no histórico? tolera a falta de alguns dias (feriados, ano com menos pregões) */
const periodoDisponivel = (pregoes, historico) => pregoes <= historico * 1.05 + 5;

/* documentos importados que são extratos de movimentação (os antigos não tinham "tipo") */
const extratosMovimentacao = docs => Object.values(docs).filter(e => !e.tipo || e.tipo === 'extrato');

if (typeof module !== 'undefined') module.exports = { aliquotaIR, dimensionar, distribuirAporte, evolucaoCarteira, indiceAcumulado, rentabilidade, instituicaoLiquidada, extratosMovimentacao, periodoDisponivel };
