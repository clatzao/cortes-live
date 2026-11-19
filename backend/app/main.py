"""Servidor local do Cortes Live: junta as rotas da API (app/rotas) e serve o site."""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import config, hardware, jobs, legendas
from . import tarefas  # noqa: F401  (registra os jobs na fila)
from . import live  # noqa: F401  (registra os jobs do monitor de live)
from .rotas import cortes, fila, legendas as rotas_legendas, lives, marca, momentos, projetos, sistema, thumbs

app = FastAPI(title="Cortes Live")


@app.on_event("startup")
def _inicio() -> None:
    hardware.detectar_em_segundo_plano()
    jobs.iniciar()


for modulo in (sistema, projetos, cortes, rotas_legendas, marca, momentos, fila, thumbs, lives):
    app.include_router(modulo.router)

# fontes usadas nas legendas, servidas para o editor de thumb desenhar com as mesmas
app.mount("/fontes", StaticFiles(directory=legendas.PASTA_FONTES), name="fontes")

if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="site")
