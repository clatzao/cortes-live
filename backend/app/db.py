"""Banco SQLite simples (um único usuário, acesso protegido por lock)."""
import json
import sqlite3
import threading
import time

from . import config

_lock = threading.RLock()
_conn = sqlite3.connect(config.DADOS / "banco.sqlite3", check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.execute("PRAGMA foreign_keys=ON")

_conn.executescript(
    """
CREATE TABLE IF NOT EXISTS projetos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    origem TEXT NOT NULL,          -- 'arquivo' ou 'link'
    entrada TEXT NOT NULL,         -- caminho ou URL informado
    caminho_original TEXT,         -- arquivo de vídeo usado nos cortes
    duracao REAL,
    largura INTEGER,
    altura INTEGER,
    fps REAL,
    status TEXT NOT NULL DEFAULT 'na_fila',  -- na_fila, processando, pronto, erro
    erro TEXT,
    criado_em REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cortes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    inicio REAL NOT NULL,
    fim REAL NOT NULL,
    criado_em REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    projeto_id INTEGER,
    corte_id INTEGER,
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'na_fila',  -- na_fila, executando, concluido, erro, cancelado
    progresso REAL NOT NULL DEFAULT 0,
    mensagem TEXT,
    saida TEXT,
    cancelar INTEGER NOT NULL DEFAULT 0,
    criado_em REAL NOT NULL,
    atualizado_em REAL NOT NULL
);
"""
)
_conn.commit()


def _adicionar_coluna(tabela: str, coluna: str, definicao: str) -> None:
    """Migração simples: adiciona colunas novas em bancos criados por versões anteriores."""
    existentes = [r[1] for r in _conn.execute(f"PRAGMA table_info({tabela})")]
    if coluna not in existentes:
        _conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}")
        _conn.commit()


_adicionar_coluna("projetos", "idioma", "TEXT NOT NULL DEFAULT 'pt'")  # pt, en ou misto
_adicionar_coluna("cortes", "legenda", "TEXT")  # palavras editadas (JSON) ou NULL = usar a transcrição
_adicionar_coluna("cortes", "estilo", "TEXT NOT NULL DEFAULT 'classico'")
_adicionar_coluna("cortes", "com_legenda", "INTEGER NOT NULL DEFAULT 1")
_adicionar_coluna("projetos", "formatos", "TEXT")  # formatos padrão do projeto (JSON) ou NULL = da marca
_adicionar_coluna("projetos", "layout", "TEXT")    # retângulos câmera/jogo (JSON) ou NULL = da marca
_adicionar_coluna("cortes", "formatos", "TEXT")    # JSON ou NULL = do projeto
_adicionar_coluna("cortes", "crop_x", "REAL NOT NULL DEFAULT 0.5")  # centro do recorte (fração da largura)
_adicionar_coluna("cortes", "gancho", "TEXT")      # título no topo do vídeo
_adicionar_coluna("cortes", "recursos", "TEXT")
_adicionar_coluna("projetos", "auto_cortes", "INTEGER NOT NULL DEFAULT 0")  # cria cortes sozinho após a análise    # {"logo","intro","outro","musica"} ou NULL = padrão

_conn.executescript(
    """
CREATE TABLE IF NOT EXISTS sugestoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    inicio REAL NOT NULL,
    fim REAL NOT NULL,
    nota INTEGER NOT NULL DEFAULT 0,      -- chance de viralizar (0-100)
    energia INTEGER NOT NULL DEFAULT 0,   -- volume do trecho (0-100)
    motivo TEXT,
    nome TEXT,
    gancho TEXT,
    origem TEXT NOT NULL,                 -- gemini ou sinais
    status TEXT NOT NULL DEFAULT 'nova',  -- nova, aceita, descartada
    corte_id INTEGER,
    criado_em REAL NOT NULL
);
"""
)
_conn.commit()

# ---------------------------------------------------------------- monitor de live (rodada 3)
_conn.executescript(
    """
CREATE TABLE IF NOT EXISTS lives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plataforma TEXT NOT NULL CHECK (plataforma IN ('twitch','kick','youtube')),
    canal TEXT NOT NULL,
    url TEXT NOT NULL,
    titulo TEXT,
    status TEXT NOT NULL DEFAULT 'aguardando'
        CHECK (status IN ('aguardando','gravando','reconectando','finalizando','encerrada','erro','cancelada')),
    erro TEXT,
    projeto_id INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
    janela_s INTEGER NOT NULL DEFAULT 180,       -- de quanto em quanto tempo gravado analisar
    analisado_ate REAL NOT NULL DEFAULT 0,       -- segundos já transcritos e analisados
    gravado_s REAL NOT NULL DEFAULT 0,
    cortes_criados INTEGER NOT NULL DEFAULT 0,
    parar INTEGER NOT NULL DEFAULT 0,            -- pedido de parar (o job de gravação lê)
    ultima_analise TEXT,                         -- resumo da última análise (para a tela)
    iniciada_em REAL,
    encerrada_em REAL,
    criado_em REAL NOT NULL,
    atualizado_em REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS lives_status ON lives (status);
CREATE INDEX IF NOT EXISTS lives_projeto ON lives (projeto_id);
CREATE UNIQUE INDEX IF NOT EXISTS lives_um_ativo_por_canal ON lives (plataforma, url)
    WHERE status IN ('aguardando','gravando','reconectando','finalizando');
CREATE TABLE IF NOT EXISTS live_partes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    ordem INTEGER NOT NULL,
    caminho TEXT NOT NULL,
    deslocamento_s REAL NOT NULL,                -- onde a parte começa na linha do tempo da live
    duracao_s REAL NOT NULL DEFAULT 0,
    criado_em REAL NOT NULL,
    UNIQUE (live_id, ordem)
);
"""
)
_conn.commit()
_adicionar_coluna("projetos", "live_id", "INTEGER REFERENCES lives(id) ON DELETE SET NULL")
_adicionar_coluna("cortes", "origem", "TEXT NOT NULL DEFAULT 'manual'")  # manual, sugestao ou live
_adicionar_coluna("cortes", "enquadramento", "TEXT NOT NULL DEFAULT 'fixo'")  # fixo (crop_x) ou auto (segue rosto)
_adicionar_coluna("cortes", "trilha_foco", "TEXT")  # JSON {inicio, fim, pontos: [[t, x]...], editada}


def executar(sql: str, params: tuple = ()) -> int:
    """Executa um comando de escrita e devolve o id da última linha inserida."""
    with _lock:
        cur = _conn.execute(sql, params)
        _conn.commit()
        return cur.lastrowid


def listar(sql: str, params: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in _conn.execute(sql, params).fetchall()]


def um(sql: str, params: tuple = ()) -> dict | None:
    with _lock:
        r = _conn.execute(sql, params).fetchone()
        return dict(r) if r else None


def agora() -> float:
    return time.time()


def json_dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
