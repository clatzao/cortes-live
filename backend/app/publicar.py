"""Posts nas redes: criar (agora ou agendado até 30 dias), o agendador e os jobs de publicar e de métricas.

O agendador é uma thread do motor: com a janela fechada o programa fica na bandeja e os posts saem no horário.
Com o programa fechado de vez, os atrasados saem assim que ele abrir de novo.
"""
import os
import sqlite3
import threading
import time
import traceback
import uuid
from pathlib import Path

from . import db, jobs
from .jobs import Cancelado, Contexto
from .redes import REDES, ErroRede, base

MAX_DIAS = 30
TENTATIVAS = 3
ESPERAS = (120, 600, 1800)          # s antes da 2ª, 3ª e 4ª tentativa
INTERVALO = float(os.environ.get("CORTES_AGENDADOR_S") or 15)
METRICAS_A_CADA = 6 * 3600
RENOVAR_A_CADA = 12 * 3600
_acordar = threading.Event()


class ErroPost(ValueError):
    pass


# ---------------------------------------------------------------- criar e mudar

def criar(exportacao_id: int, conta_ids: list[int], titulo: str, descricao: str, privacidade: str,
          agendado_para: float | None) -> list[dict]:
    exp = db.um("SELECT * FROM exportacoes WHERE id=?", (exportacao_id,))
    if not exp:
        raise ErroPost("Esse arquivo não está mais na Biblioteca.")
    if not Path(exp["caminho"]).is_file():
        raise ErroPost("O arquivo foi movido ou apagado do disco.")
    quando = _horario(agendado_para)
    if not conta_ids:
        raise ErroPost("Escolha pelo menos uma conta.")
    contas = []
    for cid in dict.fromkeys(conta_ids):
        conta = db.um("SELECT * FROM contas_sociais WHERE id=?", (cid,))
        if not conta:
            raise ErroPost("Uma das contas foi desconectada. Recarregue a página.")
        if conta["status"] != "ativa":
            raise ErroPost(f"A conta {conta['nome']} precisa ser conectada de novo (Ajustes → Contas).")
        rede = REDES[conta["rede"]]
        if privacidade not in rede.privacidades:
            raise ErroPost(f"{rede.titulo}: essa privacidade não existe por lá.")
        problema = rede.validar(exp, privacidade)
        if problema:
            raise ErroPost(f"{rede.titulo}: {problema}")
        contas.append(conta)
    agora = db.agora()
    ids = []
    with db._lock:
        try:
            db._conn.execute("BEGIN")
            for conta in contas:
                cur = db._conn.execute(
                    "INSERT INTO posts (conta_id, exportacao_id, arquivo, duracao_s, titulo, descricao, privacidade, "
                    "agendado_para, chave_idempotencia, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (conta["id"], exp["id"], exp["caminho"], exp["duracao_s"], titulo.strip()[:300],
                     descricao.strip()[:5000], privacidade, quando, uuid.uuid4().hex, agora, agora))
                ids.append(cur.lastrowid)
            db._conn.commit()
        except sqlite3.IntegrityError as e:
            db._conn.rollback()
            raise ErroPost("Esse arquivo já está agendado ou publicado numa dessas contas.") from e
    _acordar.set()
    return [ver(i) for i in ids]


def _horario(agendado_para: float | None) -> float:
    agora = time.time()
    if agendado_para is None:
        return agora
    if agendado_para < agora - 60:
        raise ErroPost("Esse horário já passou. Escolha um horário no futuro.")
    if agendado_para > agora + MAX_DIAS * 86400:
        raise ErroPost(f"Dá para agendar até {MAX_DIAS} dias à frente.")
    return max(agendado_para, agora)


