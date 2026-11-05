// Testes da lógica de cálculo. Rodar com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PADROES, alocar, brl, corretagemTabela, custoOrdem, lerNumero, linhaBoleta,
  montarOrdens, normalizarTicker, precoLimite, sugerirLote, textoBoletas,
} from "../static/calc.js";

const P = { ...PADROES };
const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

// Fórmula escrita de novo, em reais, para conferir custoOrdem de forma independente.
function custoReferencia(vReais, modelo, p = P) {
  let base = 0;
  if (modelo === "assessor") {
    const v = vReais;
    if (v <= 135.07) base = 2.7;
    else if (v <= 498.62) base = 0.02 * v;
    else if (v <= 1514.69) base = 0.015 * v + 2.49;
    else if (v <= 3029.38) base = 0.01 * v + 10.06;
    else base = 0.005 * v + 25.21;
  } else if (modelo === "app") base = p.precoFixo;
  if (modelo !== "fee") base = Math.max(base, p.corretagemMinima);
  const emol = vReais * (p.emolumentos / 100);
  let c = base * (1 + p.impostos / 100) + emol + (base + emol) * (p.outrosBovespa / 100);
  return c * (1 + p.margem / 100);
}

// ---------- Tabela Bovespa ----------

test("Tabela Bovespa: cada faixa e as fronteiras", () => {
  const casos = [
    [1, 270], [10000, 270], [13507, 270], // até 135,07 → R$ 2,70
    [13508, 270.16], [30000, 600], [49862, 997.24], // 2%
    [49863, 747.945 + 249], [100000, 1749], [151469, 2272.035 + 249], // 1,5% + 2,49
    [151470, 1514.7 + 1006], [200000, 3006], [302938, 3029.38 + 1006], // 1% + 10,06
    [302939, 1514.695 + 2521], [1000000, 7521], // 0,5% + 25,21
  ];
  for (const [v, esperado] of casos) perto(corretagemTabela(v), esperado);
});

test("Tabela Bovespa: continuidade aproximada entre faixas (sem saltos absurdos)", () => {
  for (const f of [13507, 49862, 151469, 302938]) {
    assert.ok(Math.abs(corretagemTabela(f + 1) - corretagemTabela(f)) < 100); // < R$ 1
  }
});

test("custo de uma ordem confere com a fórmula, nos três modelos e nas fronteiras", () => {
  const valores = [100, 13507, 13508, 49862, 49863, 151469, 151470, 302938, 302939, 5_000_000];
  for (const modelo of ["assessor", "app", "fee"]) {
    for (const v of valores) {
      const ref = custoReferencia(v / 100, modelo) * 100;
      const c = custoOrdem(v, modelo, P);
      assert.ok(Number.isInteger(c));
      assert.ok(c >= ref - 1e-6 && c < ref + 1, `${modelo} ${v}: ${c} vs ${ref}`);
    }
  }
});

test("custo de uma ordem: exemplo calculado à mão (R$ 100, assessor)", () => {
  // base 2,70 · emol 0,03 · 2,70×1,0965 + 0,03 + 2,73×0,059 = 3,15162 · ×1,10 = 3,466782
  assert.equal(custoOrdem(10000, "assessor", P), 347);
});

test("corretagem mínima vale só nos modelos com corretagem", () => {
  const p = { ...P, corretagemMinima: 10 };
  assert.equal(custoOrdem(10000, "assessor", p), Math.ceil(custoReferencia(100, "assessor", p) * 100 - 1e-6));
  assert.ok(custoOrdem(10000, "assessor", p) > custoOrdem(10000, "assessor", P));
  assert.equal(custoOrdem(10000, "fee", p), custoOrdem(10000, "fee", P));
  assert.equal(custoOrdem(10000, "app", { ...p, corretagemMinima: 25 }),
    Math.ceil(custoReferencia(100, "app", { ...p, corretagemMinima: 25 }) * 100 - 1e-6));
});

test("Fee Fixo cobra só taxas da B3", () => {
  // 1.000.000 centavos: emol 300 → 300 + 300×0,059 = 317,7 → ×1,1 = 349,47 → 350
  assert.equal(custoOrdem(1_000_000, "fee", P), 350);
});

// ---------- preço limite, lotes ----------

test("preço limite = preço × (1 + folga), 2 casas", () => {
  assert.equal(precoLimite(107.03, 0.3), 10735); // 107,35121 → 107,35
  assert.equal(precoLimite(100, 0.3), 10030);
  assert.equal(precoLimite(10, 0.05), 1001); // 10,005 → 10,01
  assert.equal(precoLimite(36.65, 0), 3665);
});

