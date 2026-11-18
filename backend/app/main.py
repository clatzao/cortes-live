"""Servidor local do Cortes Live (API + site)."""
import io
import json
import os

import requests
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from . import ajustes, config, db, formatos, hardware, jobs, legendas, marca, tempo, thumbs, transcricao, viral
from . import tarefas  # registra os jobs na fila

app = FastAPI(title="Cortes Live")


@app.on_event("startup")
def _inicio() -> None:
    hardware.detectar_em_segundo_plano()
    jobs.iniciar()


def _projeto(projeto_id: int) -> dict:
    p = db.um("SELECT * FROM projetos WHERE id=?", (projeto_id,))
    if not p:
        raise HTTPException(404, "Projeto não encontrado")
    return p


def _corte(corte_id: int) -> dict:
    c = db.um("SELECT * FROM cortes WHERE id=?", (corte_id,))
    if not c:
        raise HTTPException(404, "Corte não encontrado")
    return c


def _ultimo_job(tipo: str, projeto_id: int) -> dict | None:
    return db.um("SELECT id, status, progresso, mensagem FROM jobs WHERE tipo=? AND projeto_id=? "
                 "ORDER BY id DESC LIMIT 1", (tipo, projeto_id))


def _com_progresso(p: dict) -> dict:
    p["job"] = _ultimo_job("importar", p["id"])
    p["job_transcricao"] = _ultimo_job("transcrever", p["id"])
    p["tem_transcricao"] = transcricao.caminho(p["id"]).exists()
    m = marca.ler()
    p["formatos_efetivos"] = tarefas.formatos_do_corte({}, p, m)
    p["layout_efetivo"] = tarefas.layout_do_projeto(p, m)
    return p


def _corte_completo(c: dict) -> dict:
    p = _projeto(c["projeto_id"])
    m = marca.ler()
    c["formatos_efetivos"] = tarefas.formatos_do_corte(c, p, m)
    c["recursos_efetivos"] = marca.recursos_do_corte(c, m)
    return c


# ---------------------------------------------------------------- hardware

@app.get("/api/hardware")
def ver_hardware():
    return hardware.estado(esperar=False) or {"detectando": True}


@app.post("/api/hardware/detectar")
def detectar_hardware():
    return hardware.detectar()


class Ajustes(BaseModel):
    whisper_modelo: str | None = None
    whisper_dispositivo: str | None = None
    gemini_chave: str | None = None   # "" apaga a chave
    gemini_modelo: str | None = None
    viral_min: int | None = None
    viral_max: int | None = None
    viral_qtd: int | None = None
    viral_auto: bool | None = None


@app.get("/api/ajustes")
def ver_ajustes():
    return {**ajustes.publico(), "opcoes": {"whisper_modelo": ajustes.MODELOS_WHISPER,
                                            "whisper_dispositivo": ajustes.DISPOSITIVOS}}


@app.put("/api/ajustes")
def salvar_ajustes(dados: Ajustes):
    ajustes.salvar(dados.model_dump(exclude_none=True))
    return ver_ajustes()


@app.post("/api/ajustes/testar-gemini")
def testar_gemini():
    """Confere a chave salva e lista os modelos disponíveis para ela."""
    chave = ajustes.ler()["gemini_chave"]
    if not chave:
        raise HTTPException(400, "Nenhuma chave salva.")
    try:
        nomes = viral.listar_modelos(chave)
        escolhido = viral.escolher_modelo(nomes, ajustes.ler()["gemini_modelo"])
    except (viral.ErroGemini, requests.RequestException) as e:
        raise HTTPException(400, str(e)) from e
    flash = sorted(n for n in nomes if n.startswith("gemini"))
    return {"ok": True, "modelo_escolhido": escolhido, "modelos": flash}


