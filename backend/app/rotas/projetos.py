"""Projetos (lives importadas): importar, editar, capa, preview, transcrição, miniaturas, exportar tudo."""
import json
import re
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .. import ajustes, config, db, jobs, marca, media, transcricao, tarefas
from .comum import _projeto, _com_progresso, _validar_formatos, _fonte_rapida, _quadro, _jpeg

router = APIRouter()


class NovoProjeto(BaseModel):
    entrada: str = Field(min_length=1)
    nome: str | None = None
    auto_cortes: bool = False  # transcreve, acha os momentos e já cria os cortes


@router.get("/api/projetos")
def listar_projetos():
    return [_com_progresso(p) for p in db.listar("SELECT * FROM projetos ORDER BY id DESC")]


@router.post("/api/projetos")
def criar_projeto(dados: NovoProjeto):
    entrada = dados.entrada.strip().strip('"')
    eh_link = re.match(r"^https?://", entrada, re.IGNORECASE) is not None
    if not eh_link:
        if not Path(entrada).is_file():
            raise HTTPException(400, "Arquivo não encontrado. Confira o caminho ou cole um link.")
        entrada = str(Path(entrada).resolve())
    nome = (dados.nome or "").strip() or (entrada if eh_link else Path(entrada).stem)
    pid = db.executar("INSERT INTO projetos (nome, origem, entrada, auto_cortes, criado_em) VALUES (?,?,?,?,?)",
                      (nome, "link" if eh_link else "arquivo", entrada, int(dados.auto_cortes), db.agora()))
    ajustes.salvar({"auto_cortes": dados.auto_cortes})  # a caixinha lembra a última escolha
    jobs.enfileirar("importar", projeto_id=pid)
    return _com_progresso(_projeto(pid))


@router.get("/api/projetos/{projeto_id}")
def ver_projeto(projeto_id: int):
    return _com_progresso(_projeto(projeto_id))


class EdicaoProjeto(BaseModel):
    nome: str | None = None
    idioma: str | None = Field(default=None, pattern="^(pt|en|misto)$")
    formatos: list[str] | None = None
    layout: dict | None = None


@router.patch("/api/projetos/{projeto_id}")
def editar_projeto(projeto_id: int, dados: EdicaoProjeto):
    p = _projeto(projeto_id)
    nome = (dados.nome or "").strip()[:200] or p["nome"]
    idioma = dados.idioma or p["idioma"]
    fmts = db.json_dump(_validar_formatos(dados.formatos)) if dados.formatos is not None else p["formatos"]
    layout = db.json_dump(marca.validar_layout(dados.layout)) if dados.layout is not None else p["layout"]
    db.executar("UPDATE projetos SET nome=?, idioma=?, formatos=?, layout=? WHERE id=?",
                (nome, idioma, fmts, layout, projeto_id))
    if dados.formatos is not None:  # formatos do projeto valem para todos os cortes dele
        db.executar("UPDATE cortes SET formatos=NULL WHERE projeto_id=?", (projeto_id,))
    return _com_progresso(_projeto(projeto_id))


@router.get("/api/projetos/{projeto_id}/capa")
def capa_projeto(projeto_id: int):
    """Miniatura do projeto (um quadro do preview), gerada uma vez e guardada."""
    p = _projeto(projeto_id)
    pasta = config.PROJETOS / str(projeto_id)
    capa = pasta / "capa.jpg"
    proxy = pasta / "proxy.mp4"
    if not capa.exists():
        if p["status"] != "pronto" or not proxy.exists():
            raise HTTPException(404, "Ainda sem capa")
        instante = min(max(1.0, (p["duracao"] or 0) * 0.1), 120.0)
        subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{instante:.2f}",
                        "-i", str(proxy), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(capa)],
                       capture_output=True, creationflags=config.SEM_JANELA)
        if not capa.exists():
            raise HTTPException(404, "Não foi possível gerar a capa")
    return FileResponse(capa, media_type="image/jpeg")


@router.get("/api/projetos/{projeto_id}/quadro")
def quadro_projeto(projeto_id: int, t: float = 0, largura: int = 960):
    """Quadro do vídeo original (para marcar recorte e câmera/jogo)."""
    p = _projeto(projeto_id)
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    largura = max(160, min(1920, largura))
    altura = round(largura * p["altura"] / p["largura"])
    return _jpeg(_quadro(_fonte_rapida(p), t, largura, altura), 1080)


