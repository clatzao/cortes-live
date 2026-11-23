"""Servidor local do Cortes Live: junta as rotas da API (app/rotas) e serve o site."""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import config, hardware, jobs, legendas
from . import tarefas  # noqa: F401  (registra os jobs na fila)
from . import live  # noqa: F401  (registra os jobs do monitor de live)
from . import idiomas  # noqa: F401  (registra os jobs de tradução e dublagem)
from . import publicar  # noqa: F401  (registra os jobs das redes sociais)
from .rotas import biblioteca, cortes, fila, idiomas as rotas_idiomas, legendas as rotas_legendas, lives, marca, midias, momentos, projetos, redes, sistema, thumbs

app = FastAPI(title="Cortes Live")


@app.on_event("startup")
def _inicio() -> None:
    hardware.detectar_em_segundo_plano()
    jobs.iniciar()
    publicar.iniciar()  # agendador dos posts (depois da fila, que devolve os jobs interrompidos)


for modulo in (sistema, projetos, cortes, rotas_legendas, marca, momentos, fila, thumbs, lives, biblioteca, midias, rotas_idiomas, redes):
    app.include_router(modulo.router)

# fontes usadas nas legendas, servidas para o editor de thumb desenhar com as mesmas
app.mount("/fontes", StaticFiles(directory=legendas.PASTA_FONTES), name="fontes")

if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="site")
