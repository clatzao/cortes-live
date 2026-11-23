"""Fila de tarefas: ver, cancelar, limpar e abrir os arquivos exportados."""
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import config, db, jobs

router = APIRouter()


@router.get("/api/fila")
def listar_fila():
    return db.listar(
        "SELECT j.*, p.nome AS projeto_nome, c.nome AS corte_nome FROM jobs j "
        "LEFT JOIN projetos p ON p.id = j.projeto_id LEFT JOIN cortes c ON c.id = j.corte_id "
        "ORDER BY j.id DESC LIMIT 300"
    )


@router.post("/api/fila/{job_id}/cancelar")
def cancelar_job(job_id: int):
    jobs.cancelar(job_id)
    return {"ok": True}


@router.delete("/api/fila/finalizados")
def limpar_finalizados():
    db.executar("DELETE FROM jobs WHERE status IN ('concluido','erro','cancelado')")
    return {"ok": True}


@router.post("/api/fila/{job_id}/abrir")
def abrir_saida(job_id: int):
    """Abre o Explorer com o arquivo exportado selecionado."""
    job = db.um("SELECT saida FROM jobs WHERE id=?", (job_id,))
    if not job or not job["saida"] or not Path(job["saida"]).exists():
        raise HTTPException(404, "Arquivo exportado não encontrado.")
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(Path(job["saida"]))])
    return {"ok": True}


LINKS_EXTERNOS = {
    "gemini_chave": "https://aistudio.google.com/apikey",
    "google_cloud": "https://console.cloud.google.com/apis/credentials",
    "tiktok_dev": "https://developers.tiktok.com/apps/",
    "meta_dev": "https://developers.facebook.com/apps/",
}


@router.post("/api/abrir-link/{nome}")
def abrir_link(nome: str):
    """Abre no navegador padrão um link da lista fixa (a janela do programa não abre links externos)."""
    url = LINKS_EXTERNOS.get(nome)
    if not url:
        raise HTTPException(404, "Link desconhecido.")
    import os
    import webbrowser
    if not os.environ.get("CORTES_SEM_NAVEGADOR"):  # nos testes não abre o navegador de verdade
        webbrowser.open(url)
    return {"ok": True, "url": url}


@router.post("/api/abrir-exportados")
def abrir_exportados():
    config.EXPORTADOS.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        os.startfile(config.EXPORTADOS)  # noqa: S606 - pasta fixa do próprio programa
    return {"ok": True}
