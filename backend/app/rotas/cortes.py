"""Cortes: criar, editar, legenda de cada corte, prévias, exportar."""
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config, cortes, db, enquadramento, formatos, jobs, legendas, tempo, tarefas
from .comum import _projeto, _corte, _corte_completo, _validar_formatos, _validar_intervalo, _fonte_rapida, _quadro, _jpeg

router = APIRouter()


class NovoCorte(BaseModel):
    inicio: float = Field(ge=0)
    fim: float = Field(gt=0)
    nome: str | None = None


class EdicaoCorte(BaseModel):
    inicio: float | None = Field(default=None, ge=0)
    fim: float | None = Field(default=None, gt=0)
    nome: str | None = None
    estilo: str | None = None
    com_legenda: bool | None = None
    # nestes três, mandar null explicitamente volta a usar o padrão do projeto/marca
    formatos: list[str] | None = None
    recursos: dict[str, bool] | None = None
    gancho: str | None = None
    crop_x: float | None = Field(default=None, ge=0, le=1)
    enquadramento: Literal["fixo", "auto"] | None = None
    gancho_midia_id: int | None = None  # 0 = sem hook em vídeo


class ListaTimestamps(BaseModel):
    texto: str


@router.get("/api/projetos/{projeto_id}/cortes")
def listar_cortes(projeto_id: int):
    _projeto(projeto_id)
    return [_corte_completo(c) for c in db.listar("SELECT * FROM cortes WHERE projeto_id=? ORDER BY inicio",
                                                  (projeto_id,))]


@router.post("/api/projetos/{projeto_id}/cortes")
def criar_corte(projeto_id: int, dados: NovoCorte):
    p = _projeto(projeto_id)
    inicio, fim = _validar_intervalo(p, dados.inicio, dados.fim)
    cid = cortes.criar(projeto_id, inicio, fim, dados.nome)
    return _corte_completo(_corte(cid))


@router.post("/api/projetos/{projeto_id}/cortes/lote")
def criar_cortes_em_lote(projeto_id: int, dados: ListaTimestamps):
    p = _projeto(projeto_id)
    if not p["duracao"]:
        raise HTTPException(400, "Aguarde o projeto terminar de processar.")
    cortes, invalidas = tempo.ler_lista(dados.texto, p["duracao"])
    criados = []
    for c in cortes:
        cid = cortes.criar(projeto_id, c["inicio"], c["fim"], c["nome"])
        criados.append(_corte_completo(_corte(cid)))
    return {"criados": criados, "invalidas": invalidas}


@router.patch("/api/cortes/{corte_id}")
def editar_corte(corte_id: int, dados: EdicaoCorte):
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    inicio = c["inicio"] if dados.inicio is None else dados.inicio
    fim = c["fim"] if dados.fim is None else dados.fim
    inicio, fim = _validar_intervalo(p, inicio, fim)
    nome = c["nome"] if dados.nome is None else (dados.nome.strip()[:120] or c["nome"])
    estilo = c["estilo"]
    if dados.estilo is not None:
        if dados.estilo not in {e["id"] for e in legendas.listar_estilos()}:
            raise HTTPException(400, "Estilo de legenda não encontrado.")
        estilo = dados.estilo
    com_legenda = c["com_legenda"] if dados.com_legenda is None else int(dados.com_legenda)
    enviados = dados.model_fields_set
    fmts = c["formatos"]
    if "formatos" in enviados:
        fmts = db.json_dump(_validar_formatos(dados.formatos)) if dados.formatos is not None else None
    recursos = c["recursos"]
    if "recursos" in enviados:
        recursos = (db.json_dump({k: bool(v) for k, v in dados.recursos.items()
                                  if k in ("logo", "intro", "outro", "musica")})
                    if dados.recursos is not None else None)
    gancho = c["gancho"]
    if "gancho" in enviados:
        gancho = (dados.gancho or "").strip()[:200] or None
    crop_x = c["crop_x"] if dados.crop_x is None else round(dados.crop_x, 4)
    enq = dados.enquadramento or c["enquadramento"]
    if dados.gancho_midia_id is not None:
        hook = dados.gancho_midia_id or None
        if hook and not db.um("SELECT id FROM midias WHERE id=? AND tipo='gancho'", (hook,)):
            raise HTTPException(400, "Hook em vídeo não encontrado na biblioteca de mídias.")
        db.executar("UPDATE cortes SET gancho_midia_id=? WHERE id=?", (hook, corte_id))
    db.executar("UPDATE cortes SET inicio=?, fim=?, nome=?, estilo=?, com_legenda=?, formatos=?, recursos=?, "
                "gancho=?, crop_x=?, enquadramento=? WHERE id=?",
                (inicio, fim, nome, estilo, com_legenda, fmts, recursos, gancho, crop_x, enq, corte_id))
    novo = _corte(corte_id)
    if enq == "auto" and enquadramento.trilha_valida(novo) is None and not _enquadrando(corte_id):
        jobs.enfileirar("enquadrar", projeto_id=novo["projeto_id"], corte_id=corte_id,
                        mensagem="Aguardando para achar quem fala")  # ligou agora ou mudou o trecho: recalcula
    return _corte_completo(novo)


