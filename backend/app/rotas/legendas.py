"""Estilos de legenda, fontes e dicionários (emojis e palavras-chave)."""
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, legendas
from .comum import _fonte_rapida, _quadro, _jpeg

router = APIRouter()


@router.get("/api/legendas/estilos")
def listar_estilos():
    return [{**e, "de_fabrica": e["id"] in legendas.IDS_PADRAO} for e in legendas.listar_estilos()]


@router.put("/api/legendas/estilos/{estilo_id}")
def salvar_estilo(estilo_id: str, dados: dict):
    if not re.fullmatch(r"[a-z0-9_-]{1,40}", estilo_id):
        raise HTTPException(400, "Identificador inválido.")
    return legendas.salvar_estilo(estilo_id, dados)


@router.delete("/api/legendas/estilos/{estilo_id}")
def apagar_estilo(estilo_id: str):
    legendas.apagar_estilo(estilo_id)
    if estilo_id not in legendas.IDS_PADRAO:
        db.executar("UPDATE cortes SET estilo='classico' WHERE estilo=?", (estilo_id,))
    return {"ok": True}


class PreviaEstilo(BaseModel):
    estilo: dict
    projeto_id: int | None = None
    vertical: bool = True


@router.post("/api/legendas/previa")
def previa_estilo(dados: PreviaEstilo):
    estilo = legendas.validar_estilo(dados.estilo, "previa")
    w, h = (1080, 1920) if dados.vertical else (1920, 1080)
    fundo = None
    if dados.projeto_id:
        p = db.um("SELECT * FROM projetos WHERE id=? AND status='pronto'", (dados.projeto_id,))
        if p:
            fundo = _quadro(_fonte_rapida(p), (p["duracao"] or 0) / 3, w, h)
    return _jpeg(legendas.previa_estilo(estilo, w, h, fundo), 640)


@router.get("/api/legendas/fontes")
def listar_fontes():
    return legendas.listar_fontes()


class Dicionarios(BaseModel):
    emojis: dict[str, str] | None = None
    palavras_chave: list[str] | None = None


@router.get("/api/legendas/dicionarios")
def ver_dicionarios():
    return legendas.ler_dicionarios()


@router.put("/api/legendas/dicionarios")
def salvar_dicionarios(dados: Dicionarios):
    return legendas.salvar_dicionarios(dados.emojis, dados.palavras_chave)
