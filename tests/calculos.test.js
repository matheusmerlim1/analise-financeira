const { aliquotaIR, dimensionar, distribuirAporte, evolucaoCarteira, indiceAcumulado, rentabilidade } = require('../calculos');

describe('períodos do gráfico', () => {
  const { periodoDisponivel } = require('../calculos');
  test('2 anos vale para ação com ~498 pregões (feriados encurtam o ano)', () => expect(periodoDisponivel(504, 498)).toBe(true));
  test('2 anos não vale para FII com só 1 ano de histórico', () => expect(periodoDisponivel(504, 249)).toBe(false));
  test('1 ano vale com 249 pregões', () => expect(periodoDisponivel(252, 249)).toBe(true));
});

describe('documentos importados', () => {
  const { extratosMovimentacao } = require('../calculos');
  test('taxas e proventos mensais só vêm de extratos de movimentação (não de informe nem de IRPF)', () => {
    const docs = { 'a.pdf': { tipo: 'extrato', taxas: 100 }, 'b.pdf': { taxas: 50 }, 'inf.pdf': { tipo: 'informe' }, 'ir.pdf': { tipo: 'irpf' } };
    expect(extratosMovimentacao(docs).map(e => e.taxas)).toEqual([100, 50]);
  });
});

describe('instituições em liquidação', () => {
  const { instituicaoLiquidada } = require('../calculos');
  test('reconhece CDB do conglomerado Master pelo emissor', () => {
    expect(instituicaoLiquidada({ tipo: 'CDB', inst: 'BANCO MASTER S/A', ativo: 'CDB BANCO MASTER S/A CDB000' })).toMatchObject({ nome: 'conglomerado do Banco Master' });
    expect(instituicaoLiquidada({ tipo: 'CDB', inst: 'MASTER - JUROS MENSAL', ativo: 'CDB' })).not.toBeNull();
    expect(instituicaoLiquidada({ tipo: 'LCA', inst: 'BANCO MASTER DE INVESTIMENTO S.A', ativo: '' })).not.toBeNull();
  });
  test('não confunde com outros bancos nem com ações e COEs', () => {
    expect(instituicaoLiquidada({ tipo: 'CDB', inst: 'BANCO ARBI S/A', ativo: 'CDB' })).toBeNull();
    expect(instituicaoLiquidada({ tipo: 'COE', inst: 'BANCO XP S.A.', ativo: 'COE' })).toBeNull();
    expect(instituicaoLiquidada({ tipo: 'Ação', inst: 'XP', ativo: 'MASTERCARD' })).toBeNull();
  });
});

describe('evolução do patrimônio', () => {
  const eixo = [1, 2, 3];
  test('ação: quantidade de hoje × preço de cada dia; termina no valor atual', () => {
    const r = evolucaoCarteira(eixo, [{ chave: 'AAA3', grupo: 'acoes', v: 200, precos: [8, 9, 10] }]);
    expect(r.ativos.AAA3).toEqual([160, 180, 200]);
    expect(r.total).toEqual([160, 180, 200]);
  });
  test('renda fixa: valor de hoje descontado para trás pelo índice', () => {
    const r = evolucaoCarteira(eixo, [{ chave: 'CDB', grupo: 'pos', v: 121, cresc: [1, 1.1, 1.21] }]);
    expect(r.ativos.CDB.map(x => Math.round(x))).toEqual([100, 110, 121]);
  });
  test('soma por grupo e ignora itens sem valor', () => {
    const r = evolucaoCarteira(eixo, [
      { chave: 'A', grupo: 'acoes', v: 100, precos: [10, 10, 10] }, { chave: 'B', grupo: 'acoes', v: 50, precos: [5, 5, 5] },
      { chave: 'C', grupo: 'pos', v: 0, cresc: [1, 1, 1] }]);
    expect(r.grupos.acoes).toEqual([150, 150, 150]);
    expect(r.ativos.C).toBeUndefined();
  });
  test('com proventos, o passado fica menor (o DY recebido entra como ganho) e o fim continua igual ao valor de hoje', () => {
    const sem = evolucaoCarteira(eixo, [{ chave: 'F', grupo: 'fii', v: 100, precos: [10, 10, 10], dy: .252 }]).total;
    const com = evolucaoCarteira(eixo, [{ chave: 'F', grupo: 'fii', v: 100, precos: [10, 10, 10], dy: .252 }], { proventos: true }).total;
    expect(com[2]).toBeCloseTo(100);
    expect(com[0]).toBeLessThan(sem[0]);
  });
  test('preço faltando no começo usa o primeiro preço conhecido na soma', () => {
    const r = evolucaoCarteira(eixo, [{ chave: 'N', grupo: 'acoes', v: 30, precos: [null, 10, 10] }]);
    expect(r.ativos.N).toEqual([null, 30, 30]);
    expect(r.total).toEqual([30, 30, 30]);
  });
  test('índice acumulado e rentabilidade em %', () => {
    expect(indiceAcumulado(eixo, () => .1)).toEqual([1.1, 1.2100000000000002, 1.3310000000000004]);
    expect(rentabilidade([100, 110, 99]).map(x => Math.round(x))).toEqual([0, 10, -1]);
  });
});

describe('IR regressivo', () => {
  test.each([[1, .225], [180, .225], [181, .20], [360, .20], [361, .175], [720, .175], [721, .15]])('%i dias → %f', (d, a) => {
    expect(aliquotaIR(d)).toBe(a);
  });
});

describe('dimensionar (método trader-budget)', () => {
  test('respeita o teto por ativo e redistribui o excesso', () => {
    const r = dimensionar([{ sym: 'A', w: 8 }, { sym: 'B', w: 1 }, { sym: 'C', w: 1 }], 1000, 400);
    const v = Object.fromEntries(r.linhas.map(x => [x.sym, x.v]));
    expect(v.A).toBe(400);
    expect(v.B + v.C).toBe(600);
    expect(r.sobra).toBe(0);
  });
  test('descarta fatias abaixo do mínimo e repassa o valor', () => {
    const r = dimensionar([{ sym: 'A', w: 99 }, { sym: 'B', w: 1 }], 1000, 1000, 100);
    expect(r.linhas.map(x => x.sym)).toEqual(['A']);
    expect(r.linhas[0].v).toBe(1000);
  });
  test('quando todos batem no teto, devolve a sobra', () => {
    const r = dimensionar([{ sym: 'A', w: 1 }, { sym: 'B', w: 1 }], 1000, 300);
    expect(r.linhas.reduce((s, x) => s + x.v, 0)).toBe(600);
    expect(r.sobra).toBe(400);
  });
  test('teto individual (lim) prevalece sobre o geral', () => {
    const r = dimensionar([{ sym: 'A', w: 1, lim: 100 }, { sym: 'B', w: 1 }], 1000, 1000);
    expect(r.linhas.find(x => x.sym === 'A').v).toBe(100);
  });
});

describe('distribuirAporte', () => {
  test('completa primeiro as classes abaixo do alvo', () => {
    const out = distribuirAporte({ rf: 900, acoes: 100 }, { rf: .5, acoes: .5 }, 400);
    expect(out.acoes).toBe(400);
    expect(out.rf).toBe(0);
  });
  test('depois de cobrir os déficits, segue os pesos do alvo', () => {
    expect(distribuirAporte({ rf: 500, acoes: 500 }, { rf: .5, acoes: .5 }, 200)).toEqual({ rf: 100, acoes: 100 });
  });
});
