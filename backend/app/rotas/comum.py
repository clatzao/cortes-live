"""Funções usadas por várias rotas: buscar projeto/corte, validar, quadros de prévia."""
import io
import subprocess

from fastapi import HTTPException
from fastapi.responses import Response
from PIL import Image, ImageOps

from .. import config, db, formatos, marca, media, transcricao, tarefas


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
    p["job_analise"] = _ultimo_job("analisar", p["id"])
    p["n_cortes"] = db.um("SELECT COUNT(*) AS n FROM cortes WHERE projeto_id=?", (p["id"],))["n"]
    p["n_sugestoes"] = db.um("SELECT COUNT(*) AS n FROM sugestoes WHERE projeto_id=? AND status='nova'",
                             (p["id"],))["n"]
    return p


def _corte_completo(c: dict) -> dict:
    p = _projeto(c["projeto_id"])
    m = marca.ler()
    c["formatos_efetivos"] = tarefas.formatos_do_corte(c, p, m)
    c["recursos_efetivos"] = marca.recursos_do_corte(c, m)
    return c


def _validar_formatos(lista: list[str]) -> list[str]:
    validos = [f for f in dict.fromkeys(lista) if f in formatos.FORMATOS]
    if not validos:
        raise HTTPException(400, "Escolha pelo menos um formato.")
    return validos


def _validar_intervalo(p: dict, inicio: float, fim: float) -> tuple[float, float]:
    duracao = p["duracao"] or 0
    if fim < inicio:
        inicio, fim = fim, inicio
    fim = min(fim, duracao) if duracao else fim
    if fim - inicio < 0.5:
        raise HTTPException(400, "O corte precisa ter pelo menos 0,5 segundo.")
    return round(inicio, 2), round(fim, 2)


def _fonte_rapida(p: dict) -> str:
    """Para quadros de tela: o proxy (leve) se existir; o original pode ser AV1/HEVC e demorar ~1 s por quadro."""
    proxy = media.proxy_de(p["id"])
    return str(proxy) if proxy.is_file() else p["caminho_original"]


def _quadro(origem: str, instante: float, largura: int, altura: int) -> Image.Image:
    r = subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0, instante):.3f}",
                        "-i", origem, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "bmp", "-"],
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