_TIPOS_ARQUIVO = {
    "video": ("Escolha o vídeo", "Vídeos", "*.mp4 *.mkv *.mov *.flv *.ts *.webm *.avi *.m4v"),
    "imagem": ("Escolha a imagem (PNG com fundo transparente é o ideal)", "Imagens", "*.png *.jpg *.jpeg *.webp"),
    "audio": ("Escolha a música", "Áudio", "*.mp3 *.wav *.m4a *.aac *.ogg *.flac"),
}


@app.post("/api/procurar")
def procurar_arquivo(tipo: str = "video"):
    """Abre a janela 'Abrir arquivo' do Windows (o servidor roda no mesmo PC)."""
    titulo, rotulo, padroes = _TIPOS_ARQUIVO.get(tipo, _TIPOS_ARQUIVO["video"])
    script = (
        "import sys, tkinter as tk\nfrom tkinter import filedialog\n"
        "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
        "p = filedialog.askopenfilename(title=sys.argv[1], filetypes=[(sys.argv[2], sys.argv[3]), ('Todos', '*.*')])\n"
        "print(p, end='')\n"
    )
    r = subprocess.run([sys.executable, "-c", script, titulo, rotulo, padroes], capture_output=True, text=True,
                       encoding="utf-8")
    if r.returncode != 0:
        raise HTTPException(500, "Não foi possível abrir a janela de arquivos. Cole o caminho manualmente.")
    caminho = r.stdout.strip()
    return {"caminho": str(Path(caminho)) if caminho else None}


# ---------------------------------------------------------------- projetos

class NovoProjeto(BaseModel):
    entrada: str = Field(min_length=1)
    nome: str | None = None


@app.get("/api/projetos")
def listar_projetos():
    return [_com_progresso(p) for p in db.listar("SELECT * FROM projetos ORDER BY id DESC")]


@app.post("/api/projetos")
def criar_projeto(dados: NovoProjeto):
    entrada = dados.entrada.strip().strip('"')
    eh_link = re.match(r"^https?://", entrada, re.IGNORECASE) is not None
    if not eh_link:
        if not Path(entrada).is_file():
            raise HTTPException(400, "Arquivo não encontrado. Confira o caminho ou cole um link.")
        entrada = str(Path(entrada).resolve())
    nome = (dados.nome or "").strip() or (entrada if eh_link else Path(entrada).stem)
    pid = db.executar("INSERT INTO projetos (nome, origem, entrada, criado_em) VALUES (?,?,?,?)",
                      (nome, "link" if eh_link else "arquivo", entrada, db.agora()))
    jobs.enfileirar("importar", projeto_id=pid)
    return _com_progresso(_projeto(pid))


@app.get("/api/projetos/{projeto_id}")
def ver_projeto(projeto_id: int):
    return _com_progresso(_projeto(projeto_id))


class EdicaoProjeto(BaseModel):
    nome: str | None = None
    idioma: str | None = Field(default=None, pattern="^(pt|en|misto)$")
    formatos: list[str] | None = None
    layout: dict | None = None


def _validar_formatos(lista: list[str]) -> list[str]:
    validos = [f for f in dict.fromkeys(lista) if f in formatos.FORMATOS]
    if not validos:
        raise HTTPException(400, "Escolha pelo menos um formato.")
    return validos


@app.patch("/api/projetos/{projeto_id}")
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


@app.get("/api/projetos/{projeto_id}/quadro")
def quadro_projeto(projeto_id: int, t: float = 0, largura: int = 960):
    """Quadro do vídeo original (para marcar recorte e câmera/jogo)."""
    p = _projeto(projeto_id)
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    largura = max(160, min(1920, largura))
    altura = round(largura * p["altura"] / p["largura"])
    return _jpeg(_quadro(p["caminho_original"], t, largura, altura), 1080)


@app.post("/api/projetos/{projeto_id}/transcrever")
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


