/* Análise Financeira — lógica da página.
 * Dados: Banco Central ao vivo (fetch), dados.js (cotações e notícias, gerado pelo GitHub Actions)
 * e ofertas.js (prateleira de renda fixa). A página recarrega dados.js a cada 10 minutos. */

/* ================= utilidades ================= */
const $ = s => document.querySelector(s);
const pct = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d).replace('.', ',') + '%';
const sgnPct = (v, d = 1) => (v > 0 ? '+' : '') + pct(v, d);
const brl = v => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const nf = (v, d = 0) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const clip = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
// rolagens suaves só para quem não pediu menos movimento ao sistema
const SUAVE = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
// a API do Banco Central às vezes recusa um pedido isolado: tenta de novo antes de desistir
async function getJSON(url, tentativas = /bcb\.gov\.br/.test(url) ? 3 : 1) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch (e) { if (i >= tentativas) throw e; await new Promise(ok => setTimeout(ok, 800 * i)); }
  }
}
const parseBr = s => { const [d, m, y] = s.split('/'); return new Date(+y, m - 1, +d); };
const tempoRel = iso => {
  if (!iso) return '';
  const m = (Date.now() - new Date(iso)) / 6e4;
  return m < 60 ? `há ${Math.max(1, Math.round(m))} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
};
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = `${src}?t=${Date.now()}`; s.onload = () => { s.remove(); ok(); }; s.onerror = () => { s.remove(); fail(); };
    document.body.appendChild(s);
  });
}

/* ================= estado ================= */
const M = {  // fallback = valores de 25/10/2026; substituídos pelo BCB ao carregar
  selic: .1375, cdi: .1365, ipca12: .0458, trMes: .0015, usd: 5.04,
  focusSelic: { 2026: .1325, 2027: .12, 2028: .105, 2029: .10, 2030: .10 },
  focusIpca: { 2026: .0522, 2027: .0432, 2028: .0375, 2029: .035, 2030: .035 },
  focusUsd: { 2026: 5.13, 2027: 5.22, 2028: 5.29 },
  selicHist: [], ipcaHist: [], usdHist: [], cdiDia: {}, ok: false
};
let D = window.DADOS || null;
let NEWS = [], SETOR_DE = {}, U = {}, SETORES = [], IB = null;
const BASE_OFF = () => structuredClone(window.OFERTAS || []);
let OFF = store.get('af2.offers', null) || BASE_OFF();

/* ================= Banco Central ================= */
const sgs = (cod, q) => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados${q}${q.includes('?') ? '&' : '?'}formato=json`;
async function loadMacro() {
  const hoje = new Date(), fim = hoje.toLocaleDateString('pt-BR');
  const ini = d => new Date(Date.now() - d * 864e5).toLocaleDateString('pt-BR');
  const focus = ind => getJSON(`https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=12&$filter=Indicador%20eq%20'${ind}'%20and%20baseCalculo%20eq%200&$orderby=Data%20desc&$format=json&$select=Data,DataReferencia,Mediana`);
  const [selic, cdi, ipca, tr, usd, fs, fi, fu, cdid] = await Promise.allSettled([
    getJSON(sgs(432, `?dataInicial=${ini(800)}&dataFinal=${fim}`)), getJSON(sgs(4389, '/ultimos/5')),
    getJSON(sgs(13522, `?dataInicial=${ini(800)}&dataFinal=${fim}`)), getJSON(sgs(226, '/ultimos/1')),
    getJSON(sgs(1, `?dataInicial=${ini(400)}&dataFinal=${fim}`)),
    focus('Selic'), focus('IPCA'), focus('C%C3%A2mbio'),
    getJSON(sgs(12, `?dataInicial=${ini(760)}&dataFinal=${fim}`))  // CDI diário, para a evolução da renda fixa
  ]);
  if (cdid.status === 'fulfilled') M.cdiDia = Object.fromEntries(cdid.value.map(x => [x.data.split('/').reverse().join('-'), +x.valor / 100]));
  let ok = 0;
  const serie = r => r.value.map(x => ({ d: parseBr(x.data), v: +x.valor })).filter(x => x.d <= hoje);
  if (selic.status === 'fulfilled') { ok++; M.selicHist = serie(selic).map(x => ({ d: x.d, v: x.v / 100 })); M.selic = M.selicHist.at(-1).v; }
  if (cdi.status === 'fulfilled') { ok++; M.cdi = +cdi.value.at(-1).valor / 100; }
  if (ipca.status === 'fulfilled') { ok++; M.ipcaHist = serie(ipca).map(x => ({ d: x.d, v: x.v / 100 })); M.ipca12 = M.ipcaHist.at(-1).v; }
  if (tr.status === 'fulfilled') M.trMes = +tr.value.at(-1).valor / 100;
  if (usd.status === 'fulfilled') { ok++; M.usdHist = serie(usd); M.usd = M.usdHist.at(-1).v; }
  const pick = (r, key, div) => {
    if (r.status !== 'fulfilled' || !r.value.value.length) return;
    ok++; const last = r.value.value[0].Data; M[key] = {};
    r.value.value.filter(x => x.Data === last).forEach(x => M[key][x.DataReferencia] = x.Mediana / div);
    M.focusData = last;
  };
  pick(fs, 'focusSelic', 100); pick(fi, 'focusIpca', 100); pick(fu, 'focusUsd', 1);
  M.ok = ok >= 5;
}
function selicAt(months) {
  const now = new Date(), pts = [[0, M.selic]];
  Object.keys(M.focusSelic).sort().forEach(y => { const m = (+y - now.getFullYear()) * 12 + (11 - now.getMonth()) + .5; if (m > 0) pts.push([m, M.focusSelic[y]]); });
  if (months >= pts.at(-1)[0]) return pts.at(-1)[1];
  for (let i = 1; i < pts.length; i++) if (months <= pts[i][0]) {
    const [m0, v0] = pts[i - 1], [m1, v1] = pts[i]; return v0 + (v1 - v0) * (months - m0) / (m1 - m0);
  }
}
const spreadCdi = () => M.selic - M.cdi;
function cdiMedio(m1, m0 = 0) {
  let acc = 1; const a = Math.round(m0), n = Math.max(1, Math.round(m1) - a);
  for (let i = a; i < a + n; i++) acc *= Math.pow(1 + selicAt(i + .5) - spreadCdi(), 1 / 12);
  return Math.pow(acc, 12 / n) - 1;
}
function ipcaMedio(months) {
  const now = new Date(), ys = Object.keys(M.focusIpca).sort(); let acc = 1; const n = Math.max(1, Math.round(months));
  for (let i = 0; i < n; i++) { const y = String(new Date(now.getFullYear(), now.getMonth() + i, 1).getFullYear()); acc *= Math.pow(1 + (M.focusIpca[y] ?? M.focusIpca[ys.at(-1)]), 1 / 12); }
  return Math.pow(acc, 12 / n) - 1;
}

/* ================= renda fixa ================= */
const ISENTO = new Set(['LCA', 'LCI', 'CRA', 'CRI', 'Debênture incentivada']);
const FGC = new Set(['LCA', 'LCI', 'CDB']);
const TIPOS = ['LCA', 'LCI', 'CDB', 'CRA', 'CRI', 'Debênture incentivada', 'Tesouro Selic', 'Tesouro Pré', 'Tesouro IPCA+'];
const fmtTaxa = o => o.idx === 'CDI' ? `${String(o.taxa).replace('.', ',')}% CDI` : o.idx === 'Pré' ? `${String(o.taxa).replace('.', ',')}% pré` : `IPCA+${String(o.taxa).replace('.', ',')}%`;
const plataformas = () => [...new Set(OFF.map(o => o.plat))];

/* rendimento líquido anual carregando até o vencimento — ou até o horizonte, reinvestindo no mesmo produto */
function avaliar(o, valor, hMeses) {
  const h = hMeses || o.prazo / 30.4;
  const dias = o.liq ? Math.min(o.prazo, Math.round(h * 30.4)) : o.prazo, meses = dias / 30.4;
  let bruto;
  if (o.idx === 'CDI') { const d = Math.pow(1 + cdiMedio(meses), 1 / 252) - 1; bruto = Math.pow(1 + d * o.taxa / 100, 252) - 1; }
  else if (o.idx === 'Pré') bruto = o.taxa / 100;
  else bruto = (1 + ipcaMedio(meses)) * (1 + o.taxa / 100) - 1;
  const ir = ISENTO.has(o.tipo) ? 0 : aliquotaIR(dias);
  const custodia = o.tipo.startsWith('Tesouro') ? ((o.tipo === 'Tesouro Selic' && valor <= 10000) ? 0 : .002) : 0;
  let tot = (Math.pow(1 + bruto - custodia, dias / 365) - 1) * (1 - ir), diasTot = dias;
  const diasH = Math.round(h * 30.4);
  if (!o.liq && dias < diasH - 15) {
    const resto = diasH - dias, d = Math.pow(1 + cdiMedio(h, meses), 1 / 252) - 1;
    const r2 = Math.pow(1 + d * (o.idx === 'CDI' ? o.taxa / 100 : 1), 252) - 1;
    tot = (1 + tot) * (1 + (Math.pow(1 + r2, resto / 365) - 1) * (ISENTO.has(o.tipo) ? 1 : 1 - aliquotaIR(resto))) - 1;
    diasTot = diasH;
  }
  const liqAA = Math.pow(1 + tot, 365 / diasTot) - 1;
  const cdiH = cdiMedio(diasTot / 30.4);
  const final = valor * (1 + tot);
  const motivos = [];
  const car = o.tipo === 'LCI' ? 360 : o.tipo === 'LCA' ? 270 : 0;
  if (o.prazo < car) motivos.push(`${o.tipo} exige ≥ ${car / 30} meses`);
  if (valor < o.min) motivos.push(`mínimo ${brl(o.min)}`);
  if (hMeses && !o.liq && o.prazo > hMeses * 30.4 + 15) motivos.push('vence depois do prazo');
  return {
    bruto, ir, liqAA, dias, diasTot, final, ok: !motivos.length, motivos,
    real: (1 + liqAA) / (1 + ipcaMedio(diasTot / 30.4)) - 1,
    eqCdb: liqAA / ((1 - aliquotaIR(diasTot)) * cdiH) * 100,  // % do CDI que um CDB tributado precisaria
    pctCdi: liqAA / (cdiH * (1 - aliquotaIR(diasTot))) * 100
  };
}

/* ================= indicadores técnicos ================= */
function serieSMA(c, n) { const o = new Array(c.length).fill(null); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function serieEMA(c, n) { const o = [], k = 2 / (n + 1); c.forEach((v, i) => o.push(i ? v * k + o[i - 1] * (1 - k) : v)); return o; }
function serieRSI(c, n = 14) {
  const o = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i < n) continue; g /= n; l /= n; }
    else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}
