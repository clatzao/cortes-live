"""Fila de processamento: um trabalhador executa os jobs em ordem, um por vez.

A fila fica no SQLite, então sobrevive se o programa for fechado: jobs que
estavam rodando voltam para a fila na próxima abertura.
"""
import json
import threading
import time
import traceback
from typing import Callable

from . import db

_HANDLERS: dict[str, Callable] = {}
_ERRO_HOOKS: dict[str, Callable] = {}
# Cada faixa tem seu próprio trabalhador: uma transcrição longa ("pesada") não
# impede importar ou exportar cortes ("geral") ao mesmo tempo.
_FAIXAS: dict[str, list[str]] = {}
_acordar: dict[str, threading.Event] = {}
_TRABALHADORES: dict[str, int] = {}  # quantos jobs da faixa rodam ao mesmo tempo (padrão 1)


class Cancelado(Exception):
    pass


def registrar(tipo: str, ao_falhar: Callable | None = None, faixa: str = "geral", trabalhadores: int = 1):
    def deco(fn):
        _HANDLERS[tipo] = fn
        _FAIXAS.setdefault(faixa, []).append(tipo)
        _acordar.setdefault(faixa, threading.Event())
        _TRABALHADORES[faixa] = max(_TRABALHADORES.get(faixa, 1), trabalhadores)
        if ao_falhar:
            _ERRO_HOOKS[tipo] = ao_falhar
        return fn
    return deco


def _acordar_todos() -> None:
    for ev in _acordar.values():
        ev.set()


class Contexto:
    def __init__(self, job: dict):
        self.job = job
        self.id = job["id"]
        self.params = json.loads(job["params"] or "{}")
        self._ultimo = 0.0

    def progresso(self, fracao: float, mensagem: str | None = None, forcar: bool = False) -> None:
        agora = time.time()
        if not forcar and agora - self._ultimo < 0.4:
            return
        self._ultimo = agora
        fracao = max(0.0, min(1.0, fracao))
        if mensagem is None:
            db.executar("UPDATE jobs SET progresso=?, atualizado_em=? WHERE id=?", (fracao, agora, self.id))
        else:
            db.executar("UPDATE jobs SET progresso=?, mensagem=?, atualizado_em=? WHERE id=?",
                        (fracao, mensagem, agora, self.id))

    def cancelado(self) -> bool:
        r = db.um("SELECT cancelar FROM jobs WHERE id=?", (self.id,))
        return bool(r and r["cancelar"])

    def checar(self) -> None:
        if self.cancelado():
            raise Cancelado()


def enfileirar(tipo: str, projeto_id: int | None = None, corte_id: int | None = None,
               params: dict | None = None, mensagem: str = "Aguardando na fila") -> int:
    t = db.agora()
    job_id = db.executar(
        "INSERT INTO jobs (tipo, projeto_id, corte_id, params, mensagem, criado_em, atualizado_em) "
        "VALUES (?,?,?,?,?,?,?)",
        (tipo, projeto_id, corte_id, db.json_dump(params or {}), mensagem, t, t),
    )
    _acordar_todos()
    return job_id


def cancelar(job_id: int) -> None:
    job = db.um("SELECT status FROM jobs WHERE id=?", (job_id,))
    if not job:
        return
    if job["status"] == "na_fila":
        db.executar("UPDATE jobs SET status='cancelado', cancelar=1, mensagem='Cancelado', atualizado_em=? WHERE id=?",
                    (db.agora(), job_id))
    elif job["status"] == "executando":
        db.executar("UPDATE jobs SET cancelar=1 WHERE id=?", (job_id,))


def _laco(faixa: str) -> None:
    tipos = _FAIXAS[faixa]
    marcadores = ",".join("?" * len(tipos))
    evento = _acordar[faixa]
    while True:
        with db._lock:  # pegar e marcar juntos: com vários trabalhadores na faixa, dois não pegam o mesmo job
            job = db.um(f"SELECT * FROM jobs WHERE status='na_fila' AND tipo IN ({marcadores}) ORDER BY id LIMIT 1",
                        tuple(tipos))
            if job:
                db.executar("UPDATE jobs SET status='executando', mensagem='Iniciando', atualizado_em=? WHERE id=?",
                            (db.agora(), job["id"]))
        if not job:
            evento.wait(timeout=2)
            evento.clear()
            continue
        ctx = Contexto(job)
        handler = _HANDLERS.get(job["tipo"])
        try:
            if handler is None:
                raise RuntimeError(f"Tipo de job desconhecido: {job['tipo']}")
            saida = handler(ctx)
            db.executar("UPDATE jobs SET status='concluido', progresso=1, mensagem='Concluído', saida=?, "
                        "atualizado_em=? WHERE id=?", (saida, db.agora(), job["id"]))
        except Cancelado:
            db.executar("UPDATE jobs SET status='cancelado', mensagem='Cancelado', atualizado_em=? WHERE id=?",
                        (db.agora(), job["id"]))
            _chamar_hook(job, "Cancelado pelo usuário")
        except Exception as e:  # noqa: BLE001 - qualquer falha vira erro visível na fila
            traceback.print_exc()
            msg = str(e).strip() or e.__class__.__name__
            db.executar("UPDATE jobs SET status='erro', mensagem=?, atualizado_em=? WHERE id=?",
                        (msg[-2000:], db.agora(), job["id"]))
            _chamar_hook(job, msg)


def _chamar_hook(job: dict, msg: str) -> None:
    hook = _ERRO_HOOKS.get(job["tipo"])
    if hook:
        try:
            hook(job, msg)
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def iniciar() -> None:
    # Jobs interrompidos (programa fechado no meio) voltam para a fila.
    db.executar("UPDATE jobs SET status='na_fila', cancelar=0, mensagem='Retomado após reinício' "
                "WHERE status='executando'")
    for faixa in _FAIXAS:
        for n in range(_TRABALHADORES.get(faixa, 1)):
            threading.Thread(target=_laco, args=(faixa,), daemon=True, name=f"fila-{faixa}-{n}").start()
