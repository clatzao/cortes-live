"""Preferências do usuário salvas em dados/ajustes.json."""
import json
import threading

from . import config

_ARQUIVO = config.DADOS / "ajustes.json"
_lock = threading.Lock()

MODELOS_WHISPER = ["auto", "large-v3", "large-v3-turbo", "medium", "small", "base"]
DISPOSITIVOS = ["auto", "cuda", "cpu"]

PADRAO = {
    "whisper_modelo": "auto",
    "whisper_dispositivo": "auto",
    # Momentos virais
    "gemini_chave": "",          # chave da API do Google AI Studio (fica só neste PC)
    "gemini_modelo": "auto",
    "viral_min": 30,
    "viral_max": 60,
    "viral_qtd": 10,
    "viral_auto": True,          # analisar sozinho quando a transcrição terminar
}


def ler() -> dict:
    with _lock:
        try:
            dados = json.loads(_ARQUIVO.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            dados = {}
    return {**PADRAO, **{k: v for k, v in dados.items() if k in PADRAO}}


def _gravar(dados: dict) -> None:
    with _lock:
        _ARQUIVO.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")


def _inteiro(v, lo, hi, padrao):
    try:
        return int(min(hi, max(lo, int(v))))
    except (TypeError, ValueError):
        return padrao


def salvar(novos: dict) -> dict:
    atual = ler()
    if novos.get("whisper_modelo") in MODELOS_WHISPER:
        atual["whisper_modelo"] = novos["whisper_modelo"]
    if novos.get("whisper_dispositivo") in DISPOSITIVOS:
        atual["whisper_dispositivo"] = novos["whisper_dispositivo"]
    if "gemini_chave" in novos and novos["gemini_chave"] is not None:
        atual["gemini_chave"] = str(novos["gemini_chave"]).strip()
    if isinstance(novos.get("gemini_modelo"), str) and novos["gemini_modelo"].strip():
        atual["gemini_modelo"] = novos["gemini_modelo"].strip()
    if "viral_min" in novos:
        atual["viral_min"] = _inteiro(novos["viral_min"], 5, 600, 30)
    if "viral_max" in novos:
        atual["viral_max"] = _inteiro(novos["viral_max"], 5, 900, 60)
    if atual["viral_max"] < atual["viral_min"]:
        atual["viral_max"] = atual["viral_min"]
    if "viral_qtd" in novos:
        atual["viral_qtd"] = _inteiro(novos["viral_qtd"], 1, 50, 10)
    if "viral_auto" in novos:
        atual["viral_auto"] = bool(novos["viral_auto"])
    _gravar(atual)
    return atual


def publico() -> dict:
    """Ajustes para mostrar no site: a chave nunca volta inteira."""
    a = ler()
    chave = a.pop("gemini_chave")
    a["gemini_tem_chave"] = bool(chave)
    a["gemini_chave_final"] = chave[-4:] if len(chave) >= 8 else ""
    return a
