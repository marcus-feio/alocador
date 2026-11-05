"""Testes da API de cotações, sem rede: brapi simulada com httpx.MockTransport
e Yahoo substituído por uma função falsa."""

import asyncio
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from app.cotacoes import ServicoCotacoes, ticker_base

PRECOS_BRAPI = {"PETR4": 36.65, "LFTB11": 107.03}
HORA_BRAPI = "2026-11-05T17:32:10.000Z"  # 14:32:10 em São Paulo
PRECOS_YAHOO = {"B5P211": 82.10, "PREX11": 11.25, "PETR4": 99.0}


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def brapi_falsa(precos=PRECOS_BRAPI, status=None, chamadas=None, atraso=0.0, contador=None):
    async def handler(req: httpx.Request) -> httpx.Response:
        ticker = req.url.path.rsplit("/", 1)[-1]
        if chamadas is not None:
            chamadas.append((ticker, req.headers.get("authorization")))
        if contador is not None:
            contador["agora"] += 1
            contador["max"] = max(contador["max"], contador["agora"])
        try:
            if atraso:
                await asyncio.sleep(atraso)
            if status:
                return httpx.Response(status, json={"error": True, "code": "X"})
            if ticker not in precos:
                return httpx.Response(404, json={"error": True, "code": "NOT_FOUND"})
            return httpx.Response(200, json={"results": [{
                "symbol": ticker, "regularMarketPrice": precos[ticker],
                "regularMarketTime": HORA_BRAPI}]})
        finally:
            if contador is not None:
                contador["agora"] -= 1

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def yahoo_falso(precos=PRECOS_YAHOO, chamadas=None):
    async def buscar(ticker):
        if chamadas is not None:
            chamadas.append(ticker)
        if ticker in precos:
            return precos[ticker], datetime(2026, 11, 5, 17, 40, tzinfo=timezone.utc)
        return None

    return buscar


def cliente_api(servico):
    return TestClient(main.create_app(servico))


def get(servico, tickers):
    with cliente_api(servico) as c:
        r = c.get("/api/cotacoes", params={"tickers": tickers})
    assert r.status_code == 200, r.text
    return r.json()["cotacoes"]


def test_brapi_principal_com_horario_de_sao_paulo():
    chamadas = []
    s = ServicoCotacoes("tok", brapi_falsa(chamadas=chamadas), yahoo_falso())
    d = get(s, "PETR4")["PETR4"]
    assert d == {"ticker": "PETR4", "preco": 36.65, "horario": "2026-11-05T14:32:10-03:00",
                 "fonte": "brapi", "erro": None}
    assert chamadas == [("PETR4", "Bearer tok")]


def test_sem_token_nao_envia_header():
    chamadas = []
    s = ServicoCotacoes("", brapi_falsa(chamadas=chamadas), yahoo_falso())
    get(s, "PETR4")
    assert chamadas == [("PETR4", None)]


def test_fallback_yahoo_quando_brapi_nao_tem_ticker():
    yah = []
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso(chamadas=yah))
    d = get(s, "LFTB11,B5P211")
    assert d["LFTB11"]["fonte"] == "brapi"
    assert d["B5P211"]["fonte"] == "yahoo"
    assert d["B5P211"]["preco"] == 82.10
    assert d["B5P211"]["horario"] == "2026-11-05T14:40:00-03:00"
    assert yah == ["B5P211"]


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_fallback_yahoo_quando_brapi_falha(status):
    s = ServicoCotacoes("tok", brapi_falsa(status=status), yahoo_falso())
    d = get(s, "PETR4")["PETR4"]
    assert d["fonte"] == "yahoo" and d["preco"] == 99.0


def test_fallback_yahoo_em_erro_de_rede():
    def handler(req):
        raise httpx.ConnectError("sem rede")

    s = ServicoCotacoes("tok", httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                        yahoo_falso())
    assert get(s, "PREX11")["PREX11"]["fonte"] == "yahoo"


def test_brapi_com_preco_nulo_cai_no_yahoo():
    s = ServicoCotacoes("tok", brapi_falsa(precos={"PETR4": None}), yahoo_falso())
    assert get(s, "PETR4")["PETR4"]["fonte"] == "yahoo"


