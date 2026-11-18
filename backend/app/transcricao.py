"""Transcrição da live com faster-whisper (timestamps por palavra).

Adapta-se a qualquer PC: tenta a placa NVIDIA nos modos recomendados pelo
hardware.py e, se nada funcionar, usa o processador. O áudio é processado em
blocos de ~15 min cortados em pontos de silêncio, para não ocupar muita memória
mesmo em lives de muitas horas.
"""
import gc
import json
import os
import threading
import time
from pathlib import Path

import numpy as np

from . import ajustes, config, db, hardware, jobs, media
from .jobs import Contexto
from .tempo import formatar

TAXA = 16000
BLOCO = 15 * 60  # segundos por bloco
JANELA_SILENCIO = 30  # procura silêncio até 30 s antes/depois do ponto ideal

_modelo = None
_chave_modelo: tuple | None = None
_lock = threading.Lock()
_dlls_prontas = False

# Frases que o Whisper costuma "inventar" em trechos de música ou silêncio.
_ALUCINACOES = ("amara.org", "legendas pela comunidade", "legendado por", "subtitles by")


def _preparar_dlls_cuda() -> None:
    """No Windows, as DLLs do CUDA instaladas pelo pip ficam em site-packages/nvidia/*/bin."""
    global _dlls_prontas
    if _dlls_prontas or os.name != "nt":
        return
    _dlls_prontas = True
    try:
        import nvidia  # pacote presente só com o extra "gpu"
    except ImportError:
        return
    for base in getattr(nvidia, "__path__", []):
        for pasta_bin in Path(base).glob("*/bin"):
            os.add_dll_directory(str(pasta_bin))
            os.environ["PATH"] = str(pasta_bin) + os.pathsep + os.environ.get("PATH", "")


def _candidatos() -> list[tuple[str, str, str]]:
    """Lista (dispositivo, tipo de cálculo, modelo) na ordem em que serão tentados."""
    hw = hardware.estado() or {}
    rec = hw.get("whisper") or {"dispositivo": "cpu", "modelo": "small", "compute_type": "int8",
                                "alternativas_compute": []}
    aj = ajustes.ler()
    escolhido = aj["whisper_modelo"]
    disp = aj["whisper_dispositivo"]

    lista: list[tuple[str, str, str]] = []
    if disp in ("auto", "cuda"):
        if rec["dispositivo"] == "cuda":
            modelo_gpu = rec["modelo"] if escolhido == "auto" else escolhido
            for ct in [rec["compute_type"], *rec["alternativas_compute"]]:
                lista.append(("cuda", ct, modelo_gpu))
        elif disp == "cuda":  # usuário forçou a placa mesmo sem detecção
            modelo_gpu = "large-v3-turbo" if escolhido == "auto" else escolhido
            lista += [("cuda", ct, modelo_gpu) for ct in ("float16", "int8", "float32")]
    # O processador é sempre a última opção, para nunca ficar sem transcrição.
    modelo_cpu = escolhido if escolhido != "auto" else ("small" if hw.get("ram_gb", 8) >= 6 else "base")
    lista.append(("cpu", "int8", modelo_cpu))
    return lista


def _carregar(ctx: Contexto) -> tuple[object, tuple[str, str, str]]:
    global _modelo, _chave_modelo
    from faster_whisper import WhisperModel

    _preparar_dlls_cuda()
    falhas = []
    with _lock:
        for chave in _candidatos():
            disp, ct, nome = chave
            if _chave_modelo == chave and _modelo is not None:
                return _modelo, chave
            if _modelo is not None:  # libera a memória do modelo anterior antes de carregar outro
                _modelo, _chave_modelo = None, None
                gc.collect()
            ctx.progresso(0.05, f"Carregando modelo '{nome}' ({'placa de vídeo' if disp == 'cuda' else 'processador'}, "
                                f"{ct}). Na primeira vez ele é baixado, pode demorar.", forcar=True)
            try:
                if disp == "cuda":
                    import ctranslate2
                    if ctranslate2.get_cuda_device_count() == 0:
                        raise RuntimeError("CUDA indisponível (bibliotecas da NVIDIA não instaladas ou driver antigo)")
                threads = max(1, (os.cpu_count() or 4) - 1) if disp == "cpu" else 0
                m = WhisperModel(nome, device=disp, compute_type=ct, cpu_threads=threads,
                                 download_root=str(config.DADOS / "modelos"))
                # Teste real: um segundo de silêncio precisa passar pelo modelo sem erro.
                segs, _ = m.transcribe(np.zeros(TAXA, dtype=np.float32), language="pt", beam_size=1)
                list(segs)
            except Exception as e:  # noqa: BLE001 - qualquer falha leva ao próximo modo
                falhas.append(f"{disp}/{ct}/{nome}: {str(e).strip()[:300]}")
                gc.collect()
                continue
            _modelo, _chave_modelo = m, chave
            return m, chave
    raise RuntimeError("Não foi possível carregar o Whisper em nenhum modo:\n" + "\n".join(falhas))