def mudar(post_id: int, campos: dict) -> dict:
    with db._lock:
        p = db.um("SELECT * FROM posts WHERE id=?", (post_id,))
        if not p:
            raise ErroPost("Post não encontrado.")
        if p["status"] != "agendado":
            raise ErroPost("Só dá para mudar um post que ainda não saiu.")
        novos = {}
        if campos.get("titulo") is not None:
            novos["titulo"] = str(campos["titulo"]).strip()[:300]
        if campos.get("descricao") is not None:
            novos["descricao"] = str(campos["descricao"]).strip()[:5000]
        if campos.get("privacidade") is not None:
            conta = db.um("SELECT rede FROM contas_sociais WHERE id=?", (p["conta_id"],))
            if campos["privacidade"] not in REDES[conta["rede"]].privacidades:
                raise ErroPost("Essa privacidade não existe nessa rede.")
            novos["privacidade"] = campos["privacidade"]
        if "agendado_para" in campos:
            novos["agendado_para"] = _horario(campos["agendado_para"])
            novos["proxima_tentativa"] = None
        if novos:
            sets = ", ".join(f"{k}=?" for k in novos)
            db.executar(f"UPDATE posts SET {sets}, atualizado_em=? WHERE id=?", (*novos.values(), db.agora(), post_id))
    _acordar.set()
    return ver(post_id)


def cancelar(post_id: int) -> dict:
    with db._lock:
        p = db.um("SELECT * FROM posts WHERE id=?", (post_id,))
        if not p:
            raise ErroPost("Post não encontrado.")
        if p["status"] == "publicado":
            raise ErroPost("Esse post já saiu: apague direto na rede, se quiser.")
        if p["status"] in ("agendado", "enviando"):
            db.executar("UPDATE posts SET status='cancelado', erro=NULL, atualizado_em=? WHERE id=?",
                        (db.agora(), post_id))
            if p["status"] == "enviando" and p["job_id"]:
                jobs.cancelar(p["job_id"])
    return ver(post_id)


def remover(post_id: int) -> None:
    p = db.um("SELECT status FROM posts WHERE id=?", (post_id,))
    if p and p["status"] in ("agendado", "enviando"):
        raise ErroPost("Cancele o post antes de tirar da lista.")
    db.executar("DELETE FROM posts WHERE id=?", (post_id,))


def tentar_de_novo(post_id: int) -> dict:
    with db._lock:
        p = db.um("SELECT * FROM posts WHERE id=?", (post_id,))
        if not p or p["status"] not in ("falhou", "cancelado"):
            raise ErroPost("Só dá para tentar de novo um post que falhou ou foi cancelado.")
        try:
            db.executar("UPDATE posts SET status='agendado', tentativas=0, proxima_tentativa=NULL, erro=NULL, "
                        "agendado_para=?, atualizado_em=? WHERE id=?", (time.time(), db.agora(), post_id))
        except sqlite3.IntegrityError as e:
            raise ErroPost("Esse arquivo já está agendado ou publicado nessa conta.") from e
    _acordar.set()
    return ver(post_id)


# ---------------------------------------------------------------- ler

_SELECT = """
SELECT p.*, c.rede, c.nome AS conta_nome, c.avatar_url AS conta_avatar, c.status AS conta_status,
       c.so_privado, e.corte_nome, e.projeto_nome, e.formato,
       j.progresso AS envio_progresso, j.mensagem AS envio_mensagem
FROM posts p JOIN contas_sociais c ON c.id = p.conta_id
LEFT JOIN exportacoes e ON e.id = p.exportacao_id
LEFT JOIN jobs j ON j.id = p.job_id AND p.status = 'enviando'
"""


def _com_metricas(p: dict) -> dict:
    m = db.um("SELECT * FROM metricas_posts WHERE post_id=? ORDER BY coletado_em DESC LIMIT 1", (p["id"],))
    p["metricas"] = {k: m[k] for k in ("coletado_em", "views", "likes", "comentarios", "compartilhamentos",
                                        "salvos", "alcance")} if m else None
    return p


def ver(post_id: int) -> dict:
    p = db.um(_SELECT + " WHERE p.id=?", (post_id,))
    if not p:
        raise ErroPost("Post não encontrado.")
    return _com_metricas(p)


