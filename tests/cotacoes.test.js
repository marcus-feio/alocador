// Testes das cotações no navegador, sem rede: a brapi é simulada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROS, ServicoCotacoes, TTL_MS, interpretar, tickerBase } from "../static/cotacoes.js";

const HORA = "2026-11-05T17:32:10.000Z";
const PRECOS = { PETR4: 36.65, LFTB11: 107.03 };

function memoria(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const resposta = (status, corpo, headers = {}) => ({
  status, json: async () => corpo, headers: { get: (k) => headers[k] ?? null },
});

/** brapi falsa: registra as chamadas e o pico de chamadas simultâneas. */
function brapiFalsa({ precos = PRECOS, status = null, corpo = null, exigeToken = true, atraso = 0 } = {}) {
  const registro = { chamadas: [], agora: 0, max: 0 };
  const f = async (url, opts) => {
    const ticker = decodeURIComponent(url.split("/").pop());
    const auth = opts?.headers?.Authorization ?? null;
    registro.chamadas.push([ticker, auth]);
    registro.agora++; registro.max = Math.max(registro.max, registro.agora);
    try {
      if (atraso) await new Promise((r) => setTimeout(r, atraso));
      if (status) return resposta(status, corpo ?? { error: true, code: "X" });
      if (exigeToken && !auth) return resposta(401, { error: true, code: "MISSING_TOKEN", message: "Token de autenticação não fornecido" });
      if (auth === "Bearer ruim") return resposta(401, { error: true, code: "INVALID_TOKEN", message: "Token de autenticação inválido" });
      if (!(ticker in precos)) return resposta(404, { error: true, message: `Não encontramos a ação ${ticker}` });
      return resposta(200, { results: [{ symbol: ticker, regularMarketPrice: precos[ticker], regularMarketTime: HORA }] });
    } finally { registro.agora--; }
  };
  return { f, registro };
}

function servico({ token = "bom", relogio, ...opts } = {}) {
  const { f, registro } = brapiFalsa(opts);
  const s = new ServicoCotacoes({
    fetch: f,
    armazenamento: memoria(token ? { [ServicoCotacoes.CHAVE_TOKEN]: token } : {}),
    relogio: relogio ?? (() => 1_000_000),
    online: () => opts.online ?? true,
  });
  return { s, registro };
}

test("tickerBase tira o F do fracionário", () => {
  assert.equal(tickerBase("petr4f"), "PETR4");
  assert.equal(tickerBase("LFTB11"), "LFTB11");
  assert.equal(tickerBase("TAEE11F"), "TAEE11");
});

test("preço da brapi com horário e token no cabeçalho", async () => {
  const { s, registro } = servico();
  const r = await s.cotacoes(["LFTB11"]);
  assert.equal(r.LFTB11.preco, 107.03);
  assert.equal(r.LFTB11.fonte, "brapi");
  assert.equal(r.LFTB11.horario, HORA);
  assert.equal(r.LFTB11.erro, null);
  assert.deepEqual(registro.chamadas, [["LFTB11", "Bearer bom"]]);
});

test("fracionário usa o preço do ticker base, numa chamada só", async () => {
  const { s, registro } = servico();
  const r = await s.cotacoes(["PETR4", "PETR4F"]);
  assert.equal(r.PETR4F.preco, 36.65);
  assert.equal(r.PETR4F.ticker, "PETR4F");
  assert.equal(registro.chamadas.length, 1);
});

test("sem token: motivo SEM_TOKEN", async () => {
  const { s, registro } = servico({ token: "" });
  const r = await s.cotacoes(["LFTB11"]);
  assert.equal(r.LFTB11.erro, "SEM_TOKEN");
  assert.equal(r.LFTB11.mensagem, ERROS.SEM_TOKEN);
  assert.equal(r.LFTB11.preco, null);
  assert.deepEqual(registro.chamadas, [["LFTB11", null]]);
});

test("token inválido: motivo TOKEN_INVALIDO", async () => {
  const { s } = servico({ token: "ruim" });
  assert.equal((await s.cotacoes(["LFTB11"])).LFTB11.erro, "TOKEN_INVALIDO");
});

test("ticker inexistente: motivo NAO_ENCONTRADO", async () => {
  const { s } = servico();
  const r = await s.cotacoes(["XPTO11"]);
  assert.equal(r.XPTO11.erro, "NAO_ENCONTRADO");
  assert.match(r.XPTO11.detalhe, /XPTO11/);
});

test("limite: 429 e 402 com mensagem de cota", async () => {
  let { s } = servico({ status: 429, corpo: { error: true, message: "Too many requests" } });
  assert.equal((await s.cotacoes(["PETR4"])).PETR4.erro, "LIMITE");
  ({ s } = servico({ status: 402, corpo: { error: true, code: "QUOTA_EXCEEDED", message: "Limite mensal excedido" } }));
  assert.equal((await s.cotacoes(["PETR4"])).PETR4.erro, "LIMITE");
});

test("servidor fora do ar: 5xx e falha de rede", async () => {
  let { s } = servico({ status: 503 });
  assert.equal((await s.cotacoes(["PETR4"])).PETR4.erro, "FORA_DO_AR");
  const s2 = new ServicoCotacoes({ fetch: async () => { throw new TypeError("Failed to fetch"); }, armazenamento: memoria(), online: () => true });
  assert.equal((await s2.cotacoes(["PETR4"])).PETR4.erro, "FORA_DO_AR");
  const s3 = new ServicoCotacoes({ fetch: async () => { throw new TypeError("Failed to fetch"); }, armazenamento: memoria(), online: () => false });
  assert.equal((await s3.cotacoes(["PETR4"])).PETR4.erro, "SEM_INTERNET");
});

test("tempo esgotado vira TEMPO", async () => {
  const abortar = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  const s = new ServicoCotacoes({ fetch: abortar, armazenamento: memoria() });
  assert.equal((await s.cotacoes(["PETR4"])).PETR4.erro, "TEMPO");
});

test("ticker com formato inválido não chama a brapi", async () => {
  const { s, registro } = servico();
  assert.equal((await s.cotacoes(["AB"])).AB.erro, "INVALIDO");
  assert.equal(registro.chamadas.length, 0);
});

test("cache de 60 s: não repete a chamada e expira depois", async () => {
  let agora = 1_000_000;
  const { s, registro } = servico({ relogio: () => agora });
  await s.cotacoes(["LFTB11"]);
  agora += TTL_MS - 1;
  await s.cotacoes(["LFTB11"]);
  assert.equal(registro.chamadas.length, 1);
  agora += 2;
  await s.cotacoes(["LFTB11"]);
  assert.equal(registro.chamadas.length, 2);
});

test("ticker inexistente fica no cache; falta de token não", async () => {
  const { s, registro } = servico();
  await s.cotacoes(["XPTO11"]);
  await s.cotacoes(["XPTO11"]);
  assert.equal(registro.chamadas.length, 1);

  const sem = servico({ token: "" });
  await sem.s.cotacoes(["LFTB11"]);
  sem.s.token = "bom"; // usuário cola o token em Configurações
  const r = await sem.s.cotacoes(["LFTB11"]);
  assert.equal(r.LFTB11.preco, 107.03);
  assert.deepEqual(sem.registro.chamadas.at(-1), ["LFTB11", "Bearer bom"]);
});

test("trocar o token limpa o cache", async () => {
  const { s, registro } = servico();
  await s.cotacoes(["LFTB11"]);
  s.token = "outro";
  await s.cotacoes(["LFTB11"]);
  assert.equal(registro.chamadas.length, 2);
});

test("uma requisição por vez e pedidos iguais simultâneos viram um só", async () => {
  const { s, registro } = servico({ atraso: 5 });
  const [a, b] = await Promise.all([s.cotacoes(["PETR4", "LFTB11"]), s.cotacoes(["PETR4"])]);
  assert.equal(registro.max, 1);
  assert.equal(registro.chamadas.length, 2);
  assert.equal(a.PETR4.preco, b.PETR4.preco);
});

test("token salvo e apagado no armazenamento, sem espaços", () => {
  const arm = memoria();
  const s = new ServicoCotacoes({ fetch: async () => null, armazenamento: arm });
  s.token = "  abc  ";
  assert.equal(arm.getItem(ServicoCotacoes.CHAVE_TOKEN), "abc");
  s.token = "";
  assert.equal(arm.getItem(ServicoCotacoes.CHAVE_TOKEN), null);
});

test("interpretar: 200 sem o símbolo pedido e preço zero", () => {
  assert.equal(interpretar(200, { results: [{ symbol: "OUTRO", regularMarketPrice: 1 }] }, "PETR4").erro, "NAO_ENCONTRADO");
  assert.equal(interpretar(200, { results: [{ symbol: "PETR4", regularMarketPrice: 0 }] }, "PETR4").erro, "NAO_ENCONTRADO");
  assert.equal(interpretar(403, { message: "Plano não inclui" }, "PETR4").erro, "PLANO");
});
