"""Momentos virais: analisar a live e transformar sugestões em cortes."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import cortes, db, jobs, transcricao
from .comum import _projeto, _corte, _corte_completo

router = APIRouter()


class PedidoAnalise(BaseModel):
    min: int | None = Field(default=None, ge=5, le=600)
    max: int | None = Field(default=None, ge=5, le=900)
    qtd: int | None = Field(default=None, ge=1, le=50)


@router.post("/api/projetos/{projeto_id}/analisar")
def analisar_projeto(projeto_id: int, dados: PedidoAnalise | None = None):
    p = _projeto(projeto_id)
    if not transcricao.caminho(projeto_id).exists():
        raise HTTPException(400, "Aguarde a transcrição terminar.")
    for j in db.listar("SELECT id FROM jobs WHERE tipo='analisar' AND projeto_id=? "
                       "AND status IN ('na_fila','executando')", (projeto_id,)):
        jobs.cancelar(j["id"])
    params = dados.model_dump(exclude_none=True) if dados else {}
    if params.get("min") and params.get("max") and params["max"] < params["min"]:
        raise HTTPException(400, "A duração máxima precisa ser maior que a mínima.")
    jid = jobs.enfileirar("analisar", projeto_id=p["id"], params=params)
    return db.um("SELECT * FROM jobs WHERE id=?", (jid,))


@router.get("/api/projetos/{projeto_id}/sugestoes")
def listar_sugestoes(projeto_id: int):
    _projeto(projeto_id)
    return db.listar("SELECT * FROM sugestoes WHERE projeto_id=? AND status!='descartada' "
                     "ORDER BY status='aceita', nota DESC", (projeto_id,))


def _sugestao(sid: int) -> dict:
    s = db.um("SELECT * FROM sugestoes WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "Sugestão não encontrada")
    return s


@router.post("/api/sugestoes/{sugestao_id}/aceitar")
def aceitar_sugestao(sugestao_id: int):
    """Transforma a sugestão num corte (com nome e gancho já preenchidos)."""
    s = _sugestao(sugestao_id)
    cid = cortes.aceitar_sugestao(s, _projeto(s["projeto_id"])["duracao"] or 0)
    if cid is None:
        raise HTTPException(400, "O corte precisa ter pelo menos 0,5 segundo.")
    return _corte_completo(_corte(cid))


class ListaIds(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)


@router.post("/api/projetos/{projeto_id}/sugestoes/aceitar")
def aceitar_varias(projeto_id: int, dados: ListaIds):
    """Várias sugestões viram cortes de uma vez."""
    p = _projeto(projeto_id)
    marcas = ",".join("?" * len(dados.ids))
    lista = db.listar(f"SELECT * FROM sugestoes WHERE projeto_id=? AND id IN ({marcas}) ORDER BY inicio",
                      (projeto_id, *dados.ids))
    criados = [cid for s in lista if (cid := cortes.aceitar_sugestao(s, p["duracao"] or 0))]
    return [_corte_completo(_corte(cid)) for cid in criados]


@router.post("/api/sugestoes/{sugestao_id}/descartar")
def descartar_sugestao(sugestao_id: int):
    _sugestao(sugestao_id)
    db.executar("UPDATE sugestoes SET status='descartada' WHERE id=?", (sugestao_id,))
    return {"ok": True}
