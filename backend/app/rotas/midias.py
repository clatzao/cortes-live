"""Biblioteca de mídias do usuário (hooks e B-roll) e os B-rolls de cada corte."""
import json
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config, db, legendas, media, tarefas
from .comum import _corte

router = APIRouter()

MAX_SUGESTOES = 4
DURACAO_SUGERIDA = 3.0


class NovasMidias(BaseModel):
    tipo: Literal["gancho", "broll"]
    caminhos: list[str] = Field(min_length=1, max_length=50)


class EdicaoMidia(BaseModel):
    nome: str | None = Field(default=None, max_length=120)
    tags: list[str] | None = None


class BrollCorte(BaseModel):
    midia_id: int
    inicio_s: float = Field(ge=0)
    fim_s: float = Field(gt=0)
    modo: Literal["tela_cheia", "metade"] = "tela_cheia"
    origem: Literal["manual", "auto"] = "manual"


def _publica(m: dict) -> dict:
    m = dict(m)
    m["tags"] = json.loads(m["tags"] or "[]")
    m["existe"] = Path(m["caminho"]).is_file()
    return m


def _midia(midia_id: int) -> dict:
    m = db.um("SELECT * FROM midias WHERE id=?", (midia_id,))
    if not m:
        raise HTTPException(404, "Mídia não encontrada.")
    return m


@router.get("/api/midias")
def listar(tipo: str | None = None):
    if tipo:
        return [_publica(m) for m in db.listar("SELECT * FROM midias WHERE tipo=? ORDER BY nome", (tipo,))]
    return [_publica(m) for m in db.listar("SELECT * FROM midias ORDER BY tipo, nome")]


@router.post("/api/midias")
def adicionar(dados: NovasMidias):
    criadas, erros = [], []
    for bruto in dados.caminhos:
        caminho = bruto.strip().strip('"')
        p = Path(caminho)
        if not p.is_file():
            erros.append(f"Não encontrado: {caminho}")
            continue
        try:
            info = media.analisar(str(p.resolve()))
        except Exception as e:  # noqa: BLE001 - arquivo que não é vídeo
            erros.append(f"{p.name}: não é um vídeo que o programa consiga ler ({str(e)[:80]})")
            continue
        if not info.get("largura"):
            erros.append(f"{p.name}: o arquivo não tem imagem.")
            continue
        existente = db.um("SELECT id FROM midias WHERE caminho=?", (str(p.resolve()),))
        if existente:
            criadas.append(existente["id"])
            continue
        criadas.append(db.executar(
            "INSERT INTO midias (tipo, nome, caminho, duracao_s, largura, altura, tem_audio, criado_em) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (dados.tipo, p.stem[:120], str(p.resolve()), info["duracao"], info["largura"], info["altura"],
             int(bool(info["tem_audio"])), db.agora())))
    itens = [_publica(_midia(i)) for i in criadas]
    if not itens and erros:
        raise HTTPException(400, " ".join(erros))
    return {"criadas": itens, "erros": erros}


@router.patch("/api/midias/{midia_id}")
def editar(midia_id: int, dados: EdicaoMidia):
    m = _midia(midia_id)
    nome = (dados.nome or "").strip() or m["nome"]
    tags = m["tags"]
    if dados.tags is not None:
        limpas = sorted({legendas.normalizar(t) for t in dados.tags if t.strip()} - {""})
        tags = db.json_dump(limpas[:30])
    db.executar("UPDATE midias SET nome=?, tags=? WHERE id=?", (nome, tags, midia_id))
    return _publica(_midia(midia_id))


@router.delete("/api/midias/{midia_id}")
def remover(midia_id: int):
    """Tira da biblioteca (e dos cortes que usavam). O arquivo no disco não é apagado."""
    _midia(midia_id)
    db.executar("DELETE FROM midias WHERE id=?", (midia_id,))
    return {"ok": True}


@router.get("/api/midias/{midia_id}/quadro")
def quadro(midia_id: int):
    m = _midia(midia_id)
    if not Path(m["caminho"]).is_file():
        raise HTTPException(404, "O arquivo foi movido ou apagado.")
    t = min(1.0, (m["duracao_s"] or 0) / 2)
    r = subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", m["caminho"],
                        "-frames:v", "1", "-vf", "scale=240:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
                       capture_output=True, creationflags=config.SEM_JANELA)
    if r.returncode != 0 or not r.stdout:
        raise HTTPException(500, "Não deu para ler um quadro desta mídia.")
    return Response(r.stdout, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


# ---------------------------------------------------------------- B-roll do corte

def _brolls(corte_id: int) -> list[dict]:
    return db.listar("SELECT b.*, m.nome, m.duracao_s FROM corte_brolls b JOIN midias m ON m.id = b.midia_id "
                     "WHERE b.corte_id=? ORDER BY b.inicio_s", (corte_id,))


@router.get("/api/cortes/{corte_id}/brolls")
def ver_brolls(corte_id: int):
    _corte(corte_id)
    return _brolls(corte_id)


@router.put("/api/cortes/{corte_id}/brolls")
def salvar_brolls(corte_id: int, lista: list[BrollCorte]):
    c = _corte(corte_id)
    dur = c["fim"] - c["inicio"]
    for b in lista:
        _midia(b.midia_id)
        if b.fim_s <= b.inicio_s or b.inicio_s >= dur:
            raise HTTPException(400, "Cada B-roll precisa começar dentro do corte e terminar depois de começar.")
    db.executar("DELETE FROM corte_brolls WHERE corte_id=?", (corte_id,))
    for b in sorted(lista, key=lambda x: x.inicio_s):
        db.executar("INSERT INTO corte_brolls (corte_id, midia_id, inicio_s, fim_s, modo, origem) VALUES (?,?,?,?,?,?)",
                    (corte_id, b.midia_id, round(b.inicio_s, 2), round(min(b.fim_s, dur), 2), b.modo, b.origem))
    return _brolls(corte_id)


@router.post("/api/cortes/{corte_id}/brolls/sugerir")
def sugerir_brolls(corte_id: int):
    """Casa as palavras-chave das mídias de B-roll com o que é dito no corte (não salva: a tela decide)."""
    c = _corte(corte_id)
    palavras = tarefas.palavras_do_corte(c)
    if palavras is None:
        raise HTTPException(400, "A transcrição deste corte ainda não está pronta.")
    midias = [_publica(m) for m in db.listar("SELECT * FROM midias WHERE tipo='broll'")]
    midias = [m for m in midias if m["existe"] and m["tags"]]
    if not midias:
        raise HTTPException(400, "Nenhuma mídia de B-roll com palavras-chave. Adicione em Ajustes → Mídias.")
    dur = c["fim"] - c["inicio"]
    sugestoes: list[dict] = []
    usadas: set[int] = set()
    for ini, _fim, texto in palavras:
        if len(sugestoes) >= MAX_SUGESTOES:
            break
        norm = legendas.normalizar(texto)
        if not norm:
            continue
        for m in midias:
            if m["id"] in usadas or norm not in m["tags"]:
                continue
            a = round(ini, 2)
            b = round(min(dur, a + min(DURACAO_SUGERIDA, m["duracao_s"] or DURACAO_SUGERIDA)), 2)
            if b - a < 0.5 or any(not (b <= s["inicio_s"] or a >= s["fim_s"]) for s in sugestoes):
                continue
            sugestoes.append({"midia_id": m["id"], "nome": m["nome"], "inicio_s": a, "fim_s": b,
                              "modo": "tela_cheia", "origem": "auto", "palavra": texto})
            usadas.add(m["id"])
            break
    return sugestoes
