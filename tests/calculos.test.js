const { aliquotaIR, dimensionar, distribuirAporte } = require('../calculos');

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
