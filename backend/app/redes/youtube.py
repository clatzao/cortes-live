"""YouTube (Shorts): login do Google, envio retomável pela YouTube Data API v3 e métricas.

App: um projeto no Google Cloud com a "YouTube Data API v3" ativada e uma credencial OAuth do tipo
"App para computador" (Desktop). Cota padrão: 10.000 unidades/dia; cada envio custa 1.600 (~6 por dia).
"""
import os
import time
from pathlib import Path

from . import base

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
REVOGAR = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/youtube/v3"
ENVIO = "https://www.googleapis.com/upload/youtube/v3/videos"
ESCOPOS = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
PEDACO = 8 * 1024 * 1024       # múltiplo de 256 KB, como a API pede
PRIVACIDADE = {"publico": "public", "nao_listado": "unlisted", "privado": "private"}


def login(app_id, retorno, state, verificador):
    return base.link_de_login(AUTH, {
        "client_id": app_id, "redirect_uri": retorno, "response_type": "code", "scope": " ".join(ESCOPOS),
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": base.desafio(verificador), "code_challenge_method": "S256"})


def _tokens(dados: dict, antigos: dict | None = None) -> dict:
    t = {"access_token": dados["access_token"], "expira_em": time.time() + int(dados.get("expires_in", 3600))}
    t["refresh_token"] = dados.get("refresh_token") or (antigos or {}).get("refresh_token")
    return t


def trocar(app_id, segredo, codigo, retorno, verificador):
    r = base.http("POST", TOKEN, data={"client_id": app_id, "client_secret": segredo, "code": codigo,
                                        "code_verifier": verificador, "grant_type": "authorization_code",
                                        "redirect_uri": retorno})
    tokens = _tokens(base.json_ou_erro(r, "O Google recusou o login"))
    if not tokens["refresh_token"]:
        raise base.ErroRede("O Google não devolveu a permissão permanente. Remova o acesso do app na sua conta "
                            "Google e conecte de novo.")
    r = base.http("GET", f"{API}/channels", params={"part": "snippet", "mine": "true"},
                  headers={"Authorization": f"Bearer {tokens['access_token']}"})
    itens = base.json_ou_erro(r, "Não deu para ler o seu canal").get("items") or []
    if not itens:
        raise base.ErroRede("Essa conta Google não tem canal no YouTube. Crie o canal e conecte de novo.")
    canal = itens[0]
    conta = {"id_externo": canal["id"], "nome": canal["snippet"]["title"],
             "avatar_url": ((canal["snippet"].get("thumbnails") or {}).get("default") or {}).get("url"),
             "escopos": ESCOPOS}
    return tokens, conta


def renovar(app_id, segredo, tokens):
    if not tokens.get("refresh_token"):
        raise base.ErroRede("A conta do YouTube perdeu o acesso: conecte de novo.")
    r = base.http("POST", TOKEN, data={"client_id": app_id, "client_secret": segredo,
                                        "refresh_token": tokens["refresh_token"], "grant_type": "refresh_token"})
    if r.status_code == 400:  # invalid_grant: senha trocada, acesso removido ou app em modo "teste" (7 dias)
        raise base.ErroRede("O Google cancelou o acesso da conta (se o app está em modo Teste, ele expira em "
                            "7 dias: publique o app). Conecte de novo.")
    return _tokens(base.json_ou_erro(r, "Não deu para renovar o acesso ao YouTube"), tokens)


def revogar(app_id, segredo, tokens):
    base.http("POST", REVOGAR, params={"token": tokens.get("refresh_token") or tokens.get("access_token")})


def validar(exp: dict, privacidade: str) -> str | None:
    if exp["duracao_s"] > 12 * 3600:
        return "O YouTube aceita vídeos de até 12 horas."
    return None


def publicar(ctx, conta, tokens, post):
    arquivo = Path(post["arquivo"])
    total = arquivo.stat().st_size
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}
    corpo = {"snippet": {"title": (post["titulo"] or arquivo.stem)[:100], "description": post["descricao"][:5000]},
             "status": {"privacyStatus": PRIVACIDADE[post["privacidade"]], "selfDeclaredMadeForKids": False}}
    r = base.http("POST", ENVIO, params={"uploadType": "resumable", "part": "snippet,status"}, json=corpo,
                  headers={**auth, "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(total)})
    if r.status_code >= 400:
        base.json_ou_erro(r, "O YouTube recusou o envio")
    sessao = r.headers.get("Location")
    if not sessao:
        raise base.ErroRede("O YouTube não abriu o envio.", tentar_de_novo=True)
    enviado = 0
    with open(arquivo, "rb") as f:
        while True:
            ctx.checar()
            f.seek(enviado)
            pedaco = f.read(PEDACO)
            fim = enviado + len(pedaco) - 1
            r = base.http("PUT", sessao, data=pedaco, timeout=300,
                          headers={**auth, "Content-Length": str(len(pedaco)),
                                   "Content-Range": f"bytes {enviado}-{fim}/{total}"})
            if r.status_code == 308:  # continua: a API diz até onde recebeu
                faixa = r.headers.get("Range", "")
                enviado = int(faixa.rsplit("-", 1)[1]) + 1 if "-" in faixa else 0
                ctx.progresso(0.1 + 0.85 * enviado / total, f"Enviando ao YouTube: {enviado * 100 // total}%")
                continue
            video = base.json_ou_erro(r, "O YouTube recusou o vídeo")
            vid = video["id"]
            return vid, f"https://youtube.com/shorts/{vid}"


def metricas(conta, tokens, post):
    r = base.http("GET", f"{API}/videos", params={"part": "statistics", "id": post["id_externo"]},
                  headers={"Authorization": f"Bearer {tokens['access_token']}"})
    itens = base.json_ou_erro(r, "Métricas do YouTube").get("items") or []
    if not itens:
        return {}
    s = itens[0].get("statistics") or {}
    return {"views": _int(s.get("viewCount")), "likes": _int(s.get("likeCount")),
            "comentarios": _int(s.get("commentCount"))}


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


REDE = base.registrar(base.Rede(
    nome="youtube", titulo="YouTube", campos=("youtube_cliente_id", "youtube_cliente_segredo"),
    retorno_padrao=os.environ.get("CORTES_RETORNO_YOUTUBE") or f"http://127.0.0.1:{base.PORTA_RETORNO}/",
    login=login, trocar=trocar, renovar=renovar, publicar=publicar, metricas=metricas, validar=validar,
    revogar=revogar,
))
