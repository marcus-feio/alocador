# Alocador

Calculadora de boletas de compra de ações e ETFs da B3. A quantidade de cada ordem cabe no saldo já com corretagem, taxas e margem de segurança. As cotações são buscadas automaticamente, com atraso de 15 a 30 minutos.

## Instalar e rodar

Você precisa do **Python 3.10 ou mais novo** ([python.org/downloads](https://www.python.org/downloads/)).

- **Windows:** dê dois cliques em `run.bat`.
- **macOS/Linux:** no terminal, rode `./run.sh` (na primeira vez, `chmod +x run.sh`).

Na primeira execução, o script cria o ambiente virtual e instala as dependências, o que leva alguns minutos. Depois ele abre `http://localhost:8000`. Para parar o Alocador, feche a janela do terminal ou aperte `Ctrl+C`.

O ambiente virtual fica fora da pasta do projeto, para não sincronizar milhares de arquivos com o OneDrive:

- Windows: `%LOCALAPPDATA%\Alocador\venv`
- macOS/Linux: `~/.local/share/alocador/venv`

Se der algum problema, apague essa pasta e rode o script de novo.

### No celular

Com o celular na mesma rede Wi-Fi, abra o endereço que o terminal mostra (por exemplo `http://192.168.0.10:8000`). Na primeira execução, o Windows pergunta se libera o Python no firewall. Libere só para **redes privadas**.

## Token da brapi

1. Crie uma conta gratuita em [brapi.dev](https://brapi.dev) e copie o token no painel.
2. Abra o arquivo `.env` na pasta do projeto. Se ele não existir, rode o script uma vez ou copie `.env.example` para `.env`.
3. Preencha a linha `BRAPI_TOKEN=seu_token_aqui` e reinicie o Alocador.

O `.env` não vai para o git.

O plano gratuito da brapi permite **1 ticker por requisição**, **1 requisição por vez** e **15.000 requisições por mês**, com dados atualizados a cada 30 minutos. O Alocador guarda cada cotação por 60 segundos para economizar a cota. Quando a brapi falha ou não tem o ticker, o Alocador busca no **Yahoo Finance** (`TICKER.SA`). Sem token, a brapi só responde alguns tickers de teste (como PETR4) e o resto vem do Yahoo.

## Uso

- Ao digitar um ticker, o preço é preenchido sozinho. O botão **Atualizar preços** busca de novo todos os preços.
- Ao lado do preço aparecem a fonte e o horário da cotação (por exemplo, "brapi · 14:32").
- Se você digitar um preço, ele vira **manual** e não é sobrescrito. Para voltar ao preço automático, clique no selo "manual" ou apague o campo.
- Para ações (lote 100), a quantidade é dividida entre o lote padrão e o fracionário (ticker + F), e cada ordem paga a própria corretagem.
- Parâmetros, modelo de cobrança, saldo e ativos ficam salvos no navegador.

## Fontes

Para usar a fonte **Roundkey** (ou **Knockout**) nos títulos de seção, coloque os arquivos `.woff2`, `.woff`, `.otf` ou `.ttf` na pasta `fonts/` e recarregue a página. O nome do arquivo precisa conter "roundkey" ou "knockout". Sem esses arquivos, a página usa só Barlow.

## Testes

```bash
# backend (com o ambiente virtual ativo)
python -m pytest

# lógica de cálculo (Node 18+, sem dependências)
npm test
```
