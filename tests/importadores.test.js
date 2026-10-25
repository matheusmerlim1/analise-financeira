const fs = require('fs');
const path = require('path');
const imp = require('../importadores');

// extrato fictício no formato da XP (nenhum dado real)
const extrato = fs.readFileSync(path.join(__dirname, 'fixtures', 'xp_movimentacao_ficticia.txt'), 'utf8');

describe('números e datas', () => {
  test('lê valores no formato brasileiro', () => {
    expect(imp.numBR('R$ 1.234,56')).toBe(1234.56);
    expect(imp.numBR('-R$ 7.152,75')).toBe(-7152.75);
    expect(imp.numBR(42)).toBe(42);
    expect(imp.numBR('sem número')).toBeNaN();
  });
  test('converte vencimentos de vários formatos', () => {
    expect(imp.venc('15/03/2028')).toBe('2028-03-15');
    expect(imp.venc('CDB PICPAY - AGO/2029')).toBe('2029-08-15');
    expect(imp.venc('TESOURO IPCA+ 2035')).toBe('2035-12-31');
    expect(imp.venc('')).toBe('');
  });
  test('reconhece o tipo pelo nome', () => {
    expect(imp.tipoPorTexto('Tesouro Selic 2029')).toBe('Tesouro Selic');
    expect(imp.tipoPorTexto('LCA BANCO ABC')).toBe('LCA');
    expect(imp.tipoPorTexto('COE BANCO XP')).toBe('COE');
    expect(imp.tipoPorTexto('HGLG11')).toBe('FII');
    expect(imp.tipoPorTexto('PETR4')).toBe('Ação');
  });
});

describe('extrato de conta da XP', () => {
  const ex = imp.lerExtratoXP(extrato);
  test('é reconhecido como extrato da XP', () => expect(imp.ehExtratoXP(extrato)).toBe(true));
  test('lê período e saldo', () => {
    expect(ex.periodo).toEqual({ de: '2026-08-01', ate: '2026-10-31' });
    expect(ex.saldo).toBe(250);
  });
  test('lê proventos com quantidade', () => {
    expect(ex.proventos.filter(p => p.tk === 'HGLG11')).toHaveLength(2);
    expect(ex.proventos.find(p => p.tk === 'BBAS3')).toMatchObject({ qtd: 20, valor: 8, tipo: 'dividendo' });
  });
  test('separa IR retido, taxas, COE e resgates (inclusive descrições em duas linhas)', () => {
    expect(ex.irRetido).toBeCloseTo(17.5);
    expect(ex.taxas.reduce((s, t) => s + t.valor, 0)).toBe(100);
    expect(ex.coes).toEqual([expect.objectContaining({ codigo: 'XP0000AAAA1', venc: '2028-06-15', cupom: 50 })]);
    expect(ex.resgates.map(r => r.nome)).toEqual(expect.arrayContaining(['LCA BANCO EXEMPLO - DEZ/2026']));
  });

  const linhas = imp.carteiraDoExtratoXP(ex, 'extrato.pdf', ['PETR4', 'WEGE3', 'HGLG11']);
  const por = n => linhas.find(l => l.ativo === n);
  test('monta a carteira com a quantidade do provento mais recente', () => {
    expect(por('HGLG11')).toMatchObject({ tipo: 'FII', qtd: 10, renda: 19.8, src: 'extrato.pdf' });
    expect(por('MXRF11')).toMatchObject({ tipo: 'FII', qtd: 100 });
    expect(por('BBAS3')).toMatchObject({ tipo: 'Ação', qtd: 20 });
  });
  test('inclui ações vistas só no aluguel (BTC) ou por ISIN, sem quantidade', () => {
    expect(por('WEGE3')).toMatchObject({ tipo: 'Ação', qtd: '' });
    expect(por('PETR4')).toMatchObject({ tipo: 'Ação', qtd: '' });
  });
  test('inclui CDB comprado, COE, fundo aplicado e saldo; não inclui o que foi resgatado', () => {
    expect(por('CDB BANCO EXEMPLO - AGO/2029')).toMatchObject({ tipo: 'CDB', valor: 2000, venc: '2029-08-15' });
    expect(linhas.find(l => l.tipo === 'COE')).toMatchObject({ venc: '2028-06-15', renda: 50 });
    expect(por('Fundo Credito Exemplo')).toMatchObject({ valor: 500 });
    expect(por('Saldo disponível na XP')).toMatchObject({ tipo: 'Conta corrente', valor: 250 });
    expect(linhas.some(l => /LCA BANCO EXEMPLO|FUNDO EXEMPLO/.test(l.ativo))).toBe(false);
  });
  test('resume renda e custos', () => {
    const r = imp.resumoExtratoXP(ex);
    expect(r.rendaTotal).toBeCloseTo(11 + 10 + 8 + 8.8 + 50);
    expect(r.taxas).toBe(100);
    expect(r.taxasNome).toEqual(['FEE FIXO']);
  });
});

