"""python -m app  →  sobe o servidor e abre o navegador."""

import os
import socket
import threading
import webbrowser

import uvicorn

from . import config


def ip_local() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # não envia nada, só escolhe a interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main() -> None:
    porta = config.porta()
    url = f"http://localhost:{porta}"
    print(f"\n  Alocador rodando em {url}")
    print(f"  No celular (mesma rede Wi-Fi): http://{ip_local()}:{porta}")
    if not config.brapi_token():
        print("  Aviso: BRAPI_TOKEN vazio no .env. A brapi só responde alguns tickers sem token;")
        print("         os demais virão do Yahoo Finance.")
    print("  Para parar, feche esta janela ou aperte Ctrl+C.\n")
    if os.getenv("ALOCADOR_NAO_ABRIR") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="0.0.0.0", port=porta, log_level="warning")


if __name__ == "__main__":
    main()
