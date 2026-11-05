// Lógica de cálculo do Alocador. Sem DOM: usada pela página e pelos testes no Node.
//
// Todos os valores em dinheiro circulam em CENTAVOS inteiros, para que a soma
// "financeiro + custos ≤ disponível" seja exata (sem erro de ponto flutuante).
// Custos são arredondados PARA CIMA por ordem (estimativa conservadora).

export const PADROES = Object.freeze({
  precoFixo: 18.9, // R$ por ordem, modelo "Comissão via app"
  corretagemMinima: 0, // R$ por ordem
  outrosBovespa: 5.9, // %
  impostos: 9.65, // % sobre a corretagem (ISS, PIS, COFINS)
  emolumentos: 0.03, // %
  folga: 0.3, // % sobre o preço, vira o preço limite
  margem: 10, // % sobre os custos
});

export const MODELOS = Object.freeze({
  assessor: "Comissão via assessor",
  app: "Comissão via app",
  fee: "Fee Fixo",
});

// ---------- números ----------

/** R$ (number) -> centavos inteiros. */
export function paraCentavos(reais) {
  const n = Number(reais);
  return Math.round(n * 100 + Math.sign(n) * 1e-7);
}

/**
 * Converte texto digitado em número. Aceita vírgula ou ponto como decimal,
 * "R$", espaços e separador de milhar ("1.234,56", "1234.56", "50.000").
 * Retorna NaN se não for um número.
 */
export function lerNumero(texto) {
  if (typeof texto === "number") return texto;
  let s = String(texto ?? "").replace(/R\$|\s| /g, "");
  if (!s) return NaN;
  const virg = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virg >= 0 && ponto >= 0) {
    const dec = virg > ponto ? "," : ".";
    const mil = dec === "," ? "." : ",";
    s = s.split(mil).join("").replace(dec, ".");
  } else if (virg >= 0) {
    s = s.split(",").length > 2 ? s.split(",").join("") : s.replace(",", ".");
  } else if (ponto >= 0) {
    const partes = s.split(".");
    const milhar = partes.length > 2 || (/^-?[1-9]\d{0,2}$/.test(partes[0]) && partes[1].length === 3);
    if (milhar) s = partes.join("");
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Formata número no padrão brasileiro: 1234.5 -> "1.234,50". */
export function formatarNumero(valor, casas = 2) {
  const neg = valor < 0;
  const [int, dec] = Math.abs(valor).toFixed(casas).split(".");
  const comMilhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + comMilhar + (casas > 0 ? "," + dec : "");
}

/** Centavos -> "R$ 1.234,56". */
export function brl(centavos) {
  const neg = centavos < 0;
  return (neg ? "-" : "") + "R$ " + formatarNumero(Math.abs(centavos) / 100, 2);
}

export function percentual(fracao, casas = 1) {
  return formatarNumero(fracao * 100, casas) + "%";
}

// ---------- tickers ----------

/** "petr4f " -> "PETR4" (remove o F do fracionário). */
export function normalizarTicker(t) {
  const s = String(t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]{4}\d{1,2})F$/);
  return m ? m[1] : s;
}

/** Sugestão de lote: final 3 a 8 = ação (100); o resto (11, 34...) = 1. */
export function sugerirLote(ticker) {
  return /^[A-Z]{4}[3-8]$/.test(normalizarTicker(ticker)) ? 100 : 1;
}

// ---------- custos ----------

/** Tabela Bovespa, por ordem. v em centavos; retorna centavos (sem arredondar). */
export function corretagemTabela(v) {
  if (v <= 13507) return 270;
  if (v <= 49862) return v * 0.02;
  if (v <= 151469) return v * 0.015 + 249;
  if (v <= 302938) return v * 0.01 + 1006;
  return v * 0.005 + 2521;
}

/** Custo total de uma ordem de financeiro v (centavos). Retorna centavos, arredondado para cima. */
export function custoOrdem(v, modelo, p) {
  if (v <= 0) return 0;
  let base = 0;
  if (modelo === "assessor") base = corretagemTabela(v);
  else if (modelo === "app") base = paraCentavos(p.precoFixo);
  if (modelo !== "fee") base = Math.max(base, paraCentavos(p.corretagemMinima));
  const emol = (v * p.emolumentos) / 100;
  let custo = base * (1 + p.impostos / 100) + emol + ((base + emol) * p.outrosBovespa) / 100;
  custo *= 1 + p.margem / 100;
  return Math.ceil(custo - 1e-6);
}

/** Preço limite em centavos: preço × (1 + folga), arredondado em 2 casas. */
export function precoLimite(preco, folga) {
  return Math.round(preco * (1 + folga / 100) * 100 + 1e-7);
}

/**
 * Ordens de um ativo. Lote 100: parte múltipla de 100 no lote padrão e o resto
 * no fracionário (ticker + "F"); cada ordem paga a própria corretagem.
 */
