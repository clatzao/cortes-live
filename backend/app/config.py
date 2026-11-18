"""Caminhos e ferramentas externas usadas pelo programa."""
import os
import shutil
import subprocess
from pathlib import Path

# Pasta raiz do projeto: cortes-live/
RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "dados"
PROJETOS = DADOS / "projetos"


def _pasta_videos() -> Path:
    """Pasta Vídeos do Windows (respeita redirecionamento para OneDrive/outro disco)."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]

            # FOLDERID_Videos {18989B1D-99B5-455B-841C-AB7C74E4DDFC}
            guid = GUID(0x18989B1D, 0x99B5, 0x455B, (ctypes.c_ubyte * 8)(0x84, 0x1C, 0xAB, 0x7C, 0x74, 0xE4, 0xDD, 0xFC))
            caminho = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(caminho)) == 0:
                valor = caminho.value
                ctypes.windll.ole32.CoTaskMemFree(caminho)
                if valor:
                    return Path(valor)
        except Exception:  # noqa: BLE001 - cai no padrão abaixo
            pass
    return Path.home() / "Videos"


# Cortes exportados: Vídeos\Cortes Live\<projeto>\<corte>\ (CORTES_EXPORTADOS troca o local)
EXPORTADOS = Path(os.environ.get("CORTES_EXPORTADOS") or (_pasta_videos() / "Cortes Live"))
FRONTEND_DIST = RAIZ / "frontend" / "dist"

for _pasta in (DADOS, PROJETOS, EXPORTADOS):
    _pasta.mkdir(parents=True, exist_ok=True)

PORTA = int(os.environ.get("CORTES_PORTA", "8765"))

# No Windows, evita abrir uma janela de console para cada processo do FFmpeg.
SEM_JANELA = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _achar(nome: str) -> str | None:
    """Procura primeiro um FFmpeg embutido em cortes-live/ferramentas, depois no PATH."""
    exe = nome + (".exe" if os.name == "nt" else "")
    for local in (RAIZ / "ferramentas" / "ffmpeg" / "bin" / exe, RAIZ / "ferramentas" / exe):
        if local.exists():
            return str(local)
    return shutil.which(nome)


FFMPEG = _achar("ffmpeg")
FFPROBE = _achar("ffprobe")
