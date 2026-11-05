// Tela do Alocador: estado, cotações automáticas, renderização e cópia das boletas.
import * as C from "./calc.js";
import { ServicoCotacoes, TICKER_VALIDO as TICKER_OK } from "./cotacoes.js";

const CHAVE = "alocador.estado.v1";
const ESPERA_DIGITACAO = 700; // ms de debounce ao digitar o ticker
const servico = new ServicoCotacoes();
const $ = (id) => document.getElementById(id);

let proximoId = 1;
const novoAtivo = (dados = {}) => ({
  id: proximoId++,
  ticker: "",
  preco: null,
  peso: null,
  lote: 1,
  loteTocado: false,
  manual: false,
  cot: null, // {fonte, horario} | {erro, mensagem, detalhe} | {carregando}
  ...dados,
});

function estadoInicial() {
  return {
    saldo: null,
    caixa: null,
    modelo: "assessor",
    usarSobra: true,
    params: { ...C.PADROES },
    ativos: [
      novoAtivo({ ticker: "LFTB11", peso: 40, lote: 1, loteTocado: true }),
      novoAtivo({ ticker: "B5P211", peso: 30, lote: 1, loteTocado: true }),
      novoAtivo({ ticker: "PREX11", peso: 30, lote: 1, loteTocado: true }),
    ],
  };
}

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE));
    if (salvo && Array.isArray(salvo.ativos)) {
      const e = { ...estadoInicial(), ...salvo, params: { ...C.PADROES, ...salvo.params } };
      e.ativos = salvo.ativos.map((a) => {
        const { id, ...resto } = a;
        return novoAtivo({ ...resto, cot: a.cot && !a.cot.carregando ? a.cot : null });
      });
      return e;
    }
  } catch { /* sem localStorage ou JSON inválido: começa do zero */ }
  return estadoInicial();
}

const estado = carregar();

function salvar() {
  try {
    const { ativos, ...resto } = estado;
    localStorage.setItem(CHAVE, JSON.stringify({ ...resto, ativos: ativos.map(({ id, ...a }) => a) }));
  } catch { /* armazenamento indisponível */ }
}

// ---------- formatação ----------

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = fmtDia.format(new Date()) === fmtDia.format(d);
  return hoje ? fmtHora.format(d) : `${fmtDia.format(d)} ${fmtHora.format(d)}`;
}

const numeroOuVazio = (v, casas = 2) => (v === null || v === undefined || Number.isNaN(v) ? "" : C.formatarNumero(v, casas));
const casasPreco = (v) => (v !== null && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? 4 : 2);
const pesoTexto = (v) => (v === null ? "" : C.formatarNumero(v, Number.isInteger(v) ? 0 : 2));
const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Lê um campo numérico; vazio vira null, inválido marca o campo e devolve undefined. */
function lerCampo(input, { minimo = 0 } = {}) {
  const txt = input.value.trim();
  const alvo = input.closest(".entrada") || input;
  if (!txt) { alvo.removeAttribute("aria-invalid"); return null; }
  const n = C.lerNumero(txt);
  const ok = Number.isFinite(n) && n >= minimo;
  if (ok) alvo.removeAttribute("aria-invalid"); else alvo.setAttribute("aria-invalid", "true");
  return ok ? n : undefined;
}

// ---------- topo e parâmetros ----------

function preencherTopo() {
  $("saldo").value = numeroOuVazio(estado.saldo);
  $("caixa").value = numeroOuVazio(estado.caixa);
  document.querySelector(`input[name="modelo"][value="${estado.modelo}"]`).checked = true;
  $("usarSobra").checked = estado.usarSobra;
  for (const input of document.querySelectorAll("[data-param]")) {
    const v = estado.params[input.dataset.param];
    input.value = C.formatarNumero(v, input.dataset.param === "emolumentos" ? 3 : 2).replace(/(,\d\d)0$/, "$1");
  }
  atualizarResumoCustos();
}

function atualizarResumoCustos() {
  const p = estado.params;
  const pct = (v) => C.formatarNumero(v, 2).replace(/,?0+$/, "") + "%";
  $("resumoCustos").textContent =
    `folga ${pct(p.folga)} · margem ${pct(p.margem)} · impostos ${pct(p.impostos)} · outros ${pct(p.outrosBovespa)} · emolumentos ${pct(p.emolumentos)}`;
}