export function montarOrdens(ticker, qtd, lote, limite, modelo, p) {
  const partes =
    lote === 100
      ? [
          { ticker, qtd: Math.floor(qtd / 100) * 100, fracionario: false },
          { ticker: ticker + "F", qtd: qtd % 100, fracionario: true },
        ]
      : [{ ticker, qtd, fracionario: false }];
  return partes
    .filter((o) => o.qtd > 0)
    .map((o) => {
      const financeiro = o.qtd * limite;
      return { ...o, limite, financeiro, custo: custoOrdem(financeiro, modelo, p) };
    });
}

function gastoDe(qtd, a, modelo, p) {
  const ordens = montarOrdens(a.ticker, qtd, a.lote, a.limite, modelo, p);
  const financeiro = ordens.reduce((s, o) => s + o.financeiro, 0);
  const custos = ordens.reduce((s, o) => s + o.custo, 0);
  return { ordens, financeiro, custos, gasto: financeiro + custos };
}

// ---------- alocação ----------

/**
 * entrada: { saldo, caixa, modelo, params, usarSobra, ativos: [{id, ticker, preco, peso, lote}] }
 * saldo, caixa e preço em R$; peso em qualquer escala (é normalizado).
 * Valores em dinheiro do resultado em centavos.
 */
export function alocar(entrada) {
  const p = { ...PADROES, ...(entrada.params || {}) };
  const modelo = MODELOS[entrada.modelo] ? entrada.modelo : "assessor";
  const usarSobra = entrada.usarSobra !== false;
  const saldo = Math.max(0, paraCentavos(entrada.saldo || 0));
  const caixa = Math.max(0, paraCentavos(entrada.caixa || 0));
  const disponivel = Math.max(0, saldo - caixa);

  const ativos = (entrada.ativos || []).map((a) => {
    const ticker = normalizarTicker(a.ticker);
    const preco = Number(a.preco);
    const peso = Number(a.peso);
    const lote = Number(a.lote) === 100 ? 100 : 1;
    const valido = ticker.length > 0 && preco > 0 && peso > 0;
    return {
      id: a.id, ticker, preco, peso, lote, valido,
      limite: valido ? precoLimite(preco, p.folga) : 0,
      pesoAlvo: 0, alvo: 0, qtd: 0, financeiro: 0, custos: 0, gasto: 0, ordens: [],
    };
  });
  const validos = ativos.filter((a) => a.valido && a.limite > 0);
  const somaPesos = validos.reduce((s, a) => s + a.peso, 0);

  // Passos 3 e 4: alvo por ativo e maior quantidade que cabe no alvo com custos.
  for (const a of validos) {
    a.pesoAlvo = a.peso / somaPesos;
    a.alvo = disponivel * a.pesoAlvo;
    let q = Math.floor(a.alvo / a.limite);
    let g = gastoDe(q, a, modelo, p);
    while (q > 0 && g.gasto > a.alvo) {
      q -= 1;
      g = gastoDe(q, a, modelo, p);
    }
    Object.assign(a, { qtd: q }, g);
  }

  // Passo 5: usar a sobra, 1 cota por vez, no ativo mais abaixo do alvo.
  let total = validos.reduce((s, a) => s + a.gasto, 0);
  if (usarSobra && disponivel > 0) {
    for (;;) {
      let melhor = null;
      for (const a of validos) {
        const g = gastoDe(a.qtd + 1, a, modelo, p);
        if (total - a.gasto + g.gasto > disponivel) continue;
        const relativo = a.gasto / a.alvo;
        if (!melhor || relativo < melhor.relativo) melhor = { a, g, relativo };
      }
      if (!melhor) break;
      total += melhor.g.gasto - melhor.a.gasto;
      Object.assign(melhor.a, { qtd: melhor.a.qtd + 1 }, melhor.g);
    }
  }

  const financeiro = validos.reduce((s, a) => s + a.financeiro, 0);
  const custos = validos.reduce((s, a) => s + a.custos, 0);
  for (const a of ativos) {
    a.pesoFinal = financeiro > 0 ? a.financeiro / financeiro : 0;
    a.semSaldo = a.valido && a.qtd === 0;
  }
  const gasto = financeiro + custos;
  const excedente = Math.max(0, gasto - disponivel);
  return {
    modelo, params: p, saldo, caixa, disponivel,
    caixaReservado: Math.min(caixa, saldo),
    ativos,
    ordens: validos.flatMap((a) => a.ordens),
    financeiro, custos, gasto,
    sobraLivre: Math.max(0, disponivel - gasto),
    contaFicaCom: saldo - gasto,
    excedente,
    ok: excedente === 0,
  };
}

// ---------- boletas ----------

export function linhaBoleta(o) {
  return `COMPRA ${o.ticker} | ${formatarNumero(o.qtd, 0)} un. | preço limite ${brl(o.limite)} | financeiro ${brl(o.financeiro)}`;
}

export function textoBoletas(r) {
  if (!r.ordens.length) return "";
  const linhas = r.ordens.map(linhaBoleta);
  linhas.push(`TOTAL | financeiro ${brl(r.financeiro)} | custos estimados ${brl(r.custos)}`);
  return linhas.join("\n");
}
