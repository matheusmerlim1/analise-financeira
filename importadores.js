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
  Object.values(coes).forEach(c => out.push({ tipo: 'COE', ativo: `COE ${c.codigo} (${c.emissor})`, codigo: c.codigo, inst: 'XP', idx: '', taxa: '', venc: c.venc, qtd: '', valor: '', imp: true, src,
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

/* ---------- informe de rendimentos da XP (posição em 31/12, a custo, e rendimentos do ano) ---------- */
const ehInformeXP = texto => /INFORME DE RENDIMENTOS FINANCEIROS/i.test(texto) && /XP INVESTIMENTOS/i.test(texto);
// rótulos da coluna lateral do informe, que o pdf.js intercala com o texto dos ativos
const RUIDO_INFORME = /^(Declara[çc][ãa]o|IRPF|Ficha |Grupo \d|C[óo]d\.|\(Valores|P[áa]gina \d|XP INVESTIMENTOS CCTVM S\/A$|CNPJ:|Especifica|Total:)|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|C[óo]d\. ao lado/i;
function lerInformeXP(texto) {
  const L = String(texto).split(/\r?\n/).map(normLinhaPDF).filter(Boolean);
  const anoM = L.join(' ').match(/ANO CALEND[ÁA]RIO DE (\d{4})/i);
  const out = { ano: anoM ? +anoM[1] : null, ativos: [], saldoConta: 0 };
  const ini = L.findIndex(l => /DETALHAMENTO DOS ATIVOS/i.test(l));
  let isento = false, fundo = false, atual = null;
  const fechar = () => {
    if (!atual) return;
    const t = atual.partes.join(' ').replace(/\s+/g, ' ').trim(), T = t.toUpperCase();
    const vencs = t.match(/\d{2}\/\d{2}\/\d{4}/g);
    const a = { nome: t.replace(/\s*\d{2}\/\d{2}\/\d{4}\s*/g, ' ').trim(), saldoAnt: atual.s24, saldo: atual.s25, rend: atual.rend, isento: atual.isento, fundo: atual.fundo, venc: vencs ? venc(vencs.at(-1)) : '' };
    if (!a.fundo) {
      const m = T.match(/\b(CDB|LCA|LCI|CRA|CRI|COE|LF|LC|DEB[ÊE]NTURE|NTN-?B|LTN|LFT)\b/);
      if (m) {
        a.tipo = tipoPorTexto(m[1]) || m[1];
        a.emissor = t.slice(0, m.index).trim();
        const cod = t.slice(m.index).split(' ').filter(w => /^[A-Z0-9]{8,}$/.test(w) && /\d/.test(w));
        a.codigo = cod.at(-1) || '';
        a.idx = /\bPR[ÉE]\b/.test(T) ? 'Pré' : /IPCA/.test(T) ? 'IPCA' : /\b(FLU|P[ÓO]S|DI|CDI)\b/.test(T) ? 'CDI' : '';
      }
    }
    out.ativos.push(a); atual = null;
  };
  for (const l of L.slice(ini < 0 ? 0 : ini)) {
    if (/RENDIMENTOS ISENTOS/i.test(l)) isento = true;
    if (/SUJEITOS [ÀA]|TRIBUTA[ÇC][ÃA]O EXCLUSIVA/i.test(l)) isento = false;
    if (/Fundos de Investimento\s+Saldos/i.test(l)) fundo = true;
    if (/Renda Fixa\s+Saldos/i.test(l)) fundo = false;
    const sc = l.match(/^Saldo em conta - .*? ([\d.]+,\d{2}) ([\d.]+,\d{2})$/i);
    if (sc) { fechar(); out.saldoConta += numBR(sc[2]); continue; }
    if (/^SALDO EM CONTA$/i.test(l)) { fechar(); continue; }
    const m = l.match(/^(.*?)\s*(-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2})$/);
    if (m && !/^Total:/i.test(m[1]) && m[1] && !/Saldos em/i.test(l)) {
      fechar();
      atual = { partes: [m[1].replace(/\s*(Declara[çc][ãa]o|IRPF).*$/i, '')], s24: numBR(m[2]), s25: numBR(m[3]), rend: numBR(m[4]), isento, fundo };
      continue;
    }
    if (/^Total:/i.test(l)) { fechar(); continue; }
    if (atual && !RUIDO_INFORME.test(l) && !/RENDIMENTOS|TRIBUTA[ÇC][ÃA]O|Saldos em/i.test(l)) atual.partes.push(l.replace(/\s*(Declara[çc][ãa]o|IRPF|Ficha Bens e Direitos)\b.*$/i, ''));
  }
  fechar();
  return out;
}
function carteiraDoInformeXP(inf, src = '') {
  const data = inf.ano ? `31/12/${inf.ano}` : 'fim do ano';
  const out = inf.ativos.filter(a => a.saldo > 0).map(a => a.fundo
    ? { tipo: (tipoPorTexto(a.nome, 'FUNDO') || '').startsWith('Fundo') ? tipoPorTexto(a.nome, 'FUNDO') : 'Fundo DI/renda fixa', ativo: a.nome.slice(0, 60), inst: 'XP', idx: '', taxa: '', venc: '', qtd: '', valor: a.saldo,
      imp: true, src, renda: a.rend || '', nota: `saldo em ${data} (informe de rendimentos)${a.isento ? ', isento de IR' : ''}; atualize com o valor de hoje` }
    : { tipo: a.tipo || 'Outro', ativo: `${a.tipo || ''} ${a.emissor || ''} ${a.codigo || ''}`.replace(/\s+/g, ' ').trim(), codigo: a.codigo, inst: a.emissor || '', idx: a.idx || '', taxa: '', venc: a.venc,
      qtd: '', valor: a.saldo, imp: true, src, renda: a.rend || '', nota: `valor de custo em ${data} (informe de rendimentos); informe a taxa e atualize o valor` });
  if (inf.saldoConta > 0) out.push({ tipo: 'Conta corrente', ativo: `Saldo em conta (${data})`, inst: 'XP', idx: '', taxa: '', venc: '', qtd: '', valor: Math.round(inf.saldoConta * 100) / 100, imp: true, src });
  return out;
}
function resumoInformeXP(inf) {
  const soma = f => Math.round(inf.ativos.filter(f).reduce((s, a) => s + a.rend, 0) * 100) / 100;
  return { ano: inf.ano, rendIsentos: soma(a => a.isento), rendTributados: soma(a => !a.isento),
    posicaoFim: Math.round((inf.ativos.reduce((s, a) => s + a.saldo, 0) + inf.saldoConta) * 100) / 100,
    posicaoAnt: Math.round(inf.ativos.reduce((s, a) => s + a.saldoAnt, 0) * 100) / 100,
    vencidos: inf.ativos.filter(a => a.saldoAnt > 0 && !(a.saldo > 0)).map(a => `${a.tipo || ''} ${a.emissor || a.nome}`.trim()) };
}

/* ---------- declaração do IRPF ("imagem da declaração" em PDF) ---------- */
const ehIRPF = texto => /DECLARA[ÇC][ÃA]O DE AJUSTE ANUAL/i.test(texto) && /BENS E DIREITOS/i.test(texto) && !ehInformeXP(texto);
// grupos da ficha Bens e Direitos que são investimentos ou dinheiro (os demais: imóveis, veículos, outros bens)
const GRUPOS_INVEST = new Set(['03', '04', '06', '07', '08']);
const RUIDO_IRPF = /^(105 - BRASIL|Bem ou direito pertencente|CNPJ|Banco: \d|RENAVAM|GRUPO|SITUA[ÇC][ÃA]O|31\/12\/\d{4}|DECLARA[ÇC][ÃA]O|P[áa]gina \d|NOME:|CPF:|Inscri[çc][ãa]o|Matr[íi]cula|Data de aquisi)/i;
// a discriminação é texto livre: tira o que identifica a pessoa ou o bem (placa, chassi, renavam, conta)
const limparDiscr = s => String(s).replace(/\b(PLACA|CHASSI|RENAVAM)\b[-:\s]*[A-Z0-9-]+/gi, '').replace(/\b(AG[ÊE]NCIA|CONTA|C\/C|C\/)\s*[:\-]?\s*[\d./-]+/gi, '').replace(/\s+/g, ' ').trim();
function lerIRPF(texto) {
  const L = String(texto).split(/\r?\n/).map(normLinhaPDF).filter(Boolean), T = L.join('\n');
  const ex = T.match(/EXERC[ÍI]CIO (\d{4}) ANO-CALEND[ÁA]RIO (\d{4})/i);
  const val = re => { const m = T.match(re); return m ? numBR(m[1]) : 0; };
  const ir = { exercicio: ex ? +ex[1] : null, ano: ex ? +ex[2] : null, bens: [], dividas: [],
    dividendos: val(/Lucros e dividendos recebidos ([\d.]+,\d{2})/i), rendAplicacoes: val(/Rendimentos de aplica[çc][õo]es financeiras ([\d.]+,\d{2})/i),
    rendIsentos: val(/Rendimentos isentos e n[ãa]o tribut[áa]veis ([\d.]+,\d{2})/i), rendExclusivos: val(/Rendimentos sujeitos [àa] tributa[çc][ãa]o exclusiva\/definitiva ([\d.]+,\d{2})/i),
    rendTributaveis: val(/Recebidos de Pessoa Jur[íi]dica pelo titular ([\d.]+,\d{2})/i), restituir: val(/IMPOSTO A RESTITUIR ([\d.]+,\d{2})/i), pagar: val(/SALDO DE IMPOSTO A PAGAR ([\d.]+,\d{2})/i),
    bensAnt: val(/Bens e direitos em 31\/12\/\d{4} ([\d.]+,\d{2})/i), bensAtual: 0, dividasAnt: val(/D[íi]vidas e [ôo]nus reais em 31\/12\/\d{4} ([\d.]+,\d{2})/i), dividasAtual: 0 };
  const bens = [...T.matchAll(/Bens e direitos em 31\/12\/\d{4} ([\d.]+,\d{2})/gi)], divs = [...T.matchAll(/D[íi]vidas e [ôo]nus reais em 31\/12\/\d{4} ([\d.]+,\d{2})/gi)];
  if (bens[1]) ir.bensAtual = numBR(bens[1][1]); if (divs[1]) ir.dividasAtual = numBR(divs[1][1]);
  let secao = null, atual = null;
  const fechar = () => { if (atual) { atual.discr = limparDiscr(atual.partes.join(' ')); delete atual.partes; (secao === 'bens' ? ir.bens : ir.dividas).push(atual); } atual = null; };
  for (const l of L) {
    if (/^DECLARA[ÇC][ÃA]O DE BENS E DIREITOS/i.test(l)) { if (secao !== 'bens') { fechar(); secao = 'bens'; } continue; }
    if (/^D[ÍI]VIDAS E [ÔO]NUS REAIS/i.test(l)) { fechar(); secao = 'dividas'; continue; }
    if (secao && /^(DOA[ÇC][ÕO]ES|DEMONSTRATIVO|RESUMO|EVOLU[ÇC][ÃA]O)/i.test(l)) { fechar(); secao = null; continue; }
    if (!secao) continue;
    if (/^TOTAL\b/i.test(l)) { fechar(); continue; }
    let m;
    if (secao === 'bens' && (m = l.match(/^(\d{2}) (\d{2}) (.*?) ?(-?[\d.]+,\d{2}) (-?[\d.]+,\d{2})$/))) {
      fechar(); atual = { grupo: m[1], codigo: m[2], partes: [m[3]], ant: numBR(m[4]), atual: numBR(m[5]) }; continue;
    }
    if (secao === 'dividas' && (m = l.match(/^(\d{2}) (.*?) ?([\d.]+,\d{2}) ([\d.]+,\d{2}) ([\d.]+,\d{2})$/))) {
      fechar(); atual = { codigo: m[1], partes: [m[2]], ant: numBR(m[3]), atual: numBR(m[4]), pago: numBR(m[5]) }; continue;
    }
    if (atual && !RUIDO_IRPF.test(l)) atual.partes.push(l);
  }
  fechar();
  return ir;
}
function tipoDoBem(b) {
  const g = b.grupo, c = b.codigo, t = b.discr;
  if (g === '03') return tipoPorTexto(t) === 'FII' ? 'FII' : 'Ação';
  if (g === '04') return c === '01' ? 'Poupança' : tipoPorTexto(t) || (c === '03' ? 'LCA' : c === '02' ? 'CDB' : 'Outro');
  if (g === '06') return 'Conta corrente';
  if (g === '07') return c === '03' || /\bFII\b/i.test(t) ? 'FII' : (tipoPorTexto(t, 'FUNDO') || 'Fundo DI/renda fixa');
  if (g === '08') return 'Cripto';
  return 'Bem';
}
function carteiraDoIRPF(ir, src = '') {
  return ir.bens.filter(b => GRUPOS_INVEST.has(b.grupo) && b.atual > 0).map(b => {
    const tipo = tipoDoBem(b), tk = (b.discr.toUpperCase().match(/\b[A-Z]{4}\d{1,2}\b/) || [])[0];
    return { tipo, ativo: (['Ação', 'FII'].includes(tipo) && tk ? tk : b.discr).slice(0, 60), inst: '', idx: idxPorTexto(b.discr), taxa: '', venc: '', qtd: '', valor: b.atual,
      imp: true, src, nota: `valor declarado no IRPF em 31/12/${ir.ano} (custo de aquisição); atualize com o valor de hoje` };
  });
}
function resumoIRPF(ir) {
  const soma = (f, k) => Math.round(ir.bens.filter(f).reduce((s, b) => s + b[k], 0) * 100) / 100, inv = b => GRUPOS_INVEST.has(b.grupo);
  const bens = ir.bensAtual || soma(() => true, 'atual'), dividas = ir.dividasAtual || ir.dividas.reduce((s, d) => s + d.atual, 0);
  return { tipo: 'irpf', exercicio: ir.exercicio, ano: ir.ano, bens, bensAnt: ir.bensAnt || soma(() => true, 'ant'), dividas, dividasAnt: ir.dividasAnt,
    invest: soma(inv, 'atual'), investAnt: soma(inv, 'ant'), outrosBens: soma(b => !inv(b), 'atual'), liquido: Math.round((bens - dividas) * 100) / 100,
    dividendos: ir.dividendos, rendAplicacoes: ir.rendAplicacoes, rendTributaveis: ir.rendTributaveis, restituir: ir.restituir, pagar: ir.pagar,
    dividasDesc: ir.dividas.filter(d => d.atual > 0).map(d => `${d.discr} (${d.atual.toFixed(2)})`),
    textoBens: ir.bens.map(b => b.discr).join(' | ') };
}

if (typeof module !== 'undefined') module.exports = { numBR, tipoPorTexto, idxPorTexto, venc, lerTabela, lerTextoPDF, ehExtratoXP, lerExtratoXP, carteiraDoExtratoXP, resumoExtratoXP,
  ehInformeXP, lerInformeXP, carteiraDoInformeXP, resumoInformeXP, ehIRPF, lerIRPF, carteiraDoIRPF, resumoIRPF };
