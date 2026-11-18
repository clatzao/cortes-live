"""Thumbnails: escolha dos melhores quadros, recorte da pessoa, textos e arquivos.

A montagem (camadas, texto, stickers) acontece no editor do site; aqui ficam as
partes que precisam do vídeo original ou de IA.
"""
import base64
import hashlib
import io
import json
import re
import subprocess
import threading
from pathlib import Path

import cv2
import numpy as np
import requests
from PIL import Image

from . import ajustes, config, viral

PASTA_IMAGENS = config.DADOS / "thumb_imagens"
PASTA_IMAGENS.mkdir(parents=True, exist_ok=True)
ARQ_TEMPLATES = config.DADOS / "thumb_templates.json"
TAMANHOS = {"youtube": (1280, 720), "vertical": (1080, 1920), "quadrado": (1080, 1080)}
NOME_SEGURO = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")

URL_MODELO = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
ARQ_MODELO = config.DADOS / "modelos" / "isnet-general-use.onnx"
_lock_modelo = threading.Lock()
_sessao = None
_rosto = None


def pasta(projeto_id: int, corte_id: int) -> Path:
    p = config.PROJETOS / str(projeto_id) / "thumbs" / str(corte_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------- candidatos de quadro

def _detector_rosto():
    global _rosto
    if _rosto is None:
        _rosto = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _rosto


def _quadros_pequenos(origem: str, inicio: float, dur: float, passo: float, w: int, h: int):
    """Lê quadros reduzidos (w×h, BGR) a cada `passo` segundos, de uma só vez."""
    cmd = [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{inicio:.3f}", "-t", f"{dur:.3f}",
           "-i", origem, "-vf", f"fps=1/{passo:.4f},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    r = subprocess.run(cmd, capture_output=True, creationflags=config.SEM_JANELA)
    tamanho = w * h * 3
    for k in range(len(r.stdout) // tamanho):
        yield inicio + k * passo, np.frombuffer(r.stdout[k * tamanho:(k + 1) * tamanho], np.uint8).reshape(h, w, 3)


def candidatos(c: dict, p: dict, n: int = 6) -> list[dict]:
    """Os n quadros com mais cara de thumb: rosto grande, imagem nítida, momento agitado."""
    inicio, dur = c["inicio"], c["fim"] - c["inicio"]
    passo = max(0.25, dur / 160)
    w = 320
    h = max(2, int(round(w * p["altura"] / p["largura"] / 2)) * 2)
    energia = viral._energia_por_segundo(p["id"], p["duracao"])
    detector = _detector_rosto()

    amostras = []
    for t, img in _quadros_pequenos(p["caminho_original"], inicio, dur, passo, w, h):
        cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        nitidez = float(cv2.Laplacian(cinza, cv2.CV_64F).var())
        brilho = float(cinza.mean())
        rostos = detector.detectMultiScale(cinza, scaleFactor=1.1, minNeighbors=5, minSize=(18, 18))
        caixa = None
        area = 0.0
        if len(rostos):
            x, y, rw, rh = max(rostos, key=lambda r: r[2] * r[3])
            area = rw * rh / (w * h)
            caixa = [round(x / w, 4), round(y / h, 4), round(rw / w, 4), round(rh / h, 4)]
        e = float(energia[min(len(energia) - 1, int(t))]) if len(energia) else 0.0
        amostras.append({"t": t, "nitidez": nitidez, "brilho": brilho, "area": area, "rosto": caixa, "energia": e})
    if not amostras:
        raise RuntimeError("Não foi possível ler quadros deste corte.")

    max_nit = max(a["nitidez"] for a in amostras) or 1
    for a in amostras:
        nota = 0.35 * (a["nitidez"] / max_nit)
        nota += 0.40 * min(1.0, a["area"] * 12) if a["rosto"] else 0
        nota += 0.25 * min(1.0, a["energia"] / 4)
        if a["brilho"] < 35 or a["brilho"] > 225:  # quadro escuro ou estourado
            nota *= 0.5
        a["nota"] = nota

    distancia = max(1.5, dur / (n * 2))
    escolhidos: list[dict] = []
    for a in sorted(amostras, key=lambda x: -x["nota"]):
        if all(abs(a["t"] - b["t"]) >= distancia for b in escolhidos):
            escolhidos.append(a)
        if len(escolhidos) >= n:
            break
    escolhidos.sort(key=lambda x: x["t"])

    destino = pasta(p["id"], c["id"])
    topo = max(a["nota"] for a in escolhidos) or 1
    resultado = []
    for a in escolhidos:
        nome = f"quadro_{int(a['t'] * 1000)}.jpg"
        arq = destino / nome
        if not arq.exists():
            subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{a['t']:.3f}",
                            "-i", p["caminho_original"], "-frames:v", "1", "-q:v", "2", str(arq)],
                           capture_output=True, creationflags=config.SEM_JANELA)
        if arq.exists():
            resultado.append({"t": round(a["t"] - inicio, 2), "arquivo": nome,
                              "url": f"/api/thumb/arquivo/{p['id']}/{c['id']}/{nome}",
                              "nota": int(round(100 * a["nota"] / topo)), "rosto": a["rosto"]})
    return resultado


# ---------------------------------------------------------------- recorte da pessoa

def modelo_baixado() -> bool:
    return ARQ_MODELO.exists() and ARQ_MODELO.stat().st_size > 100_000_000


def _baixar_modelo() -> None:
    ARQ_MODELO.parent.mkdir(parents=True, exist_ok=True)
    parcial = ARQ_MODELO.with_suffix(".parcial")
    with requests.get(URL_MODELO, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(parcial, "wb") as f:
            for bloco in r.iter_content(1 << 20):
                f.write(bloco)
    if parcial.stat().st_size < 100_000_000:
        parcial.unlink(missing_ok=True)
        raise RuntimeError("O download do modelo de recorte veio incompleto. Tente de novo.")
    parcial.replace(ARQ_MODELO)


def _sessao_onnx():
    global _sessao
    with _lock_modelo:
        if _sessao is None:
            if not modelo_baixado():
                _baixar_modelo()
            import onnxruntime as ort
            _sessao = ort.InferenceSession(str(ARQ_MODELO), providers=["CPUExecutionProvider"])
    return _sessao


def recortar(img: Image.Image) -> tuple[Image.Image, list[float]]:
    """Separa a pessoa/objeto principal do fundo (mesmo pré e pós-processamento do rembg 'isnet').

    Devolve a imagem recortada no contorno do que sobrou e a caixa [x, y, w, h] (frações do quadro).
    """
    sessao = _sessao_onnx()
    rgb = img.convert("RGB")
    entrada = np.asarray(rgb.resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
    entrada = entrada / max(float(entrada.max()), 1e-6)
    entrada = (entrada - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / 1.0
    entrada = entrada.transpose(2, 0, 1)[None].astype(np.float32)
    saida = sessao.run(None, {sessao.get_inputs()[0].name: entrada})[0][:, 0, :, :]
    mi, ma = float(saida.min()), float(saida.max())
    pred = np.squeeze((saida - mi) / (ma - mi + 1e-8))
    mascara = Image.fromarray((pred * 255).clip(0, 255).astype(np.uint8), "L").resize(rgb.size, Image.LANCZOS)
    rgba = rgb.convert("RGBA")
    rgba.putalpha(mascara)
    caixa = mascara.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not caixa:
        raise RuntimeError("Não foi encontrada uma pessoa ou objeto para recortar neste quadro.")
    x1, y1, x2, y2 = caixa
    w, h = rgb.size
    return rgba.crop(caixa), [round(x1 / w, 4), round(y1 / h, 4), round((x2 - x1) / w, 4), round((y2 - y1) / h, 4)]


def recorte_do_quadro(projeto_id: int, corte_id: int, arquivo: str) -> dict:
    if not NOME_SEGURO.match(arquivo):
        raise ValueError("Nome de arquivo inválido.")
    destino = pasta(projeto_id, corte_id)
    origem = destino / arquivo
    if not origem.exists():
        raise FileNotFoundError("Quadro não encontrado.")
    nome = Path(arquivo).stem + "_recorte.png"
    meta = destino / (Path(arquivo).stem + "_recorte.json")
    if not (destino / nome).exists() or not meta.exists():
        img, caixa = recortar(Image.open(origem))
        img.save(destino / nome)
        meta.write_text(json.dumps(caixa))
    return {"arquivo": nome, "url": f"/api/thumb/arquivo/{projeto_id}/{corte_id}/{nome}",
            "caixa": json.loads(meta.read_text())}


# ---------------------------------------------------------------- textos

ESQUEMA_TEXTOS = {"type": "ARRAY", "items": {"type": "STRING"}}


def textos(c: dict, palavras: list | None) -> dict:
    """Opções curtas de texto para a thumb: pelo Gemini, ou do gancho/nome/fala sem chave."""
    fala = " ".join(w[2] for w in (palavras or []))[:6000]
    reserva = [t for t in (c.get("gancho"), c.get("nome")) if t]
    if fala:
        reserva.append(" ".join(fala.split()[:4]))
    # thumb pede texto curto: no máximo 6 palavras, sem pontuação solta no fim
    reserva = [" ".join(t.split()[:6]).strip(" ,.;:") for t in reserva if t and t.strip()]
    reserva = list(dict.fromkeys(t.upper() for t in reserva if t))[:4]
    aj = ajustes.ler()
    if not aj["gemini_chave"] or not fala:
        return {"opcoes": reserva, "origem": "corte"}
    try:
        modelo = viral.escolher_modelo(viral.listar_modelos(aj["gemini_chave"]), aj["gemini_modelo"])
        prompt = (
            "Você cria textos para thumbnails de vídeos virais (YouTube, Shorts, TikTok).\n"
            "Com base no trecho falado abaixo, crie 4 opções de texto para a thumbnail: 2 a 4 palavras cada, "
            "em MAIÚSCULAS, impactantes, que gerem curiosidade, no mesmo idioma da fala, sem emojis e sem hashtags."
            f"\n\nTRECHO:\n{fala}"
        )
        res = viral.gerar(aj["gemini_chave"], modelo, prompt, esquema=ESQUEMA_TEXTOS, temperatura=0.9)
        opcoes = [str(t).strip().upper()[:60] for t in res if str(t).strip()][:4]
        return {"opcoes": opcoes or reserva, "origem": "gemini" if opcoes else "corte"}
    except (viral.ErroGemini, requests.RequestException) as e:
        return {"opcoes": reserva, "origem": "corte", "aviso": str(e)[:200]}


# ---------------------------------------------------------------- arquivos

def ler_dataurl_png(dataurl: str, limite: int = 25_000_000) -> bytes:
    m = re.match(r"^data:image/(png|jpeg|webp);base64,", dataurl or "")
    if not m:
        raise ValueError("Imagem inválida.")
    dados = base64.b64decode(dataurl[m.end():], validate=True)
    if len(dados) > limite:
        raise ValueError("Imagem grande demais.")
    Image.open(io.BytesIO(dados)).verify()  # garante que é uma imagem de verdade
    return dados


def salvar_imagem_enviada(dataurl: str) -> dict:
    """Imagens adicionadas no editor (stickers, logos): ficam guardadas para reusar."""
    dados = ler_dataurl_png(dataurl, 15_000_000)
    img = Image.open(io.BytesIO(dados))
    img.load()
    if max(img.size) > 2400:
        img.thumbnail((2400, 2400))
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    nome = hashlib.sha1(buf.getvalue()).hexdigest()[:20] + ".png"
    (PASTA_IMAGENS / nome).write_bytes(buf.getvalue())
    return {"arquivo": nome, "url": f"/api/thumb/imagens/{nome}"}


def ler_templates() -> list:
    try:
        dados = json.loads(ARQ_TEMPLATES.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    except (OSError, ValueError):
        return []


def salvar_templates(lista: list) -> list:
    texto = json.dumps(lista, ensure_ascii=False)
    if len(texto) > 5_000_000:
        raise ValueError("Templates grandes demais.")
    ARQ_TEMPLATES.write_text(texto, encoding="utf-8")
    return lista
