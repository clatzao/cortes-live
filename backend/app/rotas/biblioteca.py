"""Biblioteca (S20): tudo o que já foi exportado, de todos os projetos."""
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import db, formatos

router = APIRouter()


@router.get("/api/biblioteca")
def listar(projeto: int | None = None, formato: str | None = None, busca: str | None = None):
    sql = "SELECT * FROM exportacoes WHERE 1=1"
    params: list = []
    if projeto is not None:
        sql += " AND projeto_id=?"
        params.append(projeto)
    if formato:
        sql += " AND formato=?"
        params.append(formato)
    if busca and busca.strip():
        sql += " AND (corte_nome LIKE ? OR projeto_nome LIKE ?)"
        params += [f"%{busca.strip()}%"] * 2
    itens = db.listar(sql + " ORDER BY criado_em DESC LIMIT 500", tuple(params))
    for i in itens:
        i["existe"] = Path(i["caminho"]).is_file()
        i["formato_nome"] = formatos.FORMATOS.get(i["formato"], {}).get("nome", i["formato"])
    return itens


def _item(item_id: int) -> dict:
    i = db.um("SELECT * FROM exportacoes WHERE id=?", (item_id,))
    if not i:
        raise HTTPException(404, "Arquivo não encontrado na biblioteca.")
    return i


@router.get("/api/biblioteca/{item_id}/video")
def video(item_id: int):
    i = _item(item_id)
    if not Path(i["caminho"]).is_file():
        raise HTTPException(404, "O arquivo foi movido ou apagado.")
    return FileResponse(i["caminho"], media_type="video/mp4")


@router.post("/api/biblioteca/{item_id}/abrir")
def abrir(item_id: int):
    """Abre o Explorer com o arquivo selecionado."""
    i = _item(item_id)
    if not Path(i["caminho"]).is_file():
        raise HTTPException(404, "O arquivo foi movido ou apagado.")
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(Path(i["caminho"]))])
    return {"ok": True}


@router.delete("/api/biblioteca/{item_id}")
def remover(item_id: int):
    """Tira da lista. O arquivo no disco NÃO é apagado (ele é seu)."""
    _item(item_id)
    db.executar("DELETE FROM exportacoes WHERE id=?", (item_id,))
    return {"ok": True}