const MAS = [10, 20, 30, 50, 100, 200];
function indicadores(c) {
  const sma = Object.fromEntries(MAS.map(n => [n, serieSMA(c, n)]));
  const e12 = serieEMA(c, 12), e26 = serieEMA(c, 26), macd = c.map((_, i) => e12[i] - e26[i]), sig = serieEMA(macd, 9);
  const stoch = c.map((v, i) => { if (i < 13) return null; const w = c.slice(i - 13, i + 1), lo = Math.min(...w), hi = Math.max(...w); return hi === lo ? 50 : (v - lo) / (hi - lo) * 100; });
  return { c, sma, rsi: serieRSI(c), hist: macd.map((v, i) => i < 34 ? null : v - sig[i]), stoch };
}
/* votos estilo "resumo técnico": médias móveis e osciladores */
function votos(I, i) {
  const c = I.c[i], v = [];
  MAS.forEach(n => { const s = I.sma[n][i]; if (s != null) v.push({ g: 'ma', nome: `MM${n}`, val: s, voto: c > s ? 1 : c < s ? -1 : 0 }); });
  const r = I.rsi[i]; if (r != null) v.push({ g: 'osc', nome: 'IFR 14', val: r, voto: r < 30 ? 1 : r > 70 ? -1 : 0 });
  const st = I.stoch[i]; if (st != null) v.push({ g: 'osc', nome: 'Estocástico 14', val: st, voto: st < 20 ? 1 : st > 80 ? -1 : 0 });
  const h = I.hist[i]; if (h != null) v.push({ g: 'osc', nome: 'MACD (hist.)', val: h, voto: h > 0 ? 1 : -1 });
  if (i >= 10) { const m = c / I.c[i - 10] - 1; v.push({ g: 'osc', nome: 'Momento 10d', val: m, voto: m > 0 ? 1 : m < 0 ? -1 : 0 }); }
  return v;
}
function notaTec(I, i) {
  const v = votos(I, i), avg = g => { const x = v.filter(y => y.g === g); return x.length ? x.reduce((s, y) => s + y.voto, 0) / x.length : 0; };
  return (avg('ma') + avg('osc')) / 2;
}
const H = 20; // 4 semanas de pregão
function backtest(I) {
  const c = I.c, ini = c.length > 260 ? 200 : 50; let n = 0, hit = 0, up = 0, tot = 0, rb = 0, nb = 0;
  for (let i = ini; i < c.length - H; i++) {
    const f = c[i + H] / c[i] - 1; tot++; if (f > 0) up++;
    const s = notaTec(I, i); if (Math.abs(s) < .1) continue;
    n++; if (Math.sign(s) === Math.sign(f)) hit++;
    if (s > 0) { rb += f; nb++; }
  }
  return n ? { acc: hit / n, n, base: up / tot, retCompra: nb ? rb / nb : null } : null;
}
const NIVEIS = [[.5, 2, 'Compra forte'], [.1, 1, 'Compra'], [-.1, 0, 'Neutro'], [-.5, -1, 'Venda'], [-Infinity, -2, 'Venda forte']];
const nivel = s => { const [, n, l] = NIVEIS.find(([t]) => s >= t); return { n, l }; };
const pillNivel = s => { const { n, l } = nivel(s); return `<span class="pill ${n === 2 ? 'sup' : n === 1 ? 'up' : n === 0 ? 'flat' : n === -1 ? 'down' : 'sdown'}">${l}</span>`; };

/* ================= análise do dados.js ================= */
function humor(lista) {
  if (!lista.length) return null;
  const m = lista.reduce((a, n) => a + n.sent, 0) / lista.length;
  return { m, n: lista.length, pos: lista.filter(n => n.sent > 0).length, neg: lista.filter(n => n.sent < 0).length };
}
const humorPill = h => !h ? '<span class="sub">—</span>' : `<span class="pill ${h.m > .25 ? 'up' : h.m < -.25 ? 'down' : 'flat'}" title="${h.pos} positivas, ${h.neg} negativas">${h.m > 0 ? '+' : ''}${h.m.toFixed(1).replace('.', ',')} · ${h.n}</span>`;
const recente = (n, dias = 7) => !n.data || Date.now() - new Date(n.data) < dias * 864e5;

function analisarSerie(x) {
  const c = x.c, n = c.length - 1, I = indicadores(c), last = x.preco ?? c[n];
  const back = (k) => c[Math.max(0, n - k)];
  const tail = c.slice(-127), lr = tail.slice(1).map((v, i) => Math.log(v / tail[i]));
  const mu = lr.reduce((s, v) => s + v, 0) / lr.length;
  const vol = Math.sqrt(lr.reduce((s, v) => s + (v - mu) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252);
  let pk = -Infinity, dd = 0; c.slice(-252).forEach(v => { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); });
  return {
    x, I, last, dia: x.anterior ? last / x.anterior - 1 : 0, r1: last / back(21) - 1, r3: last / back(63) - 1, r12: last / back(252) - 1,
    vol, dd, rsi: I.rsi[n], tec: notaTec(I, n), bt: backtest(I)
  };
}
function rebuild() {
  D = window.DADOS || null;
  NEWS = D ? D.noticias.filter(n => n.titulo) : [];
  SETOR_DE = {}; U = {};
  if (!D) { SETORES = []; IB = null; UF = {}; return; }
  Object.entries(D.setores).forEach(([s, ts]) => ts.forEach(t => SETOR_DE[t] = s));
  Object.entries(D.acoes).forEach(([t, x]) => {
    try { if (x.c.length > 60) U[t] = { sym: t, setor: SETOR_DE[t] || '—', nome: x.nome, ...analisarSerie(x), h: humor(NEWS.filter(n => n.tickers.includes(t))) }; } catch {}
  });
  SETORES = Object.entries(D.setores).map(([nome, ts]) => {
    const xs = ts.map(t => U[t]).filter(Boolean); if (!xs.length) return null;
    const avg = k => xs.reduce((s, x) => s + x[k], 0) / xs.length;
    return { nome, xs, r1: avg('r1'), r3: avg('r3'), r12: avg('r12'), tec: avg('tec'), h: humor(NEWS.filter(n => n.tickers.some(t => ts.includes(t)))) };
  }).filter(Boolean).sort((a, b) => b.r3 - a.r3);
  // previsão por ação: técnico + notícias + setor
  Object.values(U).forEach(a => {
    const s = SETORES.find(x => x.nome === a.setor);
    a.nNews = a.h ? clip(a.h.m / 1) : 0;
    a.nSetor = s ? clip(s.r3 * 5) : 0;
    a.prev = .7 * a.tec + .15 * a.nNews + .15 * a.nSetor;
  });
  IB = D.indices?.ibov ? analisarSerie(D.indices.ibov) : null;
  Object.values(U).forEach(a => a.dy = (D.acoes[a.sym].div12 || 0) / a.last);
  // FIIs: mesma análise técnica + dividend yield; "setor" = segmento
  UF = {};
  Object.entries(D.segmentos_fii || {}).forEach(([seg, ts]) => ts.forEach(t => SETOR_DE[t] = 'FII ' + seg));
  Object.entries(D.fiis || {}).forEach(([t, x]) => {
    try { if (x.c.length > 60) UF[t] = { sym: t, fii: true, setor: SETOR_DE[t] || 'FII', nome: x.nome, ...analisarSerie(x), dy: (x.div12 || 0) / (x.preco || x.c.at(-1)), h: humor(NEWS.filter(n => n.tickers.includes(t))) }; } catch {}
  });
  const segR3 = {}; Object.values(UF).forEach(f => (segR3[f.setor] = segR3[f.setor] || []).push(f.r3));
  Object.values(UF).forEach(f => {
    const r = segR3[f.setor]; f.nNews = f.h ? clip(f.h.m) : 0; f.nSetor = clip(r.reduce((a, b) => a + b, 0) / r.length * 5);
    f.prev = .7 * f.tec + .15 * f.nNews + .15 * f.nSetor;
  });
}
let UF = {};
const ativoDe = t => U[t] || UF[t] || null;

/* escolhe ações/FIIs para a parte de renda variável conforme o objetivo:
 * dividendos = maior DY sem tendência de queda forte (ações e FIIs); trade = sinal técnico forte (só ações, com stop e alvo);
 * equilibrado = melhor previsão ajustada à volatilidade. No máximo um por setor/segmento. */
const OBJETIVOS = { equilibrado: 'Equilibrado (crescimento)', dividendos: 'Dividendos (renda mensal)', trade: 'Trade (curto prazo)' };
function candidatosRV(obj, n, opt = {}) {
  const excl = opt.excluirSetores || new Set(), usados = new Set(), out = [];
  let pool, score, peso;
  if (obj === 'dividendos') {
    pool = [...Object.values(U), ...Object.values(UF)].filter(a => a.dy >= .05 && a.dy <= .25 && a.prev > -.3 && a.r12 > -.25);
    score = a => a.dy * (1 + .5 * a.prev); peso = a => a.dy / Math.max(a.vol, .12);
  } else if (obj === 'trade') {
    pool = Object.values(U).filter(a => a.prev >= .3 && a.rsi < 75);
    score = a => a.prev + a.r1; peso = a => a.prev / Math.max(a.vol, .15);
  } else {
    pool = Object.values(U).filter(a => a.prev >= .1);
    score = a => a.prev; peso = a => a.prev / Math.max(a.vol, .15);
  }
  pool.sort((a, b) => (excl.has(a.setor) - excl.has(b.setor)) || score(b) - score(a)).forEach(a => {
    if (out.length < n && !usados.has(a.setor)) { usados.add(a.setor); out.push({ sym: a.sym, a, w: peso(a), ...(obj === 'trade' ? planoTrade(a) : {}) }); }
  });
  return out;
}
/* trade: entrada no preço atual, stop em ~2 desvios de 10 pregões, alvo com risco/retorno 2:1 */
function planoTrade(a) {
  const risco = Math.min(.15, Math.max(.03, 2 * a.vol / Math.sqrt(252) * Math.sqrt(10)));
  return { entrada: a.last, stop: a.last * (1 - risco), alvo: a.last * (1 + 2 * risco), risco };
}
function previsaoIbov() {
  const p = [], univ = Object.values(U);
  if (IB) p.push({ nome: 'Sinal técnico do Ibovespa', v: IB.tec, peso: .45, txt: `${nivel(IB.tec).l}: ${sgnPct(IB.r3)} em 3 meses, ${IB.last > IB.I.sma[200].at(-1) ? 'acima' : 'abaixo'} da MM200` });
  if (univ.length) {
    const a = univ.filter(x => x.tec > .1).length / univ.length, b = univ.filter(x => x.tec < -.1).length / univ.length;
    p.push({ nome: 'Amplitude (ações em alta × baixa)', v: clip((a - b) * 1.5), peso: .2, txt: `${Math.round(a * 100)}% com sinal de compra, ${Math.round(b * 100)}% de venda (${univ.length} ações)` });
  }
  const hn = humor(NEWS.filter(n => recente(n) && ['Mercado', 'Ações', 'Juros'].includes(n.categoria)));
  if (hn) p.push({ nome: 'Humor das notícias', v: clip(hn.m / .8), peso: .15, txt: `média ${hn.m.toFixed(2).replace('.', ',')} em ${hn.n} manchetes (${hn.pos} +, ${hn.neg} −)` });
  const queda = M.selic - selicAt(12);
  p.push({ nome: 'Direção dos juros (Focus)', v: clip(queda / .02), peso: .1, txt: queda > 0 ? `Selic ${pct(queda)} menor em 12 meses` : 'juros estáveis ou subindo' });
  const uh = M.usdHist; if (uh.length > 25) {
    const ch = uh.at(-1).v / uh.at(-22).v - 1;
    p.push({ nome: 'Dólar no último mês', v: clip(-ch * 15), peso: .1, txt: `${sgnPct(ch)} — dólar ${ch < 0 ? 'em queda atrai capital estrangeiro' : 'em alta pesa na bolsa'}` });
  }
  const pw = p.reduce((s, x) => s + x.peso, 0) || 1;
  return { score: p.reduce((s, x) => s + x.v * x.peso, 0) / pw, partes: p };
}
function noticiasPorDia(lista) {
  const dias = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    const xs = lista.filter(n => n.data && new Date(n.data) >= d && new Date(n.data) < e);
    dias.push({ d, h: humor(xs) });
  }
  return dias;
}
function leituraNoticias() {
  const L = NEWS.filter(n => recente(n) && ['Mercado', 'Ações', 'Juros'].includes(n.categoria));
  const h = humor(L), dias = noticiasPorDia(L);
  if (!h) return { label: 'Sem dados', txt: 'Nenhuma notícia carregada ainda.', dias, score: 0 };
  const ult = humor(L.filter(n => n.data && Date.now() - new Date(n.data) < 2 * 864e5)), ant = humor(L.filter(n => n.data && Date.now() - new Date(n.data) >= 2 * 864e5));
  const delta = ult && ant ? ult.m - ant.m : 0;
  const label = h.m > .25 ? 'Viés de alta' : h.m < -.25 ? 'Viés de baixa' : 'Neutro';
  const dir = delta > .15 ? 'melhorando nos últimos 2 dias' : delta < -.15 ? 'piorando nos últimos 2 dias' : 'estável nos últimos dias';
  return { label, score: clip(h.m / .8), dias, h, txt: `${h.n} manchetes de mercado, ações e juros: ${h.pos} positivas e ${h.neg} negativas (média ${h.m > 0 ? '+' : ''}${h.m.toFixed(2).replace('.', ',')}), tom ${dir}.` };
}

