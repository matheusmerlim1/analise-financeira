/* Leitura de arquivos de investimentos: extrato de posição da B3 (.xlsx), planilhas/CSV de corretoras,
 * PDF da declaração do IR e extrato de conta da XP. Funções puras (sem DOM), testadas em tests/. */

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
    [/\bCOE\b/, 'COE'], [/\bLCI\b/, 'LCI'], [/\bLCA\b/, 'LCA'], [/\bCRI\b/, 'CRI'], [/\bCRA\b/, 'CRA'],
    [/DEB[ÊE]NTURE.*INCENTIV|INCENTIVAD/, 'Debênture incentivada'], [/DEB[ÊE]NTURE/, 'Debênture'],
    [/\bCDB\b|\bRDB\b|\bLC\b/, 'CDB'], [/POUPAN[ÇC]A/, 'Poupança'], [/CONTA CORRENTE|DEP[ÓO]SITO [ÀA] VISTA|SALDO DISPON/, 'Conta corrente'],
    [/PREVID|PGBL|VGBL/, 'Previdência'], [/BITCOIN|CRIPTO|ETHEREUM/, 'Cripto'], [/\bFII\b|IMOBILI[ÁA]RIO|FIAGRO/, 'FII'],
    [/\bETF\b|\bBOVA11|\bIVVB11|\bSMAL11/, 'ETF'], [/\bBDR\b|\b[A-Z]{4}3[2-5]\b/, 'BDR'],
    [/FUNDO.*(A[ÇC][ÕO]ES|FIA)/, 'Fundo de ações'], [/MULTIMERCADO|\bFIM\b/, 'Fundo multimercado'], [/FUNDO|\bFIC?\b|\bFIF\b|\bDI\b/, 'Fundo DI/renda fixa'],
    [/\b[A-Z]{4}11\b/, 'FII'], [/\b[A-Z]{4}(3|4|5|6)\b|A[ÇC][ÕO]ES/, 'Ação']
  ];
  return (regras.find(([re]) => re.test(s)) || [, null])[1];
}
const idxPorTexto = s => /IPCA|NTN-?B/i.test(s) ? 'IPCA' : /PR[ÉE]\b|PREFIXAD|LTN/i.test(s) ? 'Pré' : /CDI|\bDI\b|SELIC/i.test(s) ? 'CDI' : '';
const MESES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
function venc(s) {
  const t = String(s ?? '').toUpperCase();
  let m = t.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})\b/); if (m) return `${m[2]}-${MESES[m[1]]}-15`;
  m = t.match(/\b(20[2-6]\d)\b/); return m ? `${m[1]}-12-31` : '';
}

/* planilhas e CSV: acha o cabeçalho e as colunas de nome e valor (layout da B3 e da maioria das corretoras) */
function lerTabela(rows, dica = '', src = '') {
  const norm = v => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hi = rows.findIndex(r => r.some(c => /produto|ativo|codigo|papel|titulo|descricao|investimento/.test(norm(c))) && r.some(c => /valor|saldo|posicao|total/.test(norm(c))));
  if (hi < 0) return [];
  const H = rows[hi].map(norm), col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const cNome = col(/codigo de negociacao/, /^produto/, /^ativo/, /papel/, /titulo/, /descricao/, /investimento/);
  const cValor = col(/valor atualizado/, /valor liquido/, /saldo liquido/, /valor bruto/, /posicao/, /saldo/, /valor total/, /^valor/);
  const cInst = col(/instituicao/, /corretora/, /banco/, /emissor/);
  const cVenc = col(/vencimento/), cIdx = col(/indexador/), cTaxa = col(/taxa/), cQtd = col(/^quantidade$/, /quantidade/), cProd = col(/^produto/);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const nome = String(r[cNome] ?? '').trim(), v = numBR(r[cValor]);
    if (!nome || !isFinite(v) || v <= 0 || /^total/i.test(nome)) continue;
    const extra = [cProd >= 0 ? r[cProd] : '', dica].join(' ');
    out.push({
      tipo: tipoPorTexto(nome, extra) || 'Outro', ativo: nome.slice(0, 60), inst: cInst >= 0 ? String(r[cInst] ?? '').slice(0, 40) : '',
      idx: cIdx >= 0 ? idxPorTexto(r[cIdx]) : idxPorTexto(nome + ' ' + extra), taxa: cTaxa >= 0 ? numBR(r[cTaxa]) || '' : '',
      venc: cVenc >= 0 ? venc(r[cVenc]) : '', qtd: cQtd >= 0 && numBR(r[cQtd]) > 0 ? numBR(r[cQtd]) : '', valor: Math.round(v * 100) / 100, imp: true, src
    });
  }
  return out;
}

