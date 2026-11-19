"""Thumbnails: quadros candidatos, recorte da pessoa, textos, imagens, designs e templates."""
import io
import json
import os
import requests
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

from .. import config, thumbs, tarefas
from .comum import _projeto, _corte

router = APIRouter()


def _arquivo_thumb(c: dict, tamanho: str) -> Path:
    p = _projeto(c["projeto_id"])
    return tarefas.pasta_saida(p, c) / f"Thumbnail {tamanho}.png"


def _validar_tamanho(tamanho: str) -> None:
    if tamanho not in thumbs.TAMANHOS:
        raise HTTPException(400, "Tamanho de thumbnail desconhecido.")


@router.post("/api/cortes/{corte_id}/thumb/candidatos")
def thumb_candidatos(corte_id: int):
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    try:
        return thumbs.candidatos(c, p)
    except RuntimeError as e:
        raise HTTPException(500, str(e)) from e


class PedidoRecorte(BaseModel):
    arquivo: str


@router.post("/api/cortes/{corte_id}/thumb/recorte")
def thumb_recorte(corte_id: int, dados: PedidoRecorte):
    """Recorta a pessoa do quadro (na 1ª vez baixa o modelo de ~178 MB)."""
    c = _corte(corte_id)
    try:
        return thumbs.recorte_do_quadro(c["projeto_id"], corte_id, dados.arquivo)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e)) from e
    except (RuntimeError, requests.RequestException) as e:
        raise HTTPException(500, f"Falha no recorte: {e}") from e


@router.get("/api/thumb/modelo-recorte")
def thumb_modelo_recorte():
    return {"baixado": thumbs.modelo_baixado()}


@router.post("/api/cortes/{corte_id}/thumb/textos")
def thumb_textos(corte_id: int):
    c = _corte(corte_id)
    return thumbs.textos(c, tarefas.palavras_do_corte(c))


@router.get("/api/thumb/arquivo/{projeto_id}/{corte_id}/{nome}")
def thumb_arquivo(projeto_id: int, corte_id: int, nome: str):
    if not thumbs.NOME_SEGURO.match(nome):
        raise HTTPException(400, "Nome inválido")
    arq = config.PROJETOS / str(projeto_id) / "thumbs" / str(corte_id) / nome
    if not arq.is_file():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(arq)


class ImagemEnviada(BaseModel):
    dataurl: str


@router.post("/api/thumb/imagens")
def thumb_enviar_imagem(dados: ImagemEnviada):
    try:
        return thumbs.salvar_imagem_enviada(dados.dataurl)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/api/thumb/imagens/{nome}")
def thumb_imagem(nome: str):
    if not thumbs.NOME_SEGURO.match(nome):
        raise HTTPException(400, "Nome inválido")
    arq = thumbs.PASTA_IMAGENS / nome
    if not arq.is_file():
        raise HTTPException(404, "Imagem não encontrada")
    return FileResponse(arq)


@router.get("/api/cortes/{corte_id}/thumb/design/{tamanho}")
def thumb_ver_design(corte_id: int, tamanho: str):
    c = _corte(corte_id)
    _validar_tamanho(tamanho)
    arq = thumbs.pasta(c["projeto_id"], corte_id) / f"design_{tamanho}.json"
    existe = _arquivo_thumb(c, tamanho)
    return {"design": json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else None,
            "exportada": str(existe) if existe.exists() else None}


class SalvarThumb(BaseModel):
    design: dict
    png: str | None = None  # data URL da imagem final (exportar)


@router.put("/api/cortes/{corte_id}/thumb/design/{tamanho}")
def thumb_salvar(corte_id: int, tamanho: str, dados: SalvarThumb):
    """Salva o design (para editar depois) e, se vier a imagem, grava o PNG na pasta de exportados."""
    c = _corte(corte_id)
    _validar_tamanho(tamanho)
    texto = json.dumps(dados.design, ensure_ascii=False)
    if len(texto) > 5_000_000:
        raise HTTPException(400, "Design grande demais.")
    (thumbs.pasta(c["projeto_id"], corte_id) / f"design_{tamanho}.json").write_text(texto, encoding="utf-8")
    saida = None
    if dados.png:
        try:
            png = thumbs.ler_dataurl_png(dados.png)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        img = Image.open(io.BytesIO(png))
        esperado = thumbs.TAMANHOS[tamanho]
        if img.size != esperado:
            img = img.resize(esperado, Image.LANCZOS)
        saida = _arquivo_thumb(c, tamanho)
        img.convert("RGB").save(saida, "PNG", optimize=True)
    return {"ok": True, "exportada": str(saida) if saida else None}


@router.post("/api/cortes/{corte_id}/thumb/abrir/{tamanho}")
def thumb_abrir(corte_id: int, tamanho: str):
    c = _corte(corte_id)
    _validar_tamanho(tamanho)
    arq = _arquivo_thumb(c, tamanho)
    if not arq.exists():
        raise HTTPException(404, "Thumbnail ainda não exportada.")
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(arq)])
    return {"ok": True}


@router.get("/api/thumb/templates")
def thumb_templates():
    return thumbs.ler_templates()


@router.put("/api/thumb/templates")
def thumb_salvar_templates(lista: list[dict]):
    try:
        return thumbs.salvar_templates(lista)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
