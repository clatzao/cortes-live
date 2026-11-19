"""Monitor de live (S08/S09): criar, acompanhar, parar e remover."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db, jobs, live

router = APIRouter()


class NovaLive(BaseModel):
    entrada: str = Field(min_length=1, max_length=500)
    janela_s: int = Field(default=180, ge=60, le=900)
    idioma: Literal["pt", "en", "misto"] = "pt"  # a transcrição começa na hora: o idioma vem junto


def _job(tipo: str, projeto_id: int | None) -> dict | None:
    if not projeto_id:
        return None
    return db.um("SELECT id, status, progresso, mensagem FROM jobs WHERE tipo=? AND projeto_id=? "
                 "ORDER BY id DESC LIMIT 1", (tipo, projeto_id))


def _resumo(v: dict) -> dict:
    v = dict(v)
    v["partes"] = len(live.partes(v["id"]))
    v["job_gravacao"] = _job("live_gravar", v["projeto_id"])
    v["job_analise"] = _job("live_analisar", v["projeto_id"])
    v["job_final"] = _job("live_finalizar", v["projeto_id"])
    p = db.um("SELECT status FROM projetos WHERE id=?", (v["projeto_id"],)) if v["projeto_id"] else None
    v["projeto_status"] = p["status"] if p else None
    return v


def _obter(live_id: int) -> dict:
    v = live.obter(live_id)
    if not v:
        raise HTTPException(404, "Live não encontrada.")
    return v


@router.get("/api/lives")
def listar():
    return [_resumo(v) for v in db.listar(
        "SELECT * FROM lives ORDER BY CASE WHEN status IN ('aguardando','gravando','reconectando','finalizando') "
        "THEN 0 ELSE 1 END, id DESC")]


@router.post("/api/lives")
def criar(dados: NovaLive):
    try:
        plataforma, canal, url = live.normalizar(dados.entrada)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    ativa = db.um("SELECT id FROM lives WHERE plataforma=? AND url=? AND status IN "
                  "('aguardando','gravando','reconectando','finalizando')", (plataforma, url))
    if ativa:
        raise HTTPException(409, f"Esse canal já está sendo monitorado (live {ativa['id']}).")
    agora = db.agora()
    pid = db.executar("INSERT INTO projetos (nome, origem, entrada, status, idioma, criado_em) VALUES (?,?,?,?,?,?)",
                      (f"Live de {canal}", "live", url, "gravando", dados.idioma, agora))
    try:
        lid = db.executar("INSERT INTO lives (plataforma, canal, url, projeto_id, janela_s, criado_em, atualizado_em) "
                          "VALUES (?,?,?,?,?,?,?)", (plataforma, canal, url, pid, dados.janela_s, agora, agora))
    except sqlite3.IntegrityError as e:  # dois cliques ao mesmo tempo
        db.executar("DELETE FROM projetos WHERE id=?", (pid,))
        raise HTTPException(409, "Esse canal já está sendo monitorado.") from e
    db.executar("UPDATE projetos SET live_id=? WHERE id=?", (lid, pid))
    jobs.enfileirar("live_gravar", projeto_id=pid, params={"live_id": lid}, mensagem="Iniciando o monitor da live")
    return _resumo(live.obter(lid))


@router.get("/api/lives/{live_id}")
def detalhe(live_id: int):
    v = _resumo(_obter(live_id))
    v["disco_livre_gb"] = round(live.disco_livre_gb(), 1)
    v["cortes"] = db.listar(
        "SELECT c.id, c.nome, c.inicio, c.fim, c.gancho, c.criado_em, s.nota, s.motivo, s.origem AS fonte "
        "FROM cortes c LEFT JOIN sugestoes s ON s.corte_id = c.id "
        "WHERE c.projeto_id=? AND c.origem='live' ORDER BY c.id DESC", (v["projeto_id"],)) if v["projeto_id"] else []
    exportaveis = set()
    if v["projeto_status"] == "gravando":
        p = db.um("SELECT * FROM projetos WHERE id=?", (v["projeto_id"],))
        exportaveis = {c["id"] for c in v["cortes"] if live.parte_da_live(p, c["inicio"], c["fim"])}
    for c in v["cortes"]:
        c["exportavel"] = v["projeto_status"] == "pronto" or c["id"] in exportaveis
    return v


@router.post("/api/lives/{live_id}/parar")
def parar(live_id: int):
    v = _obter(live_id)
    if v["status"] not in ("aguardando", "gravando", "reconectando"):
        raise HTTPException(400, "Esta live não está sendo gravada.")
    db.executar("UPDATE lives SET parar=1, atualizado_em=? WHERE id=?", (db.agora(), live_id))
    return _resumo(live.obter(live_id))


@router.delete("/api/lives/{live_id}")
def remover(live_id: int):
    """Remove só o monitor. O projeto da live (gravação e cortes) continua em Projetos."""
    v = _obter(live_id)
    if v["status"] in live.ATIVOS:
        raise HTTPException(400, "Pare a gravação antes de remover.")
    db.executar("DELETE FROM lives WHERE id=?", (live_id,))
    return {"ok": True}