/* PDF genérico (declaração do IR, informe de rendimentos, extrato de posição): blocos com produto ou ticker e um valor */
function lerTextoPDF(linhas, src = '') {
  const out = [], visto = new Set(), MOEDA = /\d{1,3}(?:\.\d{3})*,\d{2}/;
  const CABECALHO = /DISCRIMINA|SITUA[ÇC][ÃA]O EM|GRUPO\s+C[ÓO]DIGO|BENS E DIREITOS|DECLARA[ÇC][ÃA]O/i;
  // a discriminação de um bem costuma quebrar em várias linhas e o valor fica na última: junta cada bloco
  const blocos = []; let buf = [];
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
    const nome = (tk || l.replace(/\d{1,3}(?:\.\d{3})*,\d{2}/g, '').replace(/\b0\d\s+\d{2}\b/g, '').replace(/\s+/g, ' ').trim()).slice(0, 60);
    const chave = `${nome}|${v}`; if (visto.has(chave)) return; visto.add(chave);
    out.push({ tipo, ativo: nome, inst: '', idx: idxPorTexto(l), taxa: '', venc: /VENC/i.test(l) ? venc(l) : '', qtd: '', valor: v, imp: true, src });
  });
  return out;
}

/* ---------- extrato de conta da XP (movimentação) ---------- */
const ehExtratoXP = texto => /XP INVESTIMENTOS/i.test(texto) && /Extrato da conta/i.test(texto) && /Hist[óo]rico/i.test(texto);
const ISIN_SUFIXO = { OR: '3', PR: '4', PA: '5', PB: '6' };

/* lê os lançamentos e devolve o que dá para saber da carteira: proventos (com a quantidade de cada ativo),
 * compras e resgates de renda fixa, COEs, fundos, ações alugadas (BTC), taxas e o saldo em conta */
/* o pdf.js separa cada pedaço de texto com espaços: "25 / 10 / 2026", "R $   1 . 250 , 00", "S /   236" */
const normLinhaPDF = s => String(s)
  .replace(/\s*\/\s*/g, '/').replace(/(\d)\s*([.,:])\s*(\d)/g, '$1$2$3').replace(/(\d)\s*([.,:])\s*(\d)/g, '$1$2$3')
  .replace(/R\s*\$/g, 'R$').replace(/-\s*R\$/g, '-R$').replace(/\s+:/g, ':')
  .replace(/\b([A-Z]) ?\. ?(?=[A-Z] ?\.)/g, '$1.').replace(/\b([A-Z]) \.(?=\s|$)/g, '$1.')   // "S . A ." → "S.A."
  .replace(/\s+/g, ' ').trim();
const LINHA_DATA = /^\d{2}\/\d{2}\/\d{4} \d{2}\/\d{2}\/\d{4}\b/;
const SO_DATAS_E_VALORES = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}\/\d{2}\/\d{4}) ((?:-?R\$ ?[\d.]+,\d{2} ?){2})$/;
const CABECALHO_XP = /^Liq Mov Hist|Lan[çc]amentos futuros|^Extrato|^Saldo/i;
/* no PDF, a descrição de duas linhas fica uma acima e outra abaixo da linha com as datas e os valores:
 * remonta como "datas descrição valores" */
function remontarLinhasXP(linhas) {
  const L = linhas.map(normLinhaPDF).filter(Boolean), out = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(SO_DATAS_E_VALORES);
    if (!m) { out.push(L[i]); continue; }
    const acima = out.length && !LINHA_DATA.test(out.at(-1)) && !CABECALHO_XP.test(out.at(-1)) ? out.pop() : '';
    const abaixo = i + 1 < L.length && !LINHA_DATA.test(L[i + 1]) && !CABECALHO_XP.test(L[i + 1]) ? L[++i] : '';
    out.push(`${m[1]} ${m[2]} ${[acima, abaixo].filter(Boolean).join(' ')} ${m[3]}`.replace(/\s+/g, ' '));
  }
  return out;
}