@router.post("/api/projetos/{projeto_id}/transcrever")
def transcrever_projeto(projeto_id: int):
    """(Re)transcreve o projeto; cancela uma transcrição anterior ainda em andamento."""
    p = _projeto(projeto_id)
    if p["status"] != "pronto":
        raise HTTPException(400, "Aguarde o projeto terminar de importar.")
    for j in db.listar("SELECT id FROM jobs WHERE tipo='transcrever' AND projeto_id=? "
                       "AND status IN ('na_fila','executando')", (projeto_id,)):
        jobs.cancelar(j["id"])
    jobs.enfileirar("transcrever", projeto_id=projeto_id)
    return _com_progresso(_projeto(projeto_id))


@router.get("/api/projetos/{projeto_id}/transcricao")
def ver_transcricao(projeto_id: int):
    arq = transcricao.caminho(projeto_id)
    if not arq.exists():
        raise HTTPException(404, "Ainda sem transcrição")
    return FileResponse(arq, media_type="application/json", headers={"Cache-Control": "no-store"})


@router.post("/api/projetos/{projeto_id}/reprocessar")
def reprocessar_projeto(projeto_id: int):
    p = _projeto(projeto_id)
    if p["status"] in ("na_fila", "processando"):
        raise HTTPException(409, "O projeto já está sendo processado.")
    db.executar("UPDATE projetos SET status='na_fila', erro=NULL WHERE id=?", (projeto_id,))
    jobs.enfileirar("importar", projeto_id=projeto_id)
    return _com_progresso(_projeto(projeto_id))


@router.delete("/api/projetos/{projeto_id}")
def apagar_projeto(projeto_id: int):
    """Apaga o projeto e seus arquivos internos (preview, download). O arquivo local original e
    os cortes já exportados NÃO são apagados."""
    _projeto(projeto_id)
    for j in db.listar("SELECT id FROM jobs WHERE projeto_id=? AND status IN ('na_fila','executando')",
                       (projeto_id,)):
        jobs.cancelar(j["id"])
    db.executar("DELETE FROM projetos WHERE id=?", (projeto_id,))
    shutil.rmtree(config.PROJETOS / str(projeto_id), ignore_errors=True)
    return {"ok": True}


@router.get("/api/projetos/{projeto_id}/proxy")
def proxy(projeto_id: int):
    arq = config.PROJETOS / str(projeto_id) / "proxy.mp4"
    if not arq.exists():
        raise HTTPException(404, "Preview ainda não gerado")
    return FileResponse(arq, media_type="video/mp4")


@router.get("/api/projetos/{projeto_id}/miniaturas")
def miniaturas(projeto_id: int):
    """Descrição da tira de quadros da timeline; gera em segundo plano se ainda não existir (202 = aguarde)."""
    p = _projeto(projeto_id)
    img, meta = media.arquivos_miniaturas(projeto_id)
    if img.is_file() and meta.is_file():
        return {**json.loads(meta.read_text(encoding="utf-8")), "versao": int(img.stat().st_mtime)}
    if p["status"] == "pronto":
        media.miniaturas_em_segundo_plano(projeto_id, p["duracao"] or 0)
    return Response(status_code=202)


@router.get("/api/projetos/{projeto_id}/miniaturas.jpg")
def miniaturas_imagem(projeto_id: int):
    img, _ = media.arquivos_miniaturas(projeto_id)
    if not img.is_file():
        raise HTTPException(404, "Miniaturas ainda não geradas")
    return FileResponse(img, media_type="image/jpeg")


@router.get("/api/projetos/{projeto_id}/ondas")
def ondas(projeto_id: int):
    arq = config.PROJETOS / str(projeto_id) / "ondas.json"
    if not arq.exists():
        raise HTTPException(404, "Forma de onda ainda não gerada")
    return FileResponse(arq, media_type="application/json")


@router.post("/api/projetos/{projeto_id}/exportar")
def exportar_projeto(projeto_id: int):
    """Todos os cortes do projeto, cada um nos seus formatos."""
    p = _projeto(projeto_id)
    if p["status"] != "pronto":
        raise HTTPException(400, "Aguarde o projeto terminar de processar.")
    lista = db.listar("SELECT * FROM cortes WHERE projeto_id=? ORDER BY inicio", (projeto_id,))
    if not lista:
        raise HTTPException(400, "Este projeto ainda não tem cortes.")
    n = 0
    for c in lista:
        for fmt in tarefas.formatos_do_corte(c, p):
            jobs.enfileirar("exportar", projeto_id=projeto_id, corte_id=c["id"],
                            params={"nome": c["nome"], "formato": fmt})
            n += 1
    return {"cortes": len(lista), "arquivos": n}
