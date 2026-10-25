/* Analisar uma carteira existente: entrada manual ou vários arquivos (B3, corretoras, IR, extrato XP),
 * avaliação de cada investimento, diagnóstico contra o alvo do perfil, onde colocar o aporte,
 * salvar/abrir a carteira em JSON para reavaliar depois e análise opcional com o Claude.
 * Usa as funções e o estado globais do app.js, importadores.js e calculos.js. Nada sai do navegador,
 * exceto a chamada à IA quando o usuário pede, com a própria chave. */

/* ================= ativos ================= */
const TIPOS_ATIVO = ['Ação', 'FII', 'ETF', 'BDR', 'CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'Debênture', 'Debênture incentivada', 'COE',
  'Tesouro Selic', 'Tesouro Pré', 'Tesouro IPCA+', 'Poupança', 'Conta corrente', 'Fundo DI/renda fixa', 'Fundo multimercado', 'Fundo de ações', 'Previdência', 'Cripto', 'Outro'];
const CL_EXT = [...CLASSES, { k: 'outros', nome: 'Outros (fundos, COE, previdência, cripto)', cor: '--c6' }];
let HOLD = store.get('af2.holdings', []);
let EXTRATOS = store.get('af2.extratos', {});      // resumo de cada extrato importado, por arquivo
let SNAP = store.get('af2.snap', null);            // retrato salvo no JSON, para comparar com hoje
const salvarHold = () => { store.set('af2.holdings', HOLD); store.set('af2.extratos', EXTRATOS); };

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
  const a = ativoDe(tickerDe(h));
  if (h.qtd > 0 && a) return h.qtd * a.last;
  return +h.valor || 0;
}

/* ================= importação (vários arquivos, de vários bancos) ================= */
function carregarLib(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(window[global]); s.onerror = () => fail(new Error('não foi possível carregar ' + src)); document.head.appendChild(s); });
}
async function textoDoPDF(file) {
  const pdfjs = await carregarLib('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise, linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items, porY = {};
    items.forEach(it => { const y = Math.round(it.transform[5] / 3); (porY[y] = porY[y] || []).push(it); });
    Object.keys(porY).sort((a, b) => b - a).forEach(y => linhas.push(porY[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ')));
  }
  return linhas;
}
async function lerArquivo(file) {
  const ext = file.name.split('.').pop().toLowerCase(), src = file.name;
  if (ext === 'json') return { json: JSON.parse(await file.text()) };
  if (ext === 'csv' || ext === 'txt') {
    const txt = await file.text(), sep = [';', '\t', ','].sort((a, b) => txt.split(b).length - txt.split(a).length)[0];
    return { linhas: lerTabela(txt.split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim())), '', src) };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await carregarLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return { linhas: wb.SheetNames.flatMap(n => lerTabela(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }), n, src)) };
  }
  if (ext === 'pdf') {
    const linhas = await textoDoPDF(file), texto = linhas.join('\n');
    if (ehExtratoXP(texto)) {
      const ex = lerExtratoXP(texto);
      return { linhas: carteiraDoExtratoXP(ex, src, [...Object.keys(U), ...Object.keys(UF)]), resumo: { banco: 'XP', ...resumoExtratoXP(ex) } };
    }
    return { linhas: lerTextoPDF(linhas, src), ir: /BENS E DIREITOS|DECLARA/i.test(texto) };
  }
  throw new Error('formato não suportado (use .pdf, .xlsx, .csv ou .json)');
}
async function importar(files) {
  const msg = $('#eImpMsg'), res = [];
  for (const file of files) {
    msg.textContent = `lendo ${file.name}…`;
    try {
      const r = await lerArquivo(file);
      if (r.json) { abrirJSON(r.json); res.push(`<b class="up">${esc(file.name)}</b>: carteira salva aberta`); continue; }
      if (!r.linhas.length) { res.push(`<b class="down">${esc(file.name)}</b>: nenhum investimento encontrado`); continue; }
      HOLD = HOLD.filter(h => h.src !== file.name).concat(r.linhas);   // reimportar o mesmo arquivo substitui, não duplica
      if (r.resumo) EXTRATOS[file.name] = r.resumo; else delete EXTRATOS[file.name];
      const semValor = r.linhas.filter(h => !(valorDe(h) > 0)).length;
      res.push(`<b class="up">${esc(file.name)}</b>: ${r.linhas.length} itens${r.resumo ? ' (extrato de movimentação da XP)' : ''}${semValor ? `, <span class="warn">${semValor} sem valor — complete na tabela</span>` : ''}${r.ir ? ' · valores de custo em 31/12' : ''}`);
    } catch (e) { res.push(`<b class="down">${esc(file.name)}</b>: ${esc(e.message)}`); }
  }
  salvarHold(); renderExist();
  msg.innerHTML = res.join('<br>');
}

