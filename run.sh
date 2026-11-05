#!/usr/bin/env bash
# Cria o ambiente virtual, instala as dependências e abre o Alocador.
set -euo pipefail
cd "$(dirname "$0")"

# Ambiente virtual fora da pasta do projeto (evita sincronizar com nuvem).
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/alocador/venv"

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "Python 3.10+ não encontrado. Instale em https://www.python.org/downloads/" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "Criando ambiente virtual em $VENV ..."
  mkdir -p "$(dirname "$VENV")"
  "$PY" -m venv "$VENV"
fi

echo "Conferindo dependências..."
"$VENV/bin/python" -m pip install -q --disable-pip-version-check -r requirements.txt

[ -f .env ] || cp .env.example .env

exec "$VENV/bin/python" -m app
