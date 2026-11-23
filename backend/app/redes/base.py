"""Partes comuns das redes: login oficial (OAuth), contas, tokens no cofre e chamadas HTTP.

Cada rede (youtube.py, tiktok.py, instagram.py) só implementa o que é dela; o login e a renovação passam por aqui.
"""
import base64
import hashlib
import os
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import requests

from .. import ajustes, cofre, db

PORTA_RETORNO = 53682          # porta fixa do retorno do login (as redes exigem endereço de retorno fixo)
LOGIN_VALIDADE = 600           # s para terminar o login no navegador
RENOVAR_ANTES = 600            # renova o token de acesso quando faltam 10 min
TEMPO_HTTP = 60


class ErroRede(Exception):
    """Falha ao falar com a rede. `tentar_de_novo` diz se vale tentar mais tarde (rede fora, limite)."""

    def __init__(self, msg: str, tentar_de_novo: bool = False, reconectar: bool = False):
        super().__init__(msg)
        self.tentar_de_novo = tentar_de_novo
        self.reconectar = reconectar


def url(real: str) -> str:
    """Endereço real da API, ou o servidor falso dos testes (CORTES_REDES_TESTE=http://127.0.0.1:porta)."""
    teste = os.environ.get("CORTES_REDES_TESTE")
    if not teste or real.startswith(teste):
        return real
    u = urlparse(real)
    return f"{teste.rstrip('/')}/{u.netloc}{u.path}" + (f"?{u.query}" if u.query else "")


def http(metodo: str, endereco: str, **kw) -> requests.Response:
    try:
        r = requests.request(metodo, url(endereco), timeout=kw.pop("timeout", TEMPO_HTTP), **kw)
    except requests.RequestException as e:
        raise ErroRede(f"Sem conexão com a rede: {e.__class__.__name__}", tentar_de_novo=True) from e
    if r.status_code in (429, 500, 502, 503, 504):
        raise ErroRede(f"A rede está ocupada agora (HTTP {r.status_code}).", tentar_de_novo=True)
    if r.status_code == 401:
        raise ErroRede("A rede recusou o acesso: conecte a conta de novo em Ajustes → Contas.", reconectar=True)
    return r


def json_ou_erro(r: requests.Response, oque: str) -> dict:
    try:
        dados = r.json()
    except ValueError:
        dados = {}
    if r.status_code >= 400:
        raise ErroRede(f"{oque}: {_mensagem(dados) or f'HTTP {r.status_code}'}")
    return dados


def _mensagem(dados) -> str:
    if not isinstance(dados, dict):
        return ""
    e = dados.get("error")
    if isinstance(e, dict):
        return str(e.get("message") or e.get("code") or "")[:300]
    if isinstance(e, str):
        return str(dados.get("error_description") or e)[:300]
    return str(dados.get("message") or dados.get("error_message") or "")[:300]


# ---------------------------------------------------------------- redes registradas

@dataclass
class Rede:
    nome: str                       # youtube | tiktok | instagram
    titulo: str                     # YouTube | TikTok | Instagram
    campos: tuple[str, str]         # (id do app, segredo do app) em ajustes
    retorno_padrao: str             # endereço de retorno a cadastrar no app da rede
    login: Callable                 # (app_id, retorno, state, verificador) -> url
    trocar: Callable                # (app_id, segredo, codigo, retorno, verificador) -> (tokens, conta)
    renovar: Callable               # (app_id, segredo, tokens) -> tokens
    publicar: Callable              # (ctx, conta, tokens, post) -> (id_externo, url)
    metricas: Callable              # (conta, tokens, post) -> dict
    validar: Callable               # (exportacao, privacidade) -> str | None
    revogar: Callable | None = None
    privacidades: tuple = ("publico", "nao_listado", "privado")
    renovar_antes: int = RENOVAR_ANTES
    ajuda: dict = field(default_factory=dict)


REDES: dict[str, Rede] = {}


def registrar(rede: Rede) -> Rede:
    REDES[rede.nome] = rede
    return rede


