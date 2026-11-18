"""Marca do canal (vale para todos os projetos): logo, gancho, intro/outro, música e padrões.

Os arquivos (logo, intro, música...) continuam onde o usuário os guardou; aqui
só ficam os caminhos e as opções, em dados/marca.json.
"""
import copy
import json
import re
import textwrap
import threading
from pathlib import Path

from PIL import Image, ImageDraw

from . import config, legendas

ARQUIVO = config.DADOS / "marca.json"
_lock = threading.Lock()

LAYOUT_PADRAO = {"cam": [0.70, 0.02, 0.28, 0.30], "jogo": [0.0, 0.0, 1.0, 1.0], "proporcao": 0.4}
POSICOES = ["sup_esq", "sup_dir", "inf_esq", "inf_dir"]

PADRAO = {
    "logo": {"arquivo": None, "posicao": "sup_esq", "tamanho": 0.16, "opacidade": 0.9, "padrao": True},
    "gancho": {"fonte": "Montserrat-Variavel.ttf", "variacao": "Black", "tamanho": 0.05, "cor_texto": "#111111",
               "cor_caixa": "#FFFFFF", "posicao_y": 0.13, "duracao": 0, "maiusculas": True},
    "intro": {"arquivo": None, "padrao": False},
    "outro": {"arquivo": None, "padrao": False},
    "musica": {"arquivo": None, "volume": 0.15, "abaixar_na_fala": True, "padrao": False},
    "formatos_padrao": ["vertical_crop"],
    "layout_padrao": LAYOUT_PADRAO,
}

_COR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _num(v, lo, hi, padrao):
    try:
        return min(hi, max(lo, float(v)))
    except (TypeError, ValueError):
        return padrao


def _arquivo(v) -> str | None:
    if not v:
        return None
    return str(Path(str(v).strip().strip('"')))


def validar_layout(l: dict | None) -> dict:
    l = l or {}
    res = {}
    for k in ("cam", "jogo"):
        r = l.get(k) or LAYOUT_PADRAO[k]
        try:
            x, y, w, h = (min(1.0, max(0.0, float(v))) for v in r)
        except (TypeError, ValueError):
            x, y, w, h = LAYOUT_PADRAO[k]
        w = max(0.05, min(w, 1 - x))
        h = max(0.05, min(h, 1 - y))
        res[k] = [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]
    res["proporcao"] = _num(l.get("proporcao"), 0.2, 0.7, 0.4)
    return res


def validar(d: dict) -> dict:
    base = copy.deepcopy(PADRAO)
    for chave in ("logo", "gancho", "intro", "outro", "musica"):
        base[chave].update({k: v for k, v in (d.get(chave) or {}).items() if k in base[chave]})
    lg, g, m = base["logo"], base["gancho"], base["musica"]
    lg["arquivo"] = _arquivo(lg["arquivo"])
    lg["posicao"] = lg["posicao"] if lg["posicao"] in POSICOES else "sup_esq"
    lg["tamanho"] = _num(lg["tamanho"], 0.04, 0.5, 0.16)
    lg["opacidade"] = _num(lg["opacidade"], 0.1, 1.0, 0.9)
    lg["padrao"] = bool(lg["padrao"])
    g["tamanho"] = _num(g["tamanho"], 0.02, 0.12, 0.05)
    g["posicao_y"] = _num(g["posicao_y"], 0.03, 0.9, 0.13)
    g["duracao"] = _num(g["duracao"], 0, 600, 0)
    g["maiusculas"] = bool(g["maiusculas"])
    for k in ("cor_texto", "cor_caixa"):
        if not isinstance(g[k], str) or not _COR.match(g[k]):
            g[k] = PADRAO["gancho"][k]
    g["fonte"] = str(g["fonte"])
    g["variacao"] = str(g["variacao"]) if g.get("variacao") else None
    for k in ("intro", "outro"):
        base[k]["arquivo"] = _arquivo(base[k]["arquivo"])
        base[k]["padrao"] = bool(base[k]["padrao"])
    m["arquivo"] = _arquivo(m["arquivo"])
    m["volume"] = _num(m["volume"], 0.0, 1.0, 0.15)
    m["abaixar_na_fala"] = bool(m["abaixar_na_fala"])
    m["padrao"] = bool(m["padrao"])
    from .formatos import FORMATOS  # import tardio: formatos importa marca
    fp = [f for f in (d.get("formatos_padrao") or PADRAO["formatos_padrao"]) if f in FORMATOS]
    base["formatos_padrao"] = fp or ["vertical_crop"]
    base["layout_padrao"] = validar_layout(d.get("layout_padrao"))
    return base


