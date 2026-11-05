# Alocador

Calculadora de boletas de compra de ações e ETFs da B3. A quantidade de cada ordem cabe no saldo já com corretagem, taxas e margem de segurança. As cotações vêm da [brapi.dev](https://brapi.dev), com atraso de 15 a 30 minutos.

É um site estático: roda inteiro no navegador, sem servidor próprio. Está publicado no GitHub Pages e abre em qualquer navegador, inclusive no celular.

## Token da brapi

O token **não** fica no código nem no repositório. Cada pessoa cola o seu na própria tela:

1. Crie uma conta gratuita em [brapi.dev](https://brapi.dev) e copie o token no [painel](https://brapi.dev/dashboard).
2. Abra o Alocador, expanda **Configurações** e cole o token em **Token da brapi**.

O token fica salvo só no `localStorage` daquele navegador e só é enviado para a brapi. Em outro aparelho ou navegador, cole de novo. O botão **Apagar token deste navegador** remove o token.

O plano gratuito da brapi permite **1 ticker por requisição**, **1 requisição por vez** e **15.000 requisições por mês**. O Alocador faz as chamadas em fila e guarda cada cotação por 60 segundos para economizar a cota. Sem token, a brapi só responde alguns tickers de teste, como PETR4.

## Quando não há cotação

Embaixo do preço aparece o motivo. Passe o mouse para ver o detalhe que a brapi mandou.

| Mensagem | O que fazer |
| --- | --- |
| Token da brapi ausente | Cole o token em Configurações (clique na mensagem). |
| Token da brapi inválido | Copie o token de novo no painel da brapi. |
| Ticker não encontrado | Confira o ticker. |
| Limite da brapi atingido | Espere um pouco ou confira a cota no painel da brapi. |
| Ticker fora do seu plano da brapi | O plano não cobre esse ativo. Digite o preço. |
| brapi fora do ar / brapi não respondeu | Tente de novo em alguns minutos ou digite o preço. |
| Sem internet | Confira a conexão. |

Em todos os casos dá para digitar o preço à mão.

## Uso

- Ao digitar um ticker, o preço é preenchido sozinho. O botão **Atualizar preços** busca de novo todos os preços.
- Ao lado do preço aparecem a fonte e o horário da cotação (por exemplo, "brapi · 14:32").
- Se você digitar um preço, ele vira **manual** e não é sobrescrito. Para voltar ao preço automático, clique no selo "manual" ou apague o campo.
- Para ações (lote 100), a quantidade é dividida entre o lote padrão e o fracionário (ticker + F), e cada ordem paga a própria corretagem.
- Parâmetros, modelo de cobrança, saldo e ativos ficam salvos no navegador.

## Fontes

Os títulos de seção usam **Roundkey** (ou **Knockout**) se a fonte estiver instalada no computador. Senão, a página usa Barlow. Os arquivos dessas fontes não vão para o repositório.

## Rodar no computador

Não abra o `index.html` com dois cliques: o navegador bloqueia os scripts de arquivos abertos do disco (`file://`), e nenhum botão funciona. A página mostra um aviso quando isso acontece.

- **Windows:** dê dois cliques em `abrir.bat`. Ele serve a pasta `static` em `http://localhost:8000` e abre o navegador. Precisa do Python 3, usado só como servidor de arquivos.
- **Qualquer sistema:** rode um servidor de arquivos na pasta `static`, por exemplo `python3 -m http.server -d static` ou `npx serve static`.

## Testes

```bash
npm test
```

Node 18 ou mais novo, sem dependências. A publicação no GitHub Pages (`.github/workflows/pages.yml`) só acontece se os testes passarem.
