/* Analisar uma carteira existente: entrada manual ou importação (B3, corretora, IR),
 * diagnóstico contra o alvo do perfil, onde colocar o aporte e análise opcional com o Claude.
 * Usa as funções e o estado globais do app.js. Nada sai do navegador, exceto a chamada à IA
 * quando o usuário pede, com a própria chave. */

/* ================= ativos ================= */
const TIPOS_ATIVO = ['Ação', 'FII', 'ETF', 'BDR', 'CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'Debênture', 'Debênture incentivada',
  'Tesouro Selic', 'Tesouro Pré', 'Tesouro IPCA+', 'Poupança', 'Conta corrente', 'Fundo DI/renda fixa', 'Fundo multimercado', 'Fundo de ações', 'Previdência', 'Cripto', 'Outro'];
const CL_EXT = [...CLASSES, { k: 'outros', nome: 'Outros (fundos, previdência, cripto)', cor: '--c6' }];
let HOLD = store.get('af2.holdings', []);
const salvarHold = () => store.set('af2.holdings', HOLD);

function classeDe(h) {
  const t = h.tipo;
  if (['Poupança', 'Conta corrente', 'Tesouro Selic', 'Fundo DI/renda fixa'].includes(t)) return 'res';
  if (['Tesouro Pré', 'Tesouro IPCA+'].includes(t)) return 'trav';
  if (['CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'Debênture', 'Debênture incentivada'].includes(t)) return h.idx === 'Pré' || h.idx === 'IPCA' ? 'trav' : 'pos';
  if (['Ação', 'FII', 'ETF', 'BDR', 'Fundo de ações'].includes(t)) return 'acoes';
  return 'outros';
}
const tickerDe = h => (String(h.ativo || '').toUpperCase().match(/\b[A-Z]{4}\d{1,2}\b/) || [null])[0];
function valorDe(h) {
  const tk = tickerDe(h);
  if (h.qtd > 0 && tk && U[tk]) return h.qtd * U[tk].last;
  return +h.valor || 0;
}

/* ================= importação ================= */
const numBR = s => {
  if (typeof s === 'number') return s;
  const m = String(s ?? '').replace(/R\$|\s/g, '').match(/-?[\d.]*,\d+|-?\d+(\.\d+)?/);
  if (!m) return NaN;
  const t = m[0]; return t.includes(',') ? +t.replace(/\./g, '').replace(',', '.') : +t;
};
function tipoPorTexto(txt, dica = '') {
  const s = `${dica} ${txt}`.toUpperCase();
  const regras = [
    [/TESOURO\s+SELIC|LFT\b/, 'Tesouro Selic'], [/TESOURO\s+(IPCA|RENDA|EDUCA)|NTN-?B/, 'Tesouro IPCA+'], [/TESOURO\s+PREFIXADO|LTN\b|NTN-?F/, 'Tesouro Pré'],
    [/\bLCI\b/, 'LCI'], [/\bLCA\b/, 'LCA'], [/\bCRI\b/, 'CRI'], [/\bCRA\b/, 'CRA'], [/DEB[ÊE]NTURE.*INCENTIV|INCENTIVAD/, 'Debênture incentivada'], [/DEB[ÊE]NTURE/, 'Debênture'],
    [/\bCDB\b|\bRDB\b|\bLC\b/, 'CDB'], [/POUPAN[ÇC]A/, 'Poupança'], [/CONTA CORRENTE|DEP[ÓO]SITO [ÀA] VISTA/, 'Conta corrente'],
    [/PREVID|PGBL|VGBL/, 'Previdência'], [/BITCOIN|CRIPTO|ETHEREUM/, 'Cripto'], [/\bFII\b|IMOBILI[ÁA]RIO/, 'FII'], [/\bETF\b|\bBOVA11|\bIVVB11|\bSMAL11/, 'ETF'], [/\bBDR\b|\b[A-Z]{4}3[2-5]\b/, 'BDR'],
    [/FUNDO.*(A[ÇC][ÕO]ES|FIA)/, 'Fundo de ações'], [/MULTIMERCADO|\bFIM\b/, 'Fundo multimercado'], [/FUNDO|\bFI\b|\bDI\b/, 'Fundo DI/renda fixa'],
    [/\b[A-Z]{4}11\b/, 'FII'], [/\b[A-Z]{4}(3|4|5|6)\b|A[ÇC][ÕO]ES/, 'Ação']
  ];
  return (regras.find(([re]) => re.test(s)) || [, null])[1];
}
const idxPorTexto = s => /IPCA|NTN-?B/i.test(s) ? 'IPCA' : /PR[ÉE]|PREFIXAD|LTN/i.test(s) ? 'Pré' : /CDI|DI\b|SELIC/i.test(s) ? 'CDI' : '';
function venc(s) {
  const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/) || String(s ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) { const y = String(s ?? '').match(/\b(20[2-6]\d)\b/); return y ? `${y[1]}-12-31` : ''; }
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
}

/* planilhas e CSV: acha o cabeçalho e as colunas de nome e valor (layout da B3 e da maioria das corretoras) */
function lerTabela(rows, dica = '') {
  const norm = v => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hi = rows.findIndex(r => r.some(c => /produto|ativo|codigo|papel|titulo|descricao|investimento/.test(norm(c))) && r.some(c => /valor|saldo|posicao|total/.test(norm(c))));
  if (hi < 0) return [];
  const H = rows[hi].map(norm), col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const cNome = col(/codigo de negociacao/, /^produto/, /^ativo/, /papel/, /titulo/, /descricao/, /investimento/);
  const cValor = col(/valor atualizado/, /valor liquido/, /saldo liquido/, /valor bruto/, /posicao/, /saldo/, /valor total/, /^valor/);
  const cInst = col(/instituicao/, /corretora/, /banco/, /emissor/);
  const cVenc = col(/vencimento/), cIdx = col(/indexador/), cTaxa = col(/taxa/), cQtd = col(/quantidade/);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const nome = String(r[cNome] ?? '').trim(), v = numBR(r[cValor]);
    if (!nome || !isFinite(v) || v <= 0 || /^total/i.test(nome)) continue;
    const extra = [r[col(/produto/)], dica].join(' ');
    const tipo = tipoPorTexto(nome, extra) || 'Outro';
    out.push({ tipo, ativo: nome.slice(0, 60), inst: cInst >= 0 ? String(r[cInst] ?? '').slice(0, 40) : '', idx: cIdx >= 0 ? idxPorTexto(r[cIdx]) : idxPorTexto(nome + ' ' + extra),
      taxa: cTaxa >= 0 ? numBR(r[cTaxa]) || '' : '', venc: cVenc >= 0 ? venc(r[cVenc]) : '', qtd: '', valor: Math.round(v * 100) / 100, imp: true });
  }
  return out;
}
/* PDF (declaração do IR, informe de rendimentos, extrato): linhas com produto ou ticker e um valor em R$ */
function lerTextoPDF(linhas) {
  const out = [], visto = new Set(), MOEDA = /\d{1,3}(?:\.\d{3})*,\d{2}/;
  // a discriminação de um bem costuma quebrar em várias linhas e o valor fica na última: junta cada bloco
  const blocos = []; let buf = [];
  const CABECALHO = /DISCRIMINA|SITUA[ÇC][ÃA]O EM|GRUPO\s+C[ÓO]DIGO|BENS E DIREITOS|DECLARA[ÇC][ÃA]O/i;
  linhas.forEach(l => {
    if (MOEDA.test(l)) { blocos.push([...buf, l].join(' ')); buf = []; }
    else if (CABECALHO.test(l)) buf = [];
    else if (l.trim()) { buf.push(l); if (buf.length > 4) buf.shift(); }
  });
  blocos.forEach(l => {
    const vals = l.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (!vals || /TOTAL|SALDO ANTERIOR|RENDIMENTOS? (ISENTOS|TRIBUT)|IMPOSTO|CNPJ:?\s*$/i.test(l)) return;
    const tipo = tipoPorTexto(l); if (!tipo) return;
    const v = numBR(vals.at(-1)); if (!(v > 0)) return;  // no IR, o último valor é a situação no ano mais recente
    const tk = (l.toUpperCase().match(/\b[A-Z]{4}\d{1,2}\b/) || [])[0];
    const nome = (tk || l.replace(/\d{1,3}(?:\.\d{3})*,\d{2}/g, '').replace(/\b0\d\s+\d{2}\b/g, '').replace(/\s+/g, ' ').trim()).slice(0, 60);  // tira valores e os códigos grupo/código do IR
    const chave = `${nome}|${v}`; if (visto.has(chave)) return; visto.add(chave);
    out.push({ tipo, ativo: nome, inst: '', idx: idxPorTexto(l), taxa: '', venc: /VENC/i.test(l) ? venc(l) : '', qtd: '', valor: v, imp: true });
  });
  return out;
}
function carregarLib(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(window[global]); s.onerror = () => fail(new Error('não foi possível carregar ' + src)); document.head.appendChild(s); });
}
async function importar(file) {
  const msg = $('#eImpMsg'); msg.textContent = `lendo ${file.name}…`;
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    let novos = [];
    if (ext === 'csv' || ext === 'txt') {
      const txt = await file.text(), sep = [';', '\t', ','].sort((a, b) => txt.split(b).length - txt.split(a).length)[0];
      novos = lerTabela(txt.split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim())));
    } else if (ext === 'xlsx' || ext === 'xls') {
      const XLSX = await carregarLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      wb.SheetNames.forEach(n => { novos = novos.concat(lerTabela(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }), n)); });
    } else if (ext === 'pdf') {
      const pdfjs = await carregarLib('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise, linhas = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const items = (await (await doc.getPage(p)).getTextContent()).items, porY = {};
        items.forEach(it => { const y = Math.round(it.transform[5] / 3); (porY[y] = porY[y] || []).push(it); });
        Object.keys(porY).sort((a, b) => b - a).forEach(y => linhas.push(porY[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ')));
      }
      novos = lerTextoPDF(linhas);
    } else throw new Error('formato não suportado (use .xlsx, .csv ou .pdf)');
    if (!novos.length) { msg.innerHTML = `<b class="down">Não encontrei investimentos em ${esc(file.name)}.</b> Confira se o arquivo tem colunas de produto e valor, ou digite os ativos abaixo.`; return; }
    HOLD = HOLD.concat(novos); salvarHold(); renderExist();
    msg.innerHTML = `<b class="up">${novos.length} ativos importados de ${esc(file.name)}.</b> Confira tipo, indexador e valor (marcados em amarelo).${ext === 'pdf' ? ' Na declaração do IR os valores são de custo em 31/12, não o valor de mercado de hoje.' : ''}`;
  } catch (e) { msg.innerHTML = `<b class="down">Erro ao ler o arquivo:</b> ${esc(e.message)}`; }
}

/* ================= diagnóstico ================= */
function perfilExist() {
  return { perfil: $('#ePerfil').value, prazo: Math.max(1, +$('#ePrazo').value || 36), aporte: Math.max(0, +$('#eAporte').value || 0), plat: $('#ePlat').value,
    res: clip((+$('#eRes').value || 0) / 100, 0, 1), cap: clip((+$('#eCap').value || 8) / 100, .01, .5) };
}
function diagnosticar() {
  const p = perfilExist(), pv = previsaoIbov(), alvo = pesosAuto(p, pv).w;
  const itens = HOLD.map(h => ({ h, cl: classeDe(h), v: valorDe(h), tk: tickerDe(h) })).filter(x => x.v > 0);
  const total = itens.reduce((s, x) => s + x.v, 0);
  const atual = Object.fromEntries(CL_EXT.map(c => [c.k, itens.filter(x => x.cl === c.k).reduce((s, x) => s + x.v, 0)]));
  const F = []; let score = 100;
  const pen = (n, sev, txt) => { score -= n; F.push({ sev, txt }); };
  if (!total) return { p, alvo, itens, total, atual, F, score: null };
  // distância de cada classe ao alvo (faixa de 5 pontos, como no trader-rebalance)
  CLASSES.forEach(c => {
    const a = atual[c.k] / total, d = a - alvo[c.k];
    if (Math.abs(d) > .05) pen(Math.min(18, (Math.abs(d) - .05) * 100 * 1.2), Math.abs(d) > .15 ? 'alta' : 'média',
      `${c.nome}: ${pct(a, 0)} da carteira, alvo ${pct(alvo[c.k], 0)} para o perfil ${p.perfil} — ${d > 0 ? 'acima' : 'abaixo'} ${pct(Math.abs(d), 0)}.`);
  });
  const outros = atual.outros / total;
  if (outros > .2) pen(5, 'média', `${pct(outros, 0)} em fundos, previdência ou cripto: confira taxas de administração e o risco desses produtos.`);
  // poupança e dinheiro parado
  const poup = itens.filter(x => x.h.tipo === 'Poupança').reduce((s, x) => s + x.v, 0);
  if (poup > 0 && M.selic > .085) { const rp = Math.pow(1.005 * (1 + M.trMes), 12) - 1; pen(8, 'alta', `${brl(poup)} na poupança rendendo ~${pct(rp)} ao ano; Tesouro Selic ou CDB de liquidez diária a 100% do CDI rendem ~${pct(M.cdi * .85)} líquido.`); }
  const cc = itens.filter(x => x.h.tipo === 'Conta corrente').reduce((s, x) => s + x.v, 0);
  if (cc / total > .05) pen(5, 'média', `${brl(cc)} parado em conta corrente (${pct(cc / total, 0)}), sem render.`);
  if (atual.res / total < .05 && p.perfil !== 'arrojado') pen(8, 'alta', `Reserva de liquidez de só ${pct(atual.res / total, 0)}: numa emergência você teria de vender algo no prejuízo ou pagar multa.`);
  // concentração
  itens.filter(x => x.cl === 'acoes' && !['ETF', 'Fundo de ações'].includes(x.h.tipo)).forEach(x => {
    if (x.v / total > p.cap * 1.5) pen(8, 'alta', `${x.h.ativo} é ${pct(x.v / total, 1)} da carteira, acima do teto de ${pct(p.cap, 0)} por ação.`);
  });
  const porEm = {}; itens.filter(x => FGC.has(x.h.tipo)).forEach(x => { const k = (x.h.inst || x.h.ativo).toUpperCase(); porEm[k] = (porEm[k] || 0) + x.v; });
  Object.entries(porEm).filter(([, v]) => v > 250000).forEach(([k, v]) => pen(10, 'alta', `${brl(v)} em títulos com FGC de ${k}: acima do limite de garantia de R$ 250 mil por instituição.`));
  const acoesN = new Set(itens.filter(x => x.h.tipo === 'Ação').map(x => x.tk || x.h.ativo)).size, temEtf = itens.some(x => x.h.tipo === 'ETF');
  if (atual.acoes > 0 && acoesN > 0 && acoesN < 4 && !temEtf) pen(6, 'média', `Só ${acoesN} ação(ões) na carteira: pouca diversificação. Um ETF (ex.: BOVA11) ou mais setores reduzem o risco.`);
  // previsão das ações que a pessoa tem
  let pv2 = 0;
  itens.filter(x => x.tk && U[x.tk]).forEach(x => { const a = U[x.tk]; if (a.prev <= -.1 && pv2 < 12) { pv2 += 4; pen(4, 'média', `${x.tk}: previsão "${nivel(a.prev).l}" para 4 semanas (${sgnPct(a.r3)} em 3 meses). Vale revisar a tese.`); } });
  // renda fixa que rende pouco
  itens.filter(x => x.h.idx === 'CDI' && +x.h.taxa > 0).forEach(x => {
    if (x.h.tipo === 'CDB' && +x.h.taxa < 100) pen(4, 'média', `${x.h.ativo}: CDB a ${x.h.taxa}% do CDI rende menos que um Tesouro Selic. No buscador há CDBs acima de 105%.`);
    if (['LCI', 'LCA'].includes(x.h.tipo) && +x.h.taxa < 85) pen(3, 'baixa', `${x.h.ativo}: ${x.h.tipo} a ${x.h.taxa}% do CDI; há ofertas acima de 90% no buscador.`);
  });
  const sem = itens.filter(x => ['CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'Debênture', 'Debênture incentivada'].includes(x.h.tipo) && !x.h.idx).length;
  if (sem) F.push({ sev: 'info', txt: `${sem} título(s) sem indexador: informe CDI, Pré ou IPCA para separar pós-fixado de travado.` });
  // juros caindo e nada travado
  if (M.selic - selicAt(12) > .005 && atual.trav / total < .1 && p.prazo >= 24) F.push({ sev: 'média', txt: `Focus vê Selic ${pct(M.selic - selicAt(12))} menor em 12 meses e só ${pct(atual.trav / total, 0)} está travado em pré/IPCA+: o rendimento do pós-fixado vai cair.` });
  if (!F.length) F.push({ sev: 'ok', txt: 'Nenhum problema encontrado: a carteira está dentro do alvo do seu perfil.' });
  score = Math.max(0, Math.round(score));
  return { p, alvo, itens, total, atual, F, score, pv };
}
const veredito = s => s == null ? { l: 'Sem dados', c: '' } : s >= 80 ? { l: 'Está boa', c: 'up' } : s >= 60 ? { l: 'Está ok, com ajustes', c: '' } : { l: 'Precisa ser ajustada', c: 'down' };

/* aporte: completa primeiro as classes abaixo do alvo, sem vender nada */
function planoAporte(d) {
  const X = d.p.aporte; if (!X) return { linhas: [], porCl: {} };
  const T = d.total + X, def = {}, porCl = {};
  CLASSES.forEach(c => def[c.k] = Math.max(0, d.alvo[c.k] * T - d.atual[c.k]));
  const D = Object.values(def).reduce((a, b) => a + b, 0);
  CLASSES.forEach(c => porCl[c.k] = D >= X ? X * def[c.k] / (D || 1) : def[c.k] + (X - D) * d.alvo[c.k]);
  const pool = OFF.filter(o => d.p.plat === '*' || o.plat === d.p.plat || o.plat === 'Tesouro Direto'), linhas = [];
  const rf = (cl, filtro, v) => { if (v < 1) return; const r = melhores(pool, filtro, v, d.p.prazo, cl === 'res' ? Infinity : 250000);
    r.linhas.forEach(x => linhas.push({ cl, nome: `${x.o.tipo} ${fmtTaxa(x.o)}`, onde: x.o.plat, v: x.v, ret: x.a.liqAA }));
    if (r.falta > 1) linhas.push({ cl, nome: 'sem oferta elegível — ajuste prazo ou plataforma', onde: '—', v: r.falta, ret: null }); };
  rf('res', o => o.liq, porCl.res); rf('trav', o => !o.liq && o.idx !== 'CDI', porCl.trav); rf('pos', o => !o.liq && o.idx === 'CDI', porCl.pos);
  if (porCl.acoes >= 100) {
    const tem = {}; d.itens.filter(x => x.tk).forEach(x => tem[x.tk] = (tem[x.tk] || 0) + x.v);
    const setTem = new Set(Object.keys(tem).map(t => SETOR_DE[t]).filter(Boolean)), usados = new Set(), cands = [];
    Object.values(U).filter(a => a.prev >= .1).sort((a, b) => (setTem.has(a.setor) - setTem.has(b.setor)) || b.prev - a.prev).forEach(a => {
      if (cands.length < 5 && !usados.has(a.setor)) { const lim = d.p.cap * T - (tem[a.sym] || 0); if (lim > 100) { usados.add(a.setor); cands.push({ sym: a.sym, a, w: a.prev / Math.max(a.vol, .15), lim }); } }
    });
    if (cands.length < 2) cands.push({ sym: 'BOVA11', etf: true, w: 1 });
    const r = dimensionar(cands, porCl.acoes, d.p.cap * T);
    r.linhas.forEach(x => linhas.push({ cl: 'acoes', nome: x.sym + (x.a ? ` <span class="sub">${x.a.setor}${setTem.has(x.a.setor) ? '' : ' · setor novo'}</span>` : ' <span class="sub">ETF do Ibovespa</span>'), onde: d.p.plat === '*' ? 'qualquer corretora' : d.p.plat, v: x.v, ret: null, acao: x.a }));
    if (r.sobra > 1) linhas.push({ cl: 'acoes', nome: 'BOVA11 <span class="sub">ETF do Ibovespa</span>', onde: 'qualquer corretora', v: r.sobra, ret: null });
  }
  return { linhas, porCl };
}

let EXIST = null;
function renderExist() {
  const p = perfilExist(); store.set('af2.exist', p);
  const ep = $('#ePlat'), cur = ep.value || p.plat || '*';
  ep.innerHTML = '<option value="*">Todas (a melhor de cada)</option>' + plataformas().filter(x => x !== 'Tesouro Direto').map(x => `<option>${esc(x)}</option>`).join('');
  ep.value = [...ep.options].some(o => o.value === cur) ? cur : '*';
  renderHoldTbl();
  const d = diagnosticar(); EXIST = d;
  const vd = veredito(d.score);
  $('#eTotal').textContent = d.total ? `patrimônio ${brl(d.total)} · ${d.itens.length} ativos` : '';
  $('#eVerdict').textContent = vd.l; $('#eVerdict').className = 'verdict ' + vd.c;
  $('#eScore').textContent = d.score == null ? 'adicione seus ativos para ver o diagnóstico' : `nota ${d.score}/100`;
  document.querySelectorAll('#eMeter span').forEach((el, i) => el.classList.toggle('on', d.score != null && i === Math.min(4, Math.floor(d.score / 20))));
  $('#eVerdictSub').textContent = d.score == null ? '' : `${d.F.filter(f => f.sev === 'alta').length} pontos importantes, ${d.F.filter(f => f.sev === 'média').length} médios. Alvo do perfil ${p.perfil} com ${p.prazo} meses.`;
  const T = d.total || 1;
  chart('chExist', { type: 'bar', data: { labels: CL_EXT.map(c => c.nome.split(' (')[0]), datasets: [
    { label: 'Hoje', data: CL_EXT.map(c => +(d.atual[c.k] / T * 100).toFixed(1)), backgroundColor: CL_EXT.map(c => css(c.cor)), borderRadius: 3 },
    { label: 'Alvo', data: CL_EXT.map(c => +((d.alvo[c.k] ?? 0) * 100).toFixed(1)), backgroundColor: css('--line'), borderRadius: 3 }
  ] }, options: { ...base(), plugins: { legend: legend(), tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw}%` } } }, scales: { x: { ...axis(), ticks: { ...axis().ticks, font: { size: 9 } } }, y: { ...axis(), ticks: { ...axis().ticks, callback: v => v + '%' } } } } });
  tabela($('#eClasses'), 'eCl', [
    { k: 'c', h: 'Classe', f: r => `<i class="dot" style="background:${css(r.cor)}"></i>${r.nome.split(' (')[0]}` },
    { k: 'a', h: 'Hoje', r: 1, f: r => `<span class="num">${pct(d.atual[r.k] / T, 0)}</span> <span class="sub num">${brl(d.atual[r.k])}</span>` },
    { k: 't', h: 'Alvo', r: 1, f: r => `<span class="num">${pct(d.alvo[r.k] ?? 0, 0)}</span>` },
    { k: 's', h: '', f: r => { const x = d.atual[r.k] / T - (d.alvo[r.k] ?? 0); return !d.total ? '' : Math.abs(x) <= .05 ? '<span class="pill up">ok</span>' : `<span class="pill ${Math.abs(x) > .15 ? 'down' : 'warn'}">${x > 0 ? 'reduzir' : 'aumentar'} ${pct(Math.abs(x), 0)}</span>`; } }
  ], CL_EXT.filter(c => c.k !== 'outros' || d.atual.outros), { rerender: renderExist });
  const sevPill = s => ({ alta: '<span class="pill down">importante</span>', 'média': '<span class="pill warn">médio</span>', baixa: '<span class="pill flat">leve</span>', info: '<span class="pill acc">info</span>', ok: '<span class="pill up">ok</span>' }[s]);
  tabela($('#eFind'), 'eF', [{ k: 's', h: '', f: r => sevPill(r.sev) }, { k: 't', h: 'O que encontrei', w: 1, f: r => r.txt }],
    d.total ? d.F : [], { rerender: renderExist, empty: 'Adicione ou importe seus ativos.' });
  const ap = planoAporte(d);
  $('#eApSub').textContent = p.aporte ? brl(p.aporte) : 'informe o valor do aporte';
  tabela($('#eAp'), 'eAp', [
    { k: 'n', h: 'Onde aplicar', w: 1, f: l => `<i class="dot" style="background:${css(CLASSES.find(c => c.k === l.cl).cor)}"></i><b>${l.nome}</b>` },
    { k: 'o', h: 'Plataforma', f: l => esc(l.onde) },
    { k: 'v', h: 'Valor', r: 1, f: l => `<b class="num">${brl(l.v)}</b> <span class="sub num">${pct(l.v / (p.aporte || 1), 0)}</span>` },
    { k: 'r', h: 'Ret. a.a.', r: 1, f: l => l.ret != null ? `<span class="num">${pct(l.ret)}</span>` : l.acao ? pillNivel(l.acao.prev) : '' }
  ], ap.linhas, { rerender: renderExist, empty: d.total ? 'Informe quanto vai aportar.' : 'Adicione seus ativos primeiro.' });
  const acima = CLASSES.filter(c => d.total && d.atual[c.k] / T - d.alvo[c.k] > .05);
  $('#eRebal').innerHTML = acima.length ? `Para alinhar sem aporte, seria preciso reduzir ${acima.map(c => `<b>${c.nome.split(' (')[0].toLowerCase()}</b> (${brl(d.atual[c.k] - d.alvo[c.k] * T)})`).join(' e ')}. Antes de vender, veja o imposto: vendas de ações até R$ 20 mil no mês são isentas; FIIs, ETFs e renda fixa resgatada antes do vencimento pagam IR.` : '';
  EXIST.aporte = ap;
}
function renderHoldTbl() {
  const sel = (h, k, opts) => `<select data-k="${k}">${opts.map(x => `<option${x === (h[k] || '') ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  const tot = HOLD.reduce((s, h) => s + valorDe(h), 0) || 1;
  $('#eTbl').innerHTML = `<thead><tr><th>Tipo</th><th>Ativo / produto</th><th>Instituição</th><th>Indexador</th><th class="r">Taxa</th><th>Vencimento</th><th class="r">Qtd.</th><th class="r">Valor atual (R$)</th><th class="r">%</th><th>Previsão</th><th></th></tr></thead><tbody>${HOLD.map((h, i) => { const tk = tickerDe(h), a = tk && U[tk]; return `<tr data-i="${i}" class="${h.imp ? 'imp' : ''}">
    <td>${sel(h, 'tipo', TIPOS_ATIVO)}</td><td><input data-k="ativo" value="${esc(h.ativo)}" placeholder="ex.: PETR4, CDB Banco X"></td><td><input data-k="inst" value="${esc(h.inst)}" placeholder="banco/emissor"></td>
    <td>${sel(h, 'idx', ['', 'CDI', 'Pré', 'IPCA'])}</td><td class="r"><input class="n num" data-k="taxa" type="number" step="0.1" value="${h.taxa ?? ''}" placeholder="—"></td>
    <td><input data-k="venc" type="date" value="${esc(h.venc)}" style="width:128px"></td><td class="r"><input class="n num" data-k="qtd" type="number" step="1" value="${h.qtd ?? ''}" placeholder="—"></td>
    <td class="r"><input class="n num" data-k="valor" type="number" step="100" value="${h.qtd > 0 && a ? Math.round(valorDe(h)) : h.valor ?? ''}" style="width:100px" ${h.qtd > 0 && a ? 'disabled title="calculado pela cotação"' : ''}></td>
    <td class="r num">${pct(valorDe(h) / tot, 1)}</td><td>${a ? pillNivel(a.prev) : ''}</td><td><button class="btn ghost" data-del="${i}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="11" class="sub">Nenhum ativo ainda. Clique em "+ Adicionar ativo" ou importe um arquivo.</td></tr>'}</tbody>`;
  $('#eTbl').querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
    const h = HOLD[+el.closest('tr').dataset.i], k = el.dataset.k;
    h[k] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value; h.imp = false;
    if (k === 'ativo' && h.tipo === 'Outro') h.tipo = tipoPorTexto(h.ativo) || 'Outro';
    salvarHold(); renderExist();
  }));
  $('#eTbl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { HOLD.splice(+b.dataset.del, 1); salvarHold(); renderExist(); });
}

/* ================= análise com o Claude (chamada direta do navegador) ================= */
function resumoParaIA(d) {
  const T = d.total;
  return {
    perfil: d.p.perfil, prazo_meses: d.p.prazo, aporte_planejado: d.p.aporte, patrimonio_total: Math.round(T),
    ativos: d.itens.map(x => ({ tipo: x.h.tipo, ativo: x.tk || x.h.ativo, indexador: x.h.idx || null, taxa: x.h.taxa || null, vencimento: x.h.venc || null,
      valor: Math.round(x.v), pct: +(x.v / T * 100).toFixed(1), previsao_4sem: x.tk && U[x.tk] ? nivel(U[x.tk].prev).l : undefined })),
    alocacao_atual_vs_alvo: Object.fromEntries(CL_EXT.map(c => [c.nome, { atual_pct: +(d.atual[c.k] / T * 100).toFixed(1), alvo_pct: +((d.alvo[c.k] ?? 0) * 100).toFixed(1) }])),
    diagnostico_por_regras: { nota: d.score, veredito: veredito(d.score).l, pontos: d.F.map(f => `[${f.sev}] ${f.txt}`) },
    aporte_sugerido_por_regras: (d.aporte?.linhas || []).map(l => ({ onde: l.nome.replace(/<[^>]+>/g, ''), plataforma: l.onde, valor: Math.round(l.v) })),
    mercado: {
      selic: pct(M.selic), cdi: pct(M.cdi), ipca_12m: pct(M.ipca12), juro_real: pct((1 + M.cdi) / (1 + M.ipca12) - 1), selic_focus_12m: pct(selicAt(12)), dolar: M.usd,
      previsao_ibovespa_4sem: nivel(d.pv.score).l, humor_noticias: leituraNoticias().label,
      setores_mais_fortes_3m: SETORES.slice(0, 3).map(s => `${s.nome} ${sgnPct(s.r3)}`), setores_mais_fracos_3m: SETORES.slice(-3).map(s => `${s.nome} ${sgnPct(s.r3)}`)
    },
    melhores_ofertas_renda_fixa: OFF.map(o => ({ o, a: avaliar(o, Math.max(1000, d.p.aporte), d.p.prazo) })).filter(x => x.a.ok).sort((a, b) => b.a.liqAA - a.a.liqAA).slice(0, 6)
      .map(x => `${x.o.tipo} ${fmtTaxa(x.o)} (${x.o.plat}) → ${pct(x.a.liqAA)} líquido a.a.`)
  };
}
const SISTEMA_IA = `Você é um analista de investimentos que escreve para pessoas físicas no Brasil. Analise a carteira recebida em JSON junto com o contexto de mercado e o diagnóstico já calculado por regras.
Responda em português, direto e prático, com estas seções em markdown: "## Resumo" (2 a 3 frases e um veredito: está boa, ok com ajustes, ou precisa ser ajustada), "## O que está bem", "## O que ajustar" (ações concretas, com valores em R$ quando possível), "## Onde colocar o novo aporte" (use o aporte planejado; pode concordar ou discordar da sugestão por regras e diga por quê), "## Riscos e cuidados" (imposto, FGC, concentração, liquidez).
Use os números do JSON; não invente cotações, taxas ou ofertas que não estejam nele. Taxas de renda fixa são referências e devem ser conferidas na plataforma. Não prometa retorno. Termine lembrando, em uma linha, que é uma análise educativa e não uma recomendação de investimento.`;
function mdSimples(t) {
  const e = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return e.split(/\n{2,}/).map(b => {
    if (/^#{1,3} /.test(b)) return b.replace(/^#{1,3} (.*)$/m, '<h3>$1</h3>') .replace(/\n(?!<)/g, '<br>');
    if (/^\s*[-*] /m.test(b)) return '<ul>' + b.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('') + '</ul>';
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
async function analisarIA() {
  const out = $('#aiOut'), key = $('#aiKey').value.trim(), d = EXIST;
  if (!d?.total) { out.innerHTML = '<p class="down">Adicione seus ativos antes.</p>'; return; }
  if (!/^sk-ant-/.test(key)) { out.innerHTML = '<p class="down">Cole uma chave da API Anthropic (começa com sk-ant-). Crie em console.anthropic.com → API Keys.</p>'; return; }
  try { $('#aiRemember').checked ? localStorage.setItem('af2.aikey', key) : localStorage.removeItem('af2.aikey'); } catch {}
  const btn = $('#aiRun'); btn.disabled = true; btn.textContent = 'analisando…';
  out.innerHTML = '<p class="sub">O Claude está analisando a carteira (pode levar até um minuto)…</p>';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',          // se o modelo recusar, o servidor tenta outro sozinho
        'anthropic-dangerous-direct-browser-access': 'true'            // site estático: a chamada sai do navegador com a chave do usuário
      },
      body: JSON.stringify({
        model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'medium' }, fallbacks: 'default',
        system: SISTEMA_IA,
        messages: [{ role: 'user', content: 'Carteira e contexto (JSON):\n' + JSON.stringify(resumoParaIA(d), null, 1) }]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = { 401: 'chave inválida ou revogada', 403: 'a chave não tem permissão', 429: 'limite de uso atingido — tente em alguns minutos', 529: 'a API está sobrecarregada — tente de novo' }[r.status] || j.error?.message || `erro ${r.status}`;
      out.innerHTML = `<p class="down">Não foi possível analisar: ${esc(m)}.</p>`; return;
    }
    if (j.stop_reason === 'refusal') { out.innerHTML = '<p class="down">O modelo recusou esta análise. Tente revisar os nomes dos ativos.</p>'; return; }
    const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    out.innerHTML = mdSimples(txt) + `<p class="sub">Gerado por ${esc(j.model || 'Claude')} · ${new Date().toLocaleString('pt-BR')}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="down">Falha de conexão com a API: ${esc(e.message)}.</p>`;
  } finally { btn.disabled = false; btn.textContent = 'Analisar com IA'; }
}

/* ================= eventos ================= */
function modo(m) {
  $('#modoZero').hidden = m !== 'zero'; $('#modoExist').hidden = m !== 'exist';
  document.querySelectorAll('#modoSeg button').forEach(b => b.classList.toggle('on', b.dataset.modo === m));
  store.set('af2.modo', m); if (m === 'exist') renderExist(); else renderCarteira();
}
document.querySelectorAll('#modoSeg button').forEach(b => b.onclick = () => modo(b.dataset.modo));
['#ePerfil', '#ePrazo', '#eAporte', '#ePlat', '#eRes', '#eCap'].forEach(id => $(id).addEventListener('input', renderExist));
$('#eFile').onchange = e => { const f = e.target.files[0]; if (f) importar(f); e.target.value = ''; };
const drop = $('#eDrop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) importar(f); });
$('#eAdd').onclick = () => { HOLD.push({ tipo: 'CDB', ativo: '', inst: '', idx: 'CDI', taxa: '', venc: '', qtd: '', valor: '' }); salvarHold(); renderExist(); };
$('#eClear').onclick = () => { if (confirm('Apagar todos os ativos da sua carteira neste navegador?')) { HOLD = []; salvarHold(); renderExist(); } };
$('#aiRun').onclick = analisarIA;
(() => {
  const e = store.get('af2.exist', null);
  if (e) { $('#ePerfil').value = e.perfil; $('#ePrazo').value = e.prazo; $('#eAporte').value = e.aporte; $('#eRes').value = Math.round(e.res * 100); $('#eCap').value = Math.round(e.cap * 100); }
  try { const k = localStorage.getItem('af2.aikey'); if (k) { $('#aiKey').value = k; $('#aiRemember').checked = true; } } catch {}
  modo(store.get('af2.modo', 'zero'));
})();
