"""Operações de vídeo com FFmpeg: análise, proxy de preview, forma de onda e cortes."""
import collections
import functools
import json
import os
import subprocess
import threading
import time
from pathlib import Path

import numpy as np

from . import config, hardware
from .jobs import Cancelado, Contexto


def _exigir_ffmpeg() -> None:
    if not config.FFMPEG or not config.FFPROBE:
        raise RuntimeError("FFmpeg não encontrado. Rode o instalar.bat ou instale o FFmpeg.")


@functools.lru_cache(maxsize=32)
def _analisar_cache(caminho: str, mtime: int, tamanho: int) -> dict:
    return analisar(caminho)


def analisar_rapido(caminho: str) -> dict:
    """analisar() guardado em memória enquanto o arquivo não mudar."""
    st = os.stat(caminho)
    return dict(_analisar_cache(caminho, st.st_mtime_ns, st.st_size))


def proxy_de(projeto_id: int) -> Path:
    return config.PROJETOS / str(projeto_id) / "proxy.mp4"


def analisar(caminho: str) -> dict:
    """Lê duração, resolução e fps do vídeo com o ffprobe."""
    _exigir_ffmpeg()
    r = subprocess.run(
        [config.FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", caminho],
        capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=config.SEM_JANELA,
    )
    if r.returncode != 0:
        raise RuntimeError(f"Não foi possível ler o vídeo: {r.stderr.strip()[-500:]}")
    dados = json.loads(r.stdout or "{}")
    streams = dados.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise RuntimeError("O arquivo não tem faixa de vídeo.")

    def _fps(txt: str | None) -> float:
        try:
            a, b = (txt or "0/1").split("/")
            return float(a) / float(b) if float(b) else 0.0
        except ValueError:
            return 0.0

    fps = _fps(video.get("avg_frame_rate")) or _fps(video.get("r_frame_rate")) or 30.0
    duracao = float(dados.get("format", {}).get("duration") or video.get("duration") or 0)
    if duracao <= 0:
        raise RuntimeError("Não foi possível descobrir a duração do vídeo.")
    return {"duracao": duracao, "largura": int(video.get("width") or 0), "altura": int(video.get("height") or 0),
            "fps": round(fps, 3), "tem_audio": audio is not None}


def encerrar(proc: subprocess.Popen) -> None:
    """Encerra o processo e seus filhos e espera ele terminar de verdade."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True,
                       creationflags=config.SEM_JANELA)
    else:
        proc.kill()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def apagar_arquivo(caminho: Path, tentativas: int = 20) -> None:
    """Apaga um arquivo temporário; o Windows (antivírus/indexador) às vezes o segura por instantes."""
    for _ in range(tentativas):
        try:
            caminho.unlink(missing_ok=True)
            return
        except PermissionError:
            time.sleep(0.25)


def _ler_stderr(proc: subprocess.Popen, destino: collections.deque) -> None:
    for linha in iter(proc.stderr.readline, b""):
        destino.append(linha.decode("utf-8", "replace").rstrip())


def rodar_ffmpeg(args: list[str], duracao: float, ctx: Contexto, base: float = 0.0,
                 peso: float = 1.0, mensagem: str | None = None) -> None:
    """Roda o FFmpeg mostrando o progresso e permitindo cancelar."""
    _exigir_ffmpeg()
    cmd = [config.FFMPEG, "-hide_banner", "-y", "-progress", "pipe:1", "-nostats", *args]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=config.SEM_JANELA)
    erros: collections.deque = collections.deque(maxlen=40)
    leitor = threading.Thread(target=_ler_stderr, args=(proc, erros), daemon=True)
    leitor.start()
    if mensagem:
        ctx.progresso(base, mensagem, forcar=True)
    try:
        for bruto in iter(proc.stdout.readline, b""):
            linha = bruto.decode("utf-8", "replace").strip()
            if linha.startswith("out_time_us=") or linha.startswith("out_time_ms="):
                try:
                    segundos = int(linha.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                if duracao > 0:
                    ctx.progresso(base + peso * min(1.0, segundos / duracao))
            elif linha.startswith("progress="):
                if ctx.cancelado():
                    raise Cancelado()
        proc.wait()
    finally:
        encerrar(proc)
        leitor.join(timeout=2)
    if ctx.cancelado():
        raise Cancelado()
    if proc.returncode != 0:
        detalhes = "\n".join(list(erros)[-8:])
        raise RuntimeError(f"FFmpeg falhou (código {proc.returncode}):\n{detalhes}")


def gerar_proxy(origem: str, destino: Path, info: dict, ctx: Contexto, base: float, peso: float) -> None:
    """Cópia leve em 480p para tocar no navegador (o corte final usa o original)."""
    filtros = []
    if info["altura"] > 480:
        filtros.append("scale=-2:480")
    fps_saida = info["fps"]
    if info["fps"] > 31:
        filtros.append("fps=30")
        fps_saida = 30
    args = ["-i", origem, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"]
    if filtros:
        args += ["-vf", ",".join(filtros)]
    args += hardware.args_video("proxy")
    args += ["-g", str(max(1, round(fps_saida))), "-c:a", "aac", "-b:a", "96k", "-ac", "2",
             "-movflags", "+faststart", str(destino)]
    rodar_ffmpeg(args, info["duracao"], ctx, base, peso, "Gerando preview")


TAXA_ONDAS = 10  # valores por segundo


def gerar_ondas(origem: str, destino: Path, info: dict, ctx: Contexto, base: float, peso: float) -> None:
    """Calcula pico e volume médio do áudio a cada 0,1 s (timeline e detecção de momentos)."""
    _exigir_ffmpeg()
    ctx.progresso(base, "Lendo o áudio", forcar=True)
    if not info.get("tem_audio"):
        n = int(info["duracao"] * TAXA_ONDAS) + 1
        destino.write_text(json.dumps({"taxa": TAXA_ONDAS, "picos": [0] * n, "rms": [0] * n}))
        return
    amostras_por_bloco = 8000 // TAXA_ONDAS
    cmd = [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-i", origem, "-map", "0:a:0", "-vn",
           "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=config.SEM_JANELA)
    erros: collections.deque = collections.deque(maxlen=20)
    leitor = threading.Thread(target=_ler_stderr, args=(proc, erros), daemon=True)
    leitor.start()
    picos: list[np.ndarray] = []
    rms: list[np.ndarray] = []
    total = info["duracao"] * 8000 * 2
    lidos = 0
    sobra = b""
    tamanho_leitura = amostras_por_bloco * 2 * 600  # 60 s de áudio por leitura
    try:
        while True:
            pedaco = proc.stdout.read(tamanho_leitura)
            if not pedaco:
                break
            lidos += len(pedaco)
            dados = sobra + pedaco
            usavel = len(dados) - len(dados) % (amostras_por_bloco * 2)
            sobra = dados[usavel:]
            if usavel:
                blocos = np.frombuffer(dados[:usavel], dtype=np.int16).reshape(-1, amostras_por_bloco)
                f = blocos.astype(np.float32) / 32768.0
                picos.append(np.abs(f).max(axis=1))
                rms.append(np.sqrt((f * f).mean(axis=1)))
            ctx.progresso(base + peso * min(1.0, lidos / total))
            if ctx.cancelado():
                raise Cancelado()
        proc.wait()
    finally:
        encerrar(proc)
        leitor.join(timeout=2)
    if proc.returncode != 0:
        raise RuntimeError("Falha ao ler o áudio:\n" + "\n".join(erros))
    p = np.concatenate(picos) if picos else np.zeros(1, dtype=np.float32)
    r = np.concatenate(rms) if rms else np.zeros(1, dtype=np.float32)
    destino.write_text(json.dumps({
        "taxa": TAXA_ONDAS,
        "picos": np.round(p * 100).astype(int).tolist(),
        "rms": np.round(r * 100).astype(int).tolist(),
    }))


# ---------------------------------------------------------------- miniaturas da timeline

MINI_W, MINI_H, MINI_COLUNAS, MINI_MAX = 96, 54, 20, 1500
_mini_gerando: set[int] = set()
_mini_lock = threading.Lock()


def arquivos_miniaturas(projeto_id: int) -> tuple[Path, Path]:
    pasta = config.PROJETOS / str(projeto_id)
    return pasta / "miniaturas.jpg", pasta / "miniaturas.json"


def gerar_miniaturas(projeto_id: int, duracao: float) -> None:
    """Uma imagem com um quadro a cada N segundos (lendo só os quadros-chave do proxy: rápido)."""
    img, meta = arquivos_miniaturas(projeto_id)
    proxy = proxy_de(projeto_id)
    if not proxy.is_file() or duracao <= 0:
        return
    intervalo = max(2, -(-int(duracao) // MINI_MAX))  # teto
    n = max(1, -(-int(duracao) // intervalo))
    linhas = -(-n // MINI_COLUNAS)
    tmp = img.with_name("miniaturas.parcial.jpg")
    r = subprocess.run(
        [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-skip_frame", "nokey", "-i", str(proxy), "-an",
         "-vf", f"fps=1/{intervalo},scale={MINI_W}:{MINI_H}:force_original_aspect_ratio=increase,"
                f"crop={MINI_W}:{MINI_H},tile={MINI_COLUNAS}x{linhas}",
         "-frames:v", "1", "-q:v", "5", str(tmp)],
        capture_output=True, creationflags=config.SEM_JANELA)
    if r.returncode == 0 and tmp.is_file():
        tmp.replace(img)
        meta.write_text(json.dumps({"intervalo": intervalo, "n": n, "colunas": MINI_COLUNAS,
                                    "largura": MINI_W, "altura": MINI_H}), encoding="utf-8")
    else:
        apagar_arquivo(tmp)


def miniaturas_em_segundo_plano(projeto_id: int, duracao: float) -> None:
    with _mini_lock:
        if projeto_id in _mini_gerando:
            return
        _mini_gerando.add(projeto_id)

    def rodar():
        try:
            gerar_miniaturas(projeto_id, duracao)
        finally:
            with _mini_lock:
                _mini_gerando.discard(projeto_id)

    threading.Thread(target=rodar, daemon=True).start()
