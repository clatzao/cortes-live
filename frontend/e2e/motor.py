"""Motor de teste para o Playwright: dados próprios em e2e/.dados (apagados a cada rodada) e vídeos de exemplo.

Rodado pelo playwright.config.ts (webServer). Nunca toca em cortes-live/dados: os modelos de IA entram por
junção (link de pasta) e a junção é desfeita ANTES de apagar a pasta de teste.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
DADOS = AQUI / ".dados"
FIXTURES = DADOS / "fixtures"
MODELOS_REAIS = RAIZ / "dados" / "modelos"


def desfazer_juncoes(pasta: Path) -> None:
    for p in pasta.rglob("*") if pasta.exists() else []:
        try:
            if p.is_junction() or p.is_symlink():
                os.rmdir(p) if p.is_junction() else p.unlink()
        except FileNotFoundError:
            pass


def preparar() -> None:
    desfazer_juncoes(DADOS)
    shutil.rmtree(DADOS, ignore_errors=True)
    (DADOS / "modelos").mkdir(parents=True)
    FIXTURES.mkdir(parents=True)
    (DADOS / "exportados").mkdir()
    if MODELOS_REAIS.exists():  # reaproveita os modelos já baixados (Whisper, YuNet), só leitura
        for m in MODELOS_REAIS.iterdir():
            alvo = DADOS / "modelos" / m.name
            if m.is_dir():
                subprocess.run(["cmd", "/c", "mklink", "/J", str(alvo), str(m)], capture_output=True, check=True)
            else:
                shutil.copy2(m, alvo)
    ff = shutil.which("ffmpeg") or "ffmpeg"
    # vídeo curto com som, com acento e espaço no nome (F01-E1)
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=12", "-f", "lavfi",
                    "-i", "sine=f=440:d=12", "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                    str(FIXTURES / "vídeo de teste ção.mp4")], check=True)
    (FIXTURES / "nao_e_video.txt").write_text("isto não é um vídeo", encoding="utf-8")


if __name__ == "__main__":
    preparar()
    os.environ["CORTES_DADOS"] = str(DADOS)
    os.environ["CORTES_EXPORTADOS"] = str(DADOS / "exportados")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.chdir(RAIZ / "backend")
    sys.path.insert(0, str(RAIZ / "backend"))
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORTA_TESTE", "8799")), log_level="warning")