def _pontos_de_corte(arquivo_ondas: Path, total: float) -> list[tuple[float, float]]:
    """Divide o áudio em blocos de ~15 min, cortando no ponto mais silencioso perto de cada divisa."""
    try:
        ondas = json.loads(arquivo_ondas.read_text())
        rms, taxa = ondas["rms"], ondas["taxa"]
    except (OSError, ValueError, KeyError):
        rms, taxa = [], 10
    pontos = [0.0]
    alvo = BLOCO
    while alvo < total - 60:
        corte = alvo
        if rms:
            i1 = max(0, int((alvo - JANELA_SILENCIO) * taxa))
            i2 = min(len(rms), int((alvo + JANELA_SILENCIO) * taxa))
            if i2 > i1:
                trecho = rms[i1:i2]
                corte = (i1 + int(np.argmin(trecho))) / taxa
        if corte > pontos[-1] + 60:
            pontos.append(corte)
        alvo = pontos[-1] + BLOCO
    pontos.append(total)
    return list(zip(pontos[:-1], pontos[1:]))


def _alucinacao(texto: str) -> bool:
    t = texto.lower()
    return any(a in t for a in _ALUCINACOES)


def caminho(projeto_id: int) -> Path:
    return config.PROJETOS / str(projeto_id) / "transcricao.json"


def _salvar(destino: Path, dados: dict) -> None:
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for _ in range(20):  # o arquivo pode estar sendo lido pelo site naquele instante
        try:
            tmp.replace(destino)
            return
        except PermissionError:
            time.sleep(0.1)
    tmp.unlink(missing_ok=True)


@jobs.registrar("transcrever", faixa="pesada")
def transcrever(ctx: Contexto) -> str | None:
    p = db.um("SELECT * FROM projetos WHERE id=?", (ctx.job["projeto_id"],))
    if not p:
        raise RuntimeError("O projeto foi removido.")
    if p["status"] != "pronto" or not p["caminho_original"]:
        raise RuntimeError("Importe o projeto antes de transcrever.")
    origem = p["caminho_original"]
    if not media.analisar(origem)["tem_audio"]:
        raise RuntimeError("O vídeo não tem áudio.")

    pasta = config.PROJETOS / str(p["id"])
    bruto = pasta / "audio16k.raw"
    try:
        media.rodar_ffmpeg(["-i", origem, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(TAXA),
                            "-f", "s16le", str(bruto)], p["duracao"], ctx, 0.0, 0.05, "Extraindo o áudio")
        modelo, (disp, ct, nome) = _carregar(ctx)
        total = bruto.stat().st_size / 2 / TAXA

        parametros: dict = {
            "word_timestamps": True,
            "vad_filter": True,
            "vad_parameters": {"min_silence_duration_ms": 500},
            "condition_on_previous_text": False,
            "beam_size": 5 if disp == "cuda" else 1,
        }
        if p["idioma"] == "misto":
            parametros["multilingual"] = True
        else:
            parametros["language"] = p["idioma"]

        resultado = {"parcial": True, "idioma": p["idioma"], "modelo": nome, "dispositivo": disp,
                     "compute_type": ct, "duracao": total, "segmentos": []}
        segmentos = resultado["segmentos"]
        final = caminho(p["id"])
        # Se já existe uma transcrição completa, ela continua valendo até a nova terminar
        # (cancelar uma re-transcrição não apaga a anterior).
        destino = final.with_name("transcricao.nova.json") if final.exists() else final
        ultimo_salvo = time.time()
        inicio_relogio = time.time()

        for a, b in _pontos_de_corte(pasta / "ondas.json", total):
            ctx.checar()
            amostras = np.fromfile(bruto, dtype=np.int16, count=int((b - a) * TAXA), offset=int(a * TAXA) * 2)
            audio = amostras.astype(np.float32) / 32768.0
            del amostras
            segs, _info = modelo.transcribe(audio, **parametros)
            for s in segs:
                ctx.checar()
                texto = s.text.strip()
                if not texto or _alucinacao(texto) or (s.no_speech_prob > 0.8 and s.avg_logprob < -1.0):
                    continue
                palavras = [[round(w.start + a, 2), round(max(w.end, w.start) + a, 2), w.word.strip(),
                             round(w.probability, 2)] for w in (s.words or []) if w.word.strip()]
                segmentos.append({"inicio": round(s.start + a, 2), "fim": round(max(s.end, s.start) + a, 2),
                                  "texto": texto, "palavras": palavras})
                feito = min(1.0, (a + s.end) / total)
                decorrido = time.time() - inicio_relogio
                restante = f" · faltam ~{formatar(decorrido / feito * (1 - feito))[:8]}" if feito > 0.02 else ""
                ctx.progresso(0.08 + 0.92 * feito, f"Transcrevendo {formatar(a + s.end)[:8]} de "
                                                    f"{formatar(total)[:8]}{restante}")
                if time.time() - ultimo_salvo > 10:
                    _salvar(destino, resultado)
                    ultimo_salvo = time.time()
            del audio
            ctx.progresso(0.08 + 0.92 * min(1.0, b / total), forcar=True)

        resultado["parcial"] = False
        _salvar(final, resultado)
        if (ajustes.ler()["viral_auto"] or p.get("auto_cortes")) and segmentos:
            jobs.enfileirar("analisar", projeto_id=p["id"])  # momentos virais logo em seguida
        return str(final)
    finally:
        media.apagar_arquivo(bruto)
        media.apagar_arquivo(caminho(p["id"]).with_name("transcricao.nova.json"))
