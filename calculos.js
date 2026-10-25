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

if (typeof module !== 'undefined') module.exports = { aliquotaIR, dimensionar, distribuirAporte };
