# Análise Financeira

Site que lê o mercado brasileiro e se atualiza sozinho: previsão de tendência do Ibovespa e de 38 ações, leitura das notícias, buscador de renda fixa por plataforma e montagem de carteira com o percentual de cada aplicação.

## Abas

| Aba | O que faz |
|---|---|
| **Painel** | Previsão do Ibovespa para 4 semanas (Venda forte → Compra forte) com os componentes e o acerto histórico, humor das notícias por dia, setores e ações com sinal mais forte. |
| **Monte sua carteira → Montar do zero** | Valor, prazo, perfil, plataforma, reserva, teto por ação e objetivo (equilibrado, dividendos ou trade com stop/alvo) → onde aplicar cada percentual, com checagem de risco. Salva em JSON. |
| **Monte sua carteira → Analisar minha carteira** | Importa vários arquivos de bancos diferentes (extrato de conta da XP em PDF, extrato de posição da B3 em .xlsx, CSV de corretora, PDF do IR, carteira salva .json). Avalia cada investimento (indo bem, manter, abaixo do CDI, avaliar saída), dá nota à carteira contra o perfil, mostra renda passiva e custos, onde colocar um novo aporte e a projeção no prazo. A carteira salva em JSON pode ser reaberta depois para comparar com o mercado de hoje. Análise opcional com o Claude usando a chave do próprio usuário. |
| **Buscador de renda fixa** | Filtra por valor, prazo, plataforma, produto, indexador, isenção, FGC e liquidez. Ordena por qualquer coluna (líquido a.a., taxa, prazo, mínimo…). Mostra a melhor oferta de cada plataforma. |
| **Ações** | Tabela ordenável com retorno, IFR, volatilidade, sinal técnico, humor das notícias, previsão e acerto histórico. Clique numa ação para ver o gráfico e os votos dos indicadores. |
| **Notícias** | Manchetes de 7 dias com filtros por tema, ação e tom, e a tendência que elas indicam. |
| **Juros e câmbio** | Selic, IPCA, dólar e Ibovespa com as projeções do Boletim Focus. |

## Como se atualiza

- **No navegador, ao vivo:** Selic, CDI, IPCA, dólar e Focus vêm do Banco Central a cada carregamento (e a cada 30 min com a página aberta).
- **GitHub Actions** ([.github/workflows/atualizar.yml](.github/workflows/atualizar.yml)): a cada 30 min no pregão e a cada 2 h fora dele, roda `atualizar_dados.py` (Yahoo Finance + InfoMoney + Google Notícias), gera o `dados.js` e publica o site no GitHub Pages. A página aberta recarrega o `dados.js` a cada 10 min.
- Se uma fonte falhar, o script mantém os dados da coleta anterior.
- Opcional: crie o segredo `BRAPI_TOKEN` (token gratuito em brapi.dev) no repositório para ter uma segunda fonte de cotações caso o Yahoo bloqueie o GitHub.

## Ofertas de renda fixa

XP, BTG e as demais plataformas não publicam a prateleira em API aberta (exige login). As ofertas ficam em [ofertas.js](ofertas.js), com taxas de **referência**. Para atualizar para todos: edite o arquivo no GitHub (lápis → salvar); o site republica em ~1 minuto. Para atualizar só no seu navegador: aba Buscador → Gerenciar ofertas.

## Método

- **Sinal técnico** (no estilo do resumo do TradingView): MM10/20/30/50/100/200, IFR 14, estocástico 14, histograma do MACD e momento de 10 dias votam compra/neutro/venda.
- **Previsão de ação** = 70% técnico + 15% notícias da ação + 15% força do setor. **Previsão do Ibovespa** = técnico do índice, amplitude (ações em alta × baixa), notícias, direção dos juros e dólar.
- **Acerto histórico**: o sinal técnico é recalculado em cada pregão dos últimos 2 anos e comparado com o retorno das 4 semanas seguintes, ao lado da referência "sempre alta".
- **Carteira**: método das skills trader-budget (teto por ativo com redistribuição, descarte de fatias abaixo de R$ 100, arredondamento), trader-risk (FGC por emissor, teto, prazo, mínimo, reserva) e trader-rebalance (revisar quando uma classe desviar mais de 5 pontos).
- **Renda fixa**: IR regressivo, isenção de LCI/LCA/CRA/CRI/debênture incentivada, custódia do Tesouro, carência mínima de LCI (12 m) e LCA (9 m), CDI e IPCA futuros pela curva do Focus.

## Privacidade

Extratos e carteiras são lidos **só no navegador** e guardados no `localStorage`; nada vai para servidor. O `.gitignore` bloqueia `*.pdf`, `*.xlsx`, `*.csv` e `extrato*` para que documentos pessoais nunca entrem no repositório. Os testes usam extratos fictícios.

## Testes

```bash
npm install
npm test        # Jest: leitura de extratos (XP, B3, IR) e cálculos (IR, dimensionamento, aporte)
```
O GitHub Actions roda os testes antes de cada publicação; se algum falhar, o site não é atualizado.

## Rodar localmente

```bash
python atualizar_dados.py   # gera dados.js
```
Depois abra `index.html` no navegador.

Ferramenta de estudo — não é recomendação de investimento.
