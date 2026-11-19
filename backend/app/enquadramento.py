"""Enquadramento automático: o recorte 9:16 (ou 1:1) segue o rosto de quem está falando.

1. Lê o trecho do corte a 5 quadros por segundo (do proxy, que é leve).
2. Acha os rostos com o YuNet (OpenCV, modelo ONNX de ~230 KB, baixado na primeira vez).
3. Escolhe quem está falando: o rosto com mais movimento na boca (e maior), com tolerância para não
   ficar pulando de um rosto para outro: só troca se o outro dominar por TROCA_S segundos.
4. Suaviza (zona morta + amortecimento) e grava a trilha [[t, x_centro], ...] no corte.
   t é relativo ao início do corte; x_centro é a fração da largura (o mesmo que crop_x).

É heurística: erra às vezes (rosto de perfil, plateia, cortes de câmera). Por isso a trilha é editável
e o modo fixo continua disponível.
"""
import json
import subprocess
import threading
from pathlib import Path

import numpy as np
import requests

from . import config, db, jobs, media
from .jobs import Contexto

URL_MODELO = ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
              "face_detection_yunet_2023mar.onnx")
ARQ_MODELO = config.DADOS / "modelos" / "face_detection_yunet_2023mar.onnx"
AMOSTRAS_POR_S = 5
LARGURA_ANALISE = 640
PASSO_TRILHA = 0.2       # s entre pontos da trilha
TROCA_S = 1.5            # outro rosto precisa dominar este tempo para a câmera trocar
ZONA_MORTA = 0.03        # movimentos menores que isto (fração da largura) são ignorados
AMORTECER = 0.25         # quanto do caminho até o alvo anda a cada amostra (0-1)
MESMO_ROSTO = 0.08       # rostos a menos disto (fração da largura) são considerados o mesmo
_lock = threading.Lock()


def _modelo() -> str:
    with _lock:
        if not ARQ_MODELO.exists() or ARQ_MODELO.stat().st_size < 100_000:
            ARQ_MODELO.parent.mkdir(parents=True, exist_ok=True)
            parcial = ARQ_MODELO.with_suffix(".parcial")
            r = requests.get(URL_MODELO, timeout=60)
            r.raise_for_status()
            parcial.write_bytes(r.content)
            if parcial.stat().st_size < 100_000:
                parcial.unlink(missing_ok=True)
                raise RuntimeError("O download do detector de rostos veio incompleto. Tente de novo.")
            parcial.replace(ARQ_MODELO)
    return str(ARQ_MODELO)


