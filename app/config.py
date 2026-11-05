"""Configuração lida do arquivo .env na raiz do projeto."""

import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
PASTA_STATIC = RAIZ / "static"
PASTA_FONTES = RAIZ / "fonts"

load_dotenv(RAIZ / ".env")


def brapi_token() -> str:
    return os.getenv("BRAPI_TOKEN", "").strip()


def porta() -> int:
    try:
        return int(os.getenv("ALOCADOR_PORTA", "8000"))
    except ValueError:
        return 8000