test("lote 100: 250 ações viram 200 + 50F, com duas corretagens", () => {
  const ordens = montarOrdens("PETR4", 250, 100, 3665, "assessor", P);
  assert.deepEqual(ordens.map((o) => [o.ticker, o.qtd, o.fracionario]), [
    ["PETR4", 200, false], ["PETR4F", 50, true]]);
  assert.equal(ordens[0].financeiro, 200 * 3665);
  assert.equal(ordens[1].financeiro, 50 * 3665);
  assert.equal(ordens[0].custo, custoOrdem(200 * 3665, "assessor", P));
  assert.equal(ordens[1].custo, custoOrdem(50 * 3665, "assessor", P));
});

test("lote 100: múltiplo exato não gera fracionário; menos de 100 só fracionário", () => {
  assert.deepEqual(montarOrdens("VALE3", 300, 100, 6000, "app", P).map((o) => o.ticker), ["VALE3"]);
  assert.deepEqual(montarOrdens("VALE3", 37, 100, 6000, "app", P).map((o) => o.ticker), ["VALE3F"]);
  assert.deepEqual(montarOrdens("VALE3", 0, 100, 6000, "app", P), []);
});

test("lote 1: uma ordem só, sem F", () => {
  const o = montarOrdens("BOVA11", 250, 1, 13000, "assessor", P);
  assert.equal(o.length, 1);
  assert.equal(o[0].ticker, "BOVA11");
});

test("comissão via app: duas ordens pagam duas vezes o preço fixo", () => {
  const ordens = montarOrdens("PETR4", 150, 100, 3000, "app", P);
  assert.equal(ordens.length, 2);
  for (const o of ordens) assert.ok(o.custo >= Math.ceil(1890 * 1.0965 * 1.1));
});

// ---------- números e tickers ----------

test("lerNumero aceita vírgula ou ponto", () => {
  const casos = {
    "1.234,56": 1234.56, "1234,56": 1234.56, "1234.56": 1234.56, "1,5": 1.5,
    "50.000": 50000, "50000": 50000, "R$ 50.000,00": 50000, "0.125": 0.125,
    "107.35": 107.35, "1.234.567,8": 1234567.8, "1,234.5": 1234.5, " 18,90 ": 18.9,
  };
  for (const [t, v] of Object.entries(casos)) assert.equal(lerNumero(t), v, t);
  for (const t of ["", "abc", "1,2,3x", "R$"]) assert.ok(Number.isNaN(lerNumero(t)), t);
});

test("formato brasileiro", () => {
  assert.equal(brl(123456), "R$ 1.234,56");
  assert.equal(brl(5), "R$ 0,05");
  assert.equal(brl(500000000), "R$ 5.000.000,00");
  assert.equal(brl(-1050), "-R$ 10,50");
});

test("tickers: normalização e sugestão de lote", () => {
  assert.equal(normalizarTicker(" petr4f"), "PETR4");
  assert.equal(normalizarTicker("lftb11"), "LFTB11");
  assert.equal(sugerirLote("PETR4"), 100);
  assert.equal(sugerirLote("VALE3"), 100);
  assert.equal(sugerirLote("BOVA11"), 1);
  assert.equal(sugerirLote("B5P211"), 1);
});

test("linha de boleta no formato pedido", () => {
  assert.equal(
    linhaBoleta({ ticker: "LFTB11", qtd: 120, limite: 10735, financeiro: 1288200 }),
    "COMPRA LFTB11 | 120 un. | preço limite R$ 107,35 | financeiro R$ 12.882,00");
});

// ---------- alocação ----------

const exemplo = (extra = {}) => ({
  saldo: 50000, caixa: 0, modelo: "assessor", usarSobra: true,
  ativos: [
    { id: 1, ticker: "LFTB11", preco: 107.03, peso: 40, lote: 1 },
    { id: 2, ticker: "B5P211", preco: 82.1, peso: 30, lote: 1 },
    { id: 3, ticker: "PREX11", preco: 11.25, peso: 30, lote: 1 },
  ],
  ...extra,
});

test("alocação do exemplo cabe no saldo e quase não deixa sobra", () => {
  const r = alocar(exemplo());
  assert.ok(r.ok);
  assert.ok(r.gasto <= r.disponivel);
  assert.ok(r.sobraLivre < 10735 + 2000, `sobra ${r.sobraLivre}`);
  assert.equal(r.ordens.length, 3);
  assert.equal(textoBoletas(r).split("\n").length, 4);
  assert.match(textoBoletas(r).split("\n")[3], /^TOTAL \| financeiro R\$ [\d.]+,\d\d \| custos estimados R\$ /);
});

test("sem usar sobra, cada ativo fica dentro do próprio alvo", () => {
  const r = alocar(exemplo({ usarSobra: false }));
  for (const a of r.ativos) assert.ok(a.gasto <= a.alvo);
});

test("valor em caixa é respeitado", () => {
  const r = alocar(exemplo({ caixa: 10000 }));
  assert.equal(r.disponivel, 4000000);
  assert.ok(r.gasto <= 4000000);
  assert.ok(r.contaFicaCom >= 1000000);
});