def credenciais(rede: Rede) -> tuple[str, str]:
    aj = ajustes.ler()
    app_id, segredo = aj[rede.campos[0]], aj[rede.campos[1]]
    if not app_id or not segredo:
        raise ErroRede(f"Falta configurar o app do {rede.titulo} em Ajustes → Contas (id e segredo).")
    return app_id, segredo


def pkce() -> tuple[str, str]:
    verificador = secrets.token_urlsafe(64)[:96]
    return verificador, desafio(verificador)


def desafio(verificador: str, hexa: bool = False) -> str:
    """Desafio PKCE (S256). O TikTok no computador pede o SHA-256 em hexadecimal; os outros, em base64url."""
    resumo = hashlib.sha256(verificador.encode())
    return resumo.hexdigest() if hexa else base64.urlsafe_b64encode(resumo.digest()).rstrip(b"=").decode()


# ---------------------------------------------------------------- login (OAuth no navegador)

_logins: dict[str, dict] = {}      # state -> {rede, verificador, retorno, criado, status, msg, conta_id}
_lock = threading.Lock()
_servidor: ThreadingHTTPServer | None = None


def _pagina(titulo: str, texto: str) -> bytes:
    return (f"<!doctype html><meta charset=utf-8><title>Cortes Live</title><body style='font-family:system-ui;"
            f"background:#0b0c10;color:#e8e8ee;display:grid;place-items:center;height:100vh;margin:0'>"
            f"<div style='max-width:460px;text-align:center'><h2>{titulo}</h2><p>{texto}</p></div>").encode()