function lerExtratoXP(texto) {
  const t = remontarLinhasXP(String(texto).split(/\r?\n/)).join(' ')
    .replace(/Liq Mov Hist[óo]rico Valor Saldo/gi, ' ').split(/Lan[çc]amentos futuros/i)[0];
  const per = t.match(/De:\s*(\d{2}\/\d{2}\/\d{4})\s*At[ée]:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const saldo = t.match(/Saldo dispon[íi]vel:\s*(R\$\s?[\d.]+,\d{2})/i);
  const ex = { periodo: per ? { de: venc(per[1]), ate: venc(per[2]) } : null, saldo: saldo ? numBR(saldo[1]) : null,
    proventos: [], rf: [], resgates: [], coes: [], fundos: [], btc: [], isins: [], taxas: [], irRetido: 0, lancamentos: 0 };
  const re = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+/g, marcas = [...t.matchAll(re)];
  marcas.forEach((m, i) => {
    const corpo = t.slice(m.index + m[0].length, i + 1 < marcas.length ? marcas[i + 1].index : undefined).trim();
    const moedas = corpo.match(/-?R\$\s?[\d.]+,\d{2}/g); if (!moedas || moedas.length < 2) return;
    ex.lancamentos++;
    const valor = numBR(moedas.at(-2)), hist = corpo.slice(0, corpo.lastIndexOf(moedas.at(-2))).trim(), H = hist.toUpperCase(), data = venc(m[1]);
    let x;
    if ((x = H.match(/(RENDIMENTOS|DIVIDENDOS|JUROS S\/ ?CAPITAL) DE CLIENTES ([A-Z]{4}\d{1,2}) S\/\s*(\d+)/)))
      ex.proventos.push({ data, tk: x[2], qtd: +x[3], valor, tipo: x[1].startsWith('REND') ? 'rendimento' : x[1].startsWith('DIV') ? 'dividendo' : 'jcp' });
    else if (/^IR\b|IRRF/.test(H)) ex.irRetido += Math.abs(valor);
    else if ((x = H.match(/^COMPRA (CDB|LCA|LCI|CRA|CRI|LC|LF|DEB[ÊE]NTURE)\S* \| (.+)$/)))
      ex.rf.push({ data, tipo: tipoPorTexto(x[1]) || 'CDB', nome: x[2].trim(), valor: Math.abs(valor), venc: venc(x[2]) });
    else if ((x = H.match(/^RESGATE (\S+) \| (.+)$/))) ex.resgates.push({ data, nome: x[2].trim(), valor });
    else if ((x = H.match(/^PGTO JUROS (\S+) \| COE (.+?) - ([A-Z]{3}\/\d{4})/))) ex.coes.push({ data, codigo: x[1], emissor: x[2].trim(), venc: venc(x[3]), cupom: valor });
    else if ((x = H.match(/APLICA[ÇC][ÃA]O FUNDOS (.+)$/))) ex.fundos.push({ data, nome: hist.slice(hist.toUpperCase().indexOf(x[1])).trim(), valor: Math.abs(valor) });
    else if ((x = H.match(/^RESGATE (.+)$/))) ex.resgates.push({ data, nome: hist.slice(8).trim(), valor });
    else if (/FEE FIXO|TAXA DE CUST[ÓO]DIA|TAXA DE ADMINISTRA/.test(H)) ex.taxas.push({ data, nome: hist.replace(/\s*-\s*Cobran.*$/i, ''), valor: Math.abs(valor) });
    if ((x = H.match(/BTC ([A-Z]{4})\b/))) ex.btc.push(x[1]);
    if ((x = H.match(/\bBR([A-Z]{4})(?:ACN|CTF)(OR|PR|PA|PB)\d/))) ex.isins.push(x[1] + ISIN_SUFIXO[x[2]]);
  });
  return ex;
}

/* transforma o extrato em linhas da carteira; valores que o extrato não mostra ficam em branco com uma nota */
function carteiraDoExtratoXP(ex, src = '', universo = []) {
  const out = [], tickers = new Set();
  const porTk = {};
  ex.proventos.forEach(p => {
    const a = porTk[p.tk] || (porTk[p.tk] = { ...p, renda: 0, n: 0, max: 0 });
    a.renda += p.valor; a.n++; a.max = Math.max(a.max, p.qtd);
    if (p.data >= a.data) { a.data = p.data; a.qtd = p.qtd; a.tipo = p.tipo; }
  });
  Object.values(porTk).forEach(p => {
    tickers.add(p.tk);
    const fii = p.tipo === 'rendimento' && /11$/.test(p.tk);
    // FII: as cotas só crescem com os aportes, vale a última; ação: o provento cai quando parte está emprestada (BTC), vale a maior
    out.push({ tipo: fii ? 'FII' : 'Ação', ativo: p.tk, inst: 'XP', idx: '', taxa: '', venc: '', qtd: fii ? p.qtd : p.max, valor: '', renda: Math.round(p.renda * 100) / 100,
      imp: true, src, nota: fii ? `quantidade do último provento (${p.data.split('-').reverse().join('/')})` : 'maior quantidade vista nos proventos do período; confira' });
  });
  const raiz = r => universo.find(t => t.startsWith(r) && /\d$/.test(t)) || r + '3';
  [...new Set([...ex.btc.map(raiz), ...ex.isins])].filter(t => !tickers.has(t) && ![...tickers].some(k => k.slice(0, 4) === t.slice(0, 4))).forEach(t => {
    tickers.add(t);
    out.push({ tipo: 'Ação', ativo: t, inst: 'XP', idx: '', taxa: '', venc: '', qtd: '', valor: '', imp: true, src, nota: 'aparece no extrato (aluguel/evento), mas sem a quantidade: informe' });
  });
  const resgatado = nome => ex.resgates.some(r => r.nome.toUpperCase().includes(nome.toUpperCase().split(' - ')[0]));
  ex.rf.filter(r => !resgatado(r.nome)).forEach(r => out.push({ tipo: r.tipo, ativo: r.nome, inst: 'XP', idx: idxPorTexto(r.nome), taxa: '', venc: r.venc, qtd: '', valor: r.valor, imp: true, src,
    nota: 'valor aplicado em ' + r.data.split('-').reverse().join('/') + '; atualize com o valor de hoje e informe a taxa' }));
  const coes = {}; ex.coes.forEach(c => { (coes[c.codigo] = coes[c.codigo] || { ...c, cupons: 0 }).cupons += c.cupom; });
  Object.values(coes).forEach(c => out.push({ tipo: 'COE', ativo: `COE ${c.codigo} (${c.emissor})`, inst: 'XP', idx: '', taxa: '', venc: c.venc, qtd: '', valor: '', imp: true, src,
    renda: Math.round(c.cupons * 100) / 100, nota: 'o extrato mostra só os cupons; informe o valor atual' }));
  const fundos = {}; ex.fundos.forEach(f => fundos[f.nome] = (fundos[f.nome] || 0) + f.valor);
  Object.entries(fundos).filter(([n]) => !resgatado(n)).forEach(([n, v]) => out.push({ tipo: tipoPorTexto(n, 'FUNDO') || 'Fundo DI/renda fixa', ativo: n, inst: 'XP', idx: '', taxa: '', venc: '', qtd: '', valor: Math.round(v * 100) / 100, imp: true, src,
    nota: 'valor aplicado no período (pode haver aplicações anteriores)' }));
  if (ex.saldo > 0) out.push({ tipo: 'Conta corrente', ativo: 'Saldo disponível na XP', inst: 'XP', idx: '', taxa: '', venc: '', qtd: '', valor: ex.saldo, imp: true, src });
  return out;
}
function resumoExtratoXP(ex) {
  const mes = {}; ex.proventos.concat(ex.coes.map(c => ({ data: c.data, valor: c.cupom }))).forEach(p => { const k = p.data.slice(0, 7); mes[k] = (mes[k] || 0) + p.valor; });
  const taxas = ex.taxas.reduce((s, x) => s + x.valor, 0);
  return { periodo: ex.periodo, rendaPorMes: mes, rendaTotal: Object.values(mes).reduce((a, b) => a + b, 0), taxas, nTaxas: ex.taxas.length, taxasNome: [...new Set(ex.taxas.map(x => x.nome))],
    irRetido: ex.irRetido, resgates: ex.resgates.map(r => `${r.nome} (${r.valor.toFixed(2)})`), lancamentos: ex.lancamentos };
}

if (typeof module !== 'undefined') module.exports = { numBR, tipoPorTexto, idxPorTexto, venc, lerTabela, lerTextoPDF, ehExtratoXP, lerExtratoXP, carteiraDoExtratoXP, resumoExtratoXP };
