"""Redes sociais (S23 contas, S24 publicar/agendar, S25 posts e métricas)."""
import json
import os
import webbrowser
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import ajustes, db, publicar
from ..redes import REDES, ErroRede, base

router = APIRouter()


def _erro(e: Exception, codigo: int = 400) -> HTTPException:
    return HTTPException(codigo, str(e))


@router.get("/api/redes")
def redes():
    aj = ajustes.ler()
    return [{"nome": r.nome, "titulo": r.titulo, "retorno": base.retorno(r), "privacidades": list(r.privacidades),
             "configurada": bool(aj[r.campos[0]] and aj[r.campos[1]]), "campo_id": r.campos[0],
             "campo_segredo": r.campos[1], "app_id": aj[r.campos[0]],
             "retorno_automatico": base.retorno(r).startswith("http://")} for r in REDES.values()]


@router.post("/api/redes/{rede}/conectar")
def conectar(rede: str):
    if rede not in REDES:
        raise HTTPException(404, "Rede desconhecida.")
    try:
        login = base.iniciar_login(rede)
    except ErroRede as e:
        raise _erro(e) from e
    if not os.environ.get("CORTES_SEM_NAVEGADOR"):  # nos testes quem abre o link é o próprio teste
        webbrowser.open(login["url_login"])
    return login


@router.get("/api/redes/login/{state}")
def estado_login(state: str):
    return base.estado_login(state)


class Colar(BaseModel):
    endereco: str = Field(min_length=10, max_length=4000)


@router.post("/api/redes/login/colar")
def colar(dados: Colar):
    ok, msg = base.concluir_login(dados.endereco)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True}


def _conta(c: dict) -> dict:
    c["escopos"] = json.loads(c.get("escopos") or "[]")
    c["rede_titulo"] = REDES[c["rede"]].titulo if c["rede"] in REDES else c["rede"]
    c["agendados"] = db.um("SELECT COUNT(*) AS n FROM posts WHERE conta_id=? AND status IN ('agendado','enviando')",
                           (c["id"],))["n"]
    return c


@router.get("/api/contas")
def contas():
    return [_conta(c) for c in db.listar("SELECT * FROM contas_sociais ORDER BY rede, nome")]


@router.delete("/api/contas/{conta_id}")
def desconectar(conta_id: int):
    if not db.um("SELECT 1 FROM contas_sociais WHERE id=?", (conta_id,)):
        raise HTTPException(404, "Conta não encontrada.")
    base.desconectar(conta_id)
    return {"ok": True}


class NovoPost(BaseModel):
    exportacao_id: int
    conta_ids: list[int] = Field(min_length=1, max_length=20)
    titulo: str = Field(default="", max_length=300)
    descricao: str = Field(default="", max_length=5000)
    privacidade: Literal["publico", "nao_listado", "privado"] = "publico"
    agendado_para: float | None = None   # epoch em segundos (UTC); vazio = agora


@router.post("/api/posts")
def criar_post(dados: NovoPost):
    try:
        return publicar.criar(dados.exportacao_id, dados.conta_ids, dados.titulo, dados.descricao,
                              dados.privacidade, dados.agendado_para)
    except publicar.ErroPost as e:
        raise _erro(e, 409 if "já está agendado" in str(e) else 400) from e


@router.get("/api/posts")
def listar_posts(status: str | None = None, conta: int | None = None):
    return publicar.listar(status, conta)


class MudarPost(BaseModel):
    titulo: str | None = Field(default=None, max_length=300)
    descricao: str | None = Field(default=None, max_length=5000)
    privacidade: Literal["publico", "nao_listado", "privado"] | None = None
    agendado_para: float | None = None


@router.patch("/api/posts/{post_id}")
def mudar_post(post_id: int, dados: MudarPost):
    try:
        return publicar.mudar(post_id, dados.model_dump(exclude_unset=True))
    except publicar.ErroPost as e:
        raise _erro(e) from e


@router.post("/api/posts/{post_id}/cancelar")
def cancelar_post(post_id: int):
    try:
        return publicar.cancelar(post_id)
    except publicar.ErroPost as e:
        raise _erro(e) from e


@router.post("/api/posts/{post_id}/tentar")
def tentar_post(post_id: int):
    try:
        return publicar.tentar_de_novo(post_id)
    except publicar.ErroPost as e:
        raise _erro(e, 409 if "já está agendado" in str(e) else 400) from e


@router.delete("/api/posts/{post_id}")
def remover_post(post_id: int):
    try:
        publicar.remover(post_id)
    except publicar.ErroPost as e:
        raise _erro(e) from e
    return {"ok": True}


@router.get("/api/posts/{post_id}/metricas")
def metricas_post(post_id: int):
    return publicar.historico_metricas(post_id)


@router.post("/api/posts/metricas")
def atualizar_metricas():
    return {"job_id": publicar.coletar_agora()}


@router.post("/api/posts/{post_id}/abrir")
def abrir_post(post_id: int):
    """Abre o post publicado no navegador padrão (a janela do programa não abre links externos)."""
    p = db.um("SELECT url FROM posts WHERE id=?", (post_id,))
    if not p or not p["url"] or not p["url"].startswith("https://"):
        raise HTTPException(404, "Esse post ainda não tem link.")
    if not os.environ.get("CORTES_SEM_NAVEGADOR"):
        webbrowser.open(p["url"])
    return {"ok": True, "url": p["url"]}