/* ================= tabela ordenável ================= */
const SORT = store.get('af2.sort', {});
function tabela(el, id, cols, rows, opt = {}) {
  const st = SORT[id] || opt.sort || null;
  const col = st && cols.find(c => c.k === st.k);
  const data = col ? [...rows].sort((a, b) => { const x = col.v(a), y = col.v(b); return ((x ?? -Infinity) > (y ?? -Infinity) ? 1 : (x ?? -Infinity) < (y ?? -Infinity) ? -1 : 0) * st.dir; }) : rows;
  // c.cls: classe extra da coluna (ex.: "so-desk" esconde a coluna no celular)
  // foco dentro da tabela antes de redesenhar: volta para o mesmo cabeçalho/linha depois
  const fo = el.contains(document.activeElement) ? (document.activeElement.closest('th[data-k]') ? 'th[data-k="' + document.activeElement.closest('th').dataset.k + '"] button' : document.activeElement.matches('tr[data-i]') ? 'tr[data-i="' + document.activeElement.dataset.i + '"]' : null) : null;
  // cabeçalho sem texto (coluna de selo ou botão) leva um nome só para leitor de tela: c.sr
  const cab = c => c.h || `<span class="vh">${c.sr || 'Detalhe'}</span>`;
  el.innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.v ? 's' : ''} ${c.r ? 'r' : ''} ${st?.k === c.k ? 'on' : ''} ${c.cls || ''}" data-k="${c.k}"${c.v ? ` aria-sort="${st?.k === c.k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${c.v ? `<button type="button">${c.h}<span class="ar" aria-hidden="true">${st?.k === c.k ? (st.dir > 0 ? '▲' : '▼') : '↕'}</span></button>` : cab(c)}</th>`).join('')}</tr></thead>
    <tbody>${data.map((r, i) => `<tr data-i="${rows.indexOf(r)}" class="${opt.rowCls ? opt.rowCls(r, i) : ''}">${cols.map(c => `<td class="${c.r ? 'r' : ''} ${c.w ? 'w' : ''} ${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="sub">${opt.empty || 'Nada encontrado.'}</td></tr>`}</tbody>`;
  el.querySelectorAll('th.s').forEach(th => th.onclick = () => {
    const k = th.dataset.k, cur = SORT[id] || opt.sort;
    SORT[id] = { k, dir: cur?.k === k ? -cur.dir : (cols.find(c => c.k === k).asc ? 1 : -1) };
    store.set('af2.sort', SORT); opt.rerender();
  });
  if (opt.onRow) el.querySelectorAll('tbody tr[data-i]').forEach(tr => {
    tr.onclick = e => { if (!e.target.closest('a,button,input,select')) opt.onRow(rows[+tr.dataset.i]); };
    // linha clicável também abre com Enter/Espaço (WCAG 2.1.1)
    tr.tabIndex = 0;
    tr.onkeydown = e => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opt.onRow(rows[+tr.dataset.i]); } };
  });
  if (fo) el.querySelector(fo)?.focus({ preventScroll: true });
}

/* ================= gráficos ================= */
const CH = {};
const axis = () => ({ grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--ink-3'), font: { family: 'Inter', size: 10 } } });
const base = () => ({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false } });
const legend = () => ({ labels: { color: css('--ink-2'), boxWidth: 9, font: { size: 11 } } });
const tScale = () => ({ ...axis(), type: 'linear', ticks: { ...axis().ticks, maxTicksLimit: 6, callback: v => new Date(v).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) } });
function chart(id, cfg) {
  CH[id]?.destroy(); const el = document.getElementById(id); if (!el) return;
  CH[id] = new Chart(el, cfg);
  // canvas não tem texto: o leitor de tela recebe um resumo dos dados (WCAG 1.1.1)
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', resumoGrafico(el, cfg));
}
function resumoGrafico(el, cfg) {
  const tit = el.closest('.card')?.querySelector('h2')?.textContent.trim() || 'Gráfico';
  const { type, data } = cfg, lbl = data.labels || [];
  const fx = x => typeof x === 'number' && x > 1e11 ? new Date(x).toLocaleDateString('pt-BR') : String(x ?? '');
  const fv = v => nf(v, Math.abs(v) < 100 ? 2 : 0);
  if (type === 'doughnut' || type === 'pie') {
    const d = data.datasets[0]?.data || [], t = d.reduce((a, v) => a + (+v || 0), 0) || 1;
    return `${tit}, gráfico de rosca: ${lbl.map((l, i) => `${l} ${pct(d[i] / t, 0)}`).join(', ') || 'sem dados'}.`;
  }
  const partes = data.datasets.filter(ds => !ds.hidden).map(ds => {
    const p = (ds.data || []).map((v, i) => v && typeof v === 'object' ? { x: v.x, y: v.y } : { x: lbl[i], y: v }).filter(q => typeof q.y === 'number' && isFinite(q.y));
    if (!p.length) return null;
    const nome = ds.label || 'valores';
    if (p.length <= 12) return `${nome}: ${p.map(q => `${fx(q.x)} ${fv(q.y)}`).join(', ')}`;
    const ys = p.map(q => q.y), a = p[0], b = p.at(-1);
    return `${nome}: de ${fv(a.y)} em ${fx(a.x)} a ${fv(b.y)} em ${fx(b.x)}, mínimo ${fv(Math.min(...ys))}, máximo ${fv(Math.max(...ys))}`;
  }).filter(Boolean);
  return `${tit}, gráfico. ${partes.join('; ') || 'Sem dados'}.`;
}

/* ================= faixa de indicadores ================= */
function renderStrip(pv) {
  const real = (1 + M.cdi) / (1 + M.ipca12) - 1, sp = D?.indices?.sp500 ? analisarSerie(D.indices.sp500) : null, nl = leituraNoticias();
  const u12 = M.usdHist.find(x => x.d >= new Date(Date.now() - 365 * 864e5));
  const t = [
    ['Selic', pct(M.selic), `Focus: ${pct(selicAt(12))} em 12m`],
    ['CDI', pct(M.cdi), 'ao ano'],
    ['IPCA 12m', pct(M.ipca12), 'meta 3%'],
    ['Juro real', pct(real), real > .06 ? 'muito alto' : 'moderado'],
    ['Ibovespa', IB ? nf(IB.last) : '—', IB ? `<span class="${cls(IB.dia)}">${sgnPct(IB.dia, 2)}</span> · 12m ${sgnPct(IB.r12, 0)}` : 'sem dados'],
    ['Dólar', 'R$ ' + nf(M.usd, 3), u12 ? `12m: ${sgnPct(M.usd / u12.v - 1)}` : ''],
    ['S&P 500', sp ? nf(sp.last) : '—', sp ? `<span class="${cls(sp.dia)}">${sgnPct(sp.dia, 2)}</span> · 12m ${sgnPct(sp.r12, 0)}` : ''],
    ['Previsão Ibov', pv ? nivel(pv.score).l : '—', '4 semanas'],
    ['Notícias', nl.label, nl.h ? `${nl.h.pos}+ / ${nl.h.neg}− (7d)` : '']
  ];
  // patrimônio do usuário (carteira.js), quando já há investimentos cadastrados
  const pat = typeof patrimonioAtual === 'function' ? patrimonioAtual() : null;
  if (pat?.total) t.unshift(['Seu patrimônio', brl(pat.total), `${pat.n} itens${pat.semValor ? ` · ${pat.semValor} sem valor` : ''}`, 'carteira']);
  $('#strip').innerHTML = t.map(([l, v, d, ir]) => `<div class="tile"${ir ? ` data-ir="${ir}" role="button" tabindex="0" style="cursor:pointer;border-color:var(--accent)" title="abrir minha carteira"` : ''}><div class="l">${l}</div><div class="v${/\d/.test(v) ? ' num' : ''}" title="${String(v).replace(/<[^>]*>/g, '')}">${v}</div><div class="d">${d}</div></div>`).join('');
  $('#strip').querySelectorAll('[data-ir]').forEach(el => {
    el.onclick = () => { goto(el.dataset.ir); if (typeof modo === 'function') modo('exist'); };
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } };
  });
  const st = $('#status');
  st.className = 'status ' + (M.ok && D ? 'ok' : 'err');
  st.innerHTML = `<i></i>${M.ok ? 'BCB ao vivo' : 'BCB indisponível (valores de 25/10/2026)'} · ${D ? 'mercado ' + tempoRel(D.geradoEm) : 'sem dados.js'}`;
}

/* ================= painel ================= */
function renderPainel(pv) {
  const s = pv.score, nv = nivel(s);
  document.querySelectorAll('#ibMeter span').forEach((el, i) => el.classList.toggle('on', i === nv.n + 2));
  $('#ibMeter').setAttribute('aria-label', `Escala de Venda forte a Compra forte: marcado ${nv.l}`);
  $('#ibVerdict').textContent = nv.l; $('#ibVerdict').className = 'verdict ' + cls(nv.n);
  $('#ibScore').textContent = `nota ${s > 0 ? '+' : ''}${s.toFixed(2).replace('.', ',')}`;
  $('#ibBack').innerHTML = IB?.bt ? `No histórico de 2 anos, o sinal técnico do Ibovespa acertou a direção das 4 semanas seguintes em <b>${pct(IB.bt.acc, 0)}</b> das ${IB.bt.n} vezes (apostar sempre em alta: ${pct(IB.bt.base, 0)}). ${IB.bt.acc < IB.bt.base ? 'Sozinho, o técnico não superou essa referência: use a previsão como leitura do momento, não como aposta.' : 'O sinal superou a referência no período.'}` : 'Sem histórico suficiente.';
  tabela($('#ibParts'), 'ibParts', [
    { k: 'n', h: 'Componente', w: 1, f: r => `${r.nome}<br><span class="sub">${r.txt}</span>` },
    { k: 'p', h: 'Peso', r: 1, f: r => `<span class="num">${Math.round(r.peso * 100)}%</span>` },
    { k: 'v', h: 'Sinal', r: 1, f: r => `<span class="pill ${r.v > .1 ? 'up' : r.v < -.1 ? 'down' : 'flat'} num">${r.v > 0 ? '+' : ''}${r.v.toFixed(2).replace('.', ',')}</span>` }
  ], pv.partes, { rerender: () => renderPainel(pv) });
  const nl = leituraNoticias();
  $('#newsVerdict').innerHTML = `<b class="${nl.score > .3 ? 'up' : nl.score < -.3 ? 'down' : ''}">${nl.label}.</b> ${nl.txt}`;
  newsChart('chNewsDay', nl.dias);
  tabela($('#pSetores'), 'pSet', [
    { k: 'n', h: 'Setor', f: r => r.nome, v: r => r.nome, asc: 1 },
    { k: 'r3', h: '3m', r: 1, f: r => `<span class="num ${cls(r.r3)}">${sgnPct(r.r3)}</span>`, v: r => r.r3 },
    { k: 't', h: 'Sinal', f: r => pillNivel(r.tec), v: r => r.tec }
  ], SETORES, { rerender: () => renderPainel(pv), empty: 'Sem dados de setores.' });
  const lst = Object.values(U).sort((a, b) => b.prev - a.prev);
  const mini = (el, rows) => tabela(el, el.id, [
    { k: 's', h: el.id === 'pTopUp' ? 'Mais fortes' : 'Mais fracas', f: r => `<b title="${esc(r.setor)}">${r.sym}</b>` },
    { k: 'p', h: 'Previsão', f: r => pillNivel(r.prev) },
    { k: 'r', h: '1m', r: 1, f: r => `<span class="num ${cls(r.r1)}">${sgnPct(r.r1)}</span>` }
  ], rows, { rerender: () => renderPainel(pv), onRow: r => abrirAtivo(r.sym) });
  mini($('#pTopUp'), lst.slice(0, 6)); mini($('#pTopDown'), lst.slice(-6).reverse());
  $('#pNews').innerHTML = newsItems(NEWS.slice(0, 25));
}
function newsChart(id, dias) {
  chart(id, { type: 'bar', data: { labels: dias.map(x => x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })), datasets: [{ label: 'Tom médio das manchetes', data: dias.map(x => x.h ? +x.h.m.toFixed(2) : 0), backgroundColor: dias.map(x => !x.h ? css('--line') : x.h.m >= 0 ? css('--up') : css('--down')), borderRadius: 3 }] },
    options: { ...base(), plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const h = dias[c.dataIndex].h; return h ? ` tom ${h.m.toFixed(2)} · ${h.n} manchetes (${h.pos}+ ${h.neg}−)` : ' sem manchetes'; } } } }, scales: { x: axis(), y: { ...axis(), suggestedMin: -1, suggestedMax: 1 } } } });
}
function newsItems(L) {
  const sp = s => `<span class="pill ${s > 0 ? 'up' : s < 0 ? 'down' : 'flat'} num">${s > 0 ? '+' : ''}${s}</span>`;
  return L.map(n => `<li>${sp(n.sent)}<a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}<span class="vh"> (abre em nova aba)</span></a>
    <div class="m"><span>${esc(n.fonte)}</span>·<span>${tempoRel(n.data)}</span><span class="pill acc">${esc(n.categoria)}</span>${n.tickers.map(t => `<span class="pill flat">${t}</span>`).join('')}</div></li>`).join('') || '<li class="sub">Nenhuma notícia.</li>';
}

/* ================= buscador de renda fixa ================= */
const F = store.get('af2.filtros', { plats: null, tipos: null });
function filtrosRF() {
  return {
    valor: +$('#fValor').value || 0, prazo: +$('#fPrazo').value || 0, idx: $('#fIdx').value, q: $('#fBusca').value.trim().toLowerCase(),
    isento: $('#fIsento').checked, fgc: $('#fFgc').checked, liq: $('#fLiq').checked, elig: $('#fElig').checked
  };
}
function renderChips() {
  const pl = plataformas(); if (!F.plats) F.plats = pl; if (!F.tipos) F.tipos = [...TIPOS];
  const mk = (el, all, key) => {
    el.innerHTML = all.map(x => `<button class="chip ${F[key].includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('') + `<button class="chip" data-all="1">todas</button>`;
    el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
      if (b.dataset.all) F[key] = F[key].length === all.length ? [] : [...all];
      else F[key] = F[key].includes(b.dataset.v) ? F[key].filter(x => x !== b.dataset.v) : [...F[key], b.dataset.v];
      store.set('af2.filtros', F); renderChips(); renderRF();
    });
  };
  mk($('#fPlats'), pl, 'plats'); mk($('#fTipos'), TIPOS, 'tipos');
}
function renderRF() {
  const f = filtrosRF(); store.set('af2.rf', f);
  const rows = OFF.map(o => ({ o, a: avaliar(o, f.valor, f.prazo || 0) })).filter(({ o, a }) =>
    F.plats.includes(o.plat) && F.tipos.includes(o.tipo) && (!f.idx || o.idx === f.idx) &&
    (!f.q || `${o.plat} ${o.tipo} ${o.emissor}`.toLowerCase().includes(f.q)) &&
    (!f.isento || ISENTO.has(o.tipo)) && (!f.fgc || FGC.has(o.tipo) || o.tipo.startsWith('Tesouro')) && (!f.liq || o.liq) && (!f.elig || a.ok));
  $('#fCount').textContent = `${rows.length} de ${OFF.length} ofertas · CDI médio esperado no período: ${pct(cdiMedio(f.prazo || 24))}`;
  const best = rows.length ? Math.max(...rows.filter(r => r.a.ok).map(r => r.a.liqAA)) : null;
  tabela($('#rfTbl'), 'rf', [
    // o que decide vem primeiro (no celular, antes da rolagem lateral)
    { k: 'tipo', h: 'Oferta', f: r => `<b>${r.o.tipo}</b> <span class="num">${fmtTaxa(r.o)}</span><br><span class="sub">${esc(r.o.plat)} · ${esc(r.o.emissor)}</span>`, v: r => r.o.tipo, asc: 1 },
    { k: 'liq', h: 'Líquido a.a.', r: 1, f: r => `<b class="num">${pct(r.a.liqAA)}</b>`, v: r => r.a.liqAA },
    { k: 'fin', h: `Você recebe`, r: 1, f: r => `<b class="num">${brl(r.a.final)}</b><br><span class="sub num">em ${Math.round(r.a.diasTot / 30.4)}m</span>`, v: r => r.a.final },
    { k: 'luc', h: 'Lucro', r: 1, f: r => `<span class="num up">+${brl(r.a.final - f.valor)}</span>`, v: r => r.a.final - f.valor },
    { k: 'prazo', h: 'Prazo', r: 1, f: r => `<span class="num">${r.o.liq ? 'diária' : Math.round(r.o.prazo / 30) + 'm'}</span>`, v: r => r.o.liq ? 0 : r.o.prazo, asc: 1 },
    { k: 'min', h: 'Mínimo', r: 1, f: r => `<span class="num">${brl(r.o.min)}</span>`, v: r => r.o.min, asc: 1 },
    { k: 'plat', h: 'Plataforma', f: r => esc(r.o.plat), v: r => r.o.plat, asc: 1 },
    { k: 'ir', h: 'IR', r: 1, f: r => r.a.ir ? `<span class="num">${pct(r.a.ir, 1)}</span>` : '<span class="pill up">isento</span>', v: r => r.a.ir, asc: 1 },
    { k: 'bruto', h: 'Bruto a.a.', r: 1, f: r => `<span class="num">${pct(r.a.bruto)}</span>`, v: r => r.a.bruto },
    { k: 'real', h: 'Real a.a.', r: 1, f: r => `<span class="num">${pct(r.a.real)}</span>`, v: r => r.a.real },
    { k: 'eq', h: 'Equiv. CDB', r: 1, f: r => `<span class="num sub">${r.a.eqCdb.toFixed(0)}% CDI</span>`, v: r => r.a.eqCdb },
    { k: 'g', h: 'Garantia', f: r => FGC.has(r.o.tipo) ? '<span class="pill up">FGC</span>' : r.o.tipo.startsWith('Tesouro') ? '<span class="pill acc">Tesouro</span>' : '<span class="pill warn">sem FGC</span>' },
    { k: 'st', h: '', sr: 'Situação', f: r => r.a.ok ? '' : `<span class="pill flat">${r.a.motivos[0]}</span>` }
  ], rows, { sort: { k: 'liq', dir: -1 }, rerender: renderRF, rowCls: r => r.o === SIM.o ? 'sel' : !r.a.ok ? 'off' : r.a.liqAA === best ? 'best' : '', empty: 'Nenhuma oferta com esses filtros.',
    onRow: r => { abrirSim(r.o, f); } });
  $('#rfTbl').querySelectorAll('tbody tr').forEach(tr => tr.style.cursor = 'pointer');
  const porPlat = [...new Set(rows.map(r => r.o.plat))].map(pl => {
    const xs = rows.filter(r => r.o.plat === pl && r.a.ok).sort((a, b) => b.a.liqAA - a.a.liqAA);
    return { pl, n: xs.length, best: xs[0], top3: xs.slice(0, 3).reduce((s, x) => s + x.a.liqAA, 0) / Math.max(1, Math.min(3, xs.length)) };
  }).filter(x => x.n);
  tabela($('#rfPlat'), 'rfPlat', [
    { k: 'pl', h: 'Plataforma', f: r => `<b>${r.pl}</b>`, v: r => r.pl, asc: 1 },
    { k: 'n', h: 'Ofertas', r: 1, f: r => `<span class="num">${r.n}</span>`, v: r => r.n },
    { k: 'b', h: 'Melhor', f: r => `${r.best.o.tipo} ${fmtTaxa(r.best.o)}`, v: r => r.best.a.liqAA },
    { k: 'bl', h: 'Líquido', r: 1, f: r => `<b class="num">${pct(r.best.a.liqAA)}</b>`, v: r => r.best.a.liqAA },
    { k: 't3', h: 'Média top 3', r: 1, f: r => `<span class="num">${pct(r.top3)}</span>`, v: r => r.top3 }
  ], porPlat, { sort: { k: 'bl', dir: -1 }, rerender: renderRF, onRow: r => { F.plats = F.plats.length === 1 && F.plats[0] === r.pl ? plataformas() : [r.pl]; store.set('af2.filtros', F); renderChips(); renderRF(); } });
}
/* simulador: quanto o valor investido vira no resgate */
const SIM = { o: null };
function abrirSim(o, f) {
  const novo = SIM.o !== o; SIM.o = o;
  if (novo) {
    $('#simValor').value = f.valor || 10000;
    $('#simPrazo').value = o.liq ? (f.prazo || 12) : Math.round(o.prazo / 30.4);
  }
  $('#simCard').hidden = false; renderRF(); renderSim();
  if (novo) $('#simCard').scrollIntoView({ behavior: SUAVE, block: 'nearest' });
}
function simular(o, V, meses) {
  // carrega até o vencimento (ou até o resgate, se tiver liquidez diária); mostra o valor de cada mês
  const dias = o.liq ? Math.round(meses * 30.4) : o.prazo, m = dias / 30.4;
  let bruto;
  if (o.idx === 'CDI') { const d = Math.pow(1 + cdiMedio(m), 1 / 252) - 1; bruto = Math.pow(1 + d * o.taxa / 100, 252) - 1; }
  else if (o.idx === 'Pré') bruto = o.taxa / 100;
  else bruto = (1 + ipcaMedio(m)) * (1 + o.taxa / 100) - 1;
  const custA = o.tipo.startsWith('Tesouro') ? ((o.tipo === 'Tesouro Selic' && V <= 10000) ? 0 : .002) : 0;
  const isento = ISENTO.has(o.tipo);
  const em = d => {
    const g = V * (Math.pow(1 + bruto, d / 365) - 1), r = V * (Math.pow(1 + bruto - custA, d / 365) - 1);
    const ir = isento ? 0 : r * aliquotaIR(d);
    return { d, brutoFinal: V + g, custodia: g - r, ir, liquido: V + r - ir, aliq: isento ? 0 : aliquotaIR(d) };
  };
  const fim = em(dias), serie = [];
  for (let k = 0; k <= Math.ceil(m); k++) serie.push(em(Math.min(dias, Math.round(k * 30.4))));
  const ipca = ipcaMedio(m), realFinal = fim.liquido / Math.pow(1 + ipca, dias / 365);
  const poup = V * Math.pow(M.selic > .085 ? 1.005 * (1 + M.trMes) : 1 + .7 * selicAt(m / 2) / 12, m);
  const cdiAA = Math.pow(1 + Math.pow(1 + cdiMedio(m), 1 / 252) - 1, 252) - 1;
  const cdb100 = V + V * (Math.pow(1 + cdiAA, dias / 365) - 1) * (1 - aliquotaIR(dias));
  return { ...fim, bruto, dias, meses: m, serie, realFinal, ipca, poup, cdb100, isento };
}
function renderSim() {
  const o = SIM.o; if (!o) return;
  const V = Math.max(0, +$('#simValor').value || 0), meses = Math.max(1, +$('#simPrazo').value || 12);
  $('#simPrazo').disabled = !o.liq;
  $('#simPrazoLbl').firstChild.textContent = o.liq ? 'Resgatar em (meses)' : 'Prazo (vencimento do título)';
  const s = simular(o, V, meses), a = avaliar(o, V, 0);
  $('#simTitle').textContent = `${o.tipo} ${fmtTaxa(o)} · ${o.plat}`;
  $('#simSub').innerHTML = `${esc(o.emissor)} · ${o.liq ? 'liquidez diária' : `vence em ${Math.round(o.prazo / 30.4)} meses (${new Date(Date.now() + o.prazo * 864e5).toLocaleDateString('pt-BR')})`} · mínimo ${brl(o.min)} · ${FGC.has(o.tipo) ? 'garantia do FGC' : o.tipo.startsWith('Tesouro') ? 'garantia do Tesouro' : 'sem FGC'}${V < o.min ? ' · <b class="down">valor abaixo do mínimo</b>' : ''}`;
  const lucro = s.liquido - V;
  $('#simKv').innerHTML = [
    ['Você investe', brl(V)],
    [`Valor bruto em ${Math.round(s.meses)} meses`, brl(s.brutoFinal)],
    s.custodia > .5 ? ['Custódia B3 (0,20% a.a.)', '− ' + brl(s.custodia)] : null,
    ['Imposto de renda', s.isento ? '<span class="pill up">isento</span>' : `− ${brl(s.ir)} <span class="sub">(${pct(s.aliq, 1)} do rendimento)</span>`],
    ['<b>Você recebe no resgate</b>', `<b class="num" style="font-size:18px">${brl(s.liquido)}</b>`],
    ['Lucro líquido', `<b class="up">+${brl(lucro)}</b> <span class="sub">(${sgnPct(lucro / (V || 1))} no período · ${pct(a.liqAA)} a.a.)</span>`],
    ['Descontada a inflação', `${brl(s.realFinal)} <span class="sub">em poder de compra de hoje (IPCA esperado ${pct(s.ipca, 1)} a.a.)</span>`]
  ].filter(Boolean).map(([k, v]) => `<span>${k}</span><span class="num">${v}</span>`).join('');
  const dif = s.liquido - s.poup, difCdb = s.liquido - s.cdb100;
  $('#simCmp').innerHTML = `Mesmo valor e prazo: poupança daria <b>${brl(s.poup)}</b> (${dif >= 0 ? `<span class="up">esta oferta rende ${brl(dif)} a mais</span>` : `<span class="down">${brl(-dif)} a menos</span>`}); um CDB de 100% do CDI daria <b>${brl(s.cdb100)}</b> (${difCdb >= 0 ? `<span class="up">+${brl(difCdb)}</span>` : `<span class="down">−${brl(-difCdb)}</span>`}). CDI e IPCA futuros pela curva do Focus.`;
  const lbl = s.serie.map(x => x.d === 0 ? 'hoje' : `${Math.round(x.d / 30.4)}m`);
  chart('chSim', { type: 'line', data: { labels: lbl, datasets: [
    { label: 'Líquido (já sem IR)', data: s.serie.map(x => Math.round(x.liquido)), borderColor: css('--up'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2 },
    { label: 'Bruto', data: s.serie.map(x => Math.round(x.brutoFinal)), borderColor: css('--ink-3'), borderDash: [4, 3], pointRadius: 0, borderWidth: 1.2 },
    { label: 'Investido', data: s.serie.map(() => V), borderColor: css('--c1'), pointRadius: 0, borderWidth: 1 }
  ] }, options: { ...base(), plugins: { legend: legend(), tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.raw)}` } } }, scales: { x: { ...axis(), ticks: { ...axis().ticks, maxTicksLimit: 8 } }, y: { ...axis(), ticks: { ...axis().ticks, callback: v => brl(v) } } } } });
}

function renderOffEditor() {
  const custom = !!store.get('af2.offers', null);
  $('#offSrc').textContent = `${OFF.length} ofertas · ${custom ? 'suas edições neste navegador' : 'do ofertas.js'}`;
  const sel = (o, k, opts) => `<select data-k="${k}">${opts.map(x => `<option${x === o[k] ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  $('#offTbl').innerHTML = `<thead><tr><th>Plataforma</th><th>Produto</th><th>Emissor</th><th>Indexador</th><th class="r">Taxa</th><th class="r">Prazo (d)</th><th class="r">Mínimo</th><th>Liq.</th><th><span class="vh">Apagar</span></th></tr></thead><tbody>${OFF.map((o, i) => `<tr data-i="${i}">
    <td><input data-k="plat" value="${esc(o.plat)}" list="platList"></td><td>${sel(o, 'tipo', TIPOS)}</td><td><input data-k="emissor" value="${esc(o.emissor)}"></td><td>${sel(o, 'idx', ['CDI', 'Pré', 'IPCA'])}</td>
    <td class="r"><input class="n num" data-k="taxa" type="number" step="0.1" value="${o.taxa}"></td><td class="r"><input class="n num" data-k="prazo" type="number" step="30" value="${o.prazo}"></td>
    <td class="r"><input class="n num" data-k="min" type="number" step="100" value="${o.min}"></td><td><input data-k="liq" type="checkbox" ${o.liq ? 'checked' : ''} style="width:auto"></td>
    <td><button class="btn ghost" data-del="${i}" aria-label="Apagar esta oferta"><span aria-hidden="true">✕</span></button></td></tr>`).join('')}</tbody><datalist id="platList">${plataformas().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
  $('#offTbl').querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
    const o = OFF[+el.closest('tr').dataset.i], k = el.dataset.k;
    o[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    saveOff();
  }));
  $('#offTbl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { OFF.splice(+b.dataset.del, 1); saveOff(); renderOffEditor(); });
}
function saveOff() { store.set('af2.offers', OFF); renderChips(); renderRF(); renderCarteira(); $('#offSrc').textContent = `${OFF.length} ofertas · suas edições neste navegador`; }

/* ================= monte sua carteira (método trader-budget + trader-risk) ================= */
const CLASSES = [
  { k: 'res', nome: 'Reserva (liquidez diária)', cor: '--c3' },
  { k: 'pos', nome: 'Renda fixa pós (CDI)', cor: '--c1' },
  { k: 'trav', nome: 'Renda fixa travada (pré/IPCA+)', cor: '--c4' },
  { k: 'acoes', nome: 'Ações', cor: '--c2' }
];
function pesosAuto(p, pv) {
  const resto = 1 - p.res, queda = M.selic - selicAt(12), real = (1 + M.cdi) / (1 + M.ipca12) - 1, notas = [];
  let ac = { conservador: 0, moderado: p.prazo >= 24 ? .25 : p.prazo >= 12 ? .10 : 0, arrojado: p.prazo >= 36 ? .45 : p.prazo >= 24 ? .30 : .10 }[p.perfil];
  if (ac > 0 && real > .07) { ac -= .05; notas.push(`juro real de ${pct(real)} favorece a renda fixa: −5 pontos em ações`); }
  if (ac > 0 && pv.score >= .3) { ac += .05; notas.push(`previsão do Ibovespa "${nivel(pv.score).l}": +5 pontos em ações`); }
  if (ac > 0 && pv.score <= -.3) { ac -= .05; notas.push(`previsão do Ibovespa "${nivel(pv.score).l}": −5 pontos em ações`); }
  ac = Math.max(0, ac) * resto;
  const rf = resto - ac, travShare = queda > .005 && p.prazo >= 24 ? .4 : 0;
  if (travShare) notas.push(`Focus vê Selic ${pct(queda)} menor em 12 meses: 40% da renda fixa travada em pré/IPCA+`);
  return { w: { res: p.res, pos: rf * (1 - travShare), trav: rf * travShare, acoes: ac }, notas };
}
function perfilCart() {
  return { valor: +$('#cValor').value || 0, prazo: Math.max(1, +$('#cPrazo').value || 12), perfil: $('#cPerfil').value, plat: $('#cPlat').value, obj: $('#cObj').value,
    res: clip((+$('#cRes').value || 0) / 100, 0, 1), cap: clip((+$('#cCap').value || 8) / 100, .01, .5), custom: $('#cCustom').checked };
}
function melhores(pool, filtro, valor, prazo, limiteEmissor = 250000) {
  // divide entre emissores para respeitar o FGC; Tesouro não tem limite
  const xs = pool.filter(filtro).map(o => ({ o, a: avaliar(o, valor, prazo) })).filter(x => x.a.ok).sort((a, b) => b.a.liqAA - a.a.liqAA);
  const out = [], usados = new Set(); let falta = valor;
  for (const x of xs) {
    if (falta <= 0) break;
    if (usados.has(x.o.emissor)) continue;
    const lim = x.o.tipo.startsWith('Tesouro') ? Infinity : limiteEmissor, v = Math.min(falta, lim);
    if (v < x.o.min) continue;
    out.push({ ...x, v }); usados.add(x.o.emissor); falta -= v;
  }
  return { linhas: out, falta };
}
/* dimensionar() e distribuirAporte() estão em calculos.js */
let lastCart = null;
function renderCarteira() {
  const p = perfilCart(), pv = previsaoIbov(); store.set('af2.cart', p);
  const auto = pesosAuto(p, pv);
  let w = { ...auto.w };
  if (p.custom) { const s = store.get('af2.sliders', null); if (s) { const t = Object.values(s).reduce((a, b) => a + b, 0) || 1; CLASSES.forEach(c => w[c.k] = s[c.k] / t); } }
  renderSliders(w, p.custom);
  const pool = OFF.filter(o => p.plat === '*' || o.plat === p.plat || o.plat === 'Tesouro Direto');
  const V = p.valor, linhas = [], notas = [...(p.custom ? ['percentuais ajustados à mão'] : auto.notas)];
  // reserva
  const vRes = V * w.res;
  if (vRes > 0) {
    const r = melhores(pool, o => o.liq, vRes, p.prazo, Infinity);
    if (r.linhas[0]) linhas.push({ cl: 'res', nome: r.linhas[0].o.tipo + ' ' + fmtTaxa(r.linhas[0].o), onde: r.linhas[0].o.plat, v: vRes, ret: r.linhas[0].a.liqAA, o: r.linhas[0].o });
    else notas.push('nenhuma oferta de liquidez diária nesta plataforma');
  }
  // renda fixa
  const rfBloco = (cl, filtro, valor) => {
    if (valor <= 0) return 0;
    const r = melhores(pool, o => !o.liq && filtro(o), valor, p.prazo);
    r.linhas.forEach(x => linhas.push({ cl, nome: `${x.o.tipo} ${fmtTaxa(x.o)}`, emissor: x.o.emissor, onde: x.o.plat, v: x.v, ret: x.a.liqAA, o: x.o, prazo: x.o.prazo }));
    return r.falta;
  };
  let faltaTrav = rfBloco('trav', o => o.idx !== 'CDI', V * w.trav);
  if (faltaTrav > 1) notas.push(`sem pré/IPCA+ elegível para ${brl(faltaTrav)}: foi para pós-fixado`);
  let faltaPos = rfBloco('pos', o => o.idx === 'CDI', V * w.pos + Math.max(0, faltaTrav));
  if (faltaPos > 1) { const r = melhores(pool, o => o.liq, faltaPos, p.prazo, Infinity); if (r.linhas[0]) linhas.push({ cl: 'res', nome: r.linhas[0].o.tipo + ' ' + fmtTaxa(r.linhas[0].o), onde: r.linhas[0].o.plat, v: faltaPos, ret: r.linhas[0].a.liqAA, o: r.linhas[0].o }); notas.push(`${brl(faltaPos)} sem renda fixa elegível no prazo: ficou na reserva`); }
  // ações: melhores previsões, uma por setor, pesos por nota ÷ volatilidade
  const vAc = V * w.acoes;
  if (vAc > 0) {
    const nMax = p.obj === 'trade' ? 5 : p.perfil === 'arrojado' ? 8 : 6;
    const cands = candidatosRV(p.obj, nMax);
    if (cands.length < 3) cands.push({ sym: 'BOVA11', etf: true, w: cands.reduce((s, x) => s + x.w, 0) || 1 });
    const d = dimensionar(cands, vAc, p.cap * V);
    d.linhas.forEach(x => linhas.push({ cl: 'acoes', nome: x.sym, emissor: x.etf ? 'ETF do Ibovespa' : x.a.setor, onde: p.plat === '*' ? 'qualquer corretora' : p.plat, v: x.v, ret: x.a && p.obj === 'dividendos' ? x.a.dy : null, retDy: p.obj === 'dividendos', acao: x.a, cap: x.cap, trade: x.stop ? x : null }));
    if (d.sobra > 1) { linhas.push({ cl: 'acoes', nome: 'BOVA11', emissor: 'ETF do Ibovespa', onde: p.plat === '*' ? 'qualquer corretora' : p.plat, v: d.sobra, ret: null, etf: true }); notas.push(`todas as ações bateram o teto de ${pct(p.cap, 0)}: ${brl(d.sobra)} foi para o ETF BOVA11`); }
  }
  // projeção
  const premio = .04, retAc = ((1 + cdiMedio(p.prazo)) * (1 + premio) - 1) * .85, anos = p.prazo / 12;
  const fin = linhas.reduce((s, l) => s + l.v * Math.pow(1 + (l.ret ?? retAc), anos), 0);
  const retMed = linhas.reduce((s, l) => s + l.v * (l.ret ?? retAc), 0) / (V || 1);
  lastCart = { p, linhas, w };
  // gráfico e tabela
  const porCl = CLASSES.map(c => ({ ...c, v: linhas.filter(l => l.cl === c.k).reduce((s, l) => s + l.v, 0) })).filter(c => c.v > 0);
  chart('chCart', { type: 'doughnut', data: { labels: porCl.map(c => c.nome), datasets: [{ data: porCl.map(c => Math.round(c.v)), backgroundColor: porCl.map(c => css(c.cor)), borderColor: css('--panel'), borderWidth: 2 }] },
    options: { ...base(), cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.raw)} (${pct(c.raw / V, 0)})` } } } } });
  $('#cKpis').innerHTML = porCl.map(c => `<span><i class="dot" style="background:${css(c.cor)}"></i>${c.nome}</span><b class="num">${pct(c.v / V, 0)} · ${brl(c.v)}</b>`).join('') +
    `<span class="mt">Retorno esperado</span><b class="num mt">${pct(retMed)} a.a. líquido</b><span>Em ${p.prazo} meses</span><b class="num">${brl(fin)} <span class="up">(+${brl(fin - V)})</span></b>`;
  $('#cResumo').textContent = `${linhas.length} posições · ${p.perfil}`;
  const corDe = k => css(CLASSES.find(c => c.k === k).cor);
  tabela($('#cTbl'), 'cart', [
    { k: 'n', h: 'Onde aplicar', w: 1, f: l => `<i class="dot" style="background:${corDe(l.cl)}" title="${CLASSES.find(c => c.k === l.cl).nome}"></i><b>${l.acao ? linkAtivo(l.acao.sym) : esc(l.nome)}</b> <span class="sub">${l.emissor ? esc(l.emissor) + ' · ' : ''}${l.acao ? '~' + Math.floor(l.v / l.acao.last) + (l.acao.fii ? ' cotas' : ' ações') : l.prazo ? 'vence em ' + Math.round(l.prazo / 30) + 'm' : l.etf ? 'ETF' : 'resgate diário'}<span class="so-mob"> · ${esc(l.onde)}</span></span>${l.trade ? `<br><span class="sub num">entrada R$ ${nf(l.trade.entrada, 2)} · stop <span class="down">R$ ${nf(l.trade.stop, 2)}</span> · alvo <span class="up">R$ ${nf(l.trade.alvo, 2)}</span></span>` : ''}`, v: l => CLASSES.findIndex(c => c.k === l.cl), asc: 1 },
    { k: 'o', h: 'Plataforma', cls: 'so-desk', f: l => esc(l.onde), v: l => l.onde, asc: 1 },
    { k: 'p', h: '%', r: 1, f: l => `<b class="num">${pct(l.v / V, 1)}</b>`, v: l => l.v },
    { k: 'v', h: 'Valor', r: 1, f: l => `<span class="num">${brl(l.v)}</span>`, v: l => l.v },
    { k: 'r', h: 'Ret. a.a.', r: 1, f: l => l.retDy ? `<span class="num">DY ${pct(l.ret, 1)}</span>` : l.ret != null ? `<span class="num">${pct(l.ret)}</span>` : (l.acao ? pillNivel(l.acao.prev) : '<span class="pill warn">variável</span>'), v: l => l.ret ?? retAc }
  ], linhas, { sort: { k: 'p', dir: -1 }, rerender: renderCarteira });
  // por quê
  const why = [];
  why.push(`Perfil <b>${p.perfil}</b>, ${p.prazo} meses: ${CLASSES.map(c => `${c.nome.split(' (')[0].toLowerCase()} ${pct(w[c.k], 0)}`).join(', ')}.`);
  notas.forEach(n => why.push(n[0].toUpperCase() + n.slice(1) + '.'));
  const rfBest = linhas.filter(l => l.cl === 'pos' || l.cl === 'trav').sort((a, b) => b.ret - a.ret)[0];
  if (rfBest) why.push(`Melhor renda fixa no seu prazo: <b>${rfBest.nome}</b> (${rfBest.onde}), ${pct(rfBest.ret)} líquido ao ano.`);
  const ac = linhas.filter(l => l.acao);
  if (ac.length) why.push({
    dividendos: `Objetivo <b>dividendos</b>: ações e FIIs com maior dividend yield dos últimos 12 meses (entre 5% e 25%, sem tendência de queda forte), um por setor/segmento: ${ac.map(l => `<b>${l.nome}</b>${l.acao ? ` (DY ${pct(l.acao.dy, 1)})` : ''}`).join(', ')}. Renda estimada: <b>${brl(ac.reduce((s, l) => s + (l.acao ? l.v * l.acao.dy : 0), 0) / 12)}/mês</b>, isenta de IR para pessoa física (dividendos e rendimentos de FII).`,
    trade: `Objetivo <b>trade</b>: ações com sinal técnico forte (Compra/Compra forte, IFR abaixo de 75): ${ac.map(l => `<b>${l.nome}</b>`).join(', ')}. Cada uma tem <b>stop</b> (saia se cair até ele) e <b>alvo</b> (realize o lucro), com risco/retorno de 2:1. Saia também se a previsão virar Venda. Trade tem IR de 15% sobre o lucro (20% em day trade) e exige acompanhar todo dia.`,
    equilibrado: `Ações escolhidas pela melhor previsão, uma por setor, com peso maior para quem tem nota alta e volatilidade baixa: ${ac.map(l => `<b>${l.nome}</b>`).join(', ')}.`
  }[p.obj] + ` Teto de ${pct(p.cap, 0)} do total por ação; fatias abaixo de R$ 100 são descartadas.`);
  why.push(`Retorno de ações assume CDI + 4 p.p. menos 15% de IR — é uma hipótese para a projeção, não uma previsão.`);
  why.push('Revise a carteira quando alguma classe se afastar mais de 5 pontos do alvo (rebalanceamento).');
  $('#cWhy').innerHTML = why.map(x => `<li>${x}</li>`).join('');
  // checagem de risco
  const ck = [];
  const porEmissor = {}; linhas.filter(l => l.o && FGC.has(l.o.tipo)).forEach(l => porEmissor[l.emissor || l.o.emissor] = (porEmissor[l.emissor || l.o.emissor] || 0) + l.v);
  const maxEm = Object.entries(porEmissor).sort((a, b) => b[1] - a[1])[0];
  ck.push(['Limite do FGC por emissor (R$ 250 mil)', !maxEm || maxEm[1] <= 250000, maxEm ? `maior: ${maxEm[0]} com ${brl(maxEm[1])}` : 'sem títulos com FGC']);
  const maxAc = ac.sort((a, b) => b.v - a.v)[0];
  ck.push([`Teto por ação (${pct(p.cap, 0)} do total)`, !maxAc || maxAc.v <= p.cap * V + 1, maxAc ? `maior: ${maxAc.nome} com ${pct(maxAc.v / V, 1)}` : 'sem ações']);
  ck.push(['Títulos vencem dentro do seu prazo', linhas.every(l => !l.prazo || l.prazo <= p.prazo * 30.4 + 15), 'todos os vencimentos ≤ prazo']);
  ck.push(['Aplicação mínima de cada oferta', linhas.every(l => !l.o || l.v >= l.o.min), 'todas acima do mínimo']);
  const resV = linhas.filter(l => l.cl === 'res').reduce((s, l) => s + l.v, 0);
  ck.push(['Reserva de liquidez', p.perfil === 'arrojado' || resV / V >= .1, `${pct(resV / V, 0)} (${brl(resV)}) com resgate no mesmo dia`]);
  ck.push(['Nenhuma ação com previsão de venda', ac.every(l => !l.acao || l.acao.prev > -.1), 'só entram ações com previsão Compra ou Compra forte']);
  const setores = new Set(ac.map(l => l.emissor)); ck.push(['Diversificação entre setores', ac.length <= 1 || setores.size === ac.length, `${setores.size} setores diferentes`]);
  tabela($('#cRisk'), 'risk', [
    { k: 's', h: '', sr: 'Resultado', f: r => r[1] ? '<span class="pill up">OK</span>' : '<span class="pill warn">ATENÇÃO</span>' },
    { k: 'n', h: 'Regra', w: 1, f: r => `${r[0]}<br><span class="sub">${r[2]}</span>` }
  ], ck, { rerender: renderCarteira });
}
function renderSliders(w, on) {
  const box = $('#cSliders'); box.style.display = on ? 'grid' : 'none'; if (!on) return;
  const s = store.get('af2.sliders', null) || Object.fromEntries(CLASSES.map(c => [c.k, Math.round(w[c.k] * 100)]));
  if (!store.get('af2.sliders', null)) store.set('af2.sliders', s);
  const tot = Object.values(s).reduce((a, b) => a + b, 0) || 1;
  if (box.dataset.built !== '1') {
    box.innerHTML = CLASSES.map(c => `<div class="slider"><span><i class="dot" style="background:${css(c.cor)}"></i>${c.nome.split(' (')[0]}</span><input type="range" min="0" max="100" data-k="${c.k}" aria-label="${c.nome.split(' (')[0]}"><span class="num" data-o="${c.k}"></span></div>`).join('') + '<button class="btn ghost" id="slReset" style="justify-self:start">voltar ao automático</button>';
    box.dataset.built = '1';
    box.querySelectorAll('input').forEach(i => i.oninput = () => { const v = store.get('af2.sliders', {}); v[i.dataset.k] = +i.value; store.set('af2.sliders', v); renderCarteira(); });
    $('#slReset').onclick = () => { store.set('af2.sliders', null); localStorage.removeItem('af2.sliders'); box.dataset.built = ''; renderCarteira(); };
  }
  CLASSES.forEach(c => { box.querySelector(`input[data-k="${c.k}"]`).value = s[c.k]; box.querySelector(`[data-o="${c.k}"]`).textContent = Math.round(s[c.k] / tot * 100) + '%'; });
}

/* ================= ações ================= */
let aSel = null, APER = store.get('af2.aper', 252), VOLTA = null;
/* nome de ação/FII clicável em qualquer tabela: leva ao gráfico na aba Ações */
const linkAtivo = sym => `<a href="#acoes" class="tk" data-ativo="${esc(sym)}" title="ver o gráfico de ${esc(sym)} ao longo do tempo">${esc(sym)}</a>`;
function abrirAtivo(sym) {
  if (!U[sym] && !UF[sym]) return;
  const aba = document.querySelector('section.tab.on')?.id.replace('tab-', '');
  VOLTA = aba && aba !== 'acoes' ? { aba, y: scrollY } : VOLTA;
  $('#aTipo').value = UF[sym] && !U[sym] ? 'fii' : 'acoes';
  $('#aBusca').value = ''; $('#aSinal').value = ''; $('#aSetor').value = '';
  aSel = sym; goto('acoes'); renderAcoes();
  const tr = $('#aTbl tr.sel'), box = tr?.closest('.scroll');   // a linha do ativo fica visível na tabela
  if (box) box.scrollTop = tr.offsetTop - box.clientHeight / 2;
  $('#aChCard').scrollIntoView({ behavior: SUAVE, block: 'start' });
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-ativo]'); if (!a) return;
  e.preventDefault(); e.stopPropagation(); abrirAtivo(a.dataset.ativo);
}, true);
function renderAcoes() {
  const q = $('#aBusca').value.trim().toUpperCase(), se = $('#aSetor').value, sn = $('#aSinal').value, fii = $('#aTipo').value === 'fii', SRC = fii ? UF : U;
  const setores = [...new Set(Object.values(SRC).map(a => a.setor))].sort(), selS = $('#aSetor');
  if (selS.dataset.tipo !== $('#aTipo').value) { selS.dataset.tipo = $('#aTipo').value; selS.innerHTML = `<option value="">${fii ? 'Todos os segmentos' : 'Todos os setores'}</option>` + setores.map(x => `<option>${esc(x)}</option>`).join(''); }
  const rows = Object.values(SRC).filter(a => (!q || a.sym.includes(q)) && (!se || a.setor === se) && (sn === '' || nivel(a.prev).n === +sn));
  $('#aCount').textContent = `${rows.length} de ${Object.keys(SRC).length} ${fii ? 'FIIs' : 'ações'}`;
  if (!aSel || !SRC[aSel]) aSel = [...rows].sort((a, b) => b.prev - a.prev)[0]?.sym;
  tabela($('#aTbl'), 'acoes', [
    { k: 's', h: 'Ativo', f: a => `<b>${a.sym}</b><br><span class="sub">${a.setor}</span>`, v: a => a.sym, asc: 1 },
    { k: 'pv', h: 'Previsão 4 sem.', f: a => pillNivel(a.prev), v: a => a.prev },
    { k: 'p', h: 'Preço', r: 1, f: a => `<span class="num">${nf(a.last, 2)}</span>`, v: a => a.last },
    { k: 'd', h: 'Dia', r: 1, f: a => `<span class="num ${cls(a.dia)}">${sgnPct(a.dia, 2)}</span>`, v: a => a.dia },
    { k: 'r1', h: '1m', r: 1, f: a => `<span class="num ${cls(a.r1)}">${sgnPct(a.r1)}</span>`, v: a => a.r1 },
    { k: 'r3', h: '3m', r: 1, f: a => `<span class="num ${cls(a.r3)}">${sgnPct(a.r3)}</span>`, v: a => a.r3 },
    { k: 'r12', h: '12m', r: 1, f: a => `<span class="num ${cls(a.r12)}">${sgnPct(a.r12)}</span>`, v: a => a.r12 },
    { k: 'dy', h: 'DY 12m', r: 1, f: a => a.dy ? `<span class="num">${pct(a.dy, 1)}</span>` : '', v: a => a.dy },
    { k: 'rsi', h: 'IFR', r: 1, f: a => `<span class="num">${a.rsi?.toFixed(0) ?? '—'}</span>`, v: a => a.rsi },
    { k: 'vol', h: 'Vol.', r: 1, f: a => `<span class="num">${pct(a.vol, 0)}</span>`, v: a => a.vol, asc: 1 },
    { k: 't', h: 'Técnico', f: a => pillNivel(a.tec), v: a => a.tec },
    { k: 'n', h: 'Notícias', f: a => humorPill(a.h), v: a => a.h?.m ?? 0 },
    { k: 'bt', h: 'Acerto hist.', r: 1, f: a => a.bt ? `<span class="num ${a.bt.acc > a.bt.base + .03 ? 'up' : a.bt.acc < a.bt.base - .03 ? 'down' : ''}" title="sempre alta: ${pct(a.bt.base, 0)} · ${a.bt.n} sinais">${pct(a.bt.acc, 0)}</span> <span class="sub num">/${pct(a.bt.base, 0)}</span>` : '—', v: a => a.bt ? a.bt.acc - a.bt.base : null }
  ], rows, { sort: { k: 'pv', dir: -1 }, rerender: renderAcoes, rowCls: a => a.sym === aSel ? 'sel' : '', onRow: a => { aSel = a.sym; renderAcoes(); }, empty: D ? 'Nenhuma ação com esses filtros.' : 'Sem dados de ações (dados.js ausente).' });
  const a = SRC[aSel]; if (!a) return;
  $('#aChTitle').textContent = `${a.sym} · ${a.nome || a.setor}`;
  // período efetivo: o escolhido, ou o maior que o histórico deste ativo comporta (FII tem 1 ano)
  const n = a.x.c.length, per = [504, 252, 126, 63].find(v => v <= APER && periodoDisponivel(v, n)) || 63, ini = Math.max(0, n - per), sl = arr => arr.slice(ini);
  document.querySelectorAll('#aPer button').forEach(b => { b.classList.toggle('on', +b.dataset.v === per); b.disabled = !periodoDisponivel(+b.dataset.v, n); });
  // período, variação no período e, se a pessoa tem o ativo, a posição dela
  const varP = a.x.c[n - 1] / a.x.c[ini] - 1, desde = new Date(a.x.t[ini] * 1000).toLocaleDateString('pt-BR');
  const meus = typeof HOLD !== 'undefined' ? HOLD.filter(h => typeof tickerDe === 'function' && tickerDe(h) === a.sym) : [];
  const qtd = meus.reduce((s, h) => s + (+h.qtd || 0), 0), val = meus.reduce((s, h) => s + (typeof valorDe === 'function' ? valorDe(h) : 0), 0);
  $('#aChSub').innerHTML = `Desde ${desde}: <b class="${cls(varP)}">${sgnPct(varP)}</b> · preço com MM20, MM50 e MM200${meus.length ? ` · <b>na sua carteira: ${qtd ? `${nf(qtd)} ${a.fii ? 'cotas' : 'ações'} · ` : ''}${brl(val)}</b>` : ''}`;
  $('#aVoltar').hidden = !VOLTA;
  chart('chAcao', { type: 'line', data: { labels: sl(a.x.t).map(t => new Date(t * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })), datasets: [
    { label: 'Preço', data: sl(a.x.c), borderColor: css('--c1'), pointRadius: 0, borderWidth: 2 },
    { label: 'MM20', data: sl(a.I.sma[20]), borderColor: css('--c2'), pointRadius: 0, borderWidth: 1.2 },
    { label: 'MM50', data: sl(a.I.sma[50]), borderColor: css('--c4'), pointRadius: 0, borderWidth: 1.2 },
    { label: 'MM200', data: sl(a.I.sma[200]), borderColor: css('--ink-3'), pointRadius: 0, borderWidth: 1.2, borderDash: [4, 3] }
  ] }, options: { ...base(), plugins: { legend: legend() }, scales: { x: { ...axis(), ticks: { ...axis().ticks, maxTicksLimit: 6 } }, y: axis() } } });
  const v = votos(a.I, n - 1), cnt = (g, s) => v.filter(x => x.g === g && x.voto === s).length;
  $('#aSumSub').innerHTML = `Médias: <b class="up">${cnt('ma', 1)} compra</b> · ${cnt('ma', 0)} neutro · <b class="down">${cnt('ma', -1)} venda</b> &nbsp; Osciladores: <b class="up">${cnt('osc', 1)}</b> · ${cnt('osc', 0)} · <b class="down">${cnt('osc', -1)}</b><br>Previsão: ${pillNivel(a.prev)} = 70% técnico ${a.tec.toFixed(2)} + 15% notícias ${a.nNews.toFixed(2)} + 15% setor ${a.nSetor.toFixed(2)}`;
  $('#aVotes').innerHTML = `<thead><tr><th>Indicador</th><th class="r">Valor</th><th>Voto</th></tr></thead><tbody>${v.map(x => `<tr><td>${x.nome}</td><td class="r num">${x.nome.startsWith('MM') ? nf(x.val, 2) : x.nome.startsWith('Momento') ? sgnPct(x.val) : nf(x.val, 1)}</td><td>${x.voto > 0 ? '<span class="pill up">Compra</span>' : x.voto < 0 ? '<span class="pill down">Venda</span>' : '<span class="pill flat">Neutro</span>'}</td></tr>`).join('')}</tbody>`;
}

/* ================= notícias ================= */
function renderNoticias() {
  const q = $('#nBusca').value.trim().toLowerCase(), cat = $('#nCat').value, tk = $('#nTk').value, se = $('#nSent').value;
  const L = NEWS.filter(n => (!q || n.titulo.toLowerCase().includes(q)) && (!cat || n.categoria === cat) && (!tk || n.tickers.includes(tk)) && (se === '' || Math.sign(n.sent) === +se));
  $('#nCount').textContent = `${L.length} de ${NEWS.length}`;
  $('#nList').innerHTML = D ? newsItems(L.slice(0, 200)) : '<li class="sub">Sem notícias: o dados.js ainda não foi gerado.</li>';
  const nl = leituraNoticias();
  $('#nVerdict').textContent = nl.label; $('#nVerdict').className = 'verdict mt ' + (nl.score > .3 ? 'up' : nl.score < -.3 ? 'down' : '');
  $('#nVerdictSub').textContent = nl.txt;
  newsChart('chNewsDay2', nl.dias);
  const cats = [...new Set(NEWS.map(n => n.categoria))].map(c => ({ c, h: humor(NEWS.filter(n => n.categoria === c)) }));
  tabela($('#nCatTbl'), 'nCat', [
    { k: 'c', h: 'Tema', f: r => r.c, v: r => r.c, asc: 1 }, { k: 'n', h: 'Qtd.', r: 1, f: r => `<span class="num">${r.h.n}</span>`, v: r => r.h.n }, { k: 'h', h: 'Tom', f: r => humorPill(r.h), v: r => r.h.m }
  ], cats, { rerender: renderNoticias, onRow: r => { $('#nCat').value = $('#nCat').value === r.c ? '' : r.c; renderNoticias(); } });
  const tks = [...new Set(NEWS.flatMap(n => n.tickers))].map(t => ({ t, h: humor(NEWS.filter(n => n.tickers.includes(t))) }));
  tabela($('#nTkTbl'), 'nTk', [
    { k: 't', h: 'Ação', f: r => `<b>${r.t}</b>`, v: r => r.t, asc: 1 }, { k: 'n', h: 'Qtd.', r: 1, f: r => `<span class="num">${r.h.n}</span>`, v: r => r.h.n }, { k: 'h', h: 'Tom', f: r => humorPill(r.h), v: r => r.h.m }
  ], tks, { sort: { k: 'n', dir: -1 }, rerender: renderNoticias, rowCls: r => r.t === tk ? 'sel' : '', onRow: r => { $('#nTk').value = tk === r.t ? '' : r.t; renderNoticias(); } });
}
function preencherSelects() {
  const fill = (el, vals) => { const cur = el.value; el.querySelectorAll('option:not(:first-child)').forEach(o => o.remove()); vals.forEach(v => el.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`)); el.value = cur; };
  fill($('#nCat'), [...new Set(NEWS.map(n => n.categoria))]);
  fill($('#nTk'), [...new Set(NEWS.flatMap(n => n.tickers))].sort());
  const cp = $('#cPlat'), cur = cp.value || store.get('af2.cart', {}).plat || '*';
  cp.innerHTML = '<option value="*">Todas (a melhor de cada)</option>' + plataformas().filter(p => p !== 'Tesouro Direto').map(p => `<option>${esc(p)}</option>`).join('');
  cp.value = [...cp.options].some(o => o.value === cur) ? cur : '*';
}

/* ================= juros e câmbio ================= */
function renderMacro() {
  const tip = f => ({ callbacks: { title: i => new Date(i[0].parsed.x).toLocaleDateString('pt-BR'), label: c => ` ${c.dataset.label}: ${f(c.parsed.y)}` } });
  const fpts = (obj, mult, last) => [last, ...Object.keys(obj).sort().filter(y => +y >= new Date().getFullYear()).map(y => ({ x: new Date(+y, 11, 31).getTime(), y: obj[y] * mult }))].filter(Boolean);
  const yP = { ...axis(), ticks: { ...axis().ticks, callback: v => v + '%' } };
  const sh = M.selicHist.map(x => ({ x: x.d.getTime(), y: x.v * 100 }));
  chart('chSelic', { type: 'line', data: { datasets: [{ label: 'Selic', data: sh, borderColor: css('--c1'), stepped: true, pointRadius: 0, borderWidth: 2 }, { label: 'Focus', data: fpts(M.focusSelic, 100, sh.at(-1)), borderColor: css('--c2'), borderDash: [5, 4], pointRadius: 3, borderWidth: 2 }] }, options: { ...base(), plugins: { legend: legend(), tooltip: tip(v => v.toFixed(2) + '%') }, scales: { x: { ...tScale(), min: sh[0]?.x }, y: yP } } });
  const ih = M.ipcaHist.map(x => ({ x: x.d.getTime(), y: x.v * 100 }));
  chart('chIpca', { type: 'line', data: { datasets: [{ label: 'IPCA 12m', data: ih, borderColor: css('--c5'), pointRadius: 0, borderWidth: 2, tension: .25 }, { label: 'Focus', data: fpts(M.focusIpca, 100, ih.at(-1)), borderColor: css('--c2'), borderDash: [5, 4], pointRadius: 3, borderWidth: 2 }] }, options: { ...base(), plugins: { legend: legend(), tooltip: tip(v => v.toFixed(2) + '%') }, scales: { x: { ...tScale(), min: ih[0]?.x }, y: yP } } });
  const uh = M.usdHist.map(x => ({ x: x.d.getTime(), y: x.v }));
  chart('chUsd', { type: 'line', data: { datasets: [{ label: 'PTAX', data: uh, borderColor: css('--c3'), pointRadius: 0, borderWidth: 2 }, { label: 'Focus', data: fpts(M.focusUsd, 1, uh.at(-1)), borderColor: css('--c2'), borderDash: [5, 4], pointRadius: 3, borderWidth: 2 }] }, options: { ...base(), plugins: { legend: legend(), tooltip: tip(v => 'R$ ' + v.toFixed(3)) }, scales: { x: tScale(), y: { ...axis(), ticks: { ...axis().ticks, callback: v => 'R$ ' + v.toFixed(2) } } } } });
  if (IB) {
    const x = IB.x, ini = Math.max(0, x.c.length - 252), pts = a => a.slice(ini).map((v, i) => ({ x: x.t[ini + i] * 1000, y: v }));
    chart('chIbov', { type: 'line', data: { datasets: [{ label: 'Ibovespa', data: pts(x.c), borderColor: css('--c1'), pointRadius: 0, borderWidth: 2 }, { label: 'MM50', data: pts(IB.I.sma[50]), borderColor: css('--c2'), pointRadius: 0, borderWidth: 1.2 }, { label: 'MM200', data: pts(IB.I.sma[200]), borderColor: css('--c4'), pointRadius: 0, borderWidth: 1.2 }] }, options: { ...base(), plugins: { legend: legend(), tooltip: tip(v => nf(v)) }, scales: { x: { ...tScale(), min: x.t[ini] * 1000, max: x.t.at(-1) * 1000 }, y: { ...axis(), ticks: { ...axis().ticks, callback: v => (v / 1000).toFixed(0) + ' mil' } } } } });
  }
  const real = (1 + M.cdi) / (1 + M.ipca12) - 1, s12 = selicAt(12), s24 = selicAt(24);
  $('#mWhy').innerHTML = [
    `<b>Juros</b>: Selic em ${pct(M.selic)}; o Focus projeta ${pct(s12)} em 12 meses e ${pct(s24)} em 24 — ${M.selic - s24 > .01 ? '<b>ciclo de corte</b>. Travar pré/IPCA+ agora protege o rendimento; o pós-fixado cai a cada corte.' : 'estabilidade.'}`,
    `<b>Inflação</b>: IPCA de ${pct(M.ipca12)} em 12 meses (meta 3%). Juro real de ${pct(real)} — ${real > .06 ? 'muito alto, a renda fixa paga bem sem risco de bolsa' : 'moderado'}.`,
    `<b>Câmbio</b>: dólar a R$ ${nf(M.usd, 3)}; Focus vê R$ ${nf(M.focusUsd[new Date().getFullYear() + 1] ?? M.focusUsd[new Date().getFullYear()], 2)} no fim do ano que vem.`,
    `<b>Bolsa</b>: juros em queda reduzem o custo de capital e costumam ajudar setores sensíveis a juros (varejo, construção, elétricas).${M.focusData ? ` <span class="sub">Focus de ${new Date(M.focusData + 'T12:00').toLocaleDateString('pt-BR')}.</span>` : ''}`
  ].map(x => `<li>${x}</li>`).join('');
}

/* ================= orquestração ================= */
function renderTudo() {
  rebuild(); preencherSelects();
  const pv = previsaoIbov();
  renderStrip(pv); renderPainel(pv); renderChips(); renderRF(); renderOffEditor(); renderCarteira(); renderAcoes(); renderNoticias(); renderMacro();
  if (typeof renderExist === 'function') renderExist();
}
function goto(tab) {
  document.querySelectorAll('div.tabs [role=tab]').forEach(x => { const on = x.dataset.tab === tab; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab));
  store.set('af2.tab', tab); history.replaceState(null, '', '#' + tab);
}
async function atualizarDados() {
  try { await loadScript('dados.js'); } catch {}
  if (!store.get('af2.offers', null)) { try { await loadScript('ofertas.js'); OFF = BASE_OFF(); } catch {} }
  renderTudo();
}
document.querySelectorAll('div.tabs [role=tab]').forEach(b => b.onclick = () => goto(b.dataset.tab));
// teclado nas abas (padrão ARIA): ←/→ trocam, Home/End vão às pontas; o foco acompanha a aba
$('div.tabs').addEventListener('keydown', e => {
  const abas = [...document.querySelectorAll('div.tabs [role=tab]')], i = abas.indexOf(document.activeElement); if (i < 0) return;
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key]; if (j == null) return;
  e.preventDefault(); const b = abas[(j + abas.length) % abas.length]; goto(b.dataset.tab); b.focus();
});
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => goto(b.dataset.goto));
['#fValor', '#fPrazo', '#fIdx', '#fBusca', '#fIsento', '#fFgc', '#fLiq', '#fElig'].forEach(id => $(id).addEventListener('input', renderRF));
['#simValor', '#simPrazo'].forEach(id => $(id).addEventListener('input', renderSim));
$('#simClose').onclick = () => { SIM.o = null; $('#simCard').hidden = true; renderRF(); };
['#cValor', '#cPrazo', '#cPerfil', '#cPlat', '#cRes', '#cCap', '#cCustom', '#cObj'].forEach(id => $(id).addEventListener('input', renderCarteira));
['#aTipo', '#aBusca', '#aSetor', '#aSinal'].forEach(id => $(id).addEventListener('input', renderAcoes));
document.querySelectorAll('#aPer button').forEach(b => b.onclick = () => { APER = +b.dataset.v; store.set('af2.aper', APER); renderAcoes(); });
$('#aVoltar').onclick = () => { const v = VOLTA; VOLTA = null; if (!v) return; goto(v.aba); setTimeout(() => scrollTo({ top: v.y, behavior: SUAVE }), 50); };
['#nBusca', '#nCat', '#nTk', '#nSent'].forEach(id => $(id).addEventListener('input', renderNoticias));
$('#offAdd').onclick = () => { OFF.unshift({ plat: 'XP', tipo: 'LCA', emissor: '', idx: 'CDI', taxa: 90, prazo: 720, min: 1000, liq: false }); saveOff(); renderOffEditor(); };
$('#offReset').onclick = () => { if (confirm('Descartar suas edições e voltar para o ofertas.js?')) { try { localStorage.removeItem('af2.offers'); } catch {} OFF = BASE_OFF(); renderOffEditor(); renderChips(); renderRF(); renderCarteira(); } };
$('#offExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`window.OFERTAS = ${JSON.stringify(OFF, null, 2)};\n`], { type: 'text/javascript' })); a.download = 'ofertas.js'; a.click(); };
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'; store.set('af2.theme', document.documentElement.dataset.theme); renderTudo();
};

/* ================= acessibilidade ================= */
// Botões de alternância (.chip e .seg) marcam o estado só com a classe "on": repassa como aria-pressed.
// Campos dentro de tabelas editáveis ganham como nome o cabeçalho da coluna e o número da linha.
function a11y(raiz) {
  raiz.querySelectorAll('button.chip, .seg button').forEach(b => { if (!b.dataset.all) b.setAttribute('aria-pressed', b.classList.contains('on')); });
  raiz.querySelectorAll('td input, td select').forEach(c => {
    if (c.hasAttribute('aria-label')) return;
    const td = c.closest('td'), tr = td.parentElement, th = td.closest('table')?.querySelector('thead tr')?.children[td.cellIndex];
    c.setAttribute('aria-label', `${(th?.textContent || 'Campo').replace(/[↕▲▼]/g, '').trim()} — linha ${tr.sectionRowIndex + 1}`);
  });
}
new MutationObserver(ms => { if (ms.some(m => m.type === 'childList' || m.target.matches?.('button'))) a11y(document); })
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
// áreas com rolagem própria precisam ser alcançáveis pelo teclado para rolar (WCAG 2.1.1)
document.querySelectorAll('.scroll, #strip').forEach(el => {
  el.tabIndex = 0; el.setAttribute('role', 'group');
  const t = el.id === 'strip' ? 'Indicadores do dia' : el.closest('.card')?.querySelector('h2')?.textContent.trim();
  el.setAttribute('aria-label', (t || 'Tabela') + ' (área rolável)');
});

(async function init() {
  const th = store.get('af2.theme', null); if (th) document.documentElement.dataset.theme = th;
  const rf = store.get('af2.rf', null);
  if (rf) { $('#fValor').value = rf.valor; $('#fPrazo').value = rf.prazo || ''; $('#fIdx').value = rf.idx; $('#fIsento').checked = rf.isento; $('#fFgc').checked = rf.fgc; $('#fLiq').checked = rf.liq; $('#fElig').checked = rf.elig; }
  const cp = store.get('af2.cart', null);
  if (cp) { $('#cValor').value = cp.valor; $('#cPrazo').value = cp.prazo; $('#cPerfil').value = cp.perfil; $('#cRes').value = Math.round(cp.res * 100); $('#cCap').value = Math.round(cp.cap * 100); $('#cCustom').checked = cp.custom; if (cp.obj) $('#cObj').value = cp.obj; }
  const tab = location.hash.slice(1) || store.get('af2.tab', 'painel'); if (document.getElementById('tab-' + tab)) goto(tab);
  renderTudo(); a11y(document);
  await loadMacro();
  renderTudo();
  // atualização automática: dados de mercado a cada 10 min, Banco Central a cada 30 min
  setInterval(() => { if (!document.hidden) atualizarDados(); }, 10 * 6e4);
  setInterval(async () => { if (!document.hidden) { await loadMacro(); renderTudo(); } }, 30 * 6e4);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && D && Date.now() - new Date(D.geradoEm) > 40 * 6e4) atualizarDados(); });
})();