def ler() -> dict:
    with _lock:
        try:
            dados = json.loads(ARQUIVO.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            dados = {}
    return validar(dados)


def salvar(d: dict) -> dict:
    v = validar(d)
    with _lock:
        ARQUIVO.write_text(json.dumps(v, ensure_ascii=False, indent=2), encoding="utf-8")
    return v


def recursos_do_corte(corte: dict, m: dict | None = None) -> dict:
    """Quais extras entram no corte: escolha do corte ou o padrão da marca (só se o arquivo existir)."""
    m = m or ler()
    bruto = corte.get("recursos")
    # salvo no banco vem como texto JSON; da prévia ao vivo vem como dicionário
    escolha = json.loads(bruto) if isinstance(bruto, str) else (bruto or {})
    res = {}
    for k in ("logo", "intro", "outro", "musica"):
        quer = escolha.get(k, m[k]["padrao"])
        arq = m[k]["arquivo"]
        res[k] = bool(quer and arq and Path(arq).is_file())
    return res


# ---------------------------------------------------------------- imagens

def imagem_logo(m: dict, largura_video: int) -> Image.Image:
    img = Image.open(m["logo"]["arquivo"]).convert("RGBA")
    w = max(16, round(largura_video * m["logo"]["tamanho"]))
    h = max(1, round(img.height * w / img.width))
    img = img.resize((w, h), Image.LANCZOS)
    if m["logo"]["opacidade"] < 1:
        a = img.getchannel("A").point(lambda v: round(v * m["logo"]["opacidade"]))
        img.putalpha(a)
    return img


def posicao_logo(m: dict, logo: Image.Image, w: int, h: int) -> tuple[int, int]:
    margem = round(min(w, h) * 0.035)
    p = m["logo"]["posicao"]
    x = margem if p.endswith("esq") else w - logo.width - margem
    y = margem if p.startswith("sup") else h - logo.height - margem
    return x, y


def imagem_gancho(texto: str, m: dict, w: int, h: int) -> tuple[Image.Image, int]:
    """Faixa com o texto do gancho (título) numa caixa arredondada; devolve (imagem, y no vídeo)."""
    g = m["gancho"]
    texto = texto.strip().upper() if g["maiusculas"] else texto.strip()
    px = max(10, round(min(w, h) * g["tamanho"]))
    fonte = legendas._fonte(g["fonte"], g["variacao"], px)
    largura_max = w * 0.84
    # quebra em até 3 linhas pela largura real do texto
    linhas: list[str] = []
    for paragrafo in texto.splitlines() or [""]:
        atual = ""
        for palavra in paragrafo.split():
            teste = f"{atual} {palavra}".strip()
            if atual and fonte.getlength(teste) > largura_max:
                linhas.append(atual)
                atual = palavra
            else:
                atual = teste
        if atual:
            linhas.append(atual)
    if len(linhas) > 3:
        linhas = textwrap.wrap(" ".join(linhas), width=max(10, len(" ".join(linhas)) // 3 + 1))[:3]
    lh = px * 1.2
    pad = px * 0.45
    alt = int(len(linhas) * lh + 2 * pad) + 2
    img = Image.new("RGBA", (w, alt), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    larg = max((fonte.getlength(l) for l in linhas), default=0)
    x1 = (w - larg) / 2 - pad
    d.rounded_rectangle((x1, 0, w - x1, alt - 1), radius=px * 0.35, fill=g["cor_caixa"])
    for i, l in enumerate(linhas):
        d.text((w / 2, pad + lh * (i + 0.5)), l, font=fonte, fill=g["cor_texto"], anchor="mm")
    y = round(g["posicao_y"] * h - alt / 2)
    return img, max(0, min(h - alt, y))
