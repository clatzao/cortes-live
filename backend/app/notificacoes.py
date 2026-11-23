"""Notificações do Windows (o aviso no canto da tela), para saber o que terminou com o programa na bandeja.

Usa o PowerShell do próprio Windows (sem biblioteca extra) e o id do programa instalado (br.cortes.live), então o
aviso sai com o nome e o ícone do Cortes Live e um clique abre a janela. Avisos parecidos que chegam juntos
(ex.: "Exportar todos") viram um aviso só.
"""
import os
import subprocess
import threading
import time
from xml.sax.saxutils import escape

from . import ajustes, config

APP_ID = "br.cortes.live"
JUNTAR_S = 6          # avisos do mesmo tipo nesse intervalo viram um só
_pendentes: dict[str, list[str]] = {}
_lock = threading.Lock()


def disponivel() -> bool:
    """Só no programa instalado (o id registrado no Windows) e fora dos testes."""
    return os.name == "nt" and bool(os.environ.get("CORTES_EXE")) and not os.environ.get("CORTES_SEM_AVISOS")


def avisar(tipo: str, titulo: str, texto: str, plural: str | None = None) -> None:
    """Agenda um aviso. `plural` (com {n}) é o título quando vários do mesmo tipo chegam juntos."""
    if not disponivel():
        return
    try:
        if not ajustes.ler().get("notificacoes", True):
            return
    except Exception:  # noqa: BLE001 - aviso nunca derruba quem chamou
        return
    with _lock:
        lista = _pendentes.setdefault(tipo, [])
        lista.append(texto)
        primeiro = len(lista) == 1
    if primeiro:
        threading.Thread(target=_enviar_depois, args=(tipo, titulo, plural), daemon=True, name="aviso").start()


def _enviar_depois(tipo: str, titulo: str, plural: str | None) -> None:
    time.sleep(JUNTAR_S)
    with _lock:
        textos = _pendentes.pop(tipo, [])
    if not textos:
        return
    if len(textos) > 1:
        titulo = (plural or titulo + " ({n})").format(n=len(textos))
        corpo = "\n".join(textos[:3]) + (f"\n…e mais {len(textos) - 3}" if len(textos) > 3 else "")
    else:
        corpo = textos[0]
    mostrar(titulo, corpo)


def mostrar(titulo: str, texto: str) -> bool:
    """Mostra o aviso agora. Devolve False se o Windows recusar (sem travar nada)."""
    xml = ("<toast><visual><binding template='ToastGeneric'>"
           f"<text>{escape(titulo[:120])}</text><text>{escape(texto[:400])}</text>"
           "</binding></visual></toast>")
    script = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;"
        "$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml($env:CORTES_AVISO_XML);"
        f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{APP_ID}')"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($x))"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, check=False,
                           timeout=30, creationflags=config.SEM_JANELA, env={**os.environ, "CORTES_AVISO_XML": xml})
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0


# ---------------------------------------------------------------- o que vira aviso

def _nome_projeto(projeto_id) -> str:
    from . import db
    p = db.um("SELECT nome FROM projetos WHERE id=?", (projeto_id,)) if projeto_id else None
    return p["nome"] if p else "projeto"


def job_terminou(job: dict, ok: bool, texto: str) -> None:
    """Chamado pela fila quando um job termina (concluído ou com erro; cancelado não avisa)."""
    import json
    try:
        tipo = job["tipo"]
        params = json.loads(job.get("params") or "{}")
        if tipo == "exportar":
            nome = params.get("nome") or "Corte"
            if ok:
                avisar("exportar", "Corte exportado", nome, "{n} cortes exportados")
            else:
                avisar("exportar_erro", "A exportação falhou", f"{nome}: {texto}", "{n} exportações falharam")
        elif tipo == "transcrever" and ok:
            avisar("transcrever", "Transcrição pronta", _nome_projeto(job.get("projeto_id")), "{n} transcrições prontas")
        elif tipo == "importar" and not ok:
            avisar("importar_erro", "Não deu para importar", texto, "{n} importações falharam")
        elif tipo == "live_finalizar" and ok and texto.startswith("Live finalizada"):
            avisar("live_fim", "A live acabou e virou projeto", _nome_projeto(job.get("projeto_id")))
        elif tipo in ("live_gravar", "live_finalizar") and not ok:
            avisar("live_erro", "Problema na live", texto)
    except Exception:  # noqa: BLE001 - aviso nunca derruba a fila
        import traceback
        traceback.print_exc()