function ligarTopo() {
  for (const id of ["saldo", "caixa"]) {
    const input = $(id);
    input.addEventListener("input", () => {
      const v = lerCampo(input);
      if (v !== undefined) { estado[id] = v; mudou(); }
    });
    input.addEventListener("blur", () => { if (lerCampo(input) !== undefined) input.value = numeroOuVazio(estado[id]); });
  }
  for (const r of document.querySelectorAll('input[name="modelo"]')) {
    r.addEventListener("change", () => { estado.modelo = r.value; mudou(); });
  }
  $("usarSobra").addEventListener("change", (e) => { estado.usarSobra = e.target.checked; mudou(); });
  for (const input of document.querySelectorAll("[data-param]")) {
    input.addEventListener("input", () => {
      const v = lerCampo(input);
      if (v !== undefined && v !== null) { estado.params[input.dataset.param] = v; atualizarResumoCustos(); mudou(); }
    });
    input.addEventListener("blur", () => preencherTopo());
  }
  $("restaurarPadroes").addEventListener("click", () => {
    estado.params = { ...C.PADROES };
    preencherTopo();
    mudou();
  });
}

// ---------- tabela de ativos ----------

function htmlLinha(a) {
  return `
    <td class="celula-ticker" data-rotulo="Ticker">
      <input class="in-ticker" data-campo="ticker" value="${escapar(a.ticker)}" aria-label="Ticker" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12">
    </td>
    <td class="celula-preco" data-rotulo="Preço">
      <input class="in-preco" data-campo="preco" inputmode="decimal" aria-label="Preço de ${escapar(a.ticker || "ativo")}" autocomplete="off">
      <div class="meta-preco" data-meta></div>
    </td>
    <td class="num" data-rotulo="Peso %">
      <input class="in-peso" data-campo="peso" inputmode="decimal" value="${pesoTexto(a.peso)}" aria-label="Peso em %" autocomplete="off">
    </td>
    <td data-rotulo="Lote">
      <select data-campo="lote" aria-label="Lote">
        <option value="1"${a.lote === 1 ? " selected" : ""} title="ETF, FII">1</option>
        <option value="100"${a.lote === 100 ? " selected" : ""} title="Ação">100</option>
      </select>
    </td>
    <td class="num celula-valor" data-rotulo="Quantidade" data-saida="qtd"></td>
    <td class="num celula-valor" data-rotulo="Financeiro" data-saida="financeiro"></td>
    <td class="num celula-valor" data-rotulo="Custos" data-saida="custos"></td>
    <td class="num celula-valor" data-rotulo="Peso final" data-saida="pesoFinal"></td>
    <td class="celula-remover"><button type="button" class="remover" data-acao="remover" aria-label="Remover ${escapar(a.ticker || "linha")}" title="Remover">×</button></td>`;
}

function renderLinhas() {
  const tbody = $("linhasAtivos");
  tbody.innerHTML = "";
  for (const a of estado.ativos) {
    const tr = document.createElement("tr");
    tr.dataset.id = a.id;
    tr.innerHTML = htmlLinha(a);
    tbody.appendChild(tr);
    renderPreco(a);
  }
}

const linhaDe = (a) => $("linhasAtivos").querySelector(`tr[data-id="${a.id}"]`);
const ativoDe = (el) => estado.ativos.find((a) => a.id === Number(el.closest("tr")?.dataset.id));

/** Atualiza o campo de preço (se não estiver sendo editado) e a linha de fonte/horário. */
function renderPreco(a, { forcarValor = false } = {}) {
  const tr = linhaDe(a);
  if (!tr) return;
  const input = tr.querySelector(".in-preco");
  if (forcarValor || document.activeElement !== input) {
    input.value = numeroOuVazio(a.preco, casasPreco(a.preco));
  }
  input.classList.toggle("manual", a.manual);
  const meta = tr.querySelector("[data-meta]");
  meta.className = "meta-preco";
  meta.title = "";
  if (a.manual) {
    meta.innerHTML = `<button type="button" class="selo-manual" data-acao="automatico" title="Voltar ao preço automático">manual · voltar ao automático</button>`;
  } else if (a.cot?.carregando) {
    meta.textContent = "buscando cotação…";
  } else if (a.cot?.erro) {
    meta.classList.add("erro");
    const motivo = escapar(a.cot.mensagem || "Sem cotação");
    const deToken = a.cot.erro === "SEM_TOKEN" || a.cot.erro === "TOKEN_INVALIDO";
    meta.innerHTML = (deToken
      ? `<button type="button" class="botao-texto" data-acao="configurar">${motivo}</button>`
      : motivo) + " · digite o preço";
    meta.title = a.cot.detalhe ? `${a.cot.mensagem}: ${a.cot.detalhe}` : a.cot.mensagem || "";
  } else if (a.cot?.fonte) {
    meta.textContent = `${a.cot.fonte} · ${quando(a.cot.horario)}`;
  } else {
    meta.textContent = "";
  }
}

