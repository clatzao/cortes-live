"""Caminhos e ferramentas externas usadas pelo programa."""
import os
import shutil
import subprocess
from pathlib import Path

# Pasta raiz do projeto: cortes-live/
RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "dados"
PROJETOS = DADOS / "projetos"
EXPORTADOS = DADOS / "exportados"
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
