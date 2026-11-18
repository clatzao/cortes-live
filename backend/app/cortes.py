"""Criação de cortes com a predefinição do usuário (estilo e legenda), usada pelo site e pelo modo automático."""
from . import ajustes, db, legendas


def proximo_nome(projeto_id: int) -> str:
    n = db.um("SELECT COUNT(*) AS n FROM cortes WHERE projeto_id=?", (projeto_id,))["n"]
    return f"Corte {n + 1}"


def estilo_padrao() -> str:
    eid = ajustes.ler()["estilo_padrao"]
    return eid if any(e["id"] == eid for e in legendas.listar_estilos()) else "classico"


def criar(projeto_id: int, inicio: float, fim: float, nome: str | None = None, gancho: str | None = None) -> int:
    """Insere o corte (intervalo já validado). Formatos e extras ficam NULL = seguem o padrão do projeto/marca."""
    a = ajustes.ler()
    nome = (nome or "").strip() or proximo_nome(projeto_id)
    return db.executar(
        "INSERT INTO cortes (projeto_id, nome, inicio, fim, gancho, estilo, com_legenda, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (projeto_id, nome[:120], round(inicio, 2), round(fim, 2), gancho or None, estilo_padrao(),
         1 if a["legenda_padrao"] else 0, db.agora()))


def aceitar_sugestao(s: dict, duracao: float) -> int | None:
    """Sugestão → corte. Devolve o id do corte (o existente, se já tinha sido aceita)."""
    if s["status"] == "aceita" and s["corte_id"] and db.um("SELECT id FROM cortes WHERE id=?", (s["corte_id"],)):
        return s["corte_id"]
    inicio, fim = sorted((s["inicio"], s["fim"]))
    if duracao:
        fim = min(fim, duracao)
    if fim - inicio < 0.5:
        return None
    cid = criar(s["projeto_id"], inicio, fim, s["nome"], s["gancho"])
    db.executar("UPDATE sugestoes SET status='aceita', corte_id=? WHERE id=?", (cid, s["id"]))
    return cid