@app.get("/api/projetos/{projeto_id}/transcricao")
def ver_transcricao(projeto_id: int):
    arq = transcricao.caminho(projeto_id)
    if not arq.exists():
        raise HTTPException(404, "Ainda sem transcrição")
    return FileResponse(arq, media_type="application/json", headers={"Cache-Control": "no-store"})


@app.post("/api/projetos/{projeto_id}/reprocessar")
def reprocessar_projeto(projeto_id: int):
    p = _projeto(projeto_id)
    if p["status"] in ("na_fila", "processando"):
        raise HTTPException(409, "O projeto já está sendo processado.")
    db.executar("UPDATE projetos SET status='na_fila', erro=NULL WHERE id=?", (projeto_id,))
    jobs.enfileirar("importar", projeto_id=projeto_id)
    return _com_progresso(_projeto(projeto_id))


@app.delete("/api/projetos/{projeto_id}")
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


@app.get("/api/projetos/{projeto_id}/proxy")
def proxy(projeto_id: int):
    arq = config.PROJETOS / str(projeto_id) / "proxy.mp4"
    if not arq.exists():
        raise HTTPException(404, "Preview ainda não gerado")
    return FileResponse(arq, media_type="video/mp4")


@app.get("/api/projetos/{projeto_id}/ondas")
def ondas(projeto_id: int):
    arq = config.PROJETOS / str(projeto_id) / "ondas.json"
    if not arq.exists():
        raise HTTPException(404, "Forma de onda ainda não gerada")
    return FileResponse(arq, media_type="application/json")


# ---------------------------------------------------------------- cortes

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


class ListaTimestamps(BaseModel):
    texto: str


def _validar_intervalo(p: dict, inicio: float, fim: float) -> tuple[float, float]:
    duracao = p["duracao"] or 0
    if fim < inicio:
        inicio, fim = fim, inicio
    fim = min(fim, duracao) if duracao else fim
    if fim - inicio < 0.5:
        raise HTTPException(400, "O corte precisa ter pelo menos 0,5 segundo.")
    return round(inicio, 2), round(fim, 2)


def _proximo_nome(projeto_id: int) -> str:
    n = db.um("SELECT COUNT(*) AS n FROM cortes WHERE projeto_id=?", (projeto_id,))["n"]
    return f"Corte {n + 1}"


@app.get("/api/projetos/{projeto_id}/cortes")
def listar_cortes(projeto_id: int):
    _projeto(projeto_id)
    return [_corte_completo(c) for c in db.listar("SELECT * FROM cortes WHERE projeto_id=? ORDER BY inicio",
                                                  (projeto_id,))]


@app.post("/api/projetos/{projeto_id}/cortes")
def criar_corte(projeto_id: int, dados: NovoCorte):
    p = _projeto(projeto_id)
    inicio, fim = _validar_intervalo(p, dados.inicio, dados.fim)
    nome = (dados.nome or "").strip() or _proximo_nome(projeto_id)
    cid = db.executar("INSERT INTO cortes (projeto_id, nome, inicio, fim, criado_em) VALUES (?,?,?,?,?)",
                      (projeto_id, nome[:120], inicio, fim, db.agora()))
    return _corte_completo(_corte(cid))


@app.post("/api/projetos/{projeto_id}/cortes/lote")
def criar_cortes_em_lote(projeto_id: int, dados: ListaTimestamps):
    p = _projeto(projeto_id)
    if not p["duracao"]:
        raise HTTPException(400, "Aguarde o projeto terminar de processar.")
    cortes, invalidas = tempo.ler_lista(dados.texto, p["duracao"])
    criados = []
    for c in cortes:
        nome = c["nome"] or _proximo_nome(projeto_id)
        cid = db.executar("INSERT INTO cortes (projeto_id, nome, inicio, fim, criado_em) VALUES (?,?,?,?,?)",
                          (projeto_id, nome, c["inicio"], c["fim"], db.agora()))
        criados.append(_corte_completo(_corte(cid)))
    return {"criados": criados, "invalidas": invalidas}