const temporizadores = new Map();

function ligarTabela() {
  const tbody = $("linhasAtivos");

  tbody.addEventListener("input", (e) => {
    const a = ativoDe(e.target);
    if (!a) return;
    const campo = e.target.dataset.campo;
    if (campo === "ticker") {
      a.ticker = C.normalizarTicker(e.target.value);
      if (!a.loteTocado) {
        a.lote = C.sugerirLote(a.ticker);
        linhaDe(a).querySelector('[data-campo="lote"]').value = String(a.lote);
      }
      if (!a.manual) { a.preco = null; a.cot = null; renderPreco(a); }
      clearTimeout(temporizadores.get(a.id));
      temporizadores.set(a.id, setTimeout(() => buscarCotacoes([a]), ESPERA_DIGITACAO));
    } else if (campo === "preco") {
      const v = lerCampo(e.target);
      if (v === undefined) return;
      a.preco = v;
      a.manual = v !== null; // apagar o preço devolve ao automático
      renderPreco(a);
      if (!a.manual) buscarCotacoes([a]);
    } else if (campo === "peso") {
      const v = lerCampo(e.target);
      if (v === undefined) return;
      a.peso = v;
    }
    mudou();
  });

  tbody.addEventListener("change", (e) => {
    const a = ativoDe(e.target);
    if (!a) return;
    if (e.target.dataset.campo === "lote") {
      a.lote = Number(e.target.value);
      a.loteTocado = true;
      mudou();
    } else if (e.target.dataset.campo === "ticker") {
      e.target.value = a.ticker;
    }
  });

  tbody.addEventListener("focusout", (e) => {
    const a = ativoDe(e.target);
    if (!a) return;
    if (e.target.dataset.campo === "preco") renderPreco(a, { forcarValor: lerCampo(e.target) !== undefined });
    if (e.target.dataset.campo === "peso" && lerCampo(e.target) !== undefined) e.target.value = pesoTexto(a.peso);
  });

  tbody.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-acao]");
    if (!botao) return;
    if (botao.dataset.acao === "configurar") { abrirConfiguracoes(); return; }
    const a = ativoDe(botao);
    if (!a) return;
    if (botao.dataset.acao === "remover") {
      estado.ativos = estado.ativos.filter((x) => x !== a);
      renderLinhas();
      mudou();
    } else if (botao.dataset.acao === "automatico") {
      a.manual = false;
      buscarCotacoes([a]);
    }
  });

  $("adicionarAtivo").addEventListener("click", () => {
    const a = novoAtivo({ peso: 10 });
    estado.ativos.push(a);
    renderLinhas();
    mudou();
    linhaDe(a).querySelector(".in-ticker").focus();
  });

  $("atualizarPrecos").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try { await buscarCotacoes(estado.ativos, { forcar: true }); } finally { e.currentTarget.disabled = false; }
  });
}

// ---------- cotações ----------

// ---------- configurações (token da brapi) ----------

function renderStatusToken(resultado = null) {
  const tem = Boolean(servico.token);
  const status = $("statusToken");
  status.className = "aviso-token";
  if (resultado === "TOKEN_INVALIDO") {
    status.classList.add("erro");
    status.textContent = "A brapi recusou este token. Confira se copiou o token inteiro.";
  } else if (tem && resultado === "ok") {
    status.classList.add("ok");
    status.textContent = "✓ Token salvo neste navegador e aceito pela brapi.";
  } else if (tem) {
    status.textContent = "Token salvo neste navegador.";
  } else {
    status.textContent = "Nenhum token salvo. Sem ele, quase todos os tickers ficam sem cotação.";
  }
  $("resumoConfig").textContent = tem ? "token da brapi salvo" : "falta o token da brapi";
  $("resumoConfig").classList.toggle("erro", !tem);
  $("apagarToken").hidden = !tem;
}

function abrirConfiguracoes() {
  const bloco = $("blocoConfig");
  bloco.open = true;
  bloco.scrollIntoView({ behavior: "smooth", block: "start" });
  $("tokenBrapi").focus({ preventScroll: true });
}

