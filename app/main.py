"""Servidor do Alocador: API de cotações e a página única."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from . import config
from .cotacoes import TICKER_VALIDO, ServicoCotacoes

MAX_TICKERS = 30
_EXTENSOES = {".woff2": "woff2", ".woff": "woff", ".otf": "opentype", ".ttf": "truetype"}


def fontes_css() -> str:
    """Gera @font-face para Roundkey/Knockout se os arquivos estiverem em fonts/."""
    arquivos = []
    if config.PASTA_FONTES.is_dir():
        arquivos = [f for f in config.PASTA_FONTES.iterdir() if f.suffix.lower() in _EXTENSOES]
    css, presentes = [], []
    for familia in ("Roundkey", "Knockout"):
        achados = sorted(
            (f for f in arquivos if familia.lower() in f.name.lower()),
            key=lambda f: list(_EXTENSOES).index(f.suffix.lower()),
        )
        if not achados:
            continue
        srcs = ", ".join(
            f'url("/fonts/{f.name}") format("{_EXTENSOES[f.suffix.lower()]}")' for f in achados
        )
        css.append(
            f'@font-face {{ font-family: "{familia}"; src: {srcs}; font-display: swap; }}'
        )
        presentes.append(familia)
    if presentes:  # Roundkey tem preferência; Knockout só se não houver Roundkey
        css.append(f':root {{ --fonte-titulo-secao: "{presentes[0]}", "Barlow", Arial, sans-serif; }}')
    return "\n".join(css) + "\n"


def create_app(servico: Optional[ServicoCotacoes] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.servico is None:
            app.state.servico = ServicoCotacoes(token=config.brapi_token())
        yield
        await app.state.servico.fechar()

    app = FastAPI(title="Alocador", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.servico = servico

    @app.get("/api/cotacoes")
    async def cotacoes(tickers: str = Query("", description="Lista separada por vírgula")):
        lista = [t.strip().upper() for t in tickers.split(",") if t.strip()]
        lista = list(dict.fromkeys(lista))
        if not lista:
            raise HTTPException(400, "Informe ao menos um ticker em ?tickers=")
        if len(lista) > MAX_TICKERS:
            raise HTTPException(400, f"No máximo {MAX_TICKERS} tickers por chamada")
        invalidos = [t for t in lista if not TICKER_VALIDO.match(t)]
        if invalidos:
            raise HTTPException(400, f"Ticker inválido: {', '.join(invalidos)}")
        dados = await app.state.servico.cotacoes(lista)
        return {"cotacoes": dados}

    @app.get("/fontes.css")
    async def fontes():
        return Response(fontes_css(), media_type="text/css", headers={"Cache-Control": "no-cache"})

    config.PASTA_FONTES.mkdir(exist_ok=True)
    app.mount("/fonts", StaticFiles(directory=config.PASTA_FONTES), name="fonts")
    app.mount("/", StaticFiles(directory=config.PASTA_STATIC, html=True), name="static")
    return app


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = create_app()