@app.patch("/api/cortes/{corte_id}")
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
    db.executar("UPDATE cortes SET inicio=?, fim=?, nome=?, estilo=?, com_legenda=?, formatos=?, recursos=?, "
                "gancho=?, crop_x=? WHERE id=?",
                (inicio, fim, nome, estilo, com_legenda, fmts, recursos, gancho, crop_x, corte_id))
    return _corte_completo(_corte(corte_id))


# ---------------------------------------------------------------- legenda de cada corte

class PalavrasLegenda(BaseModel):
    # [início, fim, texto] com tempo absoluto (da live)
    palavras: list[tuple[float, float, str]]


@app.get("/api/cortes/{corte_id}/legenda")
def ver_legenda(corte_id: int):
    c = _corte(corte_id)
    rel = tarefas.palavras_do_corte(c)
    if rel is None:
        return {"palavras": None, "editada": False}
    return {"palavras": [[round(i + c["inicio"], 3), round(f + c["inicio"], 3), t] for i, f, t in rel],
            "editada": bool(c["legenda"])}


@app.put("/api/cortes/{corte_id}/legenda")
def salvar_legenda(corte_id: int, dados: PalavrasLegenda):
    _corte(corte_id)
    palavras = sorted(([float(i), float(max(i, f)), t.strip()[:60]] for i, f, t in dados.palavras if t.strip()),
                      key=lambda w: w[0])
    db.executar("UPDATE cortes SET legenda=? WHERE id=?", (db.json_dump(palavras), corte_id))
    return ver_legenda(corte_id)


@app.delete("/api/cortes/{corte_id}/legenda")
def restaurar_legenda(corte_id: int):
    """Descarta a edição e volta a usar a transcrição."""
    _corte(corte_id)
    db.executar("UPDATE cortes SET legenda=NULL WHERE id=?", (corte_id,))
    return ver_legenda(corte_id)


def _quadro(origem: str, instante: float, largura: int, altura: int) -> Image.Image:
    r = subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0, instante):.3f}",
                        "-i", origem, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
                       capture_output=True, creationflags=config.SEM_JANELA)
    if r.returncode != 0 or not r.stdout:
        return Image.new("RGB", (largura, altura), (20, 20, 20))
    # recorta no centro se a proporção for outra (ex.: quadro 16:9 numa prévia 9:16), sem esticar
    return ImageOps.fit(Image.open(io.BytesIO(r.stdout)).convert("RGB"), (largura, altura))


