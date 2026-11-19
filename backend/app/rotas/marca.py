"""Formatos disponíveis e a marca do canal (logo, gancho, intro/outro, música)."""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import formatos, marca

router = APIRouter()


@router.get("/api/formatos")
def listar_formatos():
    return [{"id": k, **v} for k, v in formatos.FORMATOS.items()]


@router.get("/api/marca")
def ver_marca():
    return {**marca.ler(), "posicoes": marca.POSICOES}


@router.put("/api/marca")
def salvar_marca(dados: dict):
    for k in ("logo", "intro", "outro", "musica"):
        arq = (dados.get(k) or {}).get("arquivo")
        if arq and not Path(str(arq).strip().strip('"')).is_file():
            raise HTTPException(400, f"Arquivo não encontrado ({k}): {arq}")
    return {**marca.salvar(dados), "posicoes": marca.POSICOES}
