"""Legendas estilo TikTok desenhadas com Pillow e sobrepostas ao vídeo pelo FFmpeg.

Por que não usar .ass/libass: aqui dá para ter emoji colorido, caixa atrás da
palavra, brilho neon e uma prévia no site idêntica ao vídeo final, porque o
mesmo código desenha os dois.

Fluxo: palavras (com tempo) → telas de 2-3 palavras → estados (palavra ativa,
passo da animação) → um PNG transparente por estado → lista "ffconcat" com a
duração de cada PNG → overlay no FFmpeg.
"""
import copy
import json
import os
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from . import config

PASTA_FONTES = config.RAIZ / "fontes"
PASTA_FONTES_SISTEMA = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Fonts"
FONTE_EMOJI = PASTA_FONTES_SISTEMA / "seguiemj.ttf"
FONTES_SISTEMA = {"impact.ttf": "Impact", "ariblk.ttf": "Arial Black", "seguibl.ttf": "Segoe UI Black"}

ARQ_ESTILOS = config.DADOS / "estilos.json"
ARQ_EMOJIS = config.DADOS / "emojis.json"
ARQ_CHAVES = config.DADOS / "palavras_chave.json"
_lock = threading.Lock()

# ---------------------------------------------------------------- estilos

_BASE = {
    "nome": "Novo estilo",
    "fonte": "Montserrat-Variavel.ttf",
    "variacao": "Black",
    "tamanho": 0.075,            # fração do menor lado do vídeo
    "maiusculas": True,
    "sem_pontuacao": True,       # tira vírgulas e pontos (mantém ! e ?)
    "palavras_por_vez": 3,
    "cor_texto": "#FFFFFF",
    "cor_destaque": "#FFE11A",   # palavra sendo falada
    "cor_palavra_chave": "#3EF0FF",
    "contorno": 0.14,            # fração do tamanho da fonte
    "cor_contorno": "#000000",
    "sombra": True,
    "cor_sombra": "#000000",
    "brilho": False,
    "cor_brilho": "#00E5FF",
    "caixa": False,
    "cor_caixa": "#7C4DFF",
    "escala_destaque": 1.15,
    "animacao": True,
    "posicao_y": 0.72,           # centro do texto, fração da altura
    "largura_max": 0.86,
    "emojis": True,
    "palavras_chave": True,
}

ESTILOS_PADRAO = [
    {**_BASE, "id": "classico", "nome": "Clássico viral"},
    {**_BASE, "id": "caixa", "nome": "Caixa colorida", "fonte": "Poppins-Black.ttf", "variacao": None,
     "cor_destaque": "#FFFFFF", "caixa": True, "cor_caixa": "#7C4DFF", "contorno": 0.08,
     "escala_destaque": 1.08, "cor_palavra_chave": "#FFE11A"},
    {**_BASE, "id": "minimalista", "nome": "Minimalista", "variacao": "ExtraBold", "tamanho": 0.06,
     "maiusculas": False, "sem_pontuacao": False, "cor_destaque": "#3EDC81", "contorno": 0.0,
     "escala_destaque": 1.0, "animacao": False, "emojis": False, "palavras_chave": False},
    {**_BASE, "id": "neon", "nome": "Neon", "fonte": "Anton-Regular.ttf", "variacao": None, "tamanho": 0.08,
     "cor_destaque": "#FF4FD8", "contorno": 0.05, "cor_contorno": "#1A0033", "sombra": False,
     "brilho": True, "cor_brilho": "#00E5FF", "escala_destaque": 1.12, "cor_palavra_chave": "#B6FF3B"},
]
IDS_PADRAO = {e["id"] for e in ESTILOS_PADRAO}

_COR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_LIMITES = {"tamanho": (0.02, 0.2), "contorno": (0.0, 0.4), "escala_destaque": (1.0, 1.6),
            "posicao_y": (0.05, 0.95), "largura_max": (0.3, 1.0), "palavras_por_vez": (1, 8)}