function ligarConfiguracoes() {
  const campo = $("tokenBrapi");
  campo.value = servico.token;
  if (!servico.token) $("blocoConfig").open = true;
  renderStatusToken();

  let espera = null;
  campo.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      if (campo.value.trim() === servico.token) return;
      servico.token = campo.value;
      renderStatusToken();
      await buscarCotacoes(estado.ativos, { forcar: true });
    }, 500);
  });
  $("mostrarToken").addEventListener("click", (e) => {
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    e.currentTarget.textContent = mostrar ? "ocultar" : "mostrar";
    e.currentTarget.setAttribute("aria-pressed", String(mostrar));
  });
  $("apagarToken").addEventListener("click", async () => {
    servico.token = "";
    campo.value = "";
    renderStatusToken();
    await buscarCotacoes(estado.ativos, { forcar: true });
  });
}

/**
 * Busca na brapi o preço dos ativos indicados que não estão em modo manual.
 * Só aplica a resposta se o ticker da linha ainda for o mesmo pedido.
 */
async function buscarCotacoes(ativos, { forcar = false } = {}) {
  const alvos = ativos.filter((a) => !a.manual && TICKER_OK.test(a.ticker) && estado.ativos.includes(a));
  for (const a of ativos) {
    if (!a.manual && a.ticker && !TICKER_OK.test(a.ticker)) { a.cot = null; renderPreco(a); }
  }
  if (!alvos.length) return;
  const pedidos = new Map(alvos.map((a) => [a, a.ticker]));
  for (const a of alvos) {
    if (forcar || a.preco === null) { a.cot = { ...(a.cot || {}), carregando: true }; renderPreco(a); }
  }
  const tickers = [...new Set(alvos.map((a) => a.ticker))];
  let respostas = {};
  try {
    respostas = await servico.cotacoes(tickers);
  } catch (err) {
    console.warn("Falha ao buscar cotações:", err);
  }
  const erros = new Set();
  for (const a of alvos) {
    if (a.manual || a.ticker !== pedidos.get(a)) continue; // mudou enquanto buscava
    const c = respostas[a.ticker];
    if (c && c.preco > 0) {
      a.preco = c.preco;
      a.cot = { fonte: c.fonte, horario: c.horario };
    } else {
      a.preco = null;
      a.cot = { erro: c?.erro || "RESPOSTA", mensagem: c?.mensagem || "Falha ao buscar cotação", detalhe: c?.detalhe || "" };
      erros.add(a.cot.erro);
      if (c?.detalhe) console.info(`Cotação de ${a.ticker}: ${c.mensagem} (${c.detalhe})`);
    }
    renderPreco(a, { forcarValor: true });
  }
  if (servico.token) renderStatusToken(erros.has("TOKEN_INVALIDO") ? "TOKEN_INVALIDO" : erros.size < alvos.length ? "ok" : null);
  mudou();
}

// ---------- resultado ----------

function calcular() {
  return C.alocar({
    saldo: estado.saldo || 0,
    caixa: estado.caixa || 0,
    modelo: estado.modelo,
    usarSobra: estado.usarSobra,
    params: estado.params,
    ativos: estado.ativos.map(({ id, ticker, preco, peso, lote }) => ({ id, ticker, preco, peso, lote })),
  });
}

function renderResultado(r) {
  const porId = new Map(r.ativos.map((x) => [x.id, x]));
  for (const a of estado.ativos) {
    const tr = linhaDe(a);
    const x = porId.get(a.id);
    if (!tr || !x) continue;
    const saida = (k) => tr.querySelector(`[data-saida="${k}"]`);
    if (!x.valido) {
      for (const k of ["qtd", "financeiro", "custos", "pesoFinal"]) saida(k).textContent = "—";
      continue;
    }
    let qtd = C.formatarNumero(x.qtd, 0);
    if (x.lote === 100 && x.qtd >= 100 && x.qtd % 100) {
      qtd += `<span class="detalhe-qtd">${C.formatarNumero(x.qtd - (x.qtd % 100), 0)} + ${x.qtd % 100}F</span>`;
    } else if (x.lote === 100 && x.qtd > 0 && x.qtd < 100) {
      qtd += `<span class="detalhe-qtd">fracionário</span>`;
    }
    if (x.semSaldo && r.disponivel > 0) qtd += `<span class="aviso-linha">Saldo não cobre 1 cota</span>`;
    saida("qtd").innerHTML = qtd;
    saida("financeiro").textContent = C.brl(x.financeiro);
    saida("custos").textContent = C.brl(x.custos);
    saida("pesoFinal").innerHTML = `${C.percentual(x.pesoFinal)}<span class="detalhe-qtd">alvo ${C.percentual(x.pesoAlvo)}</span>`;
  }

  const somaPesos = estado.ativos.reduce((s, a) => s + (a.peso > 0 ? a.peso : 0), 0);
  $("somaPesos").innerHTML = `${C.formatarNumero(somaPesos, Number.isInteger(somaPesos) ? 0 : 2)}%` +
    (somaPesos > 0 && Math.abs(somaPesos - 100) > 1e-9 ? `<span class="detalhe-qtd">normalizado para 100%</span>` : "");
  $("totalFinanceiro").textContent = C.brl(r.financeiro);
  $("totalCustos").textContent = C.brl(r.custos);

  renderConta(r);
  renderBoletas(r);
}