describe('extrato da XP como o pdf.js entrega (espaços entre os caracteres, descrição acima e abaixo da linha da data)', () => {
  const texto = fs.readFileSync(path.join(__dirname, 'fixtures', 'xp_movimentacao_pdfjs_ficticia.txt'), 'utf8');
  const ex = imp.lerExtratoXP(texto);
  test('lê período, saldo e valores com separadores espaçados', () => {
    expect(ex.periodo).toEqual({ de: '2026-08-01', ate: '2026-10-31' });
    expect(ex.saldo).toBe(1250);
    expect(ex.proventos.find(p => p.tk === 'HGLG11')).toMatchObject({ qtd: 10, valor: 11 });
  });
  test('junta a descrição quebrada em volta da linha da data', () => {
    expect(ex.irRetido).toBeCloseTo(10);
    expect(ex.coes).toEqual([expect.objectContaining({ codigo: 'XP0000AAAA1', venc: '2028-06-15', cupom: 50 })]);
    expect(ex.isins).toContain('PETR4');
    expect(ex.rf).toEqual([expect.objectContaining({ tipo: 'CDB', valor: 2000, venc: '2029-08-15' })]);
    expect(ex.taxas.map(t => t.valor)).toEqual([50]);
  });
  const linhas = imp.carteiraDoExtratoXP(ex, 'x.pdf');
  test('ação usa a maior quantidade do período (proventos menores por causa de ações emprestadas)', () => {
    expect(linhas.find(l => l.ativo === 'BBAS3')).toMatchObject({ tipo: 'Ação', qtd: 20 });
  });
  test('nomes sem os espaços do pdf.js ("S.A.")', () => {
    expect(linhas.find(l => l.tipo === 'COE').ativo).toBe('COE XP0000AAAA1 (BANCO XP S.A.)');
  });
});

describe('informe de rendimentos da XP', () => {
  const texto = fs.readFileSync(path.join(__dirname, 'fixtures', 'xp_informe_pdfjs_ficticio.txt'), 'utf8');
  const inf = imp.lerInformeXP(texto);
  test('é reconhecido e lê o ano-calendário', () => {
    expect(imp.ehInformeXP(texto)).toBe(true);
    expect(imp.ehExtratoXP(texto)).toBe(false);
    expect(inf.ano).toBe(2025);
  });
  test('lê cada ativo do detalhamento, com tipo, código, emissor, indexador, vencimento e se é isento', () => {
    const cdb = inf.ativos.find(a => a.codigo === 'CDB000AAAA1');
    expect(cdb).toMatchObject({ tipo: 'CDB', emissor: 'BANCO EXEMPLO DE INVESTIMENTO S.A', idx: 'CDI', venc: '2030-01-21', saldoAnt: 4000, saldo: 4000, isento: false });
    expect(inf.ativos.find(a => a.codigo === 'CDB000BBBB2')).toMatchObject({ idx: 'Pré', venc: '2027-02-17', saldo: 2500, rend: 120 });
    expect(inf.ativos.find(a => a.codigo === 'XP0000AAAA1')).toMatchObject({ tipo: 'COE', emissor: 'BANCO XP S.A.', saldo: 1000 });
    expect(inf.ativos.find(a => a.codigo === '00A00000001')).toMatchObject({ tipo: 'LCA', isento: true, saldo: 0, rend: 500 });
    expect(inf.ativos.find(a => a.fundo)).toMatchObject({ nome: 'Fundo Debentures Exemplo Incentivado C', saldo: 2000, isento: true });
    expect(inf.saldoConta).toBeCloseTo(75.5);
  });
  test('vira carteira só com o que tinha saldo no fim do ano', () => {
    const linhas = imp.carteiraDoInformeXP(inf, 'informe.pdf');
    expect(linhas.map(l => l.codigo).filter(Boolean).sort()).toEqual(['CDB000AAAA1', 'CDB000BBBB2', 'XP0000AAAA1']);
    expect(linhas.find(l => l.codigo === 'CDB000BBBB2')).toMatchObject({ tipo: 'CDB', inst: 'BANCO EXEMPLO B', idx: 'Pré', valor: 2500, src: 'informe.pdf' });
    expect(linhas.find(l => l.tipo === 'Fundo DI/renda fixa')).toMatchObject({ valor: 2000 });
    expect(linhas.find(l => l.tipo === 'Conta corrente')).toMatchObject({ valor: 75.5 });
  });
  test('resume os rendimentos do ano', () => {
    const r = imp.resumoInformeXP(inf);
    expect(r).toMatchObject({ ano: 2025, rendIsentos: 500, rendTributados: 175, posicaoFim: 9575.5 });
  });
});