def validar_estilo(dados: dict, eid: str) -> dict:
    e = {**_BASE, **{k: v for k, v in dados.items() if k in _BASE}, "id": eid}
    for k, v in _BASE.items():
        if isinstance(v, bool):
            e[k] = bool(e[k])
        elif k.startswith("cor_"):
            if not isinstance(e[k], str) or not _COR.match(e[k]):
                e[k] = v
    for k, (lo, hi) in _LIMITES.items():
        try:
            e[k] = min(hi, max(lo, float(e[k])))
        except (TypeError, ValueError):
            e[k] = _BASE[k]
    e["palavras_por_vez"] = int(e["palavras_por_vez"])
    e["nome"] = str(e["nome"] or "Sem nome")[:40]
    e["fonte"] = str(e["fonte"])
    e["variacao"] = str(e["variacao"]) if e.get("variacao") else None
    return e


def listar_estilos() -> list[dict]:
    with _lock:
        try:
            salvos = json.loads(ARQ_ESTILOS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            salvos = []
    por_id = {e["id"]: validar_estilo(e, e["id"]) for e in salvos if isinstance(e, dict) and e.get("id")}
    resultado = [por_id.pop(p["id"], copy.deepcopy(p)) for p in ESTILOS_PADRAO]
    return resultado + list(por_id.values())


def _gravar_estilos(estilos: list[dict]) -> None:
    with _lock:
        ARQ_ESTILOS.write_text(json.dumps(estilos, ensure_ascii=False, indent=2), encoding="utf-8")


def salvar_estilo(eid: str, dados: dict) -> dict:
    e = validar_estilo(dados, eid)
    estilos = [x for x in listar_estilos() if x["id"] != eid] + [e]
    _gravar_estilos(estilos)
    return e


def apagar_estilo(eid: str) -> None:
    """Estilos próprios são apagados; os de fábrica voltam ao padrão."""
    _gravar_estilos([x for x in listar_estilos() if x["id"] != eid])


def obter_estilo(eid: str | None) -> dict:
    estilos = listar_estilos()
    return next((e for e in estilos if e["id"] == eid), estilos[0])


# ---------------------------------------------------------------- dicionários

EMOJIS_PADRAO = {
    "fogo": "🔥", "kkk": "😂", "risada": "😂", "rindo": "😂", "hahaha": "😂", "morri": "💀", "morreu": "💀",
    "ganh": "🏆", "vitoria": "🏆", "venc": "🏆", "campeao": "🏆", "recorde": "🥇", "dinheiro": "💰",
    "grana": "💰", "amor": "❤️", "coracao": "❤️", "chat": "💬", "incrivel": "🤯", "absurd": "🤯",
    "acredit": "😱", "medo": "😱", "bravo": "😡", "raiva": "😡", "triste": "😢", "chor": "😭",
    "jogada": "🎮", "jogo": "🎮", "gol": "⚽", "festa": "🎉", "parabens": "🎉", "inscrit": "🔔",
    "rapid": "⚡", "olha": "👀", "segredo": "🤫", "fome": "🍔", "perdi": "💔", "perder": "💔",
    "dificil": "😤", "chefe": "👹", "boa noite": "🌙", "bom dia": "☀️", "obrigad": "🙏", "socorro": "🆘",
    "insano": "🤯", "lindo": "😍", "nunca": "🚫", "cuidado": "⚠️", "pensa": "🤔", "verdade": "💯",
    "win": "🏆", "fire": "🔥", "lol": "😂", "money": "💰", "crazy": "🤯", "insane": "🤯", "love": "❤️",
}
CHAVES_PADRAO = [
    "ganhamos", "ganhei", "vitoria", "incrivel", "absurdo", "absurda", "nunca", "sempre", "dinheiro",
    "gratis", "morri", "socorro", "recorde", "insano", "melhor", "pior", "impossivel", "segredo",
    "verdade", "mentira", "agora", "urgente", "chefe", "final",
]


def _ler_json(arq: Path, padrao):
    try:
        return json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return copy.deepcopy(padrao)


def ler_dicionarios() -> dict:
    return {"emojis": _ler_json(ARQ_EMOJIS, EMOJIS_PADRAO), "palavras_chave": _ler_json(ARQ_CHAVES, CHAVES_PADRAO)}


def salvar_dicionarios(emojis: dict | None, chaves: list | None) -> dict:
    if emojis is not None:
        limpo = {normalizar(k): str(v)[:8] for k, v in emojis.items() if len(normalizar(k)) >= 2 and v}
        ARQ_EMOJIS.write_text(json.dumps(limpo, ensure_ascii=False, indent=2), encoding="utf-8")
    if chaves is not None:
        limpo = sorted({normalizar(k) for k in chaves if len(normalizar(k)) >= 2})
        ARQ_CHAVES.write_text(json.dumps(limpo, ensure_ascii=False, indent=2), encoding="utf-8")
    return ler_dicionarios()


def normalizar(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^\w\s]", "", s).strip()


# ---------------------------------------------------------------- fontes

def listar_fontes() -> list[dict]:
    fontes = []
    for arq in sorted(list(PASTA_FONTES.glob("*.ttf")) + list(PASTA_FONTES.glob("*.otf"))):
        try:
            f = ImageFont.truetype(str(arq), 20)
        except OSError:
            continue
        try:
            variacoes = [v.decode() if isinstance(v, bytes) else str(v) for v in f.get_variation_names()]
        except (OSError, AttributeError):
            variacoes = []
        fontes.append({"id": arq.name, "nome": f.getname()[0], "variacoes": variacoes})
    for arq, nome in FONTES_SISTEMA.items():
        if (PASTA_FONTES_SISTEMA / arq).exists():
            fontes.append({"id": f"sistema:{arq}", "nome": nome, "variacoes": []})
    return fontes


def _caminho_fonte(fid: str) -> Path | None:
    nome = fid.split(":", 1)[1] if fid.startswith("sistema:") else fid
    if "/" in nome or "\\" in nome or ".." in nome:
        return None
    p = (PASTA_FONTES_SISTEMA if fid.startswith("sistema:") else PASTA_FONTES) / nome
    return p if p.exists() else None


@lru_cache(maxsize=512)
def _fonte(fid: str, variacao: str | None, px: int) -> ImageFont.FreeTypeFont:
    caminho = _caminho_fonte(fid) or _caminho_fonte("sistema:ariblk.ttf")
    if caminho is None:
        return ImageFont.load_default(px)
    f = ImageFont.truetype(str(caminho), max(4, px))
    if variacao:
        try:
            f.set_variation_by_name(variacao)
        except (OSError, ValueError, AttributeError):
            pass
    return f


@lru_cache(maxsize=64)
def _fonte_emoji(px: int) -> ImageFont.FreeTypeFont | None:
    if not FONTE_EMOJI.exists():
        return None
    # A fonte de emoji colorida do Windows só desenha bem em tamanhos "de bitmap"; 109 é o nativo.
    return ImageFont.truetype(str(FONTE_EMOJI), max(8, px))


# ---------------------------------------------------------------- telas (grupos de palavras)

@dataclass
class Tela:
    inicio: float
    fim: float
    palavras: list[tuple[float, float, str]]
    textos: list[str] = field(default_factory=list)   # texto exibido de cada palavra
    chave: list[bool] = field(default_factory=list)   # é palavra-chave?
    emoji: str | None = None


_PONTUACAO_FIM = re.compile(r"[.!?…]$")


def _texto_exibido(txt: str, estilo: dict) -> str:
    t = txt.strip()
    if estilo["sem_pontuacao"]:
        t = re.sub(r"^[\"'“”«»(\[]+|[\"'“”«»,.;:…)\]]+$", "", t)
    return t.upper() if estilo["maiusculas"] else t


def montar_telas(palavras: list[tuple[float, float, str]], estilo: dict, dicionarios: dict | None = None
                 ) -> list[Tela]:
    dicionarios = dicionarios or ler_dicionarios()
    maximo = int(estilo["palavras_por_vez"])
    limite_chars = 20 if maximo <= 3 else 34
    telas: list[Tela] = []
    atual: list[tuple[float, float, str]] = []

    def fechar():
        if atual:
            telas.append(Tela(atual[0][0], atual[-1][1], list(atual)))
            atual.clear()

    for w in palavras:
        if not w[2].strip():
            continue
        if atual:
            chars = sum(len(x[2]) + 1 for x in atual) + len(w[2])
            if len(atual) >= maximo or chars > limite_chars or w[0] - atual[-1][1] > 0.6:
                fechar()
        atual.append(w)
        if _PONTUACAO_FIM.search(w[2].strip()):
            fechar()
    fechar()

    chaves = set(dicionarios["palavras_chave"]) if estilo["palavras_chave"] else set()
    emojis = dicionarios["emojis"] if estilo["emojis"] else {}
    ultimo_emoji = None
    for i, t in enumerate(telas):
        # tela fica na tela até a próxima começar (sem piscar), no máximo 0,6 s após a última palavra
        prox = telas[i + 1].inicio if i + 1 < len(telas) else t.fim + 0.6
        t.fim = max(t.fim, min(prox, t.fim + 0.6))
        t.textos = [_texto_exibido(w[2], estilo) for w in t.palavras]
        normais = [normalizar(w[2]) for w in t.palavras]
        t.chave = [n in chaves or bool(re.search(r"\d", n)) for n in normais]
        frase = " ".join(normais)
        escolhido = None
        for k, e in emojis.items():
            if (" " in k and k in frase) or any(n.startswith(k) for n in normais if len(k) >= 3 or n == k):
                escolhido = e
                break
        if escolhido and escolhido != ultimo_emoji:
            t.emoji = escolhido
        ultimo_emoji = escolhido
    return telas


# ---------------------------------------------------------------- desenho

def _rgb(hexa: str) -> tuple[int, int, int]:
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


@dataclass
class Layout:
    px: int
    linhas: list[list[tuple[int, float, float]]]  # (índice da palavra, centro x, largura)
    altura_linha: float


@dataclass
class Faixa:
    """Área onde a legenda é desenhada (largura do vídeo × altura fixa)."""
    largura: int
    altura: int
    y_video: int      # posição no vídeo
    px_base: int
    topo_texto: float  # dentro da faixa
    altura_linha: float


def calcular_faixa(estilo: dict, w: int, h: int) -> Faixa:
    px = max(8, round(min(w, h) * estilo["tamanho"]))
    lh = px * 1.25
    area_emoji = px * 1.7 if estilo["emojis"] else px * 0.3
    altura = int(area_emoji + 2 * lh + px * 0.6)
    altura += altura % 2
    y = int(estilo["posicao_y"] * h - (area_emoji + lh))
    y = max(0, min(h - altura, y))
    return Faixa(w, altura, y, px, area_emoji, lh)


def _layout(tela: Tela, estilo: dict, faixa: Faixa) -> Layout:
    px = faixa.px_base
    maximo = faixa.largura * estilo["largura_max"]
    while True:
        f = _fonte(estilo["fonte"], estilo["variacao"], px)
        espaco = f.getlength(" ") * 1.1 + (px * 0.32 if estilo["caixa"] else 0)  # folga para a caixa
        # reserva o espaço da palavra ativa aumentada, para ela não encostar nas vizinhas
        larguras = [f.getlength(t) * estilo["escala_destaque"] for t in tela.textos]
        linhas: list[list[int]] = [[]]
        larg = 0.0
        for i, lw in enumerate(larguras):
            extra = lw if not linhas[-1] else larg + espaco + lw
            if linhas[-1] and extra > maximo:
                linhas.append([i])
                larg = lw
            else:
                linhas[-1].append(i)
                larg = extra
        cabe = len(linhas) <= 2 and max(larguras, default=0) <= maximo
        if cabe or px <= 10:
            break
        px = int(px * 0.9)
    resultado = []
    for linha in linhas:
        total = sum(larguras[i] for i in linha) + espaco * (len(linha) - 1)
        x = (faixa.largura - total) / 2
        itens = []
        for i in linha:
            itens.append((i, x + larguras[i] / 2, larguras[i]))
            x += larguras[i] + espaco
        resultado.append(itens)
    return Layout(px, resultado, px * 1.25)


def desenhar(tela: Tela | None, estilo: dict, faixa: Faixa, ativa: int | None,
             escala_ativa: float = 1.0, escala_emoji: float = 1.0) -> Image.Image:
    img = Image.new("RGBA", (faixa.largura, faixa.altura), (0, 0, 0, 0))
    if tela is None or not tela.textos:
        return img
    lay = _layout(tela, estilo, faixa)
    n_linhas = len(lay.linhas)
    # centraliza verticalmente na área de 2 linhas
    y0 = faixa.topo_texto + (2 - n_linhas) * faixa.altura_linha / 2 + lay.altura_linha / 2

    itens = []
    for li, linha in enumerate(lay.linhas):
        cy = y0 + li * lay.altura_linha
        for i, cx, larg in linha:
            escala = escala_ativa if i == ativa else 1.0
            px = max(4, round(lay.px * escala))
            f = _fonte(estilo["fonte"], estilo["variacao"], px)
            if i == ativa:
                cor = estilo["cor_destaque"]
            elif tela.chave[i]:
                cor = estilo["cor_palavra_chave"]
            else:
                cor = estilo["cor_texto"]
            itens.append((i, cx, cy, f, px, cor))

    def texto(d: ImageDraw.ImageDraw, i, cx, cy, f, px, cor, desloc=(0, 0), contorno=None):
        borda = round(estilo["contorno"] * px) if contorno is None else contorno
        d.text((cx + desloc[0], cy + desloc[1]), tela.textos[i], font=f, fill=cor, anchor="mm",
               stroke_width=borda, stroke_fill=estilo["cor_contorno"] if contorno is None else cor)

    if estilo["sombra"]:
        camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(camada)
        r, g, b = _rgb(estilo["cor_sombra"])
        for i, cx, cy, f, px, _ in itens:
            texto(d, i, cx, cy, f, px, (r, g, b, 170), desloc=(px * 0.03, px * 0.06),
                  contorno=round(estilo["contorno"] * px))
        img = Image.alpha_composite(img, camada.filter(ImageFilter.GaussianBlur(lay.px * 0.06)))

    if estilo["brilho"]:
        camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(camada)
        for i, cx, cy, f, px, _ in itens:
            cor = estilo["cor_destaque"] if i == ativa else estilo["cor_brilho"]
            texto(d, i, cx, cy, f, px, cor, contorno=max(2, round(px * 0.1)))
        brilho = camada.filter(ImageFilter.GaussianBlur(lay.px * 0.18))
        img = Image.alpha_composite(Image.alpha_composite(img, brilho), brilho)

    d = ImageDraw.Draw(img)
    if estilo["caixa"] and ativa is not None:
        for i, cx, cy, f, px, _ in itens:
            if i != ativa:
                continue
            x1, y1, x2, y2 = d.textbbox((cx, cy), tela.textos[i], font=f, anchor="mm")
            m = px * 0.16
            d.rounded_rectangle((x1 - m, y1 - m, x2 + m, y2 + m), radius=px * 0.2, fill=estilo["cor_caixa"])
    for item in itens:
        texto(d, *item)

    if tela.emoji and escala_emoji > 0:
        fe = _fonte_emoji(max(8, round(lay.px * 1.3 * escala_emoji)))
        if fe is not None:
            topo_texto = y0 - lay.altura_linha / 2
            try:
                d.text((faixa.largura / 2, topo_texto - lay.px * 0.75), tela.emoji, font=fe, anchor="mm",
                       embedded_color=True)
            except (OSError, ValueError):
                pass
    return img


# ---------------------------------------------------------------- linha do tempo e arquivos

_POP_PALAVRA = ((0.0, 0.92), (0.05, 1.08), (0.1, 1.0))   # (atraso, fator sobre escala_destaque)
_POP_EMOJI = (0.55, 1.15, 1.0)


def estados(telas: list[Tela], estilo: dict, duracao: float) -> list[tuple[float, tuple]]:
    """Lista (instante, estado). Estado = (tela, palavra ativa, escala da palavra, escala do emoji)."""
    linha: list[tuple[float, tuple]] = [(0.0, (None, None, 1.0, 1.0))]
    animar = estilo["animacao"]
    esc = estilo["escala_destaque"]
    for k, t in enumerate(telas):
        for i, w in enumerate(t.palavras):
            t_ini = max(t.inicio, w[0])
            passos = _POP_PALAVRA if animar else ((0.0, 1.0),)
            for j, (atraso, fator) in enumerate(passos):
                emoji = _POP_EMOJI[j] if (animar and i == 0 and j < len(_POP_EMOJI)) else 1.0
                escala = round(max(1.0, esc * fator) if esc > 1.0 else 1.0, 3)
                linha.append((t_ini + atraso, (k, i, escala, emoji)))
        linha.append((t.fim, (None, None, 1.0, 1.0)))
    # ordena, corta no fim do vídeo e remove instantes repetidos (o último vence)
    linha.sort(key=lambda x: x[0])
    limpo: list[tuple[float, tuple]] = []
    for instante, est in linha:
        instante = min(max(0.0, instante), duracao)
        if limpo and instante - limpo[-1][0] < 0.02:
            limpo[-1] = (limpo[-1][0], est)
        else:
            limpo.append((instante, est))
    return limpo


def gerar_quadros(palavras: list[tuple[float, float, str]], estilo: dict, w: int, h: int, duracao: float,
                  pasta: Path, ao_progresso=None) -> tuple[Path, Faixa]:
    """Desenha os PNGs da legenda e escreve a lista para o FFmpeg (demuxer concat)."""
    pasta.mkdir(parents=True, exist_ok=True)
    telas = montar_telas(palavras, estilo)
    faixa = calcular_faixa(estilo, w, h)
    linha = estados(telas, estilo, duracao)
    arquivos: dict[tuple, str] = {}
    for n, (_, est) in enumerate(linha):
        if est not in arquivos:
            k, ativa, escala, emoji = est
            img = desenhar(telas[k] if k is not None else None, estilo, faixa, ativa, escala, emoji)
            nome = f"q{len(arquivos):05d}.png"
            img.save(pasta / nome, compress_level=1)
            arquivos[est] = nome
        if ao_progresso and n % 20 == 0:
            ao_progresso(n / max(1, len(linha)))
    lista = ["ffconcat version 1.0"]
    for n, (instante, est) in enumerate(linha):
        fim = linha[n + 1][0] if n + 1 < len(linha) else duracao
        if fim - instante <= 0:
            continue
        lista.append(f"file '{arquivos[est]}'")
        lista.append(f"duration {fim - instante:.4f}")
    lista.append(f"file '{arquivos[linha[-1][1]]}'")  # o demuxer exige repetir o último
    arq = pasta / "lista.txt"
    arq.write_text("\n".join(lista) + "\n", encoding="utf-8")
    return arq, faixa


def _srt_tempo(s: float) -> str:
    ms = int(round(max(0.0, s) * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def gerar_srt(palavras: list[tuple[float, float, str]], estilo: dict, duracao: float) -> str:
    """SRT com as mesmas telas da legenda, mas com o texto como foi falado."""
    blocos = []
    telas = montar_telas(palavras, {**estilo, "maiusculas": False, "sem_pontuacao": False, "emojis": False})
    for t in telas:
        if t.inicio >= duracao:
            continue
        texto = " ".join(w[2].strip() for w in t.palavras)
        n = len(blocos) + 1
        blocos.append(f"{n}\n{_srt_tempo(t.inicio)} --> {_srt_tempo(min(t.fim, duracao))}\n{texto}\n")
    return "\n".join(blocos)


# ---------------------------------------------------------------- prévias

def camada_em(palavras: list[tuple[float, float, str]], estilo: dict, w: int, h: int, instante: float
              ) -> tuple[Image.Image, int]:
    """Faixa da legenda no instante pedido (palavra já 'assentada', sem o meio da animação) e seu y."""
    telas = montar_telas(palavras, estilo)
    faixa = calcular_faixa(estilo, w, h)
    est = (None, None, 1.0, 1.0)
    for t0, e in estados(telas, estilo, max(instante + 1, 1)):
        if t0 <= instante:
            est = e
    k, ativa, _, _ = est
    escala = estilo["escala_destaque"] if ativa is not None else 1.0
    return desenhar(telas[k] if k is not None else None, estilo, faixa, ativa, escala, 1.0), faixa.y_video


def compor(fundo: Image.Image, palavras: list[tuple[float, float, str]], estilo: dict, instante: float
           ) -> Image.Image:
    """Desenha a legenda do instante pedido sobre um quadro do vídeo."""
    fundo = fundo.convert("RGBA")
    camada, y = camada_em(palavras, estilo, fundo.width, fundo.height, instante)
    fundo.alpha_composite(camada, (0, y))
    return fundo.convert("RGB")


TEXTO_EXEMPLO = "isso foi absurdo demais olha o fogo no chat"


def previa_estilo(estilo: dict, w: int = 1080, h: int = 1920, fundo: Image.Image | None = None) -> Image.Image:
    if fundo is None:
        fundo = Image.new("RGB", (w, h), (34, 38, 46))
        d = ImageDraw.Draw(fundo)
        for y in range(0, h, 8):  # gradiente simples para enxergar contorno e sombra
            c = int(34 + 60 * y / h)
            d.rectangle((0, y, w, y + 8), fill=(c, c - 6, c + 20))
    palavras = []
    t = 0.0
    for p in TEXTO_EXEMPLO.split():
        palavras.append((t, t + 0.3, p))
        t += 0.35
    return compor(fundo if fundo.size == (w, h) else ImageOps.fit(fundo, (w, h)), palavras, estilo, 0.4)