def _jpeg(img: Image.Image, altura_max: int = 720) -> Response:
    if img.height > altura_max:
        img = img.resize((round(img.width * altura_max / img.height), altura_max))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return Response(buf.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/cortes/{corte_id}/previa")
def previa_corte(corte_id: int, t: float, estilo: str | None = None):
    """Quadro do vídeo original no instante t (tempo da live) com a legenda desenhada por cima."""
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    fundo = _quadro(p["caminho_original"], t, p["largura"], p["altura"])
    palavras = tarefas.palavras_do_corte(c) or []
    img = legendas.compor(fundo, palavras, legendas.obter_estilo(estilo or c["estilo"]), t - c["inicio"])
    return _jpeg(img)


# ---------------------------------------------------------------- estilos de legenda

@app.get("/api/legendas/estilos")
def listar_estilos():
    return [{**e, "de_fabrica": e["id"] in legendas.IDS_PADRAO} for e in legendas.listar_estilos()]


@app.put("/api/legendas/estilos/{estilo_id}")
def salvar_estilo(estilo_id: str, dados: dict):
    if not re.fullmatch(r"[a-z0-9_-]{1,40}", estilo_id):
        raise HTTPException(400, "Identificador inválido.")
    return legendas.salvar_estilo(estilo_id, dados)


@app.delete("/api/legendas/estilos/{estilo_id}")
def apagar_estilo(estilo_id: str):
    legendas.apagar_estilo(estilo_id)
    if estilo_id not in legendas.IDS_PADRAO:
        db.executar("UPDATE cortes SET estilo='classico' WHERE estilo=?", (estilo_id,))
    return {"ok": True}


class PreviaEstilo(BaseModel):
    estilo: dict
    projeto_id: int | None = None
    vertical: bool = True


@app.post("/api/legendas/previa")
def previa_estilo(dados: PreviaEstilo):
    estilo = legendas.validar_estilo(dados.estilo, "previa")
    w, h = (1080, 1920) if dados.vertical else (1920, 1080)
    fundo = None
    if dados.projeto_id:
        p = db.um("SELECT * FROM projetos WHERE id=? AND status='pronto'", (dados.projeto_id,))
        if p:
            fundo = _quadro(p["caminho_original"], (p["duracao"] or 0) / 3, w, h)
    return _jpeg(legendas.previa_estilo(estilo, w, h, fundo), 640)


@app.get("/api/legendas/fontes")
def listar_fontes():
    return legendas.listar_fontes()


class Dicionarios(BaseModel):
    emojis: dict[str, str] | None = None
    palavras_chave: list[str] | None = None


@app.get("/api/legendas/dicionarios")
def ver_dicionarios():
    return legendas.ler_dicionarios()


@app.put("/api/legendas/dicionarios")
def salvar_dicionarios(dados: Dicionarios):
    return legendas.salvar_dicionarios(dados.emojis, dados.palavras_chave)


@app.delete("/api/cortes/{corte_id}")
def apagar_corte(corte_id: int):
    _corte(corte_id)
    db.executar("DELETE FROM cortes WHERE id=?", (corte_id,))
    return {"ok": True}


class PedidoExportacao(BaseModel):
    formatos: list[str] | None = None  # None = os formatos marcados no corte


@app.post("/api/cortes/{corte_id}/exportar")
def exportar_corte(corte_id: int, dados: PedidoExportacao | None = None):
    """Coloca na fila um arquivo por formato."""
    c = _corte(corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Aguarde o projeto terminar de processar.")
    lista = _validar_formatos(dados.formatos) if dados and dados.formatos else tarefas.formatos_do_corte(c, p)
    criados = []
    for fmt in lista:
        jid = jobs.enfileirar("exportar", projeto_id=p["id"], corte_id=corte_id,
                              params={"nome": c["nome"], "formato": fmt})
        criados.append(db.um("SELECT * FROM jobs WHERE id=?", (jid,)))
    return criados


# ---------------------------------------------------------------- momentos virais

class PedidoAnalise(BaseModel):
    min: int | None = Field(default=None, ge=5, le=600)
    max: int | None = Field(default=None, ge=5, le=900)
    qtd: int | None = Field(default=None, ge=1, le=50)


@app.post("/api/projetos/{projeto_id}/analisar")
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


@app.get("/api/projetos/{projeto_id}/sugestoes")
def listar_sugestoes(projeto_id: int):
    _projeto(projeto_id)
    return db.listar("SELECT * FROM sugestoes WHERE projeto_id=? AND status!='descartada' "
                     "ORDER BY status='aceita', nota DESC", (projeto_id,))


def _sugestao(sid: int) -> dict:
    s = db.um("SELECT * FROM sugestoes WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "Sugestão não encontrada")
    return s


@app.post("/api/sugestoes/{sugestao_id}/aceitar")
def aceitar_sugestao(sugestao_id: int):
    """Transforma a sugestão num corte (com nome e gancho já preenchidos)."""
    s = _sugestao(sugestao_id)
    if s["status"] == "aceita" and s["corte_id"] and db.um("SELECT id FROM cortes WHERE id=?", (s["corte_id"],)):
        return _corte_completo(_corte(s["corte_id"]))
    p = _projeto(s["projeto_id"])
    inicio, fim = _validar_intervalo(p, s["inicio"], s["fim"])
    cid = db.executar("INSERT INTO cortes (projeto_id, nome, inicio, fim, gancho, criado_em) VALUES (?,?,?,?,?,?)",
                      (p["id"], (s["nome"] or _proximo_nome(p["id"]))[:120], inicio, fim, s["gancho"] or None,
                       db.agora()))
    db.executar("UPDATE sugestoes SET status='aceita', corte_id=? WHERE id=?", (cid, sugestao_id))
    return _corte_completo(_corte(cid))


@app.post("/api/sugestoes/{sugestao_id}/descartar")
def descartar_sugestao(sugestao_id: int):
    _sugestao(sugestao_id)
    db.executar("UPDATE sugestoes SET status='descartada' WHERE id=?", (sugestao_id,))
    return {"ok": True}


# ---------------------------------------------------------------- formatos e marca

@app.get("/api/formatos")
def listar_formatos():
    return [{"id": k, **v} for k, v in formatos.FORMATOS.items()]


@app.get("/api/marca")
def ver_marca():
    return {**marca.ler(), "posicoes": marca.POSICOES}


@app.put("/api/marca")
def salvar_marca(dados: dict):
    for k in ("logo", "intro", "outro", "musica"):
        arq = (dados.get(k) or {}).get("arquivo")
        if arq and not Path(str(arq).strip().strip('"')).is_file():
            raise HTTPException(400, f"Arquivo não encontrado ({k}): {arq}")
    return {**marca.salvar(dados), "posicoes": marca.POSICOES}


class PedidoPrevia(BaseModel):
    corte_id: int
    formato: str
    t: float = 0.0             # instante relativo ao início do corte
    crop_x: float | None = Field(default=None, ge=0, le=1)
    layout: dict | None = None
    gancho: str | None = None
    recursos: dict[str, bool] | None = None


@app.post("/api/previa-formato")
def previa_formato(dados: PedidoPrevia):
    """Um quadro do vídeo final (enquadramento, legenda, gancho e logo), com valores ainda não salvos."""
    c = _corte(dados.corte_id)
    p = _projeto(c["projeto_id"])
    if p["status"] != "pronto":
        raise HTTPException(400, "Projeto ainda não está pronto.")
    if dados.formato not in formatos.FORMATOS:
        raise HTTPException(400, "Formato desconhecido.")
    sobrescrever = {k: v for k, v in dados.model_dump().items()
                    if k in ("crop_x", "layout", "gancho", "recursos") and k in dados.model_fields_set}
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


# ---------------------------------------------------------------- fila

@app.get("/api/fila")
def listar_fila():
    return db.listar(
        "SELECT j.*, p.nome AS projeto_nome, c.nome AS corte_nome FROM jobs j "
        "LEFT JOIN projetos p ON p.id = j.projeto_id LEFT JOIN cortes c ON c.id = j.corte_id "
        "ORDER BY j.id DESC LIMIT 300"
    )


@app.post("/api/fila/{job_id}/cancelar")
def cancelar_job(job_id: int):
    jobs.cancelar(job_id)
    return {"ok": True}


@app.delete("/api/fila/finalizados")
def limpar_finalizados():
    db.executar("DELETE FROM jobs WHERE status IN ('concluido','erro','cancelado')")
    return {"ok": True}


@app.post("/api/fila/{job_id}/abrir")
def abrir_saida(job_id: int):
    """Abre o Explorer com o arquivo exportado selecionado."""
    job = db.um("SELECT saida FROM jobs WHERE id=?", (job_id,))
    if not job or not job["saida"] or not Path(job["saida"]).exists():
        raise HTTPException(404, "Arquivo exportado não encontrado.")
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(Path(job["saida"]))])
    return {"ok": True}


@app.post("/api/abrir-exportados")
def abrir_exportados():
    if os.name == "nt":
        os.startfile(config.EXPORTADOS)  # noqa: S606 - pasta fixa do próprio programa
    return {"ok": True}


# ---------------------------------------------------------------- thumbnails

def _arquivo_thumb(c: dict, tamanho: str) -> Path:
    p = _projeto(c["projeto_id"])
    pasta = config.EXPORTADOS / f"{p['id']}_{tarefas.nome_seguro(p['nome'], 50)}"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta / f"{tarefas.nome_seguro(c['nome'] or 'corte')}_{c['id']}_thumb_{tamanho}.png"


def _validar_tamanho(tamanho: str) -> None:
    if tamanho not in thumbs.TAMANHOS:
        raise HTTPException(400, "Tamanho de thumbnail desconhecido.")


@app.post("/api/cortes/{corte_id}/thumb/candidatos")
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


@app.post("/api/cortes/{corte_id}/thumb/recorte")
def thumb_recorte(corte_id: int, dados: PedidoRecorte):
    """Recorta a pessoa do quadro (na 1ª vez baixa o modelo de ~178 MB)."""
    c = _corte(corte_id)
    try:
        return thumbs.recorte_do_quadro(c["projeto_id"], corte_id, dados.arquivo)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e)) from e
    except (RuntimeError, requests.RequestException) as e:
        raise HTTPException(500, f"Falha no recorte: {e}") from e


