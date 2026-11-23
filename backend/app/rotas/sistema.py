"""Hardware, ajustes (Whisper, Gemini, padrão dos cortes) e a janela de escolher arquivo."""
import requests
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import ajustes, hardware, viral

router = APIRouter()


@router.get("/api/hardware")
def ver_hardware():
    return hardware.estado(esperar=False) or {"detectando": True}


@router.post("/api/hardware/detectar")
def detectar_hardware():
    return hardware.detectar()


class Ajustes(BaseModel):
    whisper_modelo: str | None = None
    whisper_dispositivo: str | None = None
    download_qualidade: str | None = None
    export_resolucao: str | None = None
    gemini_chave: str | None = None   # "" apaga a chave
    gemini_modelo: str | None = None
    viral_min: int | None = None
    viral_max: int | None = None
    viral_qtd: int | None = None
    viral_auto: bool | None = None
    estilo_padrao: str | None = None
    legenda_padrao: bool | None = None
    auto_cortes: bool | None = None
    youtube_cliente_id: str | None = None
    youtube_cliente_segredo: str | None = None
    tiktok_cliente_chave: str | None = None
    tiktok_cliente_segredo: str | None = None
    instagram_app_id: str | None = None
    instagram_app_segredo: str | None = None
    iniciar_com_windows: bool | None = None


@router.get("/api/ajustes")
def ver_ajustes():
    return {**ajustes.publico(), "opcoes": {"whisper_modelo": ajustes.MODELOS_WHISPER,
                                            "whisper_dispositivo": ajustes.DISPOSITIVOS,
                                            "download_qualidade": ajustes.QUALIDADES,
                                            "export_resolucao": ajustes.RESOLUCOES}}


@router.put("/api/ajustes")
def salvar_ajustes(dados: Ajustes):
    try:
        ajustes.salvar(dados.model_dump(exclude_none=True))
    except (ValueError, OSError) as e:
        raise HTTPException(400, str(e)) from e
    return ver_ajustes()


@router.post("/api/ajustes/testar-gemini")
def testar_gemini():
    """Confere a chave salva e lista os modelos disponíveis para ela."""
    chave = ajustes.ler()["gemini_chave"]
    if not chave:
        raise HTTPException(400, "Nenhuma chave salva.")
    try:
        nomes = viral.listar_modelos(chave)
        escolhido = viral.escolher_modelo(nomes, ajustes.ler()["gemini_modelo"])
    except (viral.ErroGemini, requests.RequestException) as e:
        raise HTTPException(400, str(e)) from e
    flash = sorted(n for n in nomes if n.startswith("gemini"))
    return {"ok": True, "modelo_escolhido": escolhido, "modelos": flash}


_TIPOS_ARQUIVO = {
    "video": ("Escolha o vídeo", "Vídeos", "*.mp4 *.mkv *.mov *.flv *.ts *.webm *.avi *.m4v"),
    "imagem": ("Escolha a imagem (PNG com fundo transparente é o ideal)", "Imagens", "*.png *.jpg *.jpeg *.webp"),
    "audio": ("Escolha a música", "Áudio", "*.mp3 *.wav *.m4a *.aac *.ogg *.flac"),
}


@router.post("/api/procurar")
def procurar_arquivo(tipo: str = "video"):
    """Abre a janela 'Abrir arquivo' do Windows (o servidor roda no mesmo PC)."""
    titulo, rotulo, padroes = _TIPOS_ARQUIVO.get(tipo, _TIPOS_ARQUIVO["video"])
    script = (
        "import sys, tkinter as tk\nfrom tkinter import filedialog\n"
        "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
        "p = filedialog.askopenfilename(title=sys.argv[1], filetypes=[(sys.argv[2], sys.argv[3]), ('Todos', '*.*')])\n"
        "print(p, end='')\n"
    )
    r = subprocess.run([sys.executable, "-c", script, titulo, rotulo, padroes], capture_output=True, text=True,
                       encoding="utf-8")
    if r.returncode != 0:
        raise HTTPException(500, "Não foi possível abrir a janela de arquivos. Cole o caminho manualmente.")
    caminho = r.stdout.strip()
    return {"caminho": str(Path(caminho)) if caminho else None}
