"""Busca notícias, Ibovespa, dólar e ações por setor e grava dados.js para o index.html.

O navegador não consegue ler Yahoo Finance nem feeds de notícia direto de um arquivo
local (CORS), então este script faz a coleta e entrega tudo num arquivo que a página
carrega com <script src="dados.js">. Só usa a biblioteca padrão do Python.

No GitHub, o workflow .github/workflows/atualizar.yml roda este script sozinho
(a cada 30 min no pregão) e publica o dados.js novo no GitHub Pages.

Uso local:  python atualizar_dados.py
Variável opcional BRAPI_TOKEN: usa brapi.dev quando o Yahoo recusar (comum em servidores).
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

PASTA = Path(__file__).resolve().parent
SAIDA = PASTA / "dados.js"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnaliseFinanceira/1.0"}

# setores da B3 e ações representativas (ajuste à vontade)
SETORES = {
    "Bancos": ["ITUB4", "BBDC4", "BBAS3", "BPAC11", "SANB11"],
    "Petróleo e gás": ["PETR4", "PRIO3", "BRAV3"],
    "Mineração e siderurgia": ["VALE3", "GGBR4", "CSNA3"],
    "Energia elétrica": ["AXIA3", "EGIE3", "TAEE11", "CPLE3"],
    "Saneamento": ["SBSP3", "CSMG3"],
    "Varejo": ["MGLU3", "LREN3", "ASAI3"],
    "Construção civil": ["CYRE3", "MRVE3", "DIRR3"],
    "Indústria": ["WEGE3", "EMBJ3", "RAIL3"],
    "Saúde": ["RDOR3", "HAPV3", "RADL3"],
    "Consumo e alimentos": ["ABEV3", "MBRF3", "JBSS32"],
    "Agro e papel": ["SUZB3", "KLBN11", "SLCE3"],
    "Telecom e tecnologia": ["VIVT3", "TIMS3", "TOTS3"],
}
# ações que também recebem busca de notícias individual
CARTEIRA_NOTICIAS = ["PETR4", "VALE3", "ITUB4", "MGLU3", "WEGE3", "BBAS3", "AXIA3", "BBDC4"]

FEEDS = [
    ("InfoMoney", "https://www.infomoney.com.br/feed/", "Mercado"),
]
BUSCAS = [
    ("Ibovespa bolsa hoje", "Mercado"),
    ("Copom Selic juros", "Juros"),
    ("LCI LCA CDB renda fixa taxas", "Renda fixa"),
    ("Tesouro Direto taxas", "Renda fixa"),
    ("dólar câmbio real", "Câmbio"),
    ("IPCA inflação", "Inflação"),
]

# itens fora do assunto que alguns feeds gerais trazem
IGNORAR = re.compile(r"mega.?sena|loteria|lotof[aá]cil|quina|\+milion[aá]ria|dupla sena|timemania|hor[oó]scopo", re.I)

POSITIVAS = """alta sobe subiu sobem salta saltam saltou disparada valorizou dispara disparam avança avançam avanço ganho ganhos lucro
lucros recorde recordes supera superou cresce cresceu crescimento valoriza valorização
compra recomenda otimismo otimista positivo positiva melhora melhor forte aprova aprovado
dividendos proventos expansão retomada salto impulsiona eleva elevação upgrade alívio""".split()
NEGATIVAS = """queda cai caiu caem despenca despencam recua recuam recuo perda perdas prejuízo
prejuízos rombo rebaixa rebaixamento pessimismo negativo negativa piora pior fraco fraca
crise risco riscos alerta tombo derrete desvaloriza venda vendas multa investigação
fraude dívida calote recuperação-judicial demissões pressão incerteza tensão""".split()
# palavras que dependem de contexto: "corte de juros" é bom para bolsa, "alta da Selic" não
REGRAS_FRASE = [
    (r"alta (da|na|de) (selic|juros|inflação|dólar)", -2),
    (r"(corte|queda|redução) (da|na|de|dos) (selic|juros)", +2),
    (r"infla[çc][ãa]o(\s+\S+){0,3}\s+(sobe|acelera|dispara)", -2),
    (r"infla[çc][ãa]o(\s+\S+){0,3}\s+(cai|desacelera|recua|menor)", +2),
    (r"lidera (perdas|quedas)", -1),
]


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def sentimento(texto):
    t = texto.lower()
    pal = re.findall(r"[a-zà-ú\-]+", t)
    s = sum(p in POSITIVAS for p in pal) - sum(p in NEGATIVAS for p in pal)
    for padrao, peso in REGRAS_FRASE:
        if re.search(padrao, t):
            s += peso
    return max(-3, min(3, s))


TODOS_TICKERS = sorted({t for ts in SETORES.values() for t in ts})


def tickers_citados(texto):
    up = texto.upper()
    return [t for t in TODOS_TICKERS if re.search(rf"\b{t}\b", up)]


def ler_rss(url, fonte_padrao, categoria, limite=15):
    raiz = ET.fromstring(get(url))
    itens = []
    for it in list(raiz.iter("item"))[:limite]:
        titulo = (it.findtext("title") or "").strip()
        fonte = it.findtext("source") or fonte_padrao
        # Google Notícias põe " - Fonte" no fim do título
        if fonte and titulo.endswith(" - " + fonte):
            titulo = titulo[: -len(fonte) - 3]
        try:
            quando = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            quando = None
        itens.append({
            "titulo": titulo,
            "link": it.findtext("link"),
            "fonte": fonte,
            "data": quando,
            "categoria": categoria,
        })
    return itens


def google_news(q, categoria):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q + " when:7d", "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"})
    return ler_rss(url, "Google Notícias", categoria, limite=12)


def yahoo(simbolo, faixa="6mo"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(simbolo)}?range={faixa}&interval=1d"
    r = json.loads(get(url))["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    serie = [(ts, c) for ts, c in zip(r["timestamp"], q["close"]) if c is not None]
    m = r["meta"]
    return {
        "nome": m.get("longName") or m.get("shortName"),
        "preco": m.get("regularMarketPrice"),
        "anterior": m.get("chartPreviousClose") if faixa == "1d" else (serie[-2][1] if len(serie) > 1 else None),
        "max52": m.get("fiftyTwoWeekHigh"),
        "min52": m.get("fiftyTwoWeekLow"),
        "t": [ts for ts, _ in serie],
        "c": [round(c, 4 if c < 20 else 2) for _, c in serie],
    }


def brapi(ticker):
    """Reserva para quando o Yahoo bloquear o IP (precisa de BRAPI_TOKEN)."""
    token = os.environ.get("BRAPI_TOKEN")
    if not token:
        raise RuntimeError("Yahoo falhou e não há BRAPI_TOKEN")
    url = f"https://brapi.dev/api/quote/{urllib.parse.quote(ticker)}?range=2y&interval=1d&token={token}"
    r = json.loads(get(url))["results"][0]
    h = [x for x in r.get("historicalDataPrice", []) if x.get("close") is not None]
    return {
        "nome": r.get("longName"), "preco": r.get("regularMarketPrice"), "anterior": r.get("regularMarketPreviousClose"),
        "max52": r.get("fiftyTwoWeekHigh"), "min52": r.get("fiftyTwoWeekLow"), "pl": r.get("priceEarnings"),
        "t": [x["date"] for x in h], "c": [round(x["close"], 2) for x in h],
    }


def acao(ticker):
    try:
        return yahoo(ticker + ".SA", "2y")
    except Exception:  # noqa: BLE001
        return brapi(ticker)


def ler_anterior():
    try:
        txt = SAIDA.read_text(encoding="utf-8")
        return json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except (OSError, ValueError):
        return {}


def main():
    log = []
    dados = {"geradoEm": datetime.now(timezone.utc).isoformat(), "noticias": [], "indices": {}, "acoes": {}, "setores": SETORES, "erros": log}

    # tudo em paralelo: ~50 requisições levam poucos segundos em vez de ~1 minuto
    tarefas = {}
    for chave, simb in [("ibov", "^BVSP"), ("dolar", "BRL=X"), ("sp500", "^GSPC")]:
        tarefas[("indice", chave, simb)] = (yahoo, simb, "2y" if chave == "ibov" else "1y")
    for t in TODOS_TICKERS:
        tarefas[("acao", t, t)] = (acao, t)
    for fonte, url, cat in FEEDS:
        tarefas[("feed", fonte, url)] = (ler_rss, url, fonte, cat)
    for q, cat in BUSCAS:
        tarefas[("busca", q, q)] = (google_news, q, cat)
    for t in CARTEIRA_NOTICIAS:
        tarefas[("noticia", t, t)] = (google_news, t, "Ações")

    brutas = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futuros = {pool.submit(f[0], *f[1:]): k for k, f in tarefas.items()}
        for fut in as_completed(futuros):
            tipo, chave, rotulo = futuros[fut]
            try:
                r = fut.result()
            except Exception as e:  # noqa: BLE001 - segue com o que der
                log.append(f"{rotulo}: {e}")
                print(f"  ERRO {rotulo}: {e}")
                continue
            if tipo == "indice":
                dados["indices"][chave] = r
            elif tipo == "acao":
                dados["acoes"][chave] = r
            else:
                if tipo == "noticia":
                    for n in r:
                        n["ticker"] = chave
                brutas += r
    print(f"  {len(dados['acoes'])} ações, {len(dados['indices'])} índices")

    vistos = set()
    for n in brutas:
        chave = re.sub(r"\W+", "", n["titulo"].lower())[:80]
        if not n["titulo"] or chave in vistos or IGNORAR.search(n["titulo"]):
            continue
        vistos.add(chave)
        n["sent"] = sentimento(n["titulo"])
        cit = set(tickers_citados(n["titulo"]))
        if n.get("ticker"):
            cit.add(n.pop("ticker"))
        n["tickers"] = sorted(cit)
        dados["noticias"].append(n)
    dados["noticias"].sort(key=lambda n: n["data"] or "", reverse=True)
    print(f"  {len(dados['noticias'])} notícias")

    # fonte que falhou desta vez: mantém o valor da coleta anterior em vez de sumir do site
    anterior = ler_anterior()
    for grupo in ("indices", "acoes"):
        for k, v in anterior.get(grupo, {}).items():
            if k not in dados[grupo] and (grupo == "indices" or k in TODOS_TICKERS):
                dados[grupo][k] = v
                log.append(f"{k}: usando coleta anterior")
    if not dados["noticias"] and anterior.get("noticias"):
        dados["noticias"] = anterior["noticias"]
        log.append("notícias: usando coleta anterior")

    SAIDA.write_text("window.DADOS = " + json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"\nGravado {SAIDA.name} ({SAIDA.stat().st_size // 1024} KB). {len(log)} erro(s).")
    return 0 if dados["acoes"] or dados["noticias"] else 1


if __name__ == "__main__":
    sys.exit(main())
