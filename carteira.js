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
// escolhas da pessoa sobre itens importados, que sobrevivem a uma nova importação do mesmo arquivo
let IGN = new Set(store.get('af2.ignorados', []));  // itens apagados
let AJ = store.get('af2.ajustes', {});              // valores corrigidos à mão
const chaveH = h => `${h.src || 'manual'}|${h.codigo || h.ativo}`;
const salvarEscolhas = () => { store.set('af2.ignorados', [...IGN]); store.set('af2.ajustes', AJ); };
function apagarItem(h) { if (h.src) IGN.add(chaveH(h)); delete AJ[chaveH(h)]; HOLD = HOLD.filter(x => x !== h); salvarEscolhas(); salvarHold(); renderExist(); }
function ajustarValor(h, v) { h.valor = v === '' ? '' : +v; h.qtd = ''; h.imp = false; if (h.src) AJ[chaveH(h)] = h.valor; salvarEscolhas(); salvarHold(); renderExist(); }
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
/* o mesmo título pode vir do extrato (sem valor) e do informe (com valor): casa pelo código e completa */
function juntarPorCodigo(novos) {
  const usados = new Set();
  novos.filter(n => n.codigo).forEach(n => {
    const h = HOLD.find(x => x.codigo === n.codigo || String(x.ativo || '').includes(n.codigo));
    if (!h) return;
    if (!(+h.valor > 0) && n.valor > 0) { h.valor = n.valor; h.nota = n.nota; }
    h.codigo = h.codigo || n.codigo; h.venc = h.venc || n.venc; h.idx = h.idx || n.idx;
    if (!h.inst || h.inst === 'XP') h.inst = n.inst || h.inst;
    usados.add(n);
  });
  return usados;
}
/* instituições com liquidação decretada: instituicaoLiquidada() em calculos.js */
const liquidada = instituicaoLiquidada;
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
    if (ehIRPF(texto)) {
      const ir = lerIRPF(texto), recente = ir.ano >= new Date().getFullYear() - 1;
      // declaração antiga vira histórico; a do último ano também entra como posição (a custo)
      return { linhas: recente ? carteiraDoIRPF(ir, src) : [], resumo: resumoIRPF(ir), historico: !recente };
    }
    if (ehInformeXP(texto)) {
      const inf = lerInformeXP(texto);
      return { linhas: carteiraDoInformeXP(inf, src), resumo: { banco: 'XP', tipo: 'informe', ...resumoInformeXP(inf) } };
    }
    if (ehExtratoXP(texto)) {
      const ex = lerExtratoXP(texto);
      return { linhas: carteiraDoExtratoXP(ex, src, [...Object.keys(U), ...Object.keys(UF)]), resumo: { banco: 'XP', tipo: 'extrato', ...resumoExtratoXP(ex) } };
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
      if (!r.linhas.length && !r.resumo) { res.push(`<b class="down">${esc(file.name)}</b>: nenhum investimento encontrado`); continue; }
      if (r.historico) {
        EXTRATOS[file.name] = r.resumo;
        res.push(`<b class="up">${esc(file.name)}</b>: declaração IRPF ${r.resumo.exercicio} (ano-calendário ${r.resumo.ano}) usada como <b>histórico</b> na linha do tempo — por ser antiga, os bens não entram como posição de hoje`);
        continue;
      }
      // o que a pessoa já apagou não volta, e o valor que ela corrigiu é mantido
      r.linhas = r.linhas.filter(l => !IGN.has(chaveH(l))).map(l => AJ[chaveH(l)] != null ? { ...l, valor: AJ[chaveH(l)], imp: false } : l);
      HOLD = HOLD.filter(h => h.src !== file.name);   // reimportar o mesmo arquivo substitui, não duplica
      const juntou = juntarPorCodigo(r.linhas);
      HOLD = HOLD.concat(r.linhas.filter(l => !juntou.has(l)));
      if (r.resumo) EXTRATOS[file.name] = r.resumo; else delete EXTRATOS[file.name];
      const semValor = r.linhas.filter(h => !(valorDe(h) > 0)).length;
      res.push(`<b class="up">${esc(file.name)}</b>: ${r.linhas.length} itens${r.resumo?.tipo === 'informe' ? ` (informe de rendimentos ${r.resumo.ano})` : r.resumo?.tipo === 'irpf' ? ` (IRPF ${r.resumo.exercicio}, bens em 31/12/${r.resumo.ano})` : r.resumo ? ' (extrato de movimentação da XP)' : ''}${juntou.size ? `, ${juntou.size} completaram itens que já estavam na carteira` : ''}${semValor ? `, <span class="warn">${semValor} sem valor — complete na tabela</span>` : ''}${r.ir ? ' · valores de custo em 31/12' : ''}`);
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
  const lq = liquidada(h);
  if (lq) return { v: 'Banco liquidado', c: 'down', ord: 0, m: `${lq.nome}: liquidação extrajudicial decretada pelo Banco Central em ${lq.quando}. O valor depende do pagamento do FGC (até R$ 250 mil por CPF por conglomerado). Confira no app do FGC.` };
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
  // alvo: os itens envolvidos (para levar a pessoa até eles) ou a seção da página que resolve
  const pen = (n, sev, txt, alvo) => { score -= n; F.push({ sev, txt, alvo }); };
  const de = f => ({ itens: itens.filter(f).map(x => x.h) });
  if (!total) return { p, pv, alvo, itens, total, atual, F, score: null };
  CLASSES.forEach(c => {
    const a = atual[c.k] / total, d = a - alvo[c.k];
    if (Math.abs(d) > .05) pen(Math.min(18, (Math.abs(d) - .05) * 100 * 1.2), Math.abs(d) > .15 ? 'alta' : 'média',
      `${c.nome}: ${pct(a, 0)} da carteira, alvo ${pct(alvo[c.k], 0)} para o perfil ${p.perfil} — ${d > 0 ? 'acima' : 'abaixo'} ${pct(Math.abs(d), 0)}.`, d > 0 ? de(x => x.cl === c.k && x.v > 0) : { sec: '#eApCard' });
  });
  if (atual.outros / total > .2) pen(5, 'média', `${pct(atual.outros / total, 0)} em fundos, COE, previdência ou cripto: confira taxas e liquidez.`, de(x => x.cl === 'outros' && x.v > 0));
  const soma = f => val.filter(f).reduce((s, x) => s + x.v, 0);
  const poup = soma(x => x.h.tipo === 'Poupança'); if (poup > 0 && M.selic > .085) pen(8, 'alta', `${brl(poup)} na poupança: rende bem menos que Tesouro Selic ou CDB de liquidez diária.`, de(x => x.h.tipo === 'Poupança'));
  const cc = soma(x => x.h.tipo === 'Conta corrente'); if (cc / total > .05) pen(5, 'média', `${brl(cc)} parado em conta (${pct(cc / total, 0)}), sem render.`, de(x => x.h.tipo === 'Conta corrente'));
  if (atual.res / total < .05 && p.perfil !== 'arrojado') pen(8, 'alta', `Reserva de liquidez de só ${pct(atual.res / total, 0)}: numa emergência você teria de vender algo no prejuízo.`, { sec: '#eApCard' });
  val.filter(x => x.cl === 'acoes' && x.h.tipo === 'Ação').forEach(x => { if (x.v / total > p.cap * 1.5) pen(8, 'alta', `${x.h.ativo} é ${pct(x.v / total, 1)} da carteira, acima do teto de ${pct(p.cap, 0)} por ação.`, { itens: [x.h] }); });
  const porEm = {}; val.filter(x => FGC.has(x.h.tipo)).forEach(x => { const k = liquidada(x.h)?.nome.toUpperCase() || (x.h.inst || x.h.ativo).toUpperCase(); porEm[k] = (porEm[k] || 0) + x.v; });
  Object.entries(porEm).filter(([, v]) => v > 250000).forEach(([k, v]) => pen(10, 'alta', `${brl(v)} em títulos com FGC de ${k}: acima do limite de R$ 250 mil por instituição.`, de(x => FGC.has(x.h.tipo) && (liquidada(x.h)?.nome.toUpperCase() || (x.h.inst || x.h.ativo).toUpperCase()) === k)));
  const nAcoes = new Set(val.filter(x => x.h.tipo === 'Ação').map(x => x.tk || x.h.ativo)).size, nFii = val.filter(x => x.h.tipo === 'FII').length;
  if (atual.acoes > 0 && nAcoes + nFii < 4 && !val.some(x => x.h.tipo === 'ETF')) pen(6, 'média', `Só ${nAcoes + nFii} ativo(s) de renda variável: pouca diversificação.`, { sec: '#eApCard' });
  const ruins = itens.filter(x => x.av.v === 'Avaliar saída');
  if (ruins.length) pen(Math.min(12, ruins.length * 4), 'média', `${ruins.length} ativo(s) com recomendação de avaliar saída: ${ruins.map(x => x.tk || x.h.ativo).join(', ')}.`, { itens: ruins.map(x => x.h) });
  const coe = soma(x => x.h.tipo === 'COE'); if (coe / total > .1) pen(4, 'média', `${pct(coe / total, 0)} em COE: produto de baixa liquidez e custo embutido.`, de(x => x.h.tipo === 'COE'));
  const faltam = itens.filter(x => !(x.v > 0)).length;
  if (faltam) F.push({ sev: 'info', txt: `${faltam} item(ns) sem valor ficaram fora da conta. Clique aqui para completar o valor.`, alvo: de(x => !(x.v > 0)) });
  // custos cobrados (extratos)
  const ext = extratosMovimentacao(EXTRATOS); const taxas = ext.reduce((s, e) => s + (e.taxas || 0), 0), meses = ext.reduce((s, e) => s + mesesPeriodo(e), 0) || 1;
  // instituições em liquidação: o dinheiro depende do FGC
  const liq = val.filter(x => liquidada(x.h));
  if (liq.length) { const v = liq.reduce((s, x) => s + x.v, 0); pen(14, 'alta', `${brl(v)} em ${liq.length} título(s) do ${liquidada(liq[0].h).nome}, que teve liquidação extrajudicial decretada pelo Banco Central em ${liquidada(liq[0].h).quando}. O FGC cobre até R$ 250 mil por CPF por conglomerado (principal + juros até a liquidação). Confira no app do FGC se o pagamento já saiu; se já recebeu, remova esses itens.`, { itens: liq.map(x => x.h) }); }
  if (taxas > 0) { const anual = taxas / meses * 12; pen(anual / total > .01 ? 6 : 2, anual / total > .01 ? 'alta' : 'baixa', `Taxas cobradas na conta (${ext.flatMap(e => e.taxasNome).join(', ')}): ~${brl(anual)} por ano, ${pct(anual / total, 2)} do patrimônio.${anual / total > .01 ? ' Mais de 1% ao ano come boa parte do rendimento.' : ''}`, { sec: '#eRendaKv' }); }
  if (M.selic - selicAt(12) > .005 && atual.trav / total < .1 && p.prazo >= 24) F.push({ sev: 'média', txt: `Focus vê Selic ${pct(M.selic - selicAt(12))} menor em 12 meses e só ${pct(atual.trav / total, 0)} está travado em pré/IPCA+.`, alvo: { sec: '#eApCard' } });
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
  const obj = { app: 'analise-financeira', versao: 1, salvoEm: new Date().toISOString(), config: perfilExist(), holdings, extratos: EXTRATOS, historico: HIST, snapshot: retrato(d), ...extra };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = `carteira-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
function abrirJSON(j) {
  if (j.app !== 'analise-financeira' || !Array.isArray(j.holdings)) throw new Error('não é um arquivo de carteira deste site');
  HOLD = j.holdings; EXTRATOS = j.extratos || {}; SNAP = j.snapshot ? { ...j.snapshot, salvoEm: j.salvoEm } : null;
  store.set('af2.snap', SNAP);
  // junta o histórico salvo no arquivo com o deste navegador (o dia do salvamento vira um ponto real)
  HIST = { ...(j.historico || {}), ...HIST };
  if (j.snapshot?.total && j.salvoEm) HIST[j.salvoEm.slice(0, 10)] = HIST[j.salvoEm.slice(0, 10)] || { total: j.snapshot.total, g: {} };
  store.set('af2.hist', HIST);
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
  registrarHistorico(d);
  renderAlerta(d); renderPatrimonio(d); renderLinhaTempo(d); renderEvolucao(d); renderAvaliacao(d); renderRenda(d); renderSnap(d);
  const sevPill = s => ({ alta: '<span class="pill down">importante</span>', 'média': '<span class="pill warn">médio</span>', baixa: '<span class="pill flat">leve</span>', info: '<span class="pill acc">info</span>', ok: '<span class="pill up">ok</span>' }[s]);
  // uma coluna só: selo, texto e a ação na mesma linha (no celular não vira uma torre de texto)
  tabela($('#eFind'), 'eF', [{ k: 't', h: 'O que encontrei', w: 1, f: r => `${sevPill(r.sev)} ${r.txt}${r.alvo ? ` <span class="pill acc" title="ir até ${r.alvo.itens ? 'os itens' : 'a seção'} para ajustar">${r.alvo.itens ? `ajustar ${r.alvo.itens.length}` : 'ver'} →</span>` : ''}` }],
    d.total ? d.F : [], { rerender: renderExist, empty: 'Adicione ou importe seus investimentos.', rowCls: r => r.alvo ? 'link' : '', onRow: r => r.alvo && irPara(r.alvo) });
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
  // resposta rápida logo abaixo do campo "Investir mais"
  $('#eApRapido').innerHTML = !p.aporte ? '<span class="sub">Digite em <b>Investir mais</b> quanto quer aplicar e o prazo: a melhor opção aparece aqui.</span>' : [
    `<b>Melhor destino para ${brl(p.aporte)} em ${p.prazo} meses</b>`,
    ap.unica ? `🏆 Opção única que mais rende: <b>${ap.unica.o.tipo} ${fmtTaxa(ap.unica.o)}</b> (${ap.unica.o.plat}) → <b class="up">${brl(ap.unica.a.final)}</b> no vencimento (${pct(ap.unica.a.liqAA)} líquido a.a.${ap.unica.a.ir ? '' : ', isento de IR'}${FGC.has(ap.unica.o.tipo) ? ', com FGC' : ap.unica.o.tipo.startsWith('Tesouro') ? ', Tesouro' : ''}).` : 'Nenhuma oferta de renda fixa cabe nesse valor e prazo.',
    ap.linhas.length ? `⚖️ Para equilibrar a carteira (perfil ${p.perfil}): ${ap.linhas.slice().sort((a, b) => b.v - a.v).slice(0, 3).map(l => `<b>${l.nome.replace(/<[^>]+>/g, '').split('  ')[0]}</b> ${brl(l.v)}`).join(' · ')}${ap.linhas.length > 3 ? ` e mais ${ap.linhas.length - 3}` : ''} → <b>~${brl(ap.final)}</b> no prazo.` : '',
    ap.div ? `💰 Para renda mensal: <b>${ap.div.sym}</b> (DY ${pct(ap.div.a.dy, 1)}) ≈ ${brl(p.aporte * ap.div.a.dy / 12)}/mês isento.` : '',
    `<a href="#" id="eApVer" style="color:var(--accent);font-weight:600">ver o plano completo ↓</a>`
  ].filter(Boolean).join('<br>');
  const ver = $('#eApVer'); if (ver) ver.onclick = e => { e.preventDefault(); $('#eApCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const acima = CLASSES.filter(c => d.total && d.atual[c.k] / T - d.alvo[c.k] > .05);
  $('#eRebal').innerHTML = acima.length ? `Para alinhar sem aporte, seria preciso reduzir ${acima.map(c => `<b>${c.nome.split(' (')[0].toLowerCase()}</b> (${brl(d.atual[c.k] - d.alvo[c.k] * T)})`).join(' e ')}. Antes de vender, veja o imposto: vendas de ações até R$ 20 mil no mês são isentas; FIIs, ETFs e renda fixa resgatada antes do vencimento pagam IR.` : '';
  renderStrip(d.pv);  // atualiza o "Seu patrimônio" da faixa de indicadores
}
/* leva a pessoa até o que precisa de ajuste: as linhas dos itens na tabela de avaliação, ou a seção indicada */
function irPara(alvo) {
  if (alvo.sec) { const el = $(alvo.sec); el?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); piscar(el?.closest('.card')); return; }
  const idx = new Set(alvo.itens.map(h => HOLD.indexOf(h)).filter(i => i >= 0));
  SORT.eAv = { k: 've', dir: 1 }; renderAvaliacao(EXIST);   // problemas primeiro
  const linhas = [...$('#eAv').querySelectorAll('tbody tr')].filter(tr => { const inp = tr.querySelector('[data-av-valor]'); return inp && idx.has(+inp.dataset.avValor); });
  if (!linhas.length) return;
  linhas[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  linhas.forEach(piscar);
  setTimeout(() => linhas[0].querySelector('[data-av-valor]')?.focus(), 450);
}
function piscar(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

/* alerta no topo quando há títulos de instituição em liquidação */
function renderAlerta(d) {
  const liq = d.itens.filter(x => liquidada(x.h) && x.v > 0), box = $('#eAlerta');
  box.hidden = !liq.length; if (!liq.length) return;
  const v = liq.reduce((s, x) => s + x.v, 0), lq = liquidada(liq[0].h);
  box.innerHTML = `<b style="color:var(--down)">⚠️ ${brl(v)} em ${liq.length} título(s) do ${lq.nome}</b> (liquidação extrajudicial decretada pelo Banco Central em ${lq.quando}). O FGC cobre até R$ 250 mil por CPF por conglomerado. Se já recebeu, remova; se recebeu parte, ajuste os valores.
    <div class="row mt"><button class="btn" id="alVer">Ver e ajustar os ${liq.length} títulos</button><button class="btn" id="alRem" style="border-color:var(--down);color:var(--down)">Já recebi do FGC: remover todos</button></div>`;
  $('#alVer').onclick = () => irPara({ itens: liq.map(x => x.h) });
  $('#alRem').onclick = () => {
    if (!confirm(`Remover os ${liq.length} títulos do ${lq.nome} (${brl(v)})? Use quando o FGC já tiver pago. Eles não voltam ao reimportar os arquivos.`)) return;
    liq.forEach(x => { if (x.h.src) IGN.add(chaveH(x.h)); delete AJ[chaveH(x.h)]; });
    HOLD = HOLD.filter(h => !liq.some(x => x.h === h)); salvarEscolhas(); salvarHold(); renderExist();
  };
}

/* ================= linha do tempo: cruza IRPF, informes, registros e a carteira de hoje ================= */
function pontosLinhaTempo(d) {
  const P = [], docs = Object.entries(EXTRATOS);
  docs.filter(([, e]) => e.tipo === 'irpf').forEach(([src, e]) => {
    P.push({ data: `${e.ano - 1}-12-31`, fonte: `IRPF ${e.exercicio}`, src, invest: e.investAnt, bens: e.bensAnt, dividas: e.dividasAnt, liquido: e.bensAnt - (e.dividasAnt || 0), declarado: true });
    P.push({ data: `${e.ano}-12-31`, fonte: `IRPF ${e.exercicio}`, src, invest: e.invest, bens: e.bens, dividas: e.dividas, liquido: e.liquido, declarado: true });
  });
  docs.filter(([, e]) => e.tipo === 'informe').forEach(([src, e]) => P.push({ data: `${e.ano}-12-31`, fonte: `Informe XP ${e.ano}`, src, invest: e.posicaoFim, parcial: 'só a XP, a custo, sem ações e FIIs' }));
  Object.entries(HIST).filter(([data]) => !d.total || data !== diaISO(Date.now())).forEach(([data, h]) => P.push({ data, fonte: 'registro na página', invest: h.total }));
  if (d.total) P.push({ data: diaISO(Date.now()), fonte: 'carteira de hoje', invest: d.total, hoje: true });
  // mesmo dia e mesma fonte: fica um ponto
  const vistos = new Map(); P.forEach(p => vistos.set(`${p.data}|${p.fonte}`, { ...vistos.get(`${p.data}|${p.fonte}`), ...p }));
  return [...vistos.values()].sort((a, b) => a.data.localeCompare(b.data));
}
function renderLinhaTempo(d) {
  const P = pontosLinhaTempo(d), card = $('#linhaCard');
  const temDoc = P.some(p => p.declarado || p.parcial);
  card.hidden = !temDoc; if (card.hidden) return;
  const ms = s => new Date(s + 'T12:00').getTime();
  const decl = P.filter(p => p.declarado), inf = P.filter(p => p.parcial), reg = P.filter(p => !p.declarado && !p.parcial);
  const invLinha = P.filter(p => !p.parcial).map(p => ({ x: ms(p.data), y: p.invest }));
  chart('chLinha', { type: 'line', data: { datasets: [
    { label: 'Investimentos', data: invLinha, borderColor: css('--accent'), backgroundColor: css('--accent'), borderWidth: 2, pointRadius: 4, tension: .2 },
    { label: 'Patrimônio líquido declarado (bens − dívidas)', data: decl.map(p => ({ x: ms(p.data), y: p.liquido })), borderColor: css('--c4'), backgroundColor: css('--c4'), borderDash: [5, 4], pointRadius: 4 },
    { label: 'Informe XP (parcial)', type: 'scatter', data: inf.map(p => ({ x: ms(p.data), y: p.invest })), backgroundColor: css('--warn'), pointRadius: 6, pointStyle: 'rectRot' }
  ] }, options: { ...base(), interaction: { mode: 'nearest', intersect: false }, plugins: { legend: legend(), tooltip: { callbacks: { title: i => new Date(i[0].parsed.x).toLocaleDateString('pt-BR'), label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } } },
    scales: { x: tScale(), y: { ...axis(), ticks: { ...axis().ticks, callback: v => 'R$ ' + (v / 1000).toFixed(0) + ' mil' } } } } });
  // tabela com a variação entre pontos da mesma natureza
  let ant = null;
  const linhas = P.map(p => { const r = { ...p }; if (!p.parcial) { if (ant) { const anos = (ms(p.data) - ms(ant.data)) / (365.25 * 864e5); r.var = p.invest / ant.invest - 1; r.aa = anos > .5 ? Math.pow(p.invest / ant.invest, 1 / anos) - 1 : null; } ant = p; } return r; });
  tabela($('#linhaTbl'), 'linha', [
    { k: 'd', h: 'Data', f: p => `<span class="num">${p.data.split('-').reverse().join('/')}</span>`, v: p => p.data, asc: 1 },
    { k: 'f', h: 'Fonte', f: p => `${esc(p.fonte)}${p.parcial ? ` <span class="pill warn" title="${p.parcial}">parcial</span>` : ''}` },
    { k: 'i', h: 'Investimentos', r: 1, f: p => `<b class="num">${brl(p.invest)}</b>`, v: p => p.invest },
    { k: 'b', h: 'Outros bens', r: 1, f: p => p.bens != null ? `<span class="num">${brl(p.bens - p.invest)}</span>` : '' },
    { k: 'dv', h: 'Dívidas', r: 1, f: p => p.dividas ? `<span class="num down">−${brl(p.dividas)}</span>` : '' },
    { k: 'l', h: 'Patrimônio líquido', r: 1, f: p => p.liquido != null ? `<span class="num">${brl(p.liquido)}</span>` : '' },
    { k: 'v', h: 'Variação', r: 1, f: p => p.var != null ? `<span class="num ${cls(p.var)}">${sgnPct(p.var)}</span>${p.aa != null ? ` <span class="sub num">${sgnPct(p.aa)} a.a.</span>` : ''}` : '' }
  ], linhas, { sort: { k: 'd', dir: 1 }, rerender: () => renderLinhaTempo(d) });
  // cruzamentos
  const C = [], irs = Object.values(EXTRATOS).filter(e => e.tipo === 'irpf').sort((a, b) => a.ano - b.ano), infs = Object.values(EXTRATOS).filter(e => e.tipo === 'informe');
  const primeiro = P.find(p => !p.parcial), hoje = P.find(p => p.hoje);
  if (primeiro && hoje && primeiro !== hoje) { const anos = (ms(hoje.data) - ms(primeiro.data)) / (365.25 * 864e5), aa = Math.pow(hoje.invest / primeiro.invest, 1 / anos) - 1;
    C.push(`Investimentos de <b>${brl(primeiro.invest)}</b> (${primeiro.data.slice(0, 4)}, ${primeiro.fonte}) para <b>${brl(hoje.invest)}</b> hoje: <b class="${cls(aa)}">${sgnPct(aa)} ao ano</b> em ${anos.toFixed(1).replace('.', ',')} anos, somando aportes e rendimentos. O CDI rendeu cerca de ${pct(M.cdi * .85, 1)} líquido ao ano no período recente.`); }
  const master = irs.map(e => ({ e, v: [...(e.textoBens || '').matchAll(/MASTER[^R|]*R\$\s?([\d.]+,\d{2})/gi)].reduce((s, m) => s + numBR(m[1]), 0) })).filter(x => x.v > 0);
  const liqHoje = d.itens.filter(x => liquidada(x.h) && x.v > 0).reduce((s, x) => s + x.v, 0);
  if (master.length) C.push(`<b class="down">Concentração no Banco Master é antiga:</b> ${master.map(x => `${brl(x.v)} na declaração de ${x.e.ano}`).join(', ')}${liqHoje ? ` e ${brl(liqHoje)} na carteira de hoje` : ''}. Diversificar emissores evita depender do FGC de novo.`);
  irs.filter(e => e.dividas > 0).slice(-1).forEach(e => C.push(`Dívida declarada em 31/12/${e.ano}: <b>${brl(e.dividas)}</b> (${esc(e.dividasDesc.join('; '))}). Se ainda existir, compare o juro dela com o que os investimentos rendem: quitar dívida cara costuma ser o melhor "investimento".`));
  irs.slice(-1).forEach(e => { const prov = d.itens.reduce((s, x) => s + (x.a && x.v > 0 ? x.v * x.a.dy : 0), 0);
    C.push(`Proventos: <b>${brl(e.dividendos)}</b> de dividendos declarados em ${e.ano}; hoje a carteira rende ~<b>${brl(prov)}</b> por ano em dividendos e rendimentos de FII${prov > e.dividendos ? ` (${(prov / (e.dividendos || 1)).toFixed(1).replace('.', ',')}× mais)` : ''}.`);
    if (e.restituir) C.push(`IRPF ${e.exercicio}: imposto a restituir de ${brl(e.restituir)}; rendimentos tributáveis de ${brl(e.rendTributaveis)} no ano.`); });
  infs.forEach(f => { const ir = irs.find(e => e.ano === f.ano);
    C.push(ir ? `Ano ${f.ano}: o informe da XP mostra ${brl(f.posicaoFim)} e a declaração ${brl(ir.invest)} em investimentos${f.posicaoFim > ir.invest * 1.02 ? ' — <b class="down">a declaração pode estar sem algum item da XP</b>' : ' — coerentes'}.`
      : `Informe XP ${f.ano} (${brl(f.posicaoFim)} em renda fixa e fundos a custo) não tem a declaração do mesmo ano para conferir. Importe o IRPF ${f.ano + 1} para cruzar.`); });
  const ultimo = irs.at(-1)?.ano;
  if (!ultimo || ultimo < new Date().getFullYear() - 1) C.push(`Faltam declarações${ultimo ? ` depois de ${ultimo}` : ''}: importe os IRPF mais recentes (até o ano-calendário ${new Date().getFullYear() - 1}) para completar a linha do tempo.`);
  $('#cruzList').innerHTML = C.map(x => `<li>${x}</li>`).join('');
}

/* ================= evolução do patrimônio ================= */
let HIST = store.get('af2.hist', {});   // patrimônio real de cada dia em que a página foi aberta: { 'AAAA-MM-DD': { total, g } }
const EVO = Object.assign({ per: 252, modo: 'valor', agr: 'total', cdi: true, ibov: false, prov: false, real: true, off: [] }, store.get('af2.evo', {}));
EVO.offInit = EVO.agr === 'ativo' && EVO.off.length > 0;
const grupoEvo = x => x.h.tipo === 'FII' ? 'FIIs' : ['Ação', 'ETF', 'BDR'].includes(x.h.tipo) ? 'Ações' : ['res', 'pos', 'trav'].includes(x.cl) ? 'Renda fixa' : 'Fundos, COE e outros';
const CORES_EVO = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
const corSerie = i => i < CORES_EVO.length ? css(CORES_EVO[i]) : `hsl(${(i * 47) % 360} 65% 55%)`;
const diaISO = ms => new Date(ms).toISOString().slice(0, 10);
function registrarHistorico(d) {
  if (!(d.total > 0)) return;
  const g = {}; d.itens.filter(x => x.v > 0).forEach(x => { const k = grupoEvo(x); g[k] = (g[k] || 0) + x.v; });
  HIST[diaISO(Date.now())] = { total: Math.round(d.total * 100) / 100, g };
  store.set('af2.hist', HIST);
}
function dadosEvolucao(d) {
  const ib = D?.indices?.ibov; if (!ib) return null;
  const eixo = ib.t.slice(-EVO.per - 1).map(t => t * 1000), dias = eixo.map(diaISO), n = eixo.length;
  const cdiDia = Object.keys(M.cdiDia || {}).length ? t => M.cdiDia[t] : () => Math.pow(1 + M.cdi, 1 / 252) - 1;
  const alinhar = serie => {   // preço de cada dia do eixo, repetindo o último conhecido
    if (!serie) return null;
    const m = {}; serie.t.forEach((t, i) => m[diaISO(t * 1000)] = serie.c[i]);
    let ult = null; return dias.map(dd => (m[dd] != null ? (ult = m[dd]) : ult));
  };
  const cresc = x => {
    const h = x.h, taxa = +h.taxa || 0;
    if (h.tipo === 'Conta corrente') return null;
    if (h.tipo === 'Poupança') { const r = Math.pow(1.005 * (1 + M.trMes), 12 / 252) - 1; return indiceAcumulado(dias, () => r); }
    if (h.idx === 'Pré' && taxa) { const r = Math.pow(1 + taxa / 100, 1 / 252) - 1; return indiceAcumulado(dias, () => r); }
    if (h.idx === 'IPCA' && taxa) { const r = Math.pow((1 + M.ipca12) * (1 + taxa / 100), 1 / 252) - 1; return indiceAcumulado(dias, () => r); }
    return indiceAcumulado(dias, cdiDia, h.idx === 'CDI' && taxa ? taxa / 100 : 1);
  };
  const itens = d.itens.filter(x => x.v > 0).map(x => {
    const s = x.tk && (D.acoes[x.tk] || D.fiis?.[x.tk]);
    return { chave: x.tk || x.h.ativo, grupo: grupoEvo(x), v: x.v, ...(s ? { precos: alinhar(s), dy: x.a?.dy || 0 } : { cresc: cresc(x) }) };
  });
  const r = evolucaoCarteira(eixo, itens, { proventos: EVO.prov });
  const cdiIdx = indiceAcumulado(dias, cdiDia), ibAl = alinhar(ib);
  return { eixo, dias, n, r, itens, cdiIdx, ibov: ibAl };
}
function renderEvolucao(d) {
  const card = $('#evoCard'); card.hidden = !(d.total > 0); if (card.hidden) return;
  document.querySelectorAll('#evoPer button').forEach(b => b.classList.toggle('on', +b.dataset.v === EVO.per));
  document.querySelectorAll('#evoModo button').forEach(b => b.classList.toggle('on', b.dataset.v === EVO.modo));
  $('#evoAgr').value = EVO.agr; $('#evoCdi').checked = EVO.cdi; $('#evoIbov').checked = EVO.ibov; $('#evoProv').checked = EVO.prov; $('#evoReal').checked = EVO.real;
  const E = dadosEvolucao(d); if (!E) { $('#evoSub').textContent = 'Sem histórico de preços (dados.js ausente).'; return; }
  const pctM = EVO.modo === 'pct', fmt = v => pctM ? `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%` : brl(v);
  const conv = s => pctM ? rentabilidade(s) : s;
  // séries conforme o agrupamento
  let series;
  if (EVO.agr === 'total') series = [{ nome: 'Patrimônio', s: E.r.total, forte: true }];
  else if (EVO.agr === 'classe') series = Object.entries(E.r.grupos).sort((a, b) => b[1].at(-1) - a[1].at(-1)).map(([k, s]) => ({ nome: k, s }));
  else {
    series = Object.entries(E.r.ativos).sort((a, b) => (b[1].at(-1) || 0) - (a[1].at(-1) || 0)).map(([k, s]) => ({ nome: k, s }));
    if (!EVO.offInit) { EVO.off = series.slice(8).map(x => x.nome); EVO.offInit = true; }   // por investimento: começa com os 8 maiores
  }
  series.forEach((x, i) => x.cor = x.forte ? css('--accent') : corSerie(i));
  // comparação: no modo R$, "se o patrimônio inicial tivesse ficado no CDI / no Ibovespa"
  const base0 = E.r.total.find(v => v > 0) || 1, bench = [];
  if (EVO.cdi) bench.push({ nome: 'CDI', s: E.cdiIdx.map(c => base0 * c / E.cdiIdx[0]), cor: css('--ink-3'), tracejado: true });
  if (EVO.ibov) { const b = E.ibov.find(v => v != null); bench.push({ nome: 'Ibovespa', s: E.ibov.map(c => c == null ? null : base0 * c / b), cor: css('--warn'), tracejado: true }); }
  const todas = [...series, ...bench];
  $('#evoSeries').innerHTML = todas.map(x => `<button class="chip ${EVO.off.includes(x.nome) ? '' : 'on'}" data-s="${esc(x.nome)}" style="${EVO.off.includes(x.nome) ? '' : `border-color:${x.cor};color:${x.cor}`}"><i class="dot" style="background:${x.cor}"></i>${esc(x.nome)}</button>`).join('');
  $('#evoSeries').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { const k = b.dataset.s; EVO.off = EVO.off.includes(k) ? EVO.off.filter(x => x !== k) : [...EVO.off, k]; salvarEvo(); renderEvolucao(EXIST); });
  const ds = todas.filter(x => !EVO.off.includes(x.nome)).map(x => ({
    label: x.nome, data: conv(x.s).map((y, i) => ({ x: E.eixo[i], y })), borderColor: x.cor, backgroundColor: x.cor,
    borderWidth: x.forte ? 2.5 : 1.6, borderDash: x.tracejado ? [5, 4] : [], pointRadius: 0, spanGaps: true, tension: .15
  }));
  // pontos reais registrados (só faz sentido no total)
  const reais = Object.entries(HIST).filter(([k]) => k >= E.dias[0]).sort();
  if (EVO.real && EVO.agr === 'total' && reais.length) ds.push({ label: 'Registrado', type: 'scatter', data: reais.map(([k, v]) => ({ x: new Date(k + 'T12:00').getTime(), y: pctM ? (v.total / base0 - 1) * 100 : v.total })), backgroundColor: css('--up'), borderColor: css('--panel'), pointRadius: 5, pointHoverRadius: 7 });
  const tot = E.r.total, ini = tot.find(v => v > 0), fim = tot.at(-1), varPer = fim / ini - 1, cdiPer = E.cdiIdx.at(-1) / E.cdiIdx[0] - 1;
  const per = { 21: '1 mês', 63: '3 meses', 126: '6 meses', 252: '12 meses', 504: '2 anos' }[EVO.per];
  $('#evoSub').innerHTML = `Em ${per}: ${brl(ini)} → <b>${brl(fim)}</b> (<b class="${cls(varPer)}">${sgnPct(varPer)}</b>) contra <b>${sgnPct(cdiPer)}</b> do CDI${EVO.prov ? ', com proventos' : ', sem proventos'}.`;
  chart('chEvo', { type: 'line', data: { datasets: ds }, options: { ...base(),
    plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => new Date(i[0].parsed.x).toLocaleDateString('pt-BR'), label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
    scales: { x: { ...tScale(), min: E.eixo[0], max: E.eixo.at(-1) }, y: { ...axis(), ticks: { ...axis().ticks, callback: v => pctM ? v + '%' : (Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toFixed(0) + ' mil' : brl(v)) } } } } });
}
const salvarEvo = () => { const { offInit, ...e } = EVO; store.set('af2.evo', e); };

/* patrimônio total, por classe, por tipo e por instituição */
function patrimonioAtual() {
  const val = HOLD.map(valorDe).filter(v => v > 0);
  return { total: val.reduce((a, b) => a + b, 0), n: HOLD.length, semValor: HOLD.length - val.length };
}
function renderPatrimonio(d) {
  const T = d.total, val = d.itens.filter(x => x.v > 0), sem = d.itens.length - val.length;
  $('#patTotal').textContent = T ? brl(T) : 'R$ 0';
  const ganho12 = val.reduce((s, x) => s + (x.a ? x.v - x.v / (1 + x.a.r12) : 0), 0), rv = val.filter(x => x.a).reduce((s, x) => s + x.v, 0);
  const renda12 = val.reduce((s, x) => s + (x.a ? x.v * x.a.dy : 0), 0);
  $('#patSub').innerHTML = !d.itens.length ? 'importe seus extratos ou adicione investimentos' :
    `${val.length} investimentos com valor${sem ? ` · <span class="warn" style="color:var(--warn)">${sem} sem valor (fora da soma)</span>` : ''}${Object.keys(EXTRATOS).length || HOLD.some(h => h.src) ? ` · ${new Set(HOLD.map(h => h.src).filter(Boolean)).size} arquivo(s)` : ''}`;
  $('#patKv').innerHTML = !T ? '' : [
    ['Renda fixa e reserva', brl(d.atual.res + d.atual.pos + d.atual.trav)],
    ['Renda variável (ações e FIIs)', brl(d.atual.acoes)],
    d.atual.outros ? ['Fundos, COE e outros', brl(d.atual.outros)] : null,
    rv ? ['Variação de preço em 12 meses', `<span class="${cls(ganho12)}">${ganho12 >= 0 ? '+' : ''}${brl(ganho12)}</span> <span class="sub">nas ações e FIIs</span>`] : null,
    renda12 ? ['Proventos estimados', `<b class="up">${brl(renda12 / 12)}/mês</b>`] : null
  ].filter(Boolean).map(([k, v]) => `<span>${k}</span><b class="num">${v}</b>`).join('');
  const porTipo = {}; val.forEach(x => porTipo[x.h.tipo] = (porTipo[x.h.tipo] || 0) + x.v);
  const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]), cores = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--ink-3'];
  chart('chPat', { type: 'doughnut', data: { labels: tipos.map(t => t[0]), datasets: [{ data: tipos.map(t => Math.round(t[1])), backgroundColor: tipos.map((_, i) => css(cores[i % cores.length])), borderColor: css('--panel'), borderWidth: 2 }] },
    options: { ...base(), cutout: '60%', plugins: { legend: { position: 'right', labels: { color: css('--ink-2'), boxWidth: 9, font: { size: 10 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.raw)} (${pct(c.raw / (T || 1), 1)})` } } } } });
  const porInst = {}; val.forEach(x => { const k = (x.h.inst || 'sem instituição').replace(/\s+(INVESTIMENTOS|CCTVM|S\/?A|S\.A\.).*$/i, '').trim() || 'sem instituição'; porInst[k] = (porInst[k] || 0) + x.v; });
  tabela($('#patInst'), 'patInst', [
    { k: 'i', h: 'Onde está', w: 1, f: r => `<b>${esc(r[0])}</b>`, v: r => r[0], asc: 1 },
    { k: 'v', h: 'Valor', r: 1, f: r => `<span class="num">${brl(r[1])}</span>`, v: r => r[1] },
    { k: 'p', h: '%', r: 1, f: r => `<span class="num">${pct(r[1] / (T || 1), 0)}</span>`, v: r => r[1] }
  ], Object.entries(porInst), { sort: { k: 'v', dir: -1 }, rerender: () => renderPatrimonio(d), empty: 'Sem investimentos com valor.' });
}
function renderAvaliacao(d) {
  const linhas = d.itens;
  const T = d.total || 1;
  const ret = x => x.a ? x.a.r12 + x.a.dy : null;
  const ordem = [...linhas].filter(x => ret(x) != null && x.v > 0).sort((a, b) => ret(b) - ret(a));
  const top = new Set(ordem.slice(0, 3)), pior = new Set(ordem.slice(-3).filter(x => ret(x) < benchCDI()));
  $('#eAvSub').innerHTML = ordem.length ? `Melhores em 12 meses: ${ordem.slice(0, 3).map(x => `<b class="up">${x.tk} ${sgnPct(ret(x))}</b>`).join(', ')}${pior.size ? ` · piores: ${[...pior].map(x => `<b class="down">${x.tk} ${sgnPct(ret(x))}</b>`).join(', ')}` : ''}` : 'Retorno de 12 meses aparece para ações e FIIs cotados.';
  tabela($('#eAv'), 'eAv', [
    { k: 'a', h: 'Investimento', w: 1, f: x => `<b>${esc(x.tk || x.h.ativo)}</b> <span class="sub">${esc(x.a ? x.a.setor : x.h.tipo)}${x.h.inst ? ' · ' + esc(x.h.inst) : ''}</span>`, v: x => x.tk || x.h.ativo, asc: 1 },
    { k: 'q', h: 'Qtd.', r: 1, f: x => x.h.qtd ? `<span class="num">${nf(x.h.qtd)}</span>` : '', v: x => +x.h.qtd || 0 },
    { k: 'v', h: 'Valor (editável)', r: 1, f: x => `<input class="n num" type="number" step="100" data-av-valor="${HOLD.indexOf(x.h)}" value="${x.v > 0 ? Math.round(x.v * 100) / 100 : ''}" placeholder="falta" style="width:96px;border:1px solid var(--line);background:var(--panel-2)" title="corrija o valor de hoje; o patrimônio é recalculado">`, v: x => x.v },
    { k: 'p', h: '%', r: 1, f: x => `<span class="num">${pct(x.v / T, 1)}</span>`, v: x => x.v },
    { k: 'rd', h: 'Proventos (extrato)', r: 1, cls: 'so-desk', f: x => x.h.renda ? `<span class="num up">${brl(x.h.renda)}</span>` : '', v: x => x.h.renda || 0 },
    { k: 'dy', h: 'DY 12m', r: 1, f: x => x.a?.dy ? `<span class="num">${pct(x.a.dy, 1)}</span>` : '', v: x => x.a?.dy ?? -1 },
    { k: 'r12', h: 'Preço 12m', r: 1, f: x => x.a ? `<span class="num ${cls(x.a.r12)}">${sgnPct(x.a.r12)}</span>` : '', v: x => x.a?.r12 ?? -9 },
    { k: 'tot', h: 'Total 12m', r: 1, f: x => ret(x) != null ? `<b class="num ${ret(x) >= benchCDI() ? 'up' : 'down'}">${sgnPct(ret(x))}</b>` : '', v: x => ret(x) ?? -9 },
    { k: 'pv', h: 'Previsão', f: x => x.a ? pillNivel(x.a.prev) : '', v: x => x.a?.prev ?? -9 },
    { k: 've', h: 'Avaliação', f: x => `<span class="pill ${x.av.c}" title="${esc(x.av.m)}">${x.av.v}</span>`, v: x => x.av.ord, asc: 1 },
    { k: 'm', h: 'Por quê', w: 1, cls: 'so-desk', f: x => `<span class="sub">${esc(x.av.m)}</span>` },
    { k: 'x', h: '', f: x => `<button class="btn ghost" data-av-del="${HOLD.indexOf(x.h)}" title="apagar este investimento (não volta ao reimportar)">✕</button>` }
  ], linhas, { sort: { k: 'tot', dir: -1 }, rerender: () => renderAvaliacao(d), rowCls: x => top.has(x) ? 'best' : '', empty: 'Adicione ou importe seus investimentos.' });
  $('#eAv').querySelectorAll('[data-av-valor]').forEach(el => el.onchange = () => ajustarValor(HOLD[+el.dataset.avValor], el.value));
  $('#eAv').querySelectorAll('[data-av-del]').forEach(b => b.onclick = () => apagarItem(HOLD[+b.dataset.avDel]));
}
function renderRenda(d) {
  const mes = {}; Object.values(EXTRATOS).forEach(e => Object.entries(e.rendaPorMes || {}).forEach(([k, v]) => mes[k] = (mes[k] || 0) + v));
  const ks = Object.keys(mes).sort();
  const est = d.itens.reduce((s, x) => s + (x.a && x.v > 0 ? x.v * x.a.dy : 0), 0);
  const ext = extratosMovimentacao(EXTRATOS), infs = Object.values(EXTRATOS).filter(e => e.tipo === 'informe');
  const taxas = ext.reduce((s, e) => s + (e.taxas || 0), 0), meses = ext.reduce((s, e) => s + mesesPeriodo(e), 0) || 1;
  const rec = ks.length ? Object.values(mes).reduce((a, b) => a + b, 0) / Math.max(1, ks.length) : 0;
  const lista = xs => [...new Set(xs.filter(Boolean))].map(esc).join(' · ');
  // blocos: rótulo, valor em destaque, detalhe em texto comum
  $('#eRendaKv').innerHTML = [
    ks.length ? ['Recebido por mês', brl(rec), `média de ${ks.length} meses nos extratos`, 'up'] : null,
    ['Renda estimada', `${brl(est / 12)}/mês`, `${brl(est)} por ano pelos proventos de 12 meses · ${pct(est / (d.total || 1), 1)} da carteira`],
    taxas ? ['Taxas cobradas na conta', `${brl(taxas / meses)}/mês`, `${brl(taxas / meses * 12)} por ano · ${lista(ext.flatMap(e => e.taxasNome || []))}`, 'down'] : null,
    ext.some(e => e.irRetido) ? ['IR retido no período', brl(ext.reduce((s, e) => s + (e.irRetido || 0), 0)), 'descontado na fonte dos rendimentos'] : null,
    ...infs.map(e => [`Rendimentos em ${e.ano}`, brl(e.rendIsentos + e.rendTributados), `${brl(e.rendIsentos)} isentos + ${brl(e.rendTributados)} tributados (líquidos) · posição em 31/12: ${brl(e.posicaoFim)} a custo, sem ações e FIIs`, 'up']),
    ...infs.filter(e => e.vencidos?.length).map(e => [`Venceram ou resgatados em ${e.ano}`, `${e.vencidos.length} títulos`, lista(e.vencidos)]),
    ext.some(e => e.resgates?.length) ? ['Resgatados nos extratos', `${ext.flatMap(e => e.resgates || []).length} resgates`, lista(ext.flatMap(e => e.resgates || []).map(r => r.replace(/ \((-?[\d.]+)\)$/, (_, v) => ` (${brl(+v)})`)))] : null
  ].filter(Boolean).map(([l, v, det, c]) => `<div class="mini"><div class="l">${l}</div><div class="v num ${c || ''}">${v}</div><div class="d">${det}</div></div>`).join('');
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
  const srcs = [...new Set([...HOLD.map(h => h.src).filter(Boolean), ...Object.keys(EXTRATOS)])];
  $('#eSrcs').innerHTML = srcs.map(s => `<span class="chip on" title="${esc(s)}">${esc(s.length > 32 ? s.slice(0, 30) + '…' : s)} · ${HOLD.filter(h => h.src === s).length || (EXTRATOS[s]?.tipo === 'irpf' ? 'histórico' : 0)} <button class="btn ghost" data-rmsrc="${esc(s)}" title="remover este arquivo" style="padding:0 2px">✕</button></span>`).join('');
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
    if (k === 'valor') return ajustarValor(h, el.value);
    h[k] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value; h.imp = false;
    if (k === 'ativo' && h.tipo === 'Outro') h.tipo = tipoPorTexto(h.ativo) || 'Outro';
    salvarHold(); renderExist();
  }));
  $('#eTbl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => apagarItem(HOLD[+b.dataset.del]));
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
$('#eClear').onclick = () => { if (confirm('Apagar todos os investimentos da sua carteira neste navegador?')) { HOLD = []; EXTRATOS = {}; SNAP = null; HIST = {}; IGN = new Set(); AJ = {}; salvarEscolhas(); store.set('af2.snap', null); store.set('af2.hist', HIST); salvarHold(); renderExist(); } };
$('#eSave').onclick = () => exportarJSON(HOLD);
$('#eOpen').onchange = async e => { const f = e.target.files[0]; if (f) { try { abrirJSON(JSON.parse(await f.text())); $('#eImpMsg').innerHTML = `<b class="up">${esc(f.name)}</b>: carteira salva aberta — veja "Desde que você salvou".`; } catch (er) { $('#eImpMsg').innerHTML = `<b class="down">${esc(f.name)}</b>: ${esc(er.message)}`; } } e.target.value = ''; };
$('#cSaveJson').onclick = () => { renderCarteira(); exportarJSON(planoComoHoldings(), { origem: 'montar do zero' }); };
$('#cToExist').onclick = () => { renderCarteira(); HOLD = planoComoHoldings(); EXTRATOS = {}; salvarHold(); modo('exist'); };
$('#aiRun').onclick = analisarIA;
document.querySelectorAll('#evoPer button').forEach(b => b.onclick = () => { EVO.per = +b.dataset.v; salvarEvo(); renderEvolucao(EXIST); });
document.querySelectorAll('#evoModo button').forEach(b => b.onclick = () => { EVO.modo = b.dataset.v; salvarEvo(); renderEvolucao(EXIST); });
$('#evoAgr').onchange = e => { EVO.agr = e.target.value; EVO.off = []; EVO.offInit = false; salvarEvo(); renderEvolucao(EXIST); };
[['#evoCdi', 'cdi'], ['#evoIbov', 'ibov'], ['#evoProv', 'prov'], ['#evoReal', 'real']].forEach(([id, k]) => $(id).onchange = e => { EVO[k] = e.target.checked; salvarEvo(); renderEvolucao(EXIST); });
(() => {
  const e = store.get('af2.exist', null);
  if (e) { $('#ePerfil').value = e.perfil; $('#ePrazo').value = e.prazo; $('#eAporte').value = e.aporte; $('#eRes').value = Math.round(e.res * 100); $('#eCap').value = Math.round(e.cap * 100); if (e.obj) $('#eObj').value = e.obj; }
  try { const k = localStorage.getItem('af2.aikey'); if (k) { $('#aiKey').value = k; $('#aiRemember').checked = true; } } catch {}
  modo(store.get('af2.modo', 'zero'));
})();