class _Retorno(BaseHTTPRequestHandler):
    def do_GET(self):  # nome exigido pelo http.server
        q = parse_qs(urlparse(self.path).query)
        if not q.get("state") and not q.get("code") and not q.get("error"):
            self.send_response(404)
            self.end_headers()
            return
        ok, msg = concluir_login(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(_pagina("Conta conectada!" if ok else "Não deu certo",
                                 "Pode fechar esta aba e voltar ao Cortes Live." if ok else msg))

    def log_message(self, *a):  # silencioso
        pass


def _ligar_servidor() -> None:
    global _servidor
    if _servidor is not None:
        return
    try:
        _servidor = ThreadingHTTPServer(("127.0.0.1", PORTA_RETORNO), _Retorno)
    except OSError:
        _servidor = None  # porta ocupada: sobra colar o endereço
        return
    threading.Thread(target=_servidor.serve_forever, daemon=True, name="oauth-retorno").start()


def retorno(rede: Rede) -> str:
    return rede.retorno_padrao


def iniciar_login(nome: str) -> dict:
    rede = REDES[nome]
    app_id, _ = credenciais(rede)
    state = secrets.token_urlsafe(24)
    verificador, _ = pkce()
    end = retorno(rede)
    with _lock:
        agora = time.time()
        for k in [k for k, v in _logins.items() if agora - v["criado"] > LOGIN_VALIDADE]:
            _logins.pop(k, None)
        _logins[state] = {"rede": nome, "verificador": verificador, "retorno": end, "criado": agora,
                          "status": "aguardando", "msg": "", "conta_id": None}
    if urlparse(end).scheme == "http" and urlparse(end).hostname in ("127.0.0.1", "localhost"):
        _ligar_servidor()
    return {"state": state, "url_login": rede.login(app_id, end, state, verificador), "retorno": end}


def estado_login(state: str) -> dict:
    with _lock:
        v = _logins.get(state)
    if not v:
        return {"status": "expirado", "msg": "O login expirou. Clique em Conectar de novo."}
    return {k: v[k] for k in ("status", "msg", "conta_id", "rede")}


def concluir_login(endereco: str) -> tuple[bool, str]:
    """Recebe o endereço de retorno (do servidor local ou colado pela pessoa) e salva a conta."""
    q = parse_qs(urlparse(endereco.strip()).query)
    state = (q.get("state") or [""])[0]
    with _lock:
        login = _logins.get(state)
    if not login:
        return False, "Esse login não é deste programa ou expirou. Clique em Conectar de novo."
    if q.get("error"):
        msg = (q.get("error_description") or q.get("error"))[0]
        _marcar(state, "erro", f"A rede não autorizou: {msg}")
        return False, f"A rede não autorizou: {msg}"
    codigo = (q.get("code") or [""])[0].split("#")[0]
    if not codigo:
        _marcar(state, "erro", "O endereço não tem o código do login.")
        return False, "O endereço não tem o código do login."
    rede = REDES[login["rede"]]
    try:
        app_id, segredo = credenciais(rede)
        tokens, conta = rede.trocar(app_id, segredo, codigo, login["retorno"], login["verificador"])
        conta_id = salvar_conta(rede.nome, conta, tokens)
    except ErroRede as e:
        _marcar(state, "erro", str(e))
        return False, str(e)
    _marcar(state, "ok", "", conta_id)
    return True, ""


def _marcar(state: str, status: str, msg: str, conta_id: int | None = None) -> None:
    with _lock:
        if state in _logins:
            _logins[state].update(status=status, msg=msg, conta_id=conta_id)


# ---------------------------------------------------------------- contas e tokens

def salvar_conta(rede: str, conta: dict, tokens: dict) -> int:
    agora = db.agora()
    with db._lock:
        existente = db.um("SELECT id FROM contas_sociais WHERE rede=? AND id_externo=?", (rede, conta["id_externo"]))
        if existente:
            cid = existente["id"]
            db.executar("UPDATE contas_sociais SET nome=?, avatar_url=?, escopos=?, expira_em=?, status='ativa', "
                        "so_privado=?, atualizado_em=? WHERE id=?",
                        (conta["nome"], conta.get("avatar_url"), db.json_dump(conta.get("escopos", [])),
                         tokens.get("expira_em"), int(conta.get("so_privado", 0)), agora, cid))
        else:
            cid = db.executar("INSERT INTO contas_sociais (rede, id_externo, nome, avatar_url, escopos, expira_em, "
                              "so_privado, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)",
                              (rede, conta["id_externo"], conta["nome"], conta.get("avatar_url"),
                               db.json_dump(conta.get("escopos", [])), tokens.get("expira_em"),
                               int(conta.get("so_privado", 0)), agora, agora))
    cofre.guardar(cid, tokens)
    return cid


_lock_tokens = threading.Lock()


def tokens_validos(conta: dict) -> dict:
    """Tokens da conta, renovados se estiverem perto de vencer. Conta sem jeito vira 'expirada'."""
    with _lock_tokens:
        tokens = cofre.ler(conta["id"])
        if not tokens:
            _expirar(conta["id"])
            raise ErroRede("A conta perdeu o acesso: conecte de novo em Ajustes → Contas.", reconectar=True)
        rede = REDES[conta["rede"]]
        if tokens.get("expira_em") and tokens["expira_em"] - time.time() > rede.renovar_antes:
            return tokens
        try:
            app_id, segredo = credenciais(rede)
            novos = rede.renovar(app_id, segredo, tokens)
        except ErroRede as e:
            if not e.tentar_de_novo:
                _expirar(conta["id"])
                e.reconectar = True
            raise
        tokens = {**tokens, **novos}
        cofre.guardar(conta["id"], tokens)
        db.executar("UPDATE contas_sociais SET expira_em=?, status='ativa', atualizado_em=? WHERE id=?",
                    (tokens.get("expira_em"), db.agora(), conta["id"]))
        return tokens


def _expirar(conta_id: int) -> None:
    db.executar("UPDATE contas_sociais SET status='expirada', atualizado_em=? WHERE id=?", (db.agora(), conta_id))


def desconectar(conta_id: int) -> None:
    conta = db.um("SELECT * FROM contas_sociais WHERE id=?", (conta_id,))
    if not conta:
        return
    rede = REDES.get(conta["rede"])
    tokens = cofre.ler(conta_id)
    if rede and rede.revogar and tokens:
        try:
            rede.revogar(*credenciais(rede), tokens)
        except ErroRede:
            pass  # revogar é cortesia: a conta sai daqui de qualquer jeito
    cofre.apagar(conta_id)
    db.executar("DELETE FROM contas_sociais WHERE id=?", (conta_id,))


def link_de_login(endereco: str, params: dict) -> str:
    return f"{url(endereco)}?{urlencode(params)}"