@app.get("/api/thumb/modelo-recorte")
def thumb_modelo_recorte():
    return {"baixado": thumbs.modelo_baixado()}


@app.post("/api/cortes/{corte_id}/thumb/textos")
def thumb_textos(corte_id: int):
    c = _corte(corte_id)
    return thumbs.textos(c, tarefas.palavras_do_corte(c))


@app.get("/api/thumb/arquivo/{projeto_id}/{corte_id}/{nome}")
def thumb_arquivo(projeto_id: int, corte_id: int, nome: str):
    if not thumbs.NOME_SEGURO.match(nome):
        raise HTTPException(400, "Nome inválido")
    arq = config.PROJETOS / str(projeto_id) / "thumbs" / str(corte_id) / nome
    if not arq.is_file():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(arq)


class ImagemEnviada(BaseModel):
    dataurl: str


@app.post("/api/thumb/imagens")
def thumb_enviar_imagem(dados: ImagemEnviada):
    try:
        return thumbs.salvar_imagem_enviada(dados.dataurl)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/thumb/imagens/{nome}")
def thumb_imagem(nome: str):
    if not thumbs.NOME_SEGURO.match(nome):
        raise HTTPException(400, "Nome inválido")
    arq = thumbs.PASTA_IMAGENS / nome
    if not arq.is_file():
        raise HTTPException(404, "Imagem não encontrada")
    return FileResponse(arq)


@app.get("/api/cortes/{corte_id}/thumb/design/{tamanho}")
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


@app.put("/api/cortes/{corte_id}/thumb/design/{tamanho}")
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


@app.post("/api/cortes/{corte_id}/thumb/abrir/{tamanho}")
def thumb_abrir(corte_id: int, tamanho: str):
    c = _corte(corte_id)
    _validar_tamanho(tamanho)
    arq = _arquivo_thumb(c, tamanho)
    if not arq.exists():
        raise HTTPException(404, "Thumbnail ainda não exportada.")
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(arq)])
    return {"ok": True}


@app.get("/api/thumb/templates")
def thumb_templates():
    return thumbs.ler_templates()


@app.put("/api/thumb/templates")
def thumb_salvar_templates(lista: list[dict]):
    try:
        return thumbs.salvar_templates(lista)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# ---------------------------------------------------------------- site

# fontes usadas nas legendas, servidas para o editor de thumb desenhar com as mesmas
app.mount("/fontes", StaticFiles(directory=legendas.PASTA_FONTES), name="fontes")

if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="site")