function renderConta(r) {
  const partes = [
    { classe: "seg-compras", rotulo: "Compras", valor: r.financeiro },
    { classe: "seg-custos", rotulo: "Custos estimados", valor: r.custos },
    { classe: "seg-caixa", rotulo: "Caixa reservado", valor: r.caixaReservado },
    { classe: "seg-sobra", rotulo: "Sobra livre", valor: r.sobraLivre, sinal: true },
  ];
  const base = Math.max(r.saldo, r.gasto + r.caixaReservado, 1);
  $("barraConta").innerHTML = partes
    .map((p) => `<div class="${p.classe}" style="width:${(100 * p.valor) / base}%"></div>`)
    .join("");
  $("barraConta").setAttribute("aria-label",
    partes.map((p) => `${p.rotulo} ${C.brl(p.valor)}`).join(", "));
  $("legendaConta").innerHTML = partes.map((p) => `
    <div>
      <dt><span class="amostra ${p.classe}"></span>${p.rotulo}</dt>
      <dd>${p.sinal && p.valor > 0 ? "+ " : ""}${C.brl(p.valor)}
        <span class="pct">${r.saldo > 0 ? C.percentual(p.valor / r.saldo) : ""}</span></dd>
    </div>`).join("");

  const status = $("statusConta");
  if (r.saldo <= 0) {
    status.textContent = "Informe o saldo disponível para calcular as boletas.";
  } else {
    const fica = Math.max(0, r.contaFicaCom);
    status.innerHTML = `Depois da liquidação, a conta fica com pelo menos <span class="positivo">${C.brl(fica)}</span>`;
  }

  const alerta = $("alertaInvariante");
  if (!r.ok) {
    alerta.hidden = false;
    alerta.textContent = `⚠ Negativo: as compras com custos excedem o disponível em − ${C.brl(r.excedente)}. Não envie estas ordens.`;
    status.textContent = "";
  } else {
    alerta.hidden = true;
  }
}

function renderBoletas(r) {
  $("linhasBoletas").innerHTML = r.ordens.map((o) => `
    <tr>
      <td data-rotulo="Operação">Compra</td>
      <td data-rotulo="Ticker"><strong>${escapar(o.ticker)}</strong></td>
      <td class="num" data-rotulo="Quantidade">${C.formatarNumero(o.qtd, 0)}</td>
      <td class="num" data-rotulo="Preço limite">${C.brl(o.limite)}</td>
      <td class="num" data-rotulo="Financeiro">${C.brl(o.financeiro)}</td>
      <td data-rotulo="Mercado">${o.fracionario ? '<span class="marca-frac">Fracionário</span>' : "Lote padrão"}</td>
    </tr>`).join("");
  $("semBoletas").hidden = r.ordens.length > 0;
  $("copiarBoletas").disabled = r.ordens.length === 0 || !r.ok;
}

async function copiarTexto(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(texto);
      return;
    } catch { /* permissão negada: tenta o método antigo */ }
  }
  // Celular acessando por IP (http) não tem a Clipboard API: usa o método antigo.
  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("cópia bloqueada");
}

let ultimoResultado = null;
let avisoTimer = null;

function ligarBoletas() {
  $("copiarBoletas").addEventListener("click", async () => {
    const texto = C.textoBoletas(ultimoResultado);
    if (!texto) return;
    const aviso = $("avisoCopia");
    try {
      await copiarTexto(texto);
      aviso.textContent = `✓ ${ultimoResultado.ordens.length} boleta(s) copiadas.`;
    } catch {
      aviso.textContent = "Não foi possível copiar automaticamente. Selecione a tabela e copie manualmente.";
    }
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { aviso.textContent = ""; }, 4000);
  });
}

// ---------- ciclo ----------

function mudou() {
  ultimoResultado = calcular();
  renderResultado(ultimoResultado);
  salvar();
}

preencherTopo();
ligarTopo();
renderLinhas();
ligarTabela();
ligarBoletas();
ligarConfiguracoes();
mudou();
buscarCotacoes(estado.ativos);
window.__alocador = { estado, calcular }; // ajuda para depuração no console