def test_sem_cotacao_em_nenhuma_fonte_traz_erro_e_nao_afeta_outros():
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso())
    d = get(s, "XPTO11,PETR4")
    assert d["XPTO11"]["preco"] is None
    assert d["XPTO11"]["fonte"] is None
    assert d["XPTO11"]["erro"]
    assert d["PETR4"]["preco"] == 36.65


def test_yahoo_que_levanta_excecao_vira_erro():
    async def quebra(t):
        raise RuntimeError("boom")

    s = ServicoCotacoes("tok", brapi_falsa(precos={}), quebra)
    assert get(s, "PETR4")["PETR4"]["erro"]


def test_fracionario_busca_sem_f():
    chamadas = []
    s = ServicoCotacoes("tok", brapi_falsa(chamadas=chamadas), yahoo_falso())
    d = get(s, "PETR4F,PETR4")
    assert d["PETR4F"]["ticker"] == "PETR4F"
    assert d["PETR4F"]["preco"] == d["PETR4"]["preco"] == 36.65
    assert [c[0] for c in chamadas] == ["PETR4"]  # uma busca só


@pytest.mark.parametrize("entrada,base", [
    ("PETR4F", "PETR4"), ("petr4f", "PETR4"), ("TAEE11F", "TAEE11"),
    ("PETR4", "PETR4"), ("LFTB11", "LFTB11"), ("ABCDF", "ABCDF")])
def test_ticker_base(entrada, base):
    assert ticker_base(entrada) == base


def test_cache_de_60_segundos():
    chamadas, relogio = [], Relogio()
    s = ServicoCotacoes("tok", brapi_falsa(chamadas=chamadas), yahoo_falso(), relogio=relogio)
    with cliente_api(s) as c:
        c.get("/api/cotacoes?tickers=PETR4")
        relogio.t += 59
        c.get("/api/cotacoes?tickers=PETR4")
        assert len(chamadas) == 1
        relogio.t += 2
        c.get("/api/cotacoes?tickers=PETR4")
        assert len(chamadas) == 2


def test_cache_tambem_guarda_falhas():
    yah, relogio = [], Relogio()
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso(chamadas=yah), relogio=relogio)
    with cliente_api(s) as c:
        c.get("/api/cotacoes?tickers=NADA11")
        c.get("/api/cotacoes?tickers=NADA11")
    assert yah == ["NADA11"]


def test_brapi_uma_requisicao_por_vez():
    contador = {"agora": 0, "max": 0}
    s = ServicoCotacoes("tok", brapi_falsa(atraso=0.02, contador=contador), yahoo_falso())
    d = get(s, "PETR4,LFTB11")
    assert d["PETR4"]["fonte"] == d["LFTB11"]["fonte"] == "brapi"
    assert contador["max"] == 1


@pytest.mark.parametrize("q", ["", "PETR4,../../x", "PE", "PETR4;DROP"])
def test_parametros_invalidos(q):
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso())
    with cliente_api(s) as c:
        assert c.get("/api/cotacoes", params={"tickers": q}).status_code == 400


def test_limite_de_tickers():
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso())
    with cliente_api(s) as c:
        q = ",".join(f"AAAA{i}" for i in range(31))
        assert c.get("/api/cotacoes", params={"tickers": q}).status_code == 400


def test_pagina_principal_e_servida():
    s = ServicoCotacoes("tok", brapi_falsa(), yahoo_falso())
    with cliente_api(s) as c:
        r = c.get("/")
    assert r.status_code == 200
    assert "Alocador" in r.text


def test_fontes_css(tmp_path, monkeypatch):
    monkeypatch.setattr(main.config, "PASTA_FONTES", tmp_path)
    assert "font-face" not in main.fontes_css()
    (tmp_path / "Knockout-HTF48.otf").write_bytes(b"x")
    css = main.fontes_css()
    assert '"Knockout"' in css and '--fonte-titulo-secao: "Knockout"' in css
    (tmp_path / "Roundkey-Regular.woff2").write_bytes(b"x")
    css = main.fontes_css()
    assert '--fonte-titulo-secao: "Roundkey"' in css
    assert 'url("/fonts/Roundkey-Regular.woff2") format("woff2")' in css
