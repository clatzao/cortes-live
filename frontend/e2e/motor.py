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
    criar_video_com_fala(ff)


def criar_video_com_fala(ff: str) -> None:
    """Vídeo de ~40 s com voz sintética do Windows (System.Speech), para a transcrição ter o que ler."""
    wav = FIXTURES / "fala.wav"
    texto = ("Olá pessoal, sejam bem vindos à live de hoje! Hoje a gente vai jogar a fase mais difícil do jogo. "
             "Nossa, que jogada incrível! Vocês viram isso? Eu não acredito que deu certo! "
             "Agora vamos falar das novidades da semana, tem muita coisa boa chegando. "
             "Valeu demais a todo mundo que está assistindo, deixa o seu comentário aí no chat.") * 2
    arq_texto = FIXTURES / "fala.txt"
    arq_texto.write_text(texto, encoding="utf-8-sig")
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.SetOutputToWaveFile('{wav}'); $s.Speak((Get-Content -Raw -Encoding UTF8 '{arq_texto}')); "
          "$s.Dispose()")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    if r.returncode != 0 or not wav.is_file():
        return  # sem síntese de voz: o teste que precisa dela é pulado
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30", "-i", str(wav),
                    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                    str(FIXTURES / "com fala.mp4")], check=True)


if __name__ == "__main__":
    preparar()
    os.environ["CORTES_DADOS"] = str(DADOS)
    os.environ["CORTES_EXPORTADOS"] = str(DADOS / "exportados")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    # redes sociais: um servidor falso no lugar do YouTube/TikTok/Instagram, agendador rápido, sem abrir navegador
    sys.path.insert(0, str(AQUI))
    import redes_falsas
    porta_redes = int(os.environ.get("PORTA_REDES_TESTE", "8798"))
    redes_falsas.ligar(porta_redes)
    os.environ["CORTES_REDES_TESTE"] = f"http://127.0.0.1:{porta_redes}"
    os.environ["CORTES_AGENDADOR_S"] = "1"
    os.environ["CORTES_REDES_ESPERA"] = "0"
    os.environ["CORTES_SEM_NAVEGADOR"] = "1"
    os.chdir(RAIZ / "backend")
    sys.path.insert(0, str(RAIZ / "backend"))
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORTA_TESTE", "8799")), log_level="warning")
