"""Tradução no próprio PC, sem chave: modelos do Argos Translate (código aberto, CTranslate2 + SentencePiece).

Cada par de idiomas é um modelo de ~65-100 MB, baixado na primeira vez que é usado e guardado em
dados/modelos/argos. Quase todos os pares passam pelo inglês (pt → en → es), que é como o próprio Argos faz.
Só o modelo e o vocabulário saem do pacote; a divisão em frases já é feita pelo Cortes Live.
"""
import io
import json
import shutil
import threading
import time
import zipfile
from pathlib import Path

import requests

from . import config
from .jobs import Contexto

INDICE_URL = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"
PASTA = config.DADOS / "modelos" / "argos"
INDICE_VALIDADE_S = 7 * 86400
# códigos do Cortes Live → do Argos (o "pb" é o português do Brasil; o "pt" de lá é o de Portugal)
CODIGO = {"pt": "pb"}
_lock = threading.RLock()
_carregados: dict[str, tuple[object, object]] = {}


def _cod(idioma: str) -> str:
    return CODIGO.get(idioma, idioma)


def indice() -> list[dict]:
    """Lista de modelos do Argos (baixada e guardada por uma semana; sem internet, vale a guardada)."""
    arq = PASTA / "index.json"
    with _lock:
        velho = not arq.exists() or time.time() - arq.stat().st_mtime > INDICE_VALIDADE_S
        if velho:
            try:
                r = requests.get(INDICE_URL, timeout=30)
                r.raise_for_status()
                PASTA.mkdir(parents=True, exist_ok=True)
                arq.write_bytes(r.content)
            except requests.RequestException:
                if not arq.exists():
                    raise
        return json.loads(arq.read_text(encoding="utf-8"))


def _pacote(de: str, para: str) -> dict | None:
    for p in indice():
        if p.get("from_code") == de and p.get("to_code") == para and p.get("links"):
            return p
    return None


def rota(origem: str, destino: str) -> list[dict] | None:
    """Pacotes a usar, em ordem: direto, ou passando pelo inglês. None = par sem modelo."""
    de, para = _cod(origem), _cod(destino)
    if de == para:
        return None
    direto = _pacote(de, para)
    if direto:
        return [direto]
    if "en" in (de, para):
        return None
    a, b = _pacote(de, "en"), _pacote("en", para)
    return [a, b] if a and b else None


def _pasta(p: dict) -> Path:
    return PASTA / f'{p["from_code"]}_{p["to_code"]}-{p.get("package_version", "0")}'


def baixado(p: dict) -> bool:
    d = _pasta(p)
    return (d / "model" / "model.bin").is_file() and (d / "sentencepiece.model").is_file()


def _baixar(p: dict, ctx: Contexto, ini: float, fim: float) -> Path:
    d = _pasta(p)
    if baixado(p):
        return d
    nome = f'{p["from_code"]}→{p["to_code"]}'
    buf = io.BytesIO()
    with requests.get(p["links"][0], stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length") or 0)
        for bloco in r.iter_content(1 << 20):
            ctx.checar()
            buf.write(bloco)
            if total:
                f = buf.tell() / total
                ctx.progresso(ini + (fim - ini) * f, f"Baixando o tradutor {nome} ({buf.tell() >> 20} de {total >> 20} MB, só na 1ª vez)")
    tmp = d.with_name(d.name + ".parcial")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(buf) as z:
        for info in z.infolist():
            partes = Path(info.filename).parts[1:]  # tira a pasta de cima do pacote
            if not partes or info.is_dir():
                continue
            if partes[0] == "model" or partes == ("sentencepiece.model",):
                alvo = tmp.joinpath(*partes)
                alvo.parent.mkdir(parents=True, exist_ok=True)
                alvo.write_bytes(z.read(info))
    if not (tmp / "model" / "model.bin").is_file() or not (tmp / "sentencepiece.model").is_file():
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"O pacote do tradutor {nome} veio incompleto. Tente de novo.")
    shutil.rmtree(d, ignore_errors=True)
    tmp.replace(d)
    return d


def _modelo(p: dict):
    import ctranslate2
    import sentencepiece

    chave = _pasta(p).name
    with _lock:
        if chave not in _carregados:
            if len(_carregados) >= 2:  # no máximo os dois de uma rota pelo inglês na memória
                _carregados.clear()
            d = _pasta(p)
            _carregados[chave] = (ctranslate2.Translator(str(d / "model"), device="cpu", compute_type="int8"),
                                  sentencepiece.SentencePieceProcessor(model_file=str(d / "sentencepiece.model")))
        return _carregados[chave]


def _passar(p: dict, textos: list[str]) -> list[str]:
    if not textos:
        return []
    tradutor, sp = _modelo(p)
    tokens = [sp.encode(t, out_type=str) for t in textos]
    res = tradutor.translate_batch(tokens, beam_size=4, max_batch_size=16, replace_unknowns=True)
    return [sp.decode(r.hypotheses[0]).replace("▁", " ").strip() for r in res]


def traduzir(textos: list[str], origem: str, destino: str, ctx: Contexto) -> list[str]:
    caminho = rota(origem, destino)
    if not caminho:
        raise RuntimeError(f"Não há tradutor local de {origem} para {destino}.")
    passo = 0.5 / len(caminho)
    for i, p in enumerate(caminho):
        _baixar(p, ctx, 0.2 + i * passo, 0.2 + (i + 1) * passo)
    ctx.progresso(0.75, "Traduzindo no PC", forcar=True)
    saida = [t.strip() for t in textos]
    for p in caminho:
        ctx.checar()
        traduzidos = iter(_passar(p, [t for t in saida if t]))
        saida = [next(traduzidos) if t else "" for t in saida]
    return saida