def _enquadrando(corte_id: int) -> bool:
    return db.um("SELECT id FROM jobs WHERE tipo='enquadrar' AND corte_id=? AND status IN ('na_fila','executando')",
                 (corte_id,)) is not None


@router.post("/api/cortes/{corte_id}/enquadrar")
def recalcular_enquadramento(corte_id: int):
    """Recalcula a trilha do enquadramento automático (e liga o modo automático)."""
    c = _corte(corte_id)
    db.executar("UPDATE cortes SET enquadramento='auto', trilha_foco=NULL WHERE id=?", (corte_id,))
    if not _enquadrando(corte_id):
        jobs.enfileirar("enquadrar", projeto_id=c["projeto_id"], corte_id=corte_id,
                        mensagem="Aguardando para achar quem fala")
    return _corte_completo(_corte(corte_id))


@router.put("/api/cortes/{corte_id}/trilha")
def salvar_trilha(corte_id: int, pontos: list[tuple[float, float]]):
    """Trilha do enquadramento ajustada à mão: [[t, x], ...] (t relativo ao corte, x de 0 a 1)."""
    c = _corte(corte_id)
    dur = c["fim"] - c["inicio"]
    limpos = sorted((round(min(max(0.0, t), dur), 2), round(min(max(0.0, x), 1.0), 4)) for t, x in pontos)
    if len(limpos) < 2 or len(limpos) > 20000:
        raise HTTPException(400, "A trilha precisa ter entre 2 e 20 mil pontos.")
    db.executar("UPDATE cortes SET enquadramento='auto', trilha_foco=? WHERE id=?",
                (db.json_dump({"inicio": c["inicio"], "fim": c["fim"], "pontos": [list(p) for p in limpos],
                               "editada": True}), corte_id))
    return _corte_completo(_corte(corte_id))


class PalavrasLegenda(BaseModel):
    # [início, fim, texto] com tempo absoluto (da live)
    palavras: list[tuple[float, float, str]]


@router.get("/api/cortes/{corte_id}/legenda")
def ver_legenda(corte_id: int):
    c = _corte(corte_id)
    rel = tarefas.palavras_do_corte(c)
    if rel is None:
        return {"palavras": None, "editada": False}
    return {"palavras": [[round(i + c["inicio"], 3), round(f + c["inicio"], 3), t] for i, f, t in rel],
            "editada": bool(c["legenda"])}


@router.put("/api/cortes/{corte_id}/legenda")
def salvar_legenda(corte_id: int, dados: PalavrasLegenda):
    _corte(corte_id)
    palavras = sorted(([float(i), float(max(i, f)), t.strip()[:60]] for i, f, t in dados.palavras if t.strip()),
                      key=lambda w: w[0])
    db.executar("UPDATE cortes SET legenda=? WHERE id=?", (db.json_dump(palavras), corte_id))
    return ver_legenda(corte_id)


