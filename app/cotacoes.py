"""Busca de cotações: brapi.dev como fonte principal, Yahoo Finance como reserva.

- Plano gratuito da brapi: 1 ticker por requisição e 1 requisição simultânea,
  por isso as chamadas à brapi são feitas uma de cada vez.
- Cache em memória de 60 segundos por ticker (inclusive para falhas),
  para não estourar a cota mensal.
- Ticker fracionário (PETR4F) é buscado sem o F (PETR4).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger("alocador.cotacoes")

FUSO_B3 = ZoneInfo("America/Sao_Paulo")
URL_BRAPI = "https://brapi.dev/api/quote/{ticker}"
TICKER_VALIDO = re.compile(r"^[A-Z0-9]{4,12}$")
_FRACIONARIO = re.compile(r"^([A-Z]{4}\d{1,2})F$")


@dataclass
class Cotacao:
    ticker: str
    preco: Optional[float]
    horario: Optional[str]  # ISO 8601 no fuso de São Paulo
    fonte: Optional[str]  # "brapi" ou "yahoo"
    erro: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# Um "fetcher" recebe o ticker base e devolve (preço, horário) ou None.
Resultado = Optional[tuple[float, datetime]]
FetcherYahoo = Callable[[str], Awaitable[Resultado]]


def ticker_base(ticker: str) -> str:
    """PETR4F -> PETR4. Tickers que não seguem o padrão ficam como estão."""
    t = ticker.strip().upper()
    m = _FRACIONARIO.match(t)
    return m.group(1) if m else t


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(FUSO_B3).isoformat(timespec="seconds")


def _preco_valido(p) -> bool:
    try:
        return p is not None and float(p) > 0
    except (TypeError, ValueError):
        return False


class FalhaBrapi(Exception):
    pass


async def buscar_brapi(cliente: httpx.AsyncClient, ticker: str, token: str) -> Resultado:
    """Retorna (preço, horário) ou None se a brapi não tiver o ativo.

    Levanta FalhaBrapi em erro de rede, de autenticação ou de limite.
    """
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        r = await cliente.get(URL_BRAPI.format(ticker=ticker), headers=headers, timeout=8.0)
    except httpx.HTTPError as e:
        raise FalhaBrapi(f"rede: {e.__class__.__name__}") from e

    if r.status_code == 404:
        return None
    if r.status_code != 200:
        codigo = ""
        try:
            codigo = r.json().get("code", "")
        except ValueError:
            pass
        raise FalhaBrapi(f"HTTP {r.status_code} {codigo}".strip())

    try:
        dados = r.json()
    except ValueError as e:
        raise FalhaBrapi("resposta não é JSON") from e

    for item in dados.get("results") or []:
        if str(item.get("symbol", "")).upper() != ticker:
            continue
        preco = item.get("regularMarketPrice")
        if not _preco_valido(preco):
            return None
        horario = _ler_horario(item.get("regularMarketTime"))
        return float(preco), horario
    return None


def _ler_horario(valor) -> datetime:
    """A brapi devolve ISO 8601 ("2026-02-08T16:24:54.000Z"); aceita unix por garantia."""
    agora = datetime.now(timezone.utc)
    if valor is None:
        return agora
    if isinstance(valor, (int, float)):
        return datetime.fromtimestamp(valor, tz=timezone.utc)
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except ValueError:
        return agora


async def buscar_yahoo(ticker: str) -> Resultado:
    """Yahoo Finance via yfinance, com sufixo .SA. Roda em thread (yfinance é síncrono)."""

    def _sync() -> Resultado:
        import yfinance as yf  # importado aqui para os testes não dependerem dele

        ativo = yf.Ticker(f"{ticker}.SA")
        for periodo, intervalo in (("1d", "5m"), ("5d", "1d")):
            try:
                hist = ativo.history(period=periodo, interval=intervalo, auto_adjust=False)
            except Exception as e:  # yfinance levanta vários tipos
                log.info("yahoo %s falhou: %s", ticker, e)
                return None
            if hist is not None and not hist.empty:
                fech = hist["Close"].dropna()
                if fech.empty:
                    continue
                preco = float(fech.iloc[-1])
                if not _preco_valido(preco):
                    return None
                return preco, fech.index[-1].to_pydatetime()
        return None

    return await asyncio.to_thread(_sync)


class ServicoCotacoes:
    def __init__(
        self,
        token: str = "",
        cliente: Optional[httpx.AsyncClient] = None,
        yahoo: FetcherYahoo = buscar_yahoo,
        ttl: float = 60.0,
        relogio: Callable[[], float] = time.monotonic,
    ):
        self.token = token
        self._cliente = cliente
        self._yahoo = yahoo
        self.ttl = ttl
        self._relogio = relogio
        self._cache: dict[str, tuple[float, Cotacao]] = {}
        self._trava_brapi = asyncio.Lock()  # plano gratuito: 1 requisição simultânea
        self._em_andamento: dict[str, asyncio.Task] = {}

    async def fechar(self) -> None:
        if self._cliente is not None:
            await self._cliente.aclose()

    def _get_cliente(self) -> httpx.AsyncClient:
        if self._cliente is None:
            self._cliente = httpx.AsyncClient()
        return self._cliente

    async def cotacoes(self, tickers: list[str]) -> dict[str, dict]:
        pedidos = [t.strip().upper() for t in tickers if t.strip()]
        bases = list(dict.fromkeys(ticker_base(t) for t in pedidos))
        resultados = await asyncio.gather(*(self._cotacao(b) for b in bases))
        por_base = dict(zip(bases, resultados))
        saida = {}
        for t in pedidos:
            c = por_base[ticker_base(t)]
            saida[t] = {**c.to_dict(), "ticker": t}
        return saida

    async def _cotacao(self, base: str) -> Cotacao:
        agora = self._relogio()
        em_cache = self._cache.get(base)
        if em_cache and agora - em_cache[0] < self.ttl:
            return em_cache[1]
        # Junta pedidos simultâneos do mesmo ticker numa única busca.
        tarefa = self._em_andamento.get(base)
        if tarefa is None:
            tarefa = asyncio.ensure_future(self._buscar(base))
            self._em_andamento[base] = tarefa
            tarefa.add_done_callback(lambda _t, b=base: self._em_andamento.pop(b, None))
        c = await tarefa
        self._cache[base] = (self._relogio(), c)
        return c

    async def _buscar(self, base: str) -> Cotacao:
        if not TICKER_VALIDO.match(base):
            return Cotacao(base, None, None, None, "Ticker inválido")

        try:
            async with self._trava_brapi:
                r = await buscar_brapi(self._get_cliente(), base, self.token)
            if r:
                return Cotacao(base, r[0], _iso(r[1]), "brapi")
            log.info("brapi sem dados para %s, tentando Yahoo", base)
        except FalhaBrapi as e:
            log.info("brapi falhou para %s (%s), tentando Yahoo", base, e)

        try:
            r = await self._yahoo(base)
        except Exception as e:
            log.info("yahoo falhou para %s: %s", base, e)
            r = None
        if r:
            return Cotacao(base, r[0], _iso(r[1]), "yahoo")
        return Cotacao(base, None, None, None, "Sem cotação nas fontes disponíveis")