def listar(status: str | None = None, conta_id: int | None = None) -> list[dict]:
    sql, args = _SELECT + " WHERE 1=1", []
    if status:
        sql += " AND p.status=?"
        args.append(status)
    if conta_id:
        sql += " AND p.conta_id=?"
        args.append(conta_id)
    sql += " ORDER BY CASE WHEN p.status IN ('agendado','enviando') THEN 0 ELSE 1 END, " \
           "CASE WHEN p.status IN ('agendado','enviando') THEN p.agendado_para ELSE -COALESCE(p.publicado_em, p.atualizado_em) END"
    return [_com_metricas(p) for p in db.listar(sql, tuple(args))]


def historico_metricas(post_id: int) -> list[dict]:
    return db.listar("SELECT * FROM metricas_posts WHERE post_id=? ORDER BY coletado_em", (post_id,))


# ---------------------------------------------------------------- publicar (job)

def _falhou(post_id: int, msg: str, tentar: bool) -> None:
    p = db.um("SELECT tentativas, status FROM posts WHERE id=?", (post_id,))
    if not p or p["status"] == "cancelado":
        return
    n = p["tentativas"] + 1
    if tentar and n < TENTATIVAS:
        db.executar("UPDATE posts SET status='agendado', tentativas=?, proxima_tentativa=?, erro=?, job_id=NULL, "
                    "atualizado_em=? WHERE id=?",
                    (n, time.time() + ESPERAS[n - 1], f"{msg} Tentando de novo em breve.", db.agora(), post_id))
    else:
        db.executar("UPDATE posts SET status='falhou', tentativas=?, erro=?, job_id=NULL, atualizado_em=? WHERE id=?",
                    (n, msg, db.agora(), post_id))


def _falha_job(job: dict, msg: str) -> None:
    import json
    pid = json.loads(job["params"] or "{}").get("post_id")
    if pid:
        p = db.um("SELECT status FROM posts WHERE id=?", (pid,))
        if p and p["status"] == "enviando":
            if msg == "Cancelado pelo usuário":
                db.executar("UPDATE posts SET status='cancelado', job_id=NULL, atualizado_em=? WHERE id=?",
                            (db.agora(), pid))
            else:
                _falhou(pid, msg, tentar=False)


@jobs.registrar("publicar", ao_falhar=_falha_job, faixa="redes")
def publicar(ctx: Contexto) -> str:
    pid = ctx.params["post_id"]
    p = db.um("SELECT * FROM posts WHERE id=?", (pid,))
    if not p or p["status"] != "enviando":
        return "O post foi cancelado antes de sair."
    conta = db.um("SELECT * FROM contas_sociais WHERE id=?", (p["conta_id"],))
    rede = REDES[conta["rede"]]
    ctx.progresso(0.02, f"Publicando no {rede.titulo}: {conta['nome']}", forcar=True)
    if not Path(p["arquivo"]).is_file():
        _falhou(pid, "O arquivo foi movido ou apagado do disco.", tentar=False)
        return "Arquivo não encontrado."
    try:
        tokens = base.tokens_validos(conta)
        id_externo, link = rede.publicar(ctx, conta, tokens, p)
    except Cancelado:
        raise
    except ErroRede as e:
        _falhou(pid, str(e), tentar=e.tentar_de_novo)
        return str(e)
    with db._lock:
        atual = db.um("SELECT status FROM posts WHERE id=?", (pid,))
        # mesmo cancelado no meio, se já saiu na rede o post fica registrado como publicado
        db.executar("UPDATE posts SET status='publicado', id_externo=?, url=?, erro=NULL, publicado_em=?, job_id=NULL, "
                    "atualizado_em=? WHERE id=?", (id_externo, link, db.agora(), db.agora(), pid))
    aviso = " (estava cancelado, mas a rede já tinha recebido)" if atual and atual["status"] == "cancelado" else ""
    return f"Publicado no {rede.titulo}{aviso}: {link or id_externo}"