@router.delete("/api/cortes/{corte_id}/legenda")
def restaurar_legenda(corte_id: int):
    """Descarta a edição e volta a usar a transcrição."""
    _corte(corte_id)
    db.executar("UPDATE cortes SET legenda=NULL WHERE id=?", (corte_id,))
    return ver_legenda(corte_id)


@router.get("/api/cortes/{corte_id}/previa")
def previa_corte(corte_id: int, t: float, estilo: str | None = None):
    """Quadro do vídeo original no instante t (tempo da live) com a legenda desenhada por cima."""
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    fundo = _quadro(_fonte_rapida(p), t, p["largura"], p["altura"])
    palavras = tarefas.palavras_do_corte(c) or []
    img = legendas.compor(fundo, palavras, legendas.obter_estilo(estilo or c["estilo"]), t - c["inicio"])
    return _jpeg(img)


@router.delete("/api/cortes/{corte_id}")
def apagar_corte(corte_id: int):
    _corte(corte_id)
    db.executar("DELETE FROM cortes WHERE id=?", (corte_id,))
    return {"ok": True}


class PedidoExportacao(BaseModel):
    formatos: list[str] | None = None  # None = os formatos marcados no corte
    idioma: str | None = Field(default=None, pattern=r"^[a-z]{2}$")  # versão traduzida/dublada


@router.post("/api/cortes/{corte_id}/exportar")
def exportar_corte(corte_id: int, dados: PedidoExportacao | None = None):
    """Coloca na fila um arquivo por formato."""
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] == "gravando":
        from .. import live  # import tardio: só lives usam
        if not live.parte_da_live(p, c["inicio"], c["fim"]):
            raise HTTPException(400, "Este corte atravessa uma queda da live (ou ainda não foi todo gravado): ele "
                                     "pode ser exportado quando a live terminar.")
    elif p["status"] != "pronto":
        raise HTTPException(400, "Aguarde o projeto terminar de processar.")
    lista = _validar_formatos(dados.formatos) if dados and dados.formatos else tarefas.formatos_do_corte(c, p)
    idioma = dados.idioma if dados else None
    if idioma:
        from .. import idiomas
        if not idiomas.traducao(corte_id, idioma):
            raise HTTPException(400, "Traduza o corte para esse idioma antes de exportar.")
    criados = []
    for fmt in lista:
        jid = jobs.enfileirar("exportar", projeto_id=p["id"], corte_id=corte_id,
                              params={"nome": c["nome"], "formato": fmt, "idioma": idioma})
        criados.append(db.um("SELECT * FROM jobs WHERE id=?", (jid,)))
    return criados


class PedidoPrevia(BaseModel):
    corte_id: int
    formato: str
    t: float = 0.0             # instante relativo ao início do corte
    crop_x: float | None = Field(default=None, ge=0, le=1)
    layout: dict | None = None
    gancho: str | None = None
    recursos: dict[str, bool] | None = None
    enquadramento: Literal["fixo", "auto"] | None = None


@router.post("/api/previa-formato")
def previa_formato(dados: PedidoPrevia):
    """Um quadro do vídeo final (enquadramento, legenda, gancho e logo), com valores ainda não salvos."""
    c = _corte(dados.corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    if dados.formato not in formatos.FORMATOS:
        raise HTTPException(400, "Formato desconhecido.")
    sobrescrever = {k: v for k, v in dados.model_dump().items()
                    if k in ("crop_x", "layout", "gancho", "recursos", "enquadramento") and k in dados.model_fields_set}
    t = min(max(0.0, dados.t), max(0.0, c["fim"] - c["inicio"] - 0.05))
    pasta = Path(tempfile.mkdtemp(prefix="previa_", dir=config.DADOS))
    try:
        montagem = tarefas.preparar_montagem(c, p, dados.formato, pasta, previa_t=t, sobrescrever=sobrescrever)
        args, _ = formatos.comando(montagem, [], "-", previa=True)
        r = subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", *args], capture_output=True,
                           creationflags=config.SEM_JANELA)
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    if r.returncode != 0 or not r.stdout:
        raise HTTPException(500, "Falha ao gerar a prévia: " + r.stderr.decode("utf-8", "replace")[-400:])
    return Response(r.stdout, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
