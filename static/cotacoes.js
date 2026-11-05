// Cotações direto da brapi.dev pelo navegador.
//
// - O token fica só no localStorage deste navegador (nunca no código).
// - Plano gratuito da brapi: 1 ticker por requisição e 1 requisição por vez,
//   então as chamadas são feitas em fila, uma de cada vez.
// - Cache de 60 s por ticker para não gastar a cota mensal. Só guarda o que
//   não muda em seguida (preço encontrado ou ticker inexistente); falhas de
//   token, limite e rede não ficam no cache.
// - Ticker fracionário (PETR4F) é buscado sem o F (PETR4).

export const URL_BRAPI = "https://brapi.dev/api/quote/";
export const TTL_MS = 60_000;
export const TEMPO_LIMITE_MS = 8_000;
export const TICKER_VALIDO = /^[A-Z0-9]{4,12}$/;
const FRACIONARIO = /^([A-Z]{4}\d{1,2})F$/;

/** Motivos de falha, com o texto curto que aparece embaixo do preço. */
export const ERROS = Object.freeze({
  SEM_TOKEN: "Token da brapi ausente",
  TOKEN_INVALIDO: "Token da brapi inválido",
  NAO_ENCONTRADO: "Ticker não encontrado",
  LIMITE: "Limite da brapi atingido",
  PLANO: "Ticker fora do seu plano da brapi",
  FORA_DO_AR: "brapi fora do ar",
  SEM_INTERNET: "Sem internet",
  TEMPO: "brapi não respondeu",
  INVALIDO: "Ticker inválido",
  RESPOSTA: "Resposta inesperada da brapi",
});

export function tickerBase(ticker) {
  const t = String(ticker).trim().toUpperCase();
  const m = FRACIONARIO.exec(t);
  return m ? m[1] : t;
}

const precoValido = (p) => typeof p === "number" && Number.isFinite(p) && p > 0;

function lerHorario(valor) {
  if (typeof valor === "number") return new Date(valor * 1000).toISOString();
  const d = new Date(valor ?? Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const falha = (codigo, detalhe = "") => ({ preco: null, horario: null, fonte: null, erro: codigo, mensagem: ERROS[codigo], detalhe });

/**
 * Converte a resposta HTTP da brapi em {preco, horario, fonte} ou numa falha
 * com o motivo. Exportada para os testes.
 */
export function interpretar(status, corpo, base, { temToken = true, retryAfter = null } = {}) {
  const codigo = String(corpo?.code || "").toUpperCase();
  const msg = typeof corpo?.message === "string" ? corpo.message : "";
  if (status === 200) {
    const item = (corpo?.results || []).find((r) => String(r?.symbol || "").toUpperCase() === base);
    if (!item) return falha("NAO_ENCONTRADO", msg);
    if (!precoValido(item.regularMarketPrice)) return falha("NAO_ENCONTRADO", "sem preço no momento");
    return { preco: item.regularMarketPrice, horario: lerHorario(item.regularMarketTime), fonte: "brapi", erro: null };
  }
  if (status === 401) {
    if (codigo === "MISSING_TOKEN" || !temToken) return falha("SEM_TOKEN", msg);
    return falha("TOKEN_INVALIDO", msg);
  }
  if (status === 404) return falha("NAO_ENCONTRADO", msg);
  if (status === 429) {
    return falha("LIMITE", [msg, retryAfter ? `tente de novo em ${retryAfter} s` : ""].filter(Boolean).join(" · "));
  }
  if (status === 402 || status === 403) {
    if (/limit|cota|quota|excedid/i.test(codigo + " " + msg)) return falha("LIMITE", msg);
    return falha("PLANO", msg);
  }
  if (status === 400 && /encontr|not.?found|invalid.?ticker/i.test(codigo + " " + msg)) return falha("NAO_ENCONTRADO", msg);
  if (status >= 500) return falha("FORA_DO_AR", `HTTP ${status}`);
  return falha("RESPOSTA", [`HTTP ${status}`, msg].filter(Boolean).join(" · "));
}

/** Guarda o token no localStorage. Separado para os testes trocarem por um objeto em memória. */
export function armazenamentoPadrao() {
  try { return window.localStorage; } catch { return null; }
}

export class ServicoCotacoes {
  constructor({ fetch: f = (...a) => globalThis.fetch(...a), armazenamento = armazenamentoPadrao(), relogio = Date.now, online = () => globalThis.navigator?.onLine !== false } = {}) {
    this._fetch = f;
    this._arm = armazenamento;
    this._relogio = relogio;
    this._online = online;
    this._cache = new Map(); // base -> {t, cotacao}
    this._emAndamento = new Map(); // base -> Promise
    this._fila = Promise.resolve(); // plano gratuito: 1 requisição por vez
  }

  static CHAVE_TOKEN = "alocador.brapiToken";

  get token() {
    try { return (this._arm?.getItem(ServicoCotacoes.CHAVE_TOKEN) || "").trim(); } catch { return ""; }
  }

  set token(valor) {
    const t = String(valor || "").trim();
    try {
      if (t) this._arm?.setItem(ServicoCotacoes.CHAVE_TOKEN, t);
      else this._arm?.removeItem(ServicoCotacoes.CHAVE_TOKEN);
    } catch { /* armazenamento indisponível */ }
    this._cache.clear(); // com outro token, as respostas podem mudar
  }

  /** Devolve {TICKER: {ticker, preco, horario, fonte, erro, mensagem, detalhe}} para cada ticker pedido. */
  async cotacoes(tickers) {
    const pedidos = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
    const bases = [...new Set(pedidos.map(tickerBase))];
    const resultados = await Promise.all(bases.map((b) => this._cotacao(b)));
    const porBase = new Map(bases.map((b, i) => [b, resultados[i]]));
    return Object.fromEntries(pedidos.map((t) => [t, { ...porBase.get(tickerBase(t)), ticker: t }]));
  }

  _cotacao(base) {
    const emCache = this._cache.get(base);
    if (emCache && this._relogio() - emCache.t < TTL_MS) return Promise.resolve(emCache.cotacao);
    let tarefa = this._emAndamento.get(base);
    if (!tarefa) {
      tarefa = this._enfileirar(() => this._buscar(base)).then((c) => {
        if (c.erro === null || c.erro === "NAO_ENCONTRADO") this._cache.set(base, { t: this._relogio(), cotacao: c });
        return c;
      }).finally(() => this._emAndamento.delete(base));
      this._emAndamento.set(base, tarefa);
    }
    return tarefa;
  }

  _enfileirar(trabalho) {
    const vez = this._fila.then(trabalho, trabalho);
    this._fila = vez.catch(() => {});
    return vez;
  }

  async _buscar(base) {
    if (!TICKER_VALIDO.test(base)) return falha("INVALIDO");
    const token = this.token;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS) : null;
    let r;
    try {
      r = await this._fetch(URL_BRAPI + encodeURIComponent(base), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ctrl?.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (e?.name === "AbortError") return falha("TEMPO", `${TEMPO_LIMITE_MS / 1000} s sem resposta`);
      return falha(this._online() ? "FORA_DO_AR" : "SEM_INTERNET", e?.message || "");
    } finally {
      if (timer) clearTimeout(timer);
    }
    let corpo = null;
    try { corpo = await r.json(); } catch { /* corpo não é JSON */ }
    if (r.status === 200 && corpo === null) return falha("RESPOSTA", "resposta não é JSON");
    return interpretar(r.status, corpo, base, { temToken: Boolean(token), retryAfter: r.headers?.get?.("Retry-After") });
  }
}