@jobs.registrar("coletar_metricas", faixa="redes")
def coletar_metricas(ctx: Contexto) -> str:
    posts = db.listar("SELECT * FROM posts WHERE status='publicado' AND id_externo IS NOT NULL AND publicado_em > ?",
                      (time.time() - MAX_DIAS * 86400,))
    feitos = 0
    for i, p in enumerate(posts):
        ctx.checar()
        conta = db.um("SELECT * FROM contas_sociais WHERE id=?", (p["conta_id"],))
        if not conta or conta["status"] != "ativa":
            continue
        try:
            m = REDES[conta["rede"]].metricas(conta, base.tokens_validos(conta), p)
        except ErroRede:
            continue
        if m:
            db.executar("INSERT INTO metricas_posts (post_id, coletado_em, views, likes, comentarios, "
                        "compartilhamentos, salvos, alcance) VALUES (?,?,?,?,?,?,?,?)",
                        (p["id"], db.agora(), m.get("views"), m.get("likes"), m.get("comentarios"),
                         m.get("compartilhamentos"), m.get("salvos"), m.get("alcance")))
            feitos += 1
        ctx.progresso((i + 1) / max(1, len(posts)), f"Métricas: {i + 1} de {len(posts)}")
    return f"Métricas de {feitos} post(s) atualizadas."


@jobs.registrar("renovar_tokens", faixa="redes")
def renovar_tokens(ctx: Contexto) -> str:
    feitas = 0
    for conta in db.listar("SELECT * FROM contas_sociais WHERE status='ativa'"):
        try:
            base.tokens_validos(conta)
            feitas += 1
        except ErroRede:
            pass
    return f"{feitas} conta(s) com acesso em dia."


# ---------------------------------------------------------------- agendador

def _pendente(tipo: str) -> bool:
    return bool(db.um("SELECT 1 FROM jobs WHERE tipo=? AND status IN ('na_fila','executando') LIMIT 1", (tipo,)))


def coletar_agora() -> int | None:
    return None if _pendente("coletar_metricas") else jobs.enfileirar("coletar_metricas", mensagem="Na fila")


def _rodada() -> None:
    agora = time.time()
    with db._lock:
        devidos = db.listar("SELECT id FROM posts WHERE status='agendado' AND agendado_para <= ? "
                            "AND (proxima_tentativa IS NULL OR proxima_tentativa <= ?) ORDER BY agendado_para",
                            (agora, agora))
        for p in devidos:
            job = jobs.enfileirar("publicar", params={"post_id": p["id"]}, mensagem="Na fila para publicar")
            db.executar("UPDATE posts SET status='enviando', job_id=?, atualizado_em=? WHERE id=?",
                        (job, db.agora(), p["id"]))


def _recuperar() -> None:
    """Posts 'enviando' cujo job sumiu (programa fechado no meio) voltam para a fila do agendador."""
    db.executar("UPDATE posts SET status='agendado', job_id=NULL WHERE status='enviando' AND (job_id IS NULL OR "
                "job_id NOT IN (SELECT id FROM jobs WHERE status IN ('na_fila','executando')))")


def _laco() -> None:
    _recuperar()
    ultimo_metricas = ultimo_renovar = 0.0
    while True:
        try:
            _rodada()
            agora = time.time()
            if db.um("SELECT 1 FROM contas_sociais LIMIT 1"):
                if agora - ultimo_renovar > RENOVAR_A_CADA and not _pendente("renovar_tokens"):
                    jobs.enfileirar("renovar_tokens", mensagem="Na fila")
                    ultimo_renovar = agora
                if agora - ultimo_metricas > METRICAS_A_CADA and not _pendente("coletar_metricas"):
                    if db.um("SELECT 1 FROM posts WHERE status='publicado' LIMIT 1"):
                        jobs.enfileirar("coletar_metricas", mensagem="Na fila")
                    ultimo_metricas = agora
        except Exception:  # noqa: BLE001 - o agendador nunca para
            traceback.print_exc()
        _acordar.wait(INTERVALO)
        _acordar.clear()


def iniciar() -> None:
    threading.Thread(target=_laco, daemon=True, name="agendador-redes").start()
