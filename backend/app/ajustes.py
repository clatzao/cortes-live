"""Preferências do usuário salvas em dados/ajustes.json."""
import json
import threading

from . import config

_ARQUIVO = config.DADOS / "ajustes.json"
_lock = threading.Lock()

MODELOS_WHISPER = ["auto", "large-v3", "large-v3-turbo", "medium", "small", "base"]
DISPOSITIVOS = ["auto", "cuda", "cpu"]
QUALIDADES = ["1080", "720", "melhor"]  # altura máxima do vídeo baixado por link
RESOLUCOES = ["1080", "1440", "2160"]   # lado menor do vídeo exportado (2160 = 4K)

PADRAO = {
    "whisper_modelo": "auto",
    "whisper_dispositivo": "auto",
    "download_qualidade": "1080",  # 1080p basta para os cortes e baixa bem mais rápido que 4K
    "export_resolucao": "1080",    # 1440 ou 2160 (4K) só valem a pena com vídeo original nessa qualidade
    # Momentos virais
    "gemini_chave": "",          # chave da API do Google AI Studio (fica só neste PC)
    "gemini_modelo": "auto",
    "viral_min": 30,
    "viral_max": 60,
    "viral_qtd": 10,
    "viral_auto": True,          # analisar sozinho quando a transcrição terminar
    # Predefinição de todo corte novo (formatos e extras ficam na marca: formatos_padrao / <extra>.padrao)
    "estilo_padrao": "classico",
    "legenda_padrao": True,
    "auto_cortes": False,        # última escolha da caixinha "criar cortes automaticamente" ao importar
    # Redes sociais: apps de desenvolvedor criados por você (os segredos nunca voltam inteiros para o site)
    "youtube_cliente_id": "",
    "youtube_cliente_segredo": "",
    "tiktok_cliente_chave": "",
    "tiktok_cliente_segredo": "",
    "instagram_app_id": "",
    "instagram_app_segredo": "",
    "iniciar_com_windows": False,  # abrir escondido na bandeja ao ligar o PC (para os agendados saírem)
}
# campos de texto das redes; os que terminam em "_segredo" são mascarados em publico()
CAMPOS_REDES = ("youtube_cliente_id", "youtube_cliente_segredo", "tiktok_cliente_chave", "tiktok_cliente_segredo",
                "instagram_app_id", "instagram_app_segredo")


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
    if novos.get("download_qualidade") in QUALIDADES:
        atual["download_qualidade"] = novos["download_qualidade"]
    if novos.get("export_resolucao") in RESOLUCOES:
        atual["export_resolucao"] = novos["export_resolucao"]
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
    if isinstance(novos.get("estilo_padrao"), str) and novos["estilo_padrao"].strip():
        atual["estilo_padrao"] = novos["estilo_padrao"].strip()[:60]
    for k in ("legenda_padrao", "auto_cortes"):
        if k in novos and novos[k] is not None:
            atual[k] = bool(novos[k])
    for k in CAMPOS_REDES:
        if novos.get(k) is not None:
            atual[k] = str(novos[k]).strip()[:500]
    if novos.get("iniciar_com_windows") is not None:
        from . import inicio_windows
        inicio_windows.aplicar(bool(novos["iniciar_com_windows"]))  # falha aqui não grava o ajuste
        atual["iniciar_com_windows"] = bool(novos["iniciar_com_windows"])
    _gravar(atual)
    return atual


def publico() -> dict:
    """Ajustes para mostrar no site: a chave nunca volta inteira."""
    a = ler()
    chave = a.pop("gemini_chave")
    a["gemini_tem_chave"] = bool(chave)
    a["gemini_chave_final"] = chave[-4:] if len(chave) >= 8 else ""
    for k in CAMPOS_REDES:
        if k.endswith("_segredo"):
            a[k + "_tem"] = bool(a.pop(k))
    from . import inicio_windows
    a["iniciar_com_windows_disponivel"] = inicio_windows.disponivel()
    return a