test("ativos inválidos (sem preço, peso 0, sem ticker) ficam de fora sem travar os outros", () => {
  const r = alocar(exemplo({
    ativos: [
      { id: 1, ticker: "LFTB11", preco: 107.03, peso: 50, lote: 1 },
      { id: 2, ticker: "XPTO11", preco: 0, peso: 30, lote: 1 },
      { id: 3, ticker: "PREX11", preco: 11.25, peso: 0, lote: 1 },
      { id: 4, ticker: "", preco: 10, peso: 20, lote: 1 },
    ],
  }));
  assert.equal(r.ativos[0].pesoAlvo, 1); // pesos renormalizados só entre os válidos
  assert.ok(r.ativos[0].qtd > 0);
  assert.equal(r.ativos[1].qtd, 0);
  assert.equal(r.ativos[1].semSaldo, false);
});

test("saldo que não cobre 1 cota marca o aviso", () => {
  const r = alocar(exemplo({ saldo: 50 }));
  assert.equal(r.ativos[0].qtd, 0);
  assert.equal(r.ativos[0].semSaldo, true);
  assert.ok(r.gasto <= r.disponivel);
});

test("saldo zero ou caixa maior que o saldo não quebra", () => {
  for (const e of [{ saldo: 0 }, { saldo: 1000, caixa: 5000 }]) {
    const r = alocar(exemplo(e));
    assert.equal(r.gasto, 0);
    assert.ok(r.ok);
  }
});

// ---------- invariante com cenários aleatórios ----------

function rng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("invariante: financeiro + custos ≤ disponível em 1.000 cenários aleatórios", () => {
  const r0 = rng(20261105);
  const entre = (a, b) => a + (b - a) * r0();
  const modelos = ["assessor", "app", "fee"];
  let comCompra = 0;
  for (let i = 0; i < 1000; i++) {
    const n = 1 + Math.floor(r0() * 6);
    const ativos = Array.from({ length: n }, (_, k) => ({
      id: k,
      ticker: `TEST${k}${r0() < 0.5 ? "" : "1"}`,
      preco: Math.round(Math.exp(entre(Math.log(0.5), Math.log(800))) * 100) / 100,
      peso: r0() < 0.1 ? 0 : Math.round(entre(1, 100)),
      lote: r0() < 0.5 ? 100 : 1,
    }));
    const saldo = Math.round(Math.exp(entre(Math.log(10), Math.log(3_000_000))) * 100) / 100;
    const entrada = {
      saldo,
      caixa: r0() < 0.3 ? Math.round(saldo * entre(0, 0.5) * 100) / 100 : 0,
      modelo: modelos[i % 3],
      usarSobra: r0() < 0.7,
      params: {
        ...PADROES,
        precoFixo: Math.round(entre(0, 40) * 100) / 100,
        corretagemMinima: r0() < 0.3 ? Math.round(entre(0, 20) * 100) / 100 : 0,
        folga: entre(0, 2), margem: entre(0, 30),
        impostos: entre(0, 15), outrosBovespa: entre(0, 10), emolumentos: entre(0, 0.1),
      },
      ativos,
    };
    const r = alocar(entrada);
    const ctx = JSON.stringify(entrada);

    // Recalcula tudo a partir das ordens, sem confiar nos totais de alocar().
    let soma = 0;
    for (const o of r.ordens) {
      assert.ok(Number.isInteger(o.qtd) && o.qtd > 0, ctx);
      assert.equal(o.financeiro, o.qtd * o.limite, ctx);
      assert.equal(o.custo, custoOrdem(o.financeiro, r.modelo, r.params), ctx);
      if (o.fracionario) assert.ok(o.qtd < 100, ctx);
      soma += o.financeiro + o.custo;
    }
    assert.equal(soma, r.gasto, ctx);
    assert.ok(soma <= r.disponivel, `excedeu ${soma - r.disponivel}: ${ctx}`);
    assert.ok(r.ok && r.excedente === 0, ctx);
    assert.ok(r.saldo - soma >= r.caixaReservado, ctx);

    // Com a sobra ligada, nenhuma cota adicional cabe mais no disponível.
    if (entrada.usarSobra) {
      for (const a of r.ativos.filter((x) => x.valido)) {
        const novo = montarOrdens(a.ticker, a.qtd + 1, a.lote, a.limite, r.modelo, r.params)
          .reduce((s, o) => s + o.financeiro + o.custo, 0);
        assert.ok(r.gasto - a.gasto + novo > r.disponivel, `cabia mais 1 de ${a.ticker}: ${ctx}`);
      }
    } else {
      for (const a of r.ativos) assert.ok(a.gasto <= a.alvo + 1e-9, ctx);
    }
    if (r.ordens.length) comCompra++;
  }
  assert.ok(comCompra > 500, `poucos cenários com compra: ${comCompra}`);
});