def _quadros(origem: str, inicio: float, duracao: float, w: int, h: int, ctx: Contexto):
    """Gera (t_relativo, quadro BGR) a AMOSTRAS_POR_S por segundo."""
    cmd = [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{inicio:.3f}", "-t", f"{duracao:.3f}",
           "-i", origem, "-vf", f"fps={AMOSTRAS_POR_S},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            creationflags=config.SEM_JANELA)
    tamanho = w * h * 3
    i = 0
    try:
        while True:
            bruto = proc.stdout.read(tamanho)
            if len(bruto) < tamanho:
                break
            ctx.checar()
            yield i / AMOSTRAS_POR_S, np.frombuffer(bruto, dtype=np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        media.encerrar(proc)


def _boca(quadro: np.ndarray, rosto: np.ndarray) -> np.ndarray | None:
    """Recorte cinza da região da boca (pelos cantos da boca do YuNet), 24x12 px."""
    import cv2

    x, y, w, h = rosto[:4]
    bx1, by1, bx2, by2 = rosto[10], rosto[11], rosto[12], rosto[13]  # cantos direito e esquerdo da boca
    cx, cy = (bx1 + bx2) / 2, (by1 + by2) / 2
    lw, lh = max(8.0, w * 0.45), max(6.0, h * 0.28)
    a, b = int(max(0, cx - lw / 2)), int(max(0, cy - lh / 2))
    c, d = int(min(quadro.shape[1], cx + lw / 2)), int(min(quadro.shape[0], cy + lh / 2))
    if c - a < 4 or d - b < 4:
        return None
    return cv2.resize(cv2.cvtColor(quadro[b:d, a:c], cv2.COLOR_BGR2GRAY), (24, 12)).astype(np.float32)


def calcular(origem: str, inicio: float, duracao: float, largura: int, altura: int,
             ctx: Contexto) -> list[list[float]] | None:
    """Trilha [[t, x], ...] do corte, ou None se nenhum rosto apareceu."""
    import cv2

    w = LARGURA_ANALISE
    h = max(2, int(round(altura * w / largura / 2)) * 2)
    detector = cv2.FaceDetectorYN.create(_modelo(), "", (w, h), score_threshold=0.7)
    alvo: float | None = None          # x do rosto escolhido
    desafiante: float | None = None    # x de outro rosto que está dominando
    desde = 0.0
    bocas: dict[int, np.ndarray] = {}  # boca do quadro anterior, por posição aproximada (em 1/20 da largura)
    brutos: list[tuple[float, float | None]] = []
    total = max(1, int(duracao * AMOSTRAS_POR_S))
    com_rosto = 0

    for n, (t, q) in enumerate(_quadros(origem, inicio, duracao, w, h, ctx)):
        _, rostos = detector.detect(q)
        candidatos = []
        novas_bocas: dict[int, np.ndarray] = {}
        for r in (rostos if rostos is not None else []):
            x = float((r[0] + r[2] / 2) / w)
            chave = int(x * 20)
            boca = _boca(q, r)
            movimento = 0.0
            if boca is not None:
                anterior = bocas.get(chave)
                if anterior is None:
                    anterior = bocas.get(chave - 1, bocas.get(chave + 1))
                if anterior is not None:
                    movimento = float(np.abs(boca - anterior).mean())
                novas_bocas[chave] = boca
            tamanho = float(r[2] / w)
            candidatos.append((x, movimento, tamanho))
        bocas = novas_bocas
        if candidatos:
            com_rosto += 1
            m_max = max(c[1] for c in candidatos) or 1.0
            t_max = max(c[2] for c in candidatos) or 1.0
            melhor = max(candidatos, key=lambda c: 0.7 * c[1] / m_max + 0.3 * c[2] / t_max)[0]
            if alvo is None:
                alvo = melhor
            elif abs(melhor - alvo) <= MESMO_ROSTO:
                alvo = melhor          # o mesmo rosto se mexendo: acompanha
                desafiante = None
            elif desafiante is not None and abs(melhor - desafiante) <= MESMO_ROSTO:
                if t - desde >= TROCA_S:
                    alvo, desafiante = melhor, None   # o outro dominou tempo bastante: troca
            else:
                desafiante, desde = melhor, t
        brutos.append((t, alvo))
        if n % 10 == 0:
            ctx.progresso(min(0.95, n / total), "Procurando quem está falando")

    if com_rosto == 0:
        return None
    # antes do primeiro rosto, usa o primeiro alvo encontrado; depois, segura o último
    primeiro = next(x for _, x in brutos if x is not None)
    suave: list[tuple[float, float]] = []
    atual = primeiro
    for t, x in brutos:
        destino = x if x is not None else atual
        if abs(destino - atual) > ZONA_MORTA:
            atual += (destino - atual) * AMORTECER
        suave.append((t, atual))
    # reamostra a cada PASSO_TRILHA e arredonda
    trilha: list[list[float]] = []
    proximo = 0.0
    for t, x in suave:
        if t + 1e-6 >= proximo:
            trilha.append([round(t, 2), round(min(1.0, max(0.0, x)), 4)])
            proximo += PASSO_TRILHA
    return trilha


def valor_em(trilha: list[list[float]], t: float) -> float:
    """x do centro do recorte no instante t (relativo ao corte), interpolando a trilha."""
    if not trilha:
        return 0.5
    if t <= trilha[0][0]:
        return trilha[0][1]
    for (t0, x0), (t1, x1) in zip(trilha, trilha[1:]):
        if t0 <= t <= t1:
            return x0 + (x1 - x0) * ((t - t0) / (t1 - t0) if t1 > t0 else 0)
    return trilha[-1][1]


def trilha_valida(c: dict) -> list[list[float]] | None:
    """A trilha salva no corte, se ainda vale para o intervalo atual (mudou início/fim = recalcular)."""
    if not c.get("trilha_foco"):
        return None
    try:
        dados = json.loads(c["trilha_foco"])
    except ValueError:
        return None
    if abs(dados.get("inicio", -1) - c["inicio"]) > 0.05 or abs(dados.get("fim", -1) - c["fim"]) > 0.05:
        return None
    return dados.get("pontos") or None


def calcular_corte(c: dict, p: dict, ctx: Contexto) -> list[list[float]] | None:
    """Calcula e salva a trilha do corte. None = nenhum rosto (o corte volta para o modo fixo)."""
    proxy = media.proxy_de(p["id"])
    origem = str(proxy) if proxy.is_file() else p["caminho_original"]
    if not origem or not Path(origem).is_file():
        raise RuntimeError("O vídeo deste projeto não está disponível.")
    pontos = calcular(origem, c["inicio"], c["fim"] - c["inicio"], p["largura"] or 1920, p["altura"] or 1080, ctx)
    if pontos is None:
        db.executar("UPDATE cortes SET enquadramento='fixo', trilha_foco=NULL WHERE id=?", (c["id"],))
        return None
    db.executar("UPDATE cortes SET trilha_foco=? WHERE id=?",
                (db.json_dump({"inicio": c["inicio"], "fim": c["fim"], "pontos": pontos, "editada": False}), c["id"]))
    return pontos


@jobs.registrar("enquadrar", faixa="foco")  # faixa própria: leve, não espera transcrição
def enquadrar(ctx: Contexto) -> str:
    c = db.um("SELECT * FROM cortes WHERE id=?", (ctx.job["corte_id"],))
    if not c:
        raise RuntimeError("O corte foi removido.")
    p = db.um("SELECT * FROM projetos WHERE id=?", (c["projeto_id"],))
    ctx.progresso(0.02, "Preparando o detector de rostos", forcar=True)
    pontos = calcular_corte(c, p, ctx)
    if pontos is None:
        return "Nenhum rosto encontrado: o corte ficou com o enquadramento fixo."
    xs = [x for _, x in pontos]
    return f"Enquadramento calculado: {len(pontos)} pontos, centro entre {min(xs):.0%} e {max(xs):.0%}."


def comandos_sendcmd(pontos: list[list[float]], w: int, cw: int, instancia: str = "foco") -> str:
    """Arquivo do filtro sendcmd do FFmpeg: muda o x do recorte ao longo do corte."""
    linhas = []
    for t, x in pontos:
        cx = int(min(max(0, x * w - cw / 2), w - cw))
        linhas.append(f"{t:.2f} crop@{instancia} x {cx};")
    return "\n".join(linhas) + "\n"
