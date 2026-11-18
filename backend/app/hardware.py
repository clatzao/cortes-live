"""Detecta o hardware do PC e escolhe sozinho o melhor modo de trabalho.

- Codificador de vídeo: testa de verdade NVENC (NVIDIA), QSV (Intel) e AMF (AMD);
  se nenhum funcionar, usa libx264 no processador.
- Transcrição (Whisper): escolhe dispositivo, modelo e tipo de cálculo de acordo
  com a placa NVIDIA (geração e memória). Na hora de carregar o modelo, o
  transcritor ainda tenta os tipos alternativos e, por último, o processador.
"""
import ctypes
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

from . import config

_estado: dict | None = None
_pronto = threading.Event()
_lock = threading.Lock()


def _rodar(cmd: list[str], timeout: float = 25) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            creationflags=config.SEM_JANELA, encoding="utf-8", errors="replace",
        )
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, "", str(e)


# ---------------------------------------------------------------- placas de vídeo

def _nvidia_smi() -> str | None:
    achado = shutil.which("nvidia-smi")
    if achado:
        return achado
    padrao = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
    return str(padrao) if padrao.exists() else None


def _gpus_nvidia() -> list[dict]:
    smi = _nvidia_smi()
    if not smi:
        return []
    campos = "name,memory.total,driver_version,compute_cap"
    code, out, _ = _rodar([smi, f"--query-gpu={campos}", "--format=csv,noheader,nounits"])
    tem_cc = code == 0
    if not tem_cc:  # drivers antigos não conhecem compute_cap
        code, out, _ = _rodar([smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"])
        if code != 0:
            return []
    gpus = []
    for linha in out.strip().splitlines():
        partes = [p.strip() for p in linha.split(",")]
        try:
            vram_gb = round(float(partes[1]) / 1024, 1)
        except (ValueError, IndexError):
            vram_gb = 0.0
        cc = None
        if tem_cc and len(partes) > 3:
            try:
                cc = float(partes[3])
            except ValueError:
                cc = None
        gpus.append({"nome": partes[0], "vram_gb": vram_gb, "driver": partes[2] if len(partes) > 2 else "", "compute_cap": cc})
    return gpus


def _todas_gpus() -> list[str]:
    if os.name != "nt":
        return []
    code, out, _ = _rodar(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"])
    return [l.strip() for l in out.splitlines() if l.strip()] if code == 0 else []


def _ram_gb() -> float:
    if os.name == "nt":
        class MEMSTAT(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MEMSTAT()
        m.dwLength = ctypes.sizeof(MEMSTAT)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return round(m.ullTotalPhys / 1024**3, 1)
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3, 1)
    except (ValueError, OSError, AttributeError):
        return 0.0


# ---------------------------------------------------------------- codificador de vídeo

def _args_encoder(nome: str, variante: int, perfil: str) -> list[str]:
    """Argumentos do FFmpeg para cada codificador. perfil: 'proxy' (rápido) ou 'final' (qualidade)."""
    proxy = perfil == "proxy"
    if nome == "h264_nvenc":
        if variante == 0:  # presets modernos (driver 456+)
            return ["-c:v", "h264_nvenc", "-preset", "p3" if proxy else "p6", "-rc", "vbr",
                    "-cq", "30" if proxy else "21", "-b:v", "0", "-pix_fmt", "yuv420p"]
        return ["-c:v", "h264_nvenc", "-cq", "30" if proxy else "21", "-pix_fmt", "yuv420p"]
    if nome == "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "veryfast" if proxy else "medium",
                "-global_quality", "30" if proxy else "22", "-pix_fmt", "nv12"]
    if nome == "h264_amf":
        q = "30" if proxy else "22"
        return ["-c:v", "h264_amf", "-quality", "speed" if proxy else "quality", "-rc", "cqp",
                "-qp_i", q, "-qp_p", q, "-pix_fmt", "nv12"]
    return ["-c:v", "libx264", "-preset", "veryfast" if proxy else "medium",
            "-crf", "28" if proxy else "20", "-pix_fmt", "yuv420p"]


_CANDIDATOS = [("h264_nvenc", 0), ("h264_nvenc", 1), ("h264_qsv", 0), ("h264_amf", 0)]
_NOMES_ENCODER = {"h264_nvenc": "NVIDIA NVENC", "h264_qsv": "Intel Quick Sync",
                  "h264_amf": "AMD AMF", "libx264": "Processador (x264)"}


def _encoder_funciona(nome: str, variante: int) -> bool:
    if not config.FFMPEG:
        return False
    cmd = [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
           "-i", "color=c=black:s=640x360:r=30:d=0.5", *_args_encoder(nome, variante, "final"), "-f", "null", "-"]
    code, _, _ = _rodar(cmd, timeout=30)
    return code == 0


def _escolher_encoder() -> tuple[str, int, list[str]]:
    funcionando = []
    escolhido = ("libx264", 0)
    for nome, variante in _CANDIDATOS:
        if nome in funcionando:
            continue
        if _encoder_funciona(nome, variante):
            funcionando.append(nome)
            if escolhido[0] == "libx264":
                escolhido = (nome, variante)
    return escolhido[0], escolhido[1], funcionando + ["libx264"]


# ---------------------------------------------------------------- recomendação do Whisper

# Memória de vídeo aproximada (GB) por modelo e tipo de cálculo.
_MEMORIA = {
    "large-v3":       {"float16": 4.7, "int8_float16": 3.1, "int8": 3.1, "float32": 9.0},
    "large-v3-turbo": {"float16": 2.2, "int8_float16": 1.5, "int8": 1.5, "float32": 4.0},
    "medium":         {"float16": 2.6, "int8_float16": 1.7, "int8": 1.7, "float32": 5.0},
    "small":          {"float16": 1.2, "int8_float16": 0.9, "int8": 0.9, "float32": 2.0},
    "base":           {"float16": 0.6, "int8_float16": 0.5, "int8": 0.5, "float32": 0.9},
}
_ORDEM_MODELOS = ["large-v3-turbo", "medium", "small", "base"]


def _driver_major(driver: str) -> int:
    m = re.match(r"(\d+)", driver or "")
    return int(m.group(1)) if m else 0


def _whisper_cpu(ram: float, cpus: int, motivo: str) -> dict:
    modelo = "base" if ram < 6 else "small"
    return {"dispositivo": "cpu", "modelo": modelo, "compute_type": "int8",
            "alternativas_compute": ["float32"], "gpu": None,
            "motivo": motivo + f" Usando o processador ({cpus} núcleos) com o modelo '{modelo}', "
                      "mais leve. Uma live longa pode levar várias horas."}


def recomendar_whisper(gpus: list[dict], ram: float, cpus: int) -> dict:
    if not gpus:
        return _whisper_cpu(ram, cpus, "Nenhuma placa NVIDIA encontrada.")
    gpu = max(gpus, key=lambda g: g["vram_gb"])
    cc = gpu["compute_cap"]
    if _driver_major(gpu["driver"]) and _driver_major(gpu["driver"]) < 525:
        return _whisper_cpu(ram, cpus, f"O driver da {gpu['nome']} ({gpu['driver']}) é antigo; "
                                       "atualize para 525 ou mais novo para usar a placa.")
    if cc is not None and cc < 5.0:
        return _whisper_cpu(ram, cpus, f"A {gpu['nome']} é antiga demais para o CUDA 12.")

    gtx16 = "GTX 16" in gpu["nome"].upper()
    if cc is None:
        cadeia = ["int8", "float32"]
    elif cc >= 7.0 and not gtx16:
        cadeia = ["float16", "int8_float16", "int8", "float32"]
    elif cc >= 6.1 or gtx16:
        cadeia = ["int8", "float32"]
    else:
        cadeia = ["float32"]

    util = gpu["vram_gb"] * 0.85 - 0.4  # folga para o Windows e o próprio programa
    modelo = None
    for m in _ORDEM_MODELOS:
        if _MEMORIA[m][cadeia[0]] <= util:
            modelo = m
            break
    if modelo is None:
        return _whisper_cpu(ram, cpus, f"A {gpu['nome']} tem pouca memória ({gpu['vram_gb']} GB).")
    return {"dispositivo": "cuda", "modelo": modelo, "compute_type": cadeia[0],
            "alternativas_compute": cadeia[1:], "gpu": gpu["nome"],
            "motivo": f"{gpu['nome']} ({gpu['vram_gb']} GB): modelo '{modelo}' em '{cadeia[0]}'. "
                      "Se não carregar, o programa tenta os modos alternativos e depois o processador."}


# ---------------------------------------------------------------- API do módulo

def detectar() -> dict:
    """Faz a detecção completa (alguns segundos) e guarda o resultado."""
    global _estado
    with _lock:
        gpus = _gpus_nvidia()
        ram = _ram_gb()
        cpus = os.cpu_count() or 1
        encoder, variante, disponiveis = _escolher_encoder()
        _estado = {
            "ffmpeg": config.FFMPEG,
            "ffprobe": config.FFPROBE,
            "placas": _todas_gpus(),
            "nvidia": gpus,
            "ram_gb": ram,
            "cpus": cpus,
            "encoder": encoder,
            "encoder_variante": variante,
            "encoder_nome": _NOMES_ENCODER[encoder],
            "encoders_disponiveis": disponiveis,
            "whisper": recomendar_whisper(gpus, ram, cpus),
        }
        _pronto.set()
        return _estado


def detectar_em_segundo_plano() -> None:
    threading.Thread(target=detectar, daemon=True, name="detectar-hardware").start()


def estado(esperar: bool = True) -> dict | None:
    if esperar:
        _pronto.wait(timeout=120)
    return _estado


def args_video(perfil: str = "final") -> list[str]:
    e = estado() or {"encoder": "libx264", "encoder_variante": 0}
    return _args_encoder(e["encoder"], e["encoder_variante"], perfil)