/* ================= avaliação de cada investimento ================= */
const benchCDI = () => M.cdi * .85;   // CDI líquido de IR (alíquota de longo prazo) — régua de comparação
function avaliarInvestimento(x) {
  const h = x.h, a = x.a, b = benchCDI();
  if (!(x.v > 0)) return { v: 'Falta o valor', c: 'flat', ord: 0, m: h.nota || 'informe o valor ou a quantidade' };
  if (a) {
    const tot = a.r12 + a.dy, prev = nivel(a.prev).l;
    const base = `${sgnPct(a.r12)} de preço${a.dy ? ` + ${pct(a.dy, 1)} de proventos` : ''} em 12 meses (total ${sgnPct(tot)}) contra ${pct(b, 1)} do CDI líquido; previsão ${prev}.`;
    if (tot < b - .10 && a.prev <= -.1) return { v: 'Avaliar saída', c: 'down', ord: 1, m: `${base} Rende bem abaixo da renda fixa e a tendência é de baixa: considere trocar.` };
    if (a.prev <= -.3) return { v: 'Atenção', c: 'warn', ord: 2, m: `${base} Sinal técnico de venda forte: acompanhe de perto.` };
    if (a.fii && a.dy < b - .03) return { v: 'Atenção', c: 'warn', ord: 2, m: `${base} Dividend yield abaixo do CDI líquido para um FII.` };
    if (tot < b) return { v: 'Abaixo do CDI', c: 'warn', ord: 3, m: `${base} Perdeu para a renda fixa no período: confira se a tese ainda vale.` };
    if (tot >= b + .03 && a.prev > -.1) return { v: 'Indo bem', c: 'up', ord: 5, m: base };
    return { v: 'Manter', c: 'flat', ord: 4, m: base };
  }
  switch (h.tipo) {
    case 'Poupança': return { v: 'Retirar', c: 'down', ord: 1, m: `Poupança rende ~${pct(Math.pow(1.005 * (1 + M.trMes), 12) - 1, 1)} ao ano; Tesouro Selic ou CDB de liquidez diária a 100% do CDI rendem ~${pct(b, 1)} líquido.` };
    case 'Conta corrente': return { v: 'Aplicar', c: 'warn', ord: 2, m: 'Dinheiro parado sem render. Leve para Tesouro Selic ou CDB de liquidez diária.' };
    case 'COE': return { v: 'Atenção', c: 'warn', ord: 2, m: 'COE tem baixa liquidez e custos embutidos. Em geral vale levar até o vencimento e não renovar.' };
    case 'Fundo DI/renda fixa': case 'Fundo multimercado': case 'Fundo de ações':
      return { v: 'Confira a taxa', c: 'warn', ord: 3, m: 'Compare a rentabilidade líquida do fundo com um CDB/LCA do buscador. Fundos com taxa de administração acima de 0,8% a.a. costumam perder.' };
    case 'Tesouro Selic': case 'Tesouro Pré': case 'Tesouro IPCA+': return { v: 'Manter', c: 'flat', ord: 4, m: 'Título público: risco soberano. Mantenha até o vencimento ou até precisar do dinheiro.' };
  }
  if (['CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'Debênture', 'Debênture incentivada'].includes(h.tipo)) {
    if (!h.idx || !(+h.taxa > 0)) return { v: 'Informe a taxa', c: 'flat', ord: 3, m: h.nota || 'Informe indexador e taxa para comparar com o mercado.' };
    if (h.idx === 'CDI' && ((h.tipo === 'CDB' && h.taxa < 100) || (['LCI', 'LCA'].includes(h.tipo) && h.taxa < 85)))
      return { v: 'Abaixo do mercado', c: 'warn', ord: 3, m: `${h.tipo} a ${h.taxa}% do CDI paga menos que as ofertas atuais. Resgatar antes do vencimento costuma ter perda; não renove nessa taxa.` };
    return { v: 'Manter', c: 'flat', ord: 4, m: `${h.tipo} ${fmtTaxa({ idx: h.idx, taxa: h.taxa })}: dentro do que o mercado paga. Mantenha até o vencimento.` };
  }
  return { v: 'Manter', c: 'flat', ord: 4, m: '' };
}

/* ================= diagnóstico ================= */
function perfilExist() {
  return { perfil: $('#ePerfil').value, prazo: Math.max(1, +$('#ePrazo').value || 36), aporte: Math.max(0, +$('#eAporte').value || 0), plat: $('#ePlat').value, obj: $('#eObj').value,
    res: clip((+$('#eRes').value || 0) / 100, 0, 1), cap: clip((+$('#eCap').value || 8) / 100, .01, .5) };
}
function diagnosticar() {
  const p = perfilExist(), pv = previsaoIbov(), alvo = pesosAuto(p, pv).w;
  const itens = HOLD.map(h => { const tk = tickerDe(h), a = ativoDe(tk); return { h, cl: classeDe(h), v: valorDe(h), tk, a }; });
  itens.forEach(x => x.av = avaliarInvestimento(x));
  const val = itens.filter(x => x.v > 0), total = val.reduce((s, x) => s + x.v, 0);
  const atual = Object.fromEntries(CL_EXT.map(c => [c.k, val.filter(x => x.cl === c.k).reduce((s, x) => s + x.v, 0)]));
  const F = []; let score = 100;
  const pen = (n, sev, txt) => { score -= n; F.push({ sev, txt }); };
  if (!total) return { p, pv, alvo, itens, total, atual, F, score: null };
  CLASSES.forEach(c => {
    const a = atual[c.k] / total, d = a - alvo[c.k];
    if (Math.abs(d) > .05) pen(Math.min(18, (Math.abs(d) - .05) * 100 * 1.2), Math.abs(d) > .15 ? 'alta' : 'média',
      `${c.nome}: ${pct(a, 0)} da carteira, alvo ${pct(alvo[c.k], 0)} para o perfil ${p.perfil} — ${d > 0 ? 'acima' : 'abaixo'} ${pct(Math.abs(d), 0)}.`);
  });
  if (atual.outros / total > .2) pen(5, 'média', `${pct(atual.outros / total, 0)} em fundos, COE, previdência ou cripto: confira taxas e liquidez.`);
  const soma = f => val.filter(f).reduce((s, x) => s + x.v, 0);
  const poup = soma(x => x.h.tipo === 'Poupança'); if (poup > 0 && M.selic > .085) pen(8, 'alta', `${brl(poup)} na poupança: rende bem menos que Tesouro Selic ou CDB de liquidez diária.`);
  const cc = soma(x => x.h.tipo === 'Conta corrente'); if (cc / total > .05) pen(5, 'média', `${brl(cc)} parado em conta (${pct(cc / total, 0)}), sem render.`);
  if (atual.res / total < .05 && p.perfil !== 'arrojado') pen(8, 'alta', `Reserva de liquidez de só ${pct(atual.res / total, 0)}: numa emergência você teria de vender algo no prejuízo.`);
  val.filter(x => x.cl === 'acoes' && x.h.tipo === 'Ação').forEach(x => { if (x.v / total > p.cap * 1.5) pen(8, 'alta', `${x.h.ativo} é ${pct(x.v / total, 1)} da carteira, acima do teto de ${pct(p.cap, 0)} por ação.`); });
  const porEm = {}; val.filter(x => FGC.has(x.h.tipo)).forEach(x => { const k = (x.h.inst || x.h.ativo).toUpperCase(); porEm[k] = (porEm[k] || 0) + x.v; });
  Object.entries(porEm).filter(([, v]) => v > 250000).forEach(([k, v]) => pen(10, 'alta', `${brl(v)} em títulos com FGC de ${k}: acima do limite de R$ 250 mil por instituição.`));
  const nAcoes = new Set(val.filter(x => x.h.tipo === 'Ação').map(x => x.tk || x.h.ativo)).size, nFii = val.filter(x => x.h.tipo === 'FII').length;
  if (atual.acoes > 0 && nAcoes + nFii < 4 && !val.some(x => x.h.tipo === 'ETF')) pen(6, 'média', `Só ${nAcoes + nFii} ativo(s) de renda variável: pouca diversificação.`);
  const ruins = itens.filter(x => x.av.v === 'Avaliar saída');
  if (ruins.length) pen(Math.min(12, ruins.length * 4), 'média', `${ruins.length} ativo(s) com recomendação de avaliar saída: ${ruins.map(x => x.tk || x.h.ativo).join(', ')}.`);
  const coe = soma(x => x.h.tipo === 'COE'); if (coe / total > .1) pen(4, 'média', `${pct(coe / total, 0)} em COE: produto de baixa liquidez e custo embutido.`);
  const faltam = itens.filter(x => !(x.v > 0)).length;
  if (faltam) F.push({ sev: 'info', txt: `${faltam} item(ns) sem valor ficaram fora da conta. Complete quantidade ou valor na tabela "Seus ativos".` });
  // custos cobrados (extratos)
  const ext = Object.values(EXTRATOS); const taxas = ext.reduce((s, e) => s + e.taxas, 0), meses = ext.reduce((s, e) => s + mesesPeriodo(e), 0) || 1;
  if (taxas > 0) { const anual = taxas / meses * 12; pen(anual / total > .01 ? 6 : 2, anual / total > .01 ? 'alta' : 'baixa', `Taxas cobradas na conta (${ext.flatMap(e => e.taxasNome).join(', ')}): ~${brl(anual)} por ano, ${pct(anual / total, 2)} do patrimônio.${anual / total > .01 ? ' Mais de 1% ao ano come boa parte do rendimento.' : ''}`); }
  if (M.selic - selicAt(12) > .005 && atual.trav / total < .1 && p.prazo >= 24) F.push({ sev: 'média', txt: `Focus vê Selic ${pct(M.selic - selicAt(12))} menor em 12 meses e só ${pct(atual.trav / total, 0)} está travado em pré/IPCA+.` });
  if (!F.length) F.push({ sev: 'ok', txt: 'Nenhum problema encontrado: a carteira está dentro do alvo do seu perfil.' });
  return { p, pv, alvo, itens, total, atual, F, score: Math.max(0, Math.round(score)) };
}
const mesesPeriodo = e => e.periodo ? Math.max(1, (new Date(e.periodo.ate) - new Date(e.periodo.de)) / (30.4 * 864e5)) : 1;
const veredito = s => s == null ? { l: 'Sem dados', c: '' } : s >= 80 ? { l: 'Está boa', c: 'up' } : s >= 60 ? { l: 'Está ok, com ajustes', c: '' } : { l: 'Precisa ser ajustada', c: 'down' };

/* ================= aporte ================= */
function planoAporte(d) {
  const X = d.p.aporte; if (!X) return { linhas: [], final: 0 };
  const T = d.total + X, porCl = distribuirAporte(Object.fromEntries(CLASSES.map(c => [c.k, d.atual[c.k]])), d.alvo, X);
  const pool = OFF.filter(o => d.p.plat === '*' || o.plat === d.p.plat || o.plat === 'Tesouro Direto'), linhas = [];
  const rf = (cl, filtro, v) => { if (v < 1) return; const r = melhores(pool, filtro, v, d.p.prazo, cl === 'res' ? Infinity : 250000);
    r.linhas.forEach(x => linhas.push({ cl, nome: `${x.o.tipo} ${fmtTaxa(x.o)}`, onde: x.o.plat, v: x.v, ret: x.a.liqAA }));
    if (r.falta > 1) linhas.push({ cl, nome: 'sem oferta elegível — ajuste prazo ou plataforma', onde: '—', v: r.falta, ret: null }); };
  rf('res', o => o.liq, porCl.res); rf('trav', o => !o.liq && o.idx !== 'CDI', porCl.trav); rf('pos', o => !o.liq && o.idx === 'CDI', porCl.pos);
  if (porCl.acoes >= 100) {
    const tem = {}; d.itens.filter(x => x.tk && x.v > 0).forEach(x => tem[x.tk] = (tem[x.tk] || 0) + x.v);
    const setTem = new Set(Object.keys(tem).map(t => SETOR_DE[t]).filter(Boolean));
    const cands = candidatosRV(d.p.obj, 5, { excluirSetores: setTem }).map(c => ({ ...c, lim: Math.max(0, d.p.cap * T - (tem[c.sym] || 0)) })).filter(c => c.lim > 100);
    if (cands.length < 2) cands.push({ sym: 'BOVA11', etf: true, w: 1 });
    const r = dimensionar(cands, porCl.acoes, d.p.cap * T);
    r.linhas.forEach(x => linhas.push({ cl: 'acoes', nome: x.sym + (x.a ? ` <span class="sub">${x.a.setor}${setTem.has(x.a.setor) ? '' : ' · setor novo'}</span>` : ' <span class="sub">ETF do Ibovespa</span>'),
      onde: d.p.plat === '*' ? 'qualquer corretora' : d.p.plat, v: x.v, ret: x.a && d.p.obj === 'dividendos' ? x.a.dy : null, retDy: d.p.obj === 'dividendos', acao: x.a, trade: x.stop ? x : null }));
    if (r.sobra > 1) linhas.push({ cl: 'acoes', nome: 'BOVA11 <span class="sub">ETF do Ibovespa</span>', onde: 'qualquer corretora', v: r.sobra, ret: null });
  }
  const retRV = ((1 + cdiMedio(d.p.prazo)) * 1.04 - 1) * .85, anos = d.p.prazo / 12;
  const final = linhas.reduce((s, l) => s + l.v * Math.pow(1 + (l.ret ?? retRV), anos), 0);
  // melhor opção única: a oferta de renda fixa que mais devolve no prazo, e o melhor pagador de dividendos
  const unica = OFF.map(o => ({ o, a: avaliar(o, X, d.p.prazo) })).filter(x => x.a.ok).sort((a, b) => b.a.final - a.a.final)[0];
  const div = candidatosRV('dividendos', 1)[0];
  return { linhas, final, unica, div };
}

/* ================= salvar e abrir a carteira (JSON) ================= */
function retrato(d) {
  return {
    mercado: { selic: M.selic, cdi: M.cdi, ipca12: M.ipca12, usd: M.usd, ibov: IB?.last ?? null, previsaoIbov: d.pv.score },
    nota: d.score, total: d.total, alocacao: Object.fromEntries(CL_EXT.map(c => [c.k, d.total ? d.atual[c.k] / d.total : 0])),
    ativos: d.itens.map(x => ({ chave: x.tk || x.h.ativo, valor: x.v, preco: x.a?.last ?? null, prev: x.a?.prev ?? null, veredito: x.av.v }))
  };
}
function exportarJSON(holdings, extra = {}) {
  const d = EXIST || diagnosticar();
  const obj = { app: 'analise-financeira', versao: 1, salvoEm: new Date().toISOString(), config: perfilExist(), holdings, extratos: EXTRATOS, snapshot: retrato(d), ...extra };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = `carteira-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
function abrirJSON(j) {
  if (j.app !== 'analise-financeira' || !Array.isArray(j.holdings)) throw new Error('não é um arquivo de carteira deste site');
  HOLD = j.holdings; EXTRATOS = j.extratos || {}; SNAP = j.snapshot ? { ...j.snapshot, salvoEm: j.salvoEm } : null;
  store.set('af2.snap', SNAP);
  const c = j.config || {};
  if (c.perfil) $('#ePerfil').value = c.perfil; if (c.prazo) $('#ePrazo').value = c.prazo; if (c.aporte != null) $('#eAporte').value = c.aporte;
  if (c.res != null) $('#eRes').value = Math.round(c.res * 100); if (c.cap) $('#eCap').value = Math.round(c.cap * 100); if (c.obj) $('#eObj').value = c.obj;
  salvarHold(); modo('exist');
}
/* converte a carteira montada do zero em linhas da carteira, para salvar ou levar para "Minha carteira" */
function planoComoHoldings() {
  if (!lastCart) return [];
  const dia = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  return lastCart.linhas.map(l => l.acao
    ? { tipo: l.acao.fii ? 'FII' : 'Ação', ativo: l.acao.sym, inst: l.onde, idx: '', taxa: '', venc: '', qtd: Math.floor(l.v / l.acao.last), valor: Math.round(l.v), planejado: true }
    : l.o ? { tipo: l.o.tipo, ativo: `${l.o.tipo} ${l.o.emissor}`, inst: l.o.plat, idx: l.o.idx, taxa: l.o.taxa, venc: l.o.liq ? '' : dia(l.o.prazo), qtd: '', valor: Math.round(l.v), planejado: true }
      : { tipo: 'ETF', ativo: l.nome.replace(/<[^>]+>/g, '').trim().split(' ')[0], inst: l.onde, idx: '', taxa: '', venc: '', qtd: '', valor: Math.round(l.v), planejado: true });
}

/* ================= render ================= */
let EXIST = null;
function renderExist() {
  const p = perfilExist(); store.set('af2.exist', p);
  const ep = $('#ePlat'), cur = ep.value || p.plat || '*';
  ep.innerHTML = '<option value="*">Todas (a melhor de cada)</option>' + plataformas().filter(x => x !== 'Tesouro Direto').map(x => `<option>${esc(x)}</option>`).join('');
  ep.value = [...ep.options].some(o => o.value === cur) ? cur : '*';
  const d = diagnosticar(); EXIST = d;
  renderHoldTbl(d); renderFontes();
  const vd = veredito(d.score), T = d.total || 1;
  $('#eTotal').textContent = d.total ? `patrimônio ${brl(d.total)} · ${d.itens.length} itens` : '';
  $('#eVerdict').textContent = vd.l; $('#eVerdict').className = 'verdict ' + vd.c;
  $('#eScore').textContent = d.score == null ? 'adicione ou importe seus investimentos' : `nota ${d.score}/100`;
  document.querySelectorAll('#eMeter span').forEach((el, i) => el.classList.toggle('on', d.score != null && i === Math.min(4, Math.floor(d.score / 20))));
  $('#eVerdictSub').textContent = d.score == null ? '' : `${d.F.filter(f => f.sev === 'alta').length} pontos importantes, ${d.F.filter(f => f.sev === 'média').length} médios. Alvo do perfil ${p.perfil}, reserva de ${pct(p.res, 0)}.`;
  chart('chExist', { type: 'bar', data: { labels: CL_EXT.map(c => c.nome.split(' (')[0]), datasets: [
    { label: 'Hoje', data: CL_EXT.map(c => +(d.atual[c.k] / T * 100).toFixed(1)), backgroundColor: CL_EXT.map(c => css(c.cor)), borderRadius: 3 },
    { label: 'Alvo', data: CL_EXT.map(c => +((d.alvo[c.k] ?? 0) * 100).toFixed(1)), backgroundColor: css('--line'), borderRadius: 3 }
  ] }, options: { ...base(), plugins: { legend: legend(), tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw}%` } } }, scales: { x: { ...axis(), ticks: { ...axis().ticks, font: { size: 9 } } }, y: { ...axis(), ticks: { ...axis().ticks, callback: v => v + '%' } } } } });
  tabela($('#eClasses'), 'eCl', [
    { k: 'c', h: 'Classe', f: r => `<i class="dot" style="background:${css(r.cor)}"></i>${r.nome.split(' (')[0]}` },
    { k: 'a', h: 'Hoje', r: 1, f: r => `<span class="num">${pct(d.atual[r.k] / T, 0)}</span> <span class="sub num">${brl(d.atual[r.k])}</span>` },
    { k: 't', h: `Alvo (${p.perfil})`, r: 1, f: r => `<span class="num">${pct(d.alvo[r.k] ?? 0, 0)}</span> <span class="sub num">${brl((d.alvo[r.k] ?? 0) * d.total)}</span>` },
    { k: 's', h: '', f: r => { const x = d.atual[r.k] / T - (d.alvo[r.k] ?? 0); return !d.total ? '' : Math.abs(x) <= .05 ? '<span class="pill up">ok</span>' : `<span class="pill ${Math.abs(x) > .15 ? 'down' : 'warn'}">${x > 0 ? 'reduzir' : 'aumentar'} ${pct(Math.abs(x), 0)}</span>`; } }
  ], CL_EXT.filter(c => c.k !== 'outros' || d.atual.outros), { rerender: renderExist });
  renderAvaliacao(d); renderRenda(d); renderSnap(d);
  const sevPill = s => ({ alta: '<span class="pill down">importante</span>', 'média': '<span class="pill warn">médio</span>', baixa: '<span class="pill flat">leve</span>', info: '<span class="pill acc">info</span>', ok: '<span class="pill up">ok</span>' }[s]);
  tabela($('#eFind'), 'eF', [{ k: 's', h: '', f: r => sevPill(r.sev) }, { k: 't', h: 'O que encontrei', w: 1, f: r => r.txt }], d.total ? d.F : [], { rerender: renderExist, empty: 'Adicione ou importe seus investimentos.' });
  const ap = planoAporte(d); d.aporte = ap;
  $('#eApSub').textContent = p.aporte ? `${brl(p.aporte)} · ${p.prazo} meses · ${OBJETIVOS[p.obj].split(' (')[0].toLowerCase()}` : 'informe o valor';
  tabela($('#eAp'), 'eAp', [
    { k: 'n', h: 'Onde aplicar', w: 1, f: l => `<i class="dot" style="background:${css(CLASSES.find(c => c.k === l.cl).cor)}"></i><b>${l.nome}</b>${l.trade ? `<br><span class="sub num">stop <span class="down">R$ ${nf(l.trade.stop, 2)}</span> · alvo <span class="up">R$ ${nf(l.trade.alvo, 2)}</span></span>` : ''}` },
    { k: 'o', h: 'Plataforma', f: l => esc(l.onde) },
    { k: 'v', h: 'Valor', r: 1, f: l => `<b class="num">${brl(l.v)}</b> <span class="sub num">${pct(l.v / (p.aporte || 1), 0)}</span>` },
    { k: 'r', h: 'Ret. a.a.', r: 1, f: l => l.retDy ? `<span class="num">DY ${pct(l.ret, 1)}</span>` : l.ret != null ? `<span class="num">${pct(l.ret)}</span>` : l.acao ? pillNivel(l.acao.prev) : '' }
  ], ap.linhas, { rerender: renderExist, empty: d.total ? 'Informe quanto vai aportar.' : 'Adicione seus investimentos primeiro.' });
  $('#eApProj').innerHTML = !p.aporte ? '' : [
    `Em <b>${p.prazo} meses</b>, os ${brl(p.aporte)} divididos assim viram <b>~${brl(ap.final)}</b> (renda fixa pelas taxas do buscador; renda variável pela hipótese de CDI + 4 p.p.).`,
    ap.unica ? `Melhor opção única no prazo: <b>${ap.unica.o.tipo} ${fmtTaxa(ap.unica.o)}</b> (${ap.unica.o.plat}) → <b>${brl(ap.unica.a.final)}</b> em ${Math.round(ap.unica.a.diasTot / 30.4)} meses, ${pct(ap.unica.a.liqAA)} líquido a.a.` : '',
    ap.div ? `Para renda mensal: <b>${ap.div.sym}</b> (DY ${pct(ap.div.a.dy, 1)}) pagaria ~<b>${brl(p.aporte * ap.div.a.dy / 12)}/mês</b> isento de IR, com risco de preço.` : ''
  ].filter(Boolean).map(x => `<span>${x}</span>`).join('<br>');
  const acima = CLASSES.filter(c => d.total && d.atual[c.k] / T - d.alvo[c.k] > .05);
  $('#eRebal').innerHTML = acima.length ? `Para alinhar sem aporte, seria preciso reduzir ${acima.map(c => `<b>${c.nome.split(' (')[0].toLowerCase()}</b> (${brl(d.atual[c.k] - d.alvo[c.k] * T)})`).join(' e ')}. Antes de vender, veja o imposto: vendas de ações até R$ 20 mil no mês são isentas; FIIs, ETFs e renda fixa resgatada antes do vencimento pagam IR.` : '';
}
function renderAvaliacao(d) {
  const linhas = d.itens.filter(x => x.v > 0 || x.h.qtd || x.h.nota);
  const T = d.total || 1;
  const ret = x => x.a ? x.a.r12 + x.a.dy : null;
  const ordem = [...linhas].filter(x => ret(x) != null && x.v > 0).sort((a, b) => ret(b) - ret(a));
  const top = new Set(ordem.slice(0, 3)), pior = new Set(ordem.slice(-3).filter(x => ret(x) < benchCDI()));
  $('#eAvSub').innerHTML = ordem.length ? `Melhores em 12 meses: ${ordem.slice(0, 3).map(x => `<b class="up">${x.tk} ${sgnPct(ret(x))}</b>`).join(', ')}${pior.size ? ` · piores: ${[...pior].map(x => `<b class="down">${x.tk} ${sgnPct(ret(x))}</b>`).join(', ')}` : ''}` : 'Retorno de 12 meses aparece para ações e FIIs cotados.';
  tabela($('#eAv'), 'eAv', [
    { k: 'a', h: 'Investimento', w: 1, f: x => `<b>${esc(x.tk || x.h.ativo)}</b> <span class="sub">${esc(x.a ? x.a.setor : x.h.tipo)}${x.h.inst ? ' · ' + esc(x.h.inst) : ''}</span>`, v: x => x.tk || x.h.ativo, asc: 1 },
    { k: 'q', h: 'Qtd.', r: 1, f: x => x.h.qtd ? `<span class="num">${nf(x.h.qtd)}</span>` : '', v: x => +x.h.qtd || 0 },
    { k: 'v', h: 'Valor', r: 1, f: x => x.v > 0 ? `<span class="num">${brl(x.v)}</span>` : '<span class="pill flat">falta</span>', v: x => x.v },
    { k: 'p', h: '%', r: 1, f: x => `<span class="num">${pct(x.v / T, 1)}</span>`, v: x => x.v },
    { k: 'rd', h: 'Proventos (extrato)', r: 1, f: x => x.h.renda ? `<span class="num up">${brl(x.h.renda)}</span>` : '', v: x => x.h.renda || 0 },
    { k: 'dy', h: 'DY 12m', r: 1, f: x => x.a?.dy ? `<span class="num">${pct(x.a.dy, 1)}</span>` : '', v: x => x.a?.dy ?? -1 },
    { k: 'r12', h: 'Preço 12m', r: 1, f: x => x.a ? `<span class="num ${cls(x.a.r12)}">${sgnPct(x.a.r12)}</span>` : '', v: x => x.a?.r12 ?? -9 },
    { k: 'tot', h: 'Total 12m', r: 1, f: x => ret(x) != null ? `<b class="num ${ret(x) >= benchCDI() ? 'up' : 'down'}">${sgnPct(ret(x))}</b>` : '', v: x => ret(x) ?? -9 },
    { k: 'pv', h: 'Previsão', f: x => x.a ? pillNivel(x.a.prev) : '', v: x => x.a?.prev ?? -9 },
    { k: 've', h: 'Avaliação', f: x => `<span class="pill ${x.av.c}" title="${esc(x.av.m)}">${x.av.v}</span>`, v: x => x.av.ord, asc: 1 },
    { k: 'm', h: 'Por quê', w: 1, f: x => `<span class="sub">${esc(x.av.m)}</span>` }
  ], linhas, { sort: { k: 'tot', dir: -1 }, rerender: () => renderAvaliacao(d), rowCls: x => top.has(x) ? 'best' : '', empty: 'Adicione ou importe seus investimentos.' });
}
function renderRenda(d) {
  const mes = {}; Object.values(EXTRATOS).forEach(e => Object.entries(e.rendaPorMes || {}).forEach(([k, v]) => mes[k] = (mes[k] || 0) + v));
  const ks = Object.keys(mes).sort();
  const est = d.itens.reduce((s, x) => s + (x.a && x.v > 0 ? x.v * x.a.dy : 0), 0);
  const ext = Object.values(EXTRATOS), taxas = ext.reduce((s, e) => s + e.taxas, 0), meses = ext.reduce((s, e) => s + mesesPeriodo(e), 0) || 1;
  const rec = ks.length ? Object.values(mes).reduce((a, b) => a + b, 0) / Math.max(1, ks.length) : 0;
  $('#eRendaKv').innerHTML = [
    ks.length ? ['Recebido por mês (extratos)', `<b class="up">${brl(rec)}</b> <span class="sub">média de ${ks.length} meses</span>`] : null,
    ['Renda estimada pelos proventos de 12 meses', `<b>${brl(est / 12)}/mês</b> <span class="sub">${brl(est)}/ano · ${pct(est / (d.total || 1), 1)} da carteira</span>`],
    taxas ? ['Taxas cobradas na conta', `<b class="down">${brl(taxas / meses)}/mês</b> <span class="sub">${ext.flatMap(e => e.taxasNome).join(', ')}</span>`] : null,
    ext.some(e => e.irRetido) ? ['IR retido no período', brl(ext.reduce((s, e) => s + e.irRetido, 0))] : null,
    ext.some(e => e.resgates?.length) ? ['Resgatados no período', `<span class="sub">${ext.flatMap(e => e.resgates).map(esc).join('; ')}</span>`] : null
  ].filter(Boolean).map(([k, v]) => `<span>${k}</span><span class="num">${v}</span>`).join('');
  chart('chRenda', { type: 'bar', data: { labels: ks.map(k => k.split('-').reverse().join('/')), datasets: [{ label: 'Proventos e cupons', data: ks.map(k => Math.round(mes[k] * 100) / 100), backgroundColor: css('--up'), borderRadius: 3 }] },
    options: { ...base(), plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${brl(c.raw)}` } } }, scales: { x: axis(), y: { ...axis(), ticks: { ...axis().ticks, callback: v => brl(v) } } } } });
  $('#chRendaBox').hidden = !ks.length;
}
function renderSnap(d) {
  const card = $('#eSnapCard'); card.hidden = !SNAP || !d.total; if (card.hidden) return;
  const dias = Math.round((Date.now() - new Date(SNAP.salvoEm)) / 864e5), s = SNAP.mercado;
  const ch = (a, b) => b ? a / b - 1 : null;
  const resumo = [
    `Salva em <b>${new Date(SNAP.salvoEm).toLocaleDateString('pt-BR')}</b> (${dias} dias). Carteira: ${brl(SNAP.total)} → <b>${brl(d.total)}</b> (${sgnPct(ch(d.total, SNAP.total))}).`,
    `Nota ${SNAP.nota ?? '—'} → <b>${d.score}</b>. Selic ${pct(s.selic)} → ${pct(M.selic)} · CDI ${pct(s.cdi)} → ${pct(M.cdi)} · IPCA ${pct(s.ipca12)} → ${pct(M.ipca12)}${s.ibov && IB ? ` · Ibovespa ${sgnPct(ch(IB.last, s.ibov))}` : ''} · previsão do Ibovespa ${nivel(s.previsaoIbov).l} → ${nivel(d.pv.score).l}.`
  ];
  const mudou = d.itens.map(x => ({ x, o: SNAP.ativos.find(a => a.chave === (x.tk || x.h.ativo)) })).filter(r => r.o);
  const nMud = mudou.filter(r => r.o.veredito !== r.x.av.v).length;
  if (nMud) resumo.push(`<b>${nMud} investimento(s) mudaram de avaliação</b> — veja a tabela.`);
  $('#eSnapTxt').innerHTML = resumo.join('<br>');
  tabela($('#eSnap'), 'eSnap', [
    { k: 'a', h: 'Investimento', f: r => `<b>${esc(r.o.chave)}</b>` },
    { k: 'p', h: 'Preço então → hoje', r: 1, f: r => r.o.preco && r.x.a ? `<span class="num">${nf(r.o.preco, 2)} → ${nf(r.x.a.last, 2)}</span> <span class="num ${cls(ch(r.x.a.last, r.o.preco))}">${sgnPct(ch(r.x.a.last, r.o.preco))}</span>` : '', v: r => r.o.preco && r.x.a ? ch(r.x.a.last, r.o.preco) : -9 },
    { k: 'v', h: 'Valor então → hoje', r: 1, f: r => `<span class="num">${brl(r.o.valor)} → ${brl(r.x.v)}</span>`, v: r => r.x.v - r.o.valor },
    { k: 's', h: 'Previsão então → hoje', f: r => r.o.prev != null && r.x.a ? `${pillNivel(r.o.prev)} → ${pillNivel(r.x.a.prev)}` : '' },
    { k: 'e', h: 'Avaliação então → hoje', f: r => r.o.veredito === r.x.av.v ? `<span class="pill flat">${r.x.av.v}</span>` : `<span class="pill flat">${r.o.veredito}</span> → <span class="pill ${r.x.av.c}">${r.x.av.v}</span>` }
  ], mudou, { rerender: () => renderSnap(d) });
}
function renderFontes() {
  const srcs = [...new Set(HOLD.map(h => h.src).filter(Boolean))];
  $('#eSrcs').innerHTML = srcs.map(s => `<span class="chip on" title="${esc(s)}">${esc(s.length > 32 ? s.slice(0, 30) + '…' : s)} · ${HOLD.filter(h => h.src === s).length} <button class="btn ghost" data-rmsrc="${esc(s)}" title="remover este arquivo" style="padding:0 2px">✕</button></span>`).join('');
  $('#eSrcs').querySelectorAll('[data-rmsrc]').forEach(b => b.onclick = () => { HOLD = HOLD.filter(h => h.src !== b.dataset.rmsrc); delete EXTRATOS[b.dataset.rmsrc]; salvarHold(); renderExist(); });
}
function renderHoldTbl(d) {
  const sel = (h, k, opts) => `<select data-k="${k}">${opts.map(x => `<option${x === (h[k] || '') ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  const tot = d.total || 1;
  $('#eTbl').innerHTML = `<thead><tr><th>Tipo</th><th>Ativo / produto</th><th>Instituição</th><th>Indexador</th><th class="r">Taxa</th><th>Vencimento</th><th class="r">Qtd.</th><th class="r">Valor atual (R$)</th><th class="r">%</th><th>Origem</th><th></th></tr></thead><tbody>${HOLD.map((h, i) => { const a = ativoDe(tickerDe(h)), calc = h.qtd > 0 && a; return `<tr data-i="${i}" class="${h.imp ? 'imp' : ''}" title="${esc(h.nota || '')}">
    <td>${sel(h, 'tipo', TIPOS_ATIVO)}</td><td><input data-k="ativo" value="${esc(h.ativo)}" placeholder="ex.: PETR4, CDB Banco X"></td><td><input data-k="inst" value="${esc(h.inst)}" placeholder="banco/corretora"></td>
    <td>${sel(h, 'idx', ['', 'CDI', 'Pré', 'IPCA'])}</td><td class="r"><input class="n num" data-k="taxa" type="number" step="0.1" value="${h.taxa ?? ''}" placeholder="—"></td>
    <td><input data-k="venc" type="date" value="${esc(h.venc)}" style="width:128px"></td><td class="r"><input class="n num" data-k="qtd" type="number" step="1" value="${h.qtd ?? ''}" placeholder="—"></td>
    <td class="r"><input class="n num" data-k="valor" type="number" step="100" value="${calc ? Math.round(valorDe(h)) : h.valor ?? ''}" style="width:100px" ${calc ? 'disabled title="calculado: quantidade × cotação"' : ''} placeholder="${h.nota ? 'informe' : '—'}"></td>
    <td class="r num">${pct(valorDe(h) / tot, 1)}</td><td class="sub" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(h.src || (h.planejado ? 'planejado' : 'manual'))}</td><td><button class="btn ghost" data-del="${i}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="11" class="sub">Nenhum investimento ainda. Importe seus extratos ou clique em "+ Adicionar".</td></tr>'}</tbody>`;
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
    perfil: d.p.perfil, objetivo_renda_variavel: OBJETIVOS[d.p.obj], prazo_meses: d.p.prazo, reserva_desejada_pct: d.p.res * 100, aporte_planejado: d.p.aporte, patrimonio_total: Math.round(T),
    ativos: d.itens.filter(x => x.v > 0).map(x => ({ tipo: x.h.tipo, ativo: x.tk || x.h.ativo, indexador: x.h.idx || null, taxa: x.h.taxa || null, vencimento: x.h.venc || null,
      valor: Math.round(x.v), pct: +(x.v / T * 100).toFixed(1), dy_12m: x.a ? +(x.a.dy * 100).toFixed(1) : undefined, retorno_preco_12m: x.a ? +(x.a.r12 * 100).toFixed(1) : undefined,
      previsao_4sem: x.a ? nivel(x.a.prev).l : undefined, avaliacao_por_regras: x.av.v })),
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
Responda em português, direto e prático, com estas seções em markdown: "## Resumo" (2 a 3 frases e um veredito: está boa, ok com ajustes, ou precisa ser ajustada), "## Investimento por investimento" (os que vão bem, os que manter e os que vale a pena retirar, com o motivo), "## O que ajustar" (ações concretas, com valores em R$ quando possível), "## Onde colocar o novo aporte" (considere o objetivo e o prazo; pode concordar ou discordar da sugestão por regras e diga por quê), "## Riscos e cuidados" (imposto, FGC, concentração, liquidez).
Use os números do JSON; não invente cotações, taxas ou ofertas que não estejam nele. Taxas de renda fixa são referências e devem ser conferidas na plataforma. Não prometa retorno. Termine lembrando, em uma linha, que é uma análise educativa e não uma recomendação de investimento.`;
function mdSimples(t) {
  const e = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return e.split(/\n{2,}/).map(b => {
    if (/^#{1,3} /.test(b)) return b.replace(/^#{1,3} (.*)$/m, '<h3>$1</h3>').replace(/\n(?!<)/g, '<br>');
    if (/^\s*[-*] /m.test(b)) return '<ul>' + b.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('') + '</ul>';
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
async function analisarIA() {
  const out = $('#aiOut'), key = $('#aiKey').value.trim(), d = EXIST;
  if (!d?.total) { out.innerHTML = '<p class="down">Adicione seus investimentos antes.</p>'; return; }
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
['#ePerfil', '#ePrazo', '#eAporte', '#ePlat', '#eRes', '#eCap', '#eObj'].forEach(id => $(id).addEventListener('input', renderExist));
$('#eFile').onchange = e => { if (e.target.files.length) importar([...e.target.files]); e.target.value = ''; };
const drop = $('#eDrop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) importar([...e.dataTransfer.files]); });
$('#eAdd').onclick = () => { HOLD.unshift({ tipo: 'CDB', ativo: '', inst: '', idx: 'CDI', taxa: '', venc: '', qtd: '', valor: '' }); salvarHold(); renderExist(); };
$('#eClear').onclick = () => { if (confirm('Apagar todos os investimentos da sua carteira neste navegador?')) { HOLD = []; EXTRATOS = {}; SNAP = null; store.set('af2.snap', null); salvarHold(); renderExist(); } };
$('#eSave').onclick = () => exportarJSON(HOLD);
$('#eOpen').onchange = async e => { const f = e.target.files[0]; if (f) { try { abrirJSON(JSON.parse(await f.text())); $('#eImpMsg').innerHTML = `<b class="up">${esc(f.name)}</b>: carteira salva aberta — veja "Desde que você salvou".`; } catch (er) { $('#eImpMsg').innerHTML = `<b class="down">${esc(f.name)}</b>: ${esc(er.message)}`; } } e.target.value = ''; };
$('#cSaveJson').onclick = () => { renderCarteira(); exportarJSON(planoComoHoldings(), { origem: 'montar do zero' }); };
$('#cToExist').onclick = () => { renderCarteira(); HOLD = planoComoHoldings(); EXTRATOS = {}; salvarHold(); modo('exist'); };
$('#aiRun').onclick = analisarIA;
(() => {
  const e = store.get('af2.exist', null);
  if (e) { $('#ePerfil').value = e.perfil; $('#ePrazo').value = e.prazo; $('#eAporte').value = e.aporte; $('#eRes').value = Math.round(e.res * 100); $('#eCap').value = Math.round(e.cap * 100); if (e.obj) $('#eObj').value = e.obj; }
  try { const k = localStorage.getItem('af2.aikey'); if (k) { $('#aiKey').value = k; $('#aiRemember').checked = true; } } catch {}
  modo(store.get('af2.modo', 'zero'));
})();