describe('declaração do IRPF (imagem da declaração)', () => {
  const texto = fs.readFileSync(path.join(__dirname, 'fixtures', 'irpf_pdfjs_ficticio.txt'), 'utf8');
  const ir = imp.lerIRPF(texto);
  test('é reconhecida e não se confunde com os documentos da XP', () => {
    expect(imp.ehIRPF(texto)).toBe(true);
    expect(imp.ehInformeXP(texto)).toBe(false);
    expect(imp.ehExtratoXP(texto)).toBe(false);
    expect(ir).toMatchObject({ exercicio: 2026, ano: 2025 });
  });
  test('lê cada bem com grupo, código, discriminação e os dois saldos', () => {
    expect(ir.bens).toHaveLength(6);
    expect(ir.bens.find(b => b.grupo === '04' && b.codigo === '02')).toMatchObject({ ant: 10000, atual: 10000 });
    expect(ir.bens.find(b => b.grupo === '04' && b.codigo === '02').discr).toMatch(/BANCO MASTER/);
    expect(ir.bens.find(b => b.grupo === '07')).toMatchObject({ ant: 0, atual: 7000 });
  });
  test('não guarda dados sensíveis na discriminação (placa, chassi, renavam, conta)', () => {
    const txt = ir.bens.map(b => b.discr).join(' ');
    expect(txt).not.toMatch(/RENAVAM|CHASSI|PLACA|Conta:|Agência/i);
  });
  test('lê dívidas, rendimentos, imposto e evolução patrimonial', () => {
    expect(ir.dividas).toEqual([expect.objectContaining({ ant: 0, atual: 3000, pago: 100 })]);
    expect(ir).toMatchObject({ dividendos: 1500, rendAplicacoes: 800, rendIsentos: 2000, rendExclusivos: 4800, restituir: 350, pagar: 0,
      bensAnt: 37300, bensAtual: 39650, dividasAnt: 0, dividasAtual: 3000 });
  });
  test('resume investimentos x outros bens e monta a carteira só com investimentos com saldo', () => {
    const r = imp.resumoIRPF(ir);
    expect(r).toMatchObject({ tipo: 'irpf', ano: 2025, invest: 19650, investAnt: 17300, outrosBens: 20000, liquido: 36650 });
    const linhas = imp.carteiraDoIRPF(ir, 'irpf.pdf');
    expect(linhas.map(l => l.tipo).sort()).toEqual(['Ação', 'CDB', 'Conta corrente', 'FII']);
    expect(linhas.find(l => l.tipo === 'Ação')).toMatchObject({ ativo: 'BBAS3', valor: 2500, src: 'irpf.pdf' });
  });
});

describe('planilhas (layout do extrato de posição da B3)', () => {
  const linhas = imp.lerTabela([
    ['Produto', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço de Fechamento', 'Valor Atualizado'],
    ['ITUB4 - ITAU UNIBANCO', 'XP', 'ITUB4', '200', '48,30', '9.660,00'],
    ['', '', '', '', 'Total', '9.660,00'],
  ], 'Acoes', 'posicao.xlsx');
  test('lê a linha do ativo e ignora o total', () => {
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ tipo: 'Ação', ativo: 'ITUB4', qtd: 200, valor: 9660, src: 'posicao.xlsx' });
  });
  test('sem cabeçalho reconhecível, não inventa nada', () => {
    expect(imp.lerTabela([['a', 'b'], ['1', '2']])).toEqual([]);
  });
});

describe('PDF da declaração do IR', () => {
  test('junta discriminações quebradas em várias linhas e usa o valor mais recente', () => {
    const linhas = imp.lerTextoPDF([
      'BENS E DIREITOS', 'GRUPO CÓDIGO DISCRIMINAÇÃO SITUAÇÃO EM 31/12/2024 SITUAÇÃO EM 31/12/2025',
      '03 01 300 AÇÕES PETR4 PETROBRAS PN', 'CUSTODIADAS NA CORRETORA 9.500,00 11.200,00',
      '04 03 LCI BANCO EXEMPLO', 'VENCIMENTO 2027 0,00 10.000,00',
      'TOTAL 9.500,00 21.200,00'
    ]);
    expect(linhas.map(l => [l.tipo, l.valor])).toEqual([['Ação', 11200], ['LCI', 10000]]);
    expect(linhas[1].venc).toBe('2027-12-31');
  });
});
