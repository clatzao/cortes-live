"""Idiomas do corte (S21): traduzir a legenda, editar a tradução, escolher a voz e dublar."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import ajustes, db, idiomas, jobs
from .comum import _corte

router = APIRouter()


class PedidoTraducao(BaseModel):
    idioma: str = Field(pattern=r"^[a-z]{2}$")


class Segmento(BaseModel):
    inicio: float = Field(ge=0)
    fim: float = Field(ge=0)
    texto: str = Field(max_length=500)


class PedidoDublagem(BaseModel):
    idioma: str = Field(pattern=r"^[a-z]{2}$")
    voz: str = Field(min_length=3, max_length=80)
    audio_original: Literal["abaixar", "silenciar"] = "abaixar"


def _job(tipo: str, corte_id: int) -> dict | None:
    return db.um("SELECT id, status, progresso, mensagem, saida, params FROM jobs WHERE tipo=? AND corte_id=? "
                 "ORDER BY id DESC LIMIT 1", (tipo, corte_id))


@router.get("/api/idiomas")
def listar_idiomas():
    return [{"codigo": k, "nome": v} for k, v in idiomas.IDIOMAS.items()]


@router.get("/api/vozes")
def listar_vozes(idioma: str | None = None):
    try:
        return idiomas.vozes(idioma)
    except Exception as e:  # noqa: BLE001 - sem internet na 1a vez
        raise HTTPException(502, f"Não deu para baixar a lista de vozes: {str(e)[:200]}") from e


@router.get("/api/cortes/{corte_id}/idiomas")
def estado(corte_id: int):
    """Traduções e dublagens do corte, com os jobs em andamento."""
    _corte(corte_id)
    trad = db.listar("SELECT idioma, segmentos, editada, atualizado_em FROM traducoes WHERE corte_id=?", (corte_id,))
    dub = db.listar("SELECT idioma, voz, audio_original, caminho_audio FROM dublagens WHERE corte_id=?", (corte_id,))
    return {
        "traducoes": [{**t, "segmentos": __import__("json").loads(t["segmentos"])} for t in trad],
        "dublagens": [{**d, "existe": bool(d["caminho_audio"]) and Path(d["caminho_audio"]).is_file()} for d in dub],
        "job_traducao": _job("traduzir", corte_id),
        "job_dublagem": _job("dublar", corte_id),
    }


@router.post("/api/cortes/{corte_id}/traducoes")
def traduzir(corte_id: int, dados: PedidoTraducao):
    c = _corte(corte_id)
    try:
        textos = [f["texto"] for f in idiomas.frases_do_corte(c)]
    except RuntimeError:
        textos = []  # transcrição ainda não pronta: o job avisa
    origens = set(idiomas.origens_das_frases(c["projeto_id"], textos)) if textos else {idiomas.idioma_falado(c["projeto_id"])}
    if origens == {dados.idioma}:
        raise HTTPException(400, f"O corte já está em {idiomas.IDIOMAS.get(dados.idioma, dados.idioma)}: escolha outro idioma.")
    if not ajustes.ler()["gemini_chave"]:  # sem chave: tradutor local; avisa na hora se o par não existir
        from .. import traducao_local
        try:
            ok = all(traducao_local.rota(o, dados.idioma) is not None for o in origens - {dados.idioma, "misto"})
        except Exception as e:  # noqa: BLE001 - sem internet na 1a vez
            raise HTTPException(502, f"Não deu para baixar a lista de tradutores: {str(e)[:200]}") from e
        if not ok:
            raise HTTPException(400, "Não há tradutor local para esse idioma. Configure o Gemini em Ajustes → IA e hardware.")
    jid = jobs.enfileirar("traduzir", projeto_id=c["projeto_id"], corte_id=corte_id, params={"idioma": dados.idioma},
                          mensagem="Aguardando para traduzir")
    return db.um("SELECT * FROM jobs WHERE id=?", (jid,))


@router.put("/api/cortes/{corte_id}/traducoes/{idioma}")
def editar_traducao(corte_id: int, idioma: str, segmentos: list[Segmento]):
    _corte(corte_id)
    if not idiomas.traducao(corte_id, idioma):
        raise HTTPException(404, "Tradução não encontrada.")
    db.executar("UPDATE traducoes SET segmentos=?, editada=1, atualizado_em=? WHERE corte_id=? AND idioma=?",
                (db.json_dump([s.model_dump() for s in segmentos]), db.agora(), corte_id, idioma))
    return idiomas.traducao(corte_id, idioma)


@router.post("/api/cortes/{corte_id}/dublagens")
def dublar(corte_id: int, dados: PedidoDublagem):
    c = _corte(corte_id)
    if not idiomas.traducao(corte_id, dados.idioma):
        raise HTTPException(400, "Traduza o corte para esse idioma antes de dublar.")
    jid = jobs.enfileirar("dublar", projeto_id=c["projeto_id"], corte_id=corte_id, params=dados.model_dump(),
                          mensagem="Aguardando para dublar")
    return db.um("SELECT * FROM jobs WHERE id=?", (jid,))


@router.get("/api/cortes/{corte_id}/dublagens/{idioma}/audio")
def ouvir(corte_id: int, idioma: str):
    d = idiomas.dublagem(corte_id, idioma)
    if not d:
        raise HTTPException(404, "Dublagem não encontrada.")
    return FileResponse(d["caminho_audio"], media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.delete("/api/cortes/{corte_id}/dublagens/{idioma}")
def apagar_dublagem(corte_id: int, idioma: str):
    d = idiomas.dublagem(corte_id, idioma)
    db.executar("DELETE FROM dublagens WHERE corte_id=? AND idioma=?", (corte_id, idioma))
    if d:
        Path(d["caminho_audio"]).unlink(missing_ok=True)
    return {"ok": True}
