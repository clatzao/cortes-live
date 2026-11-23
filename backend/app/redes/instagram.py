"""Instagram (Reels): API do Instagram com login do Instagram (conta Profissional, sem Página do Facebook).

App: criado no Meta for Developers com o produto "Instagram" (API com login do Instagram). A Meta só aceita
endereço de retorno https, então o login termina numa página que não abre: copie o endereço da barra do navegador
e cole no Cortes Live. O token longo dura 60 dias e é renovado sozinho.
"""
import os
import time
from pathlib import Path

from . import base

AUTH = "https://www.instagram.com/oauth/authorize"
TOKEN = "https://api.instagram.com/oauth/access_token"
GRAPH = "https://graph.instagram.com"
VERSAO = "v23.0"
API = f"{GRAPH}/{VERSAO}"
ENVIO = f"https://rupload.facebook.com/ig-api-upload/{VERSAO}"
ESCOPOS = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"]
ESPERA_MAX = 900               # s esperando o Instagram processar o Reel


def login(app_id, retorno, state, verificador):
    return base.link_de_login(AUTH, {"client_id": app_id, "redirect_uri": retorno, "response_type": "code",
                                     "scope": ",".join(ESCOPOS), "state": state, "enable_fb_login": "0"})


def trocar(app_id, segredo, codigo, retorno, verificador):
    r = base.http("POST", TOKEN, data={"client_id": app_id, "client_secret": segredo, "code": codigo,
                                        "grant_type": "authorization_code", "redirect_uri": retorno})
    curto = base.json_ou_erro(r, "O Instagram recusou o login")
    if not curto.get("access_token"):
        raise base.ErroRede(f"O Instagram recusou o login: {curto.get('error_message') or 'sem token'}")
    r = base.http("GET", f"{GRAPH}/access_token", params={"grant_type": "ig_exchange_token", "client_secret": segredo,
                                                          "access_token": curto["access_token"]})
    longo = base.json_ou_erro(r, "Não deu para pegar o acesso de 60 dias")
    tokens = {"access_token": longo["access_token"], "expira_em": time.time() + int(longo.get("expires_in", 5184000)),
              "obtido_em": time.time()}
    r = base.http("GET", f"{API}/me", params={"fields": "user_id,username,profile_picture_url",
                                              "access_token": tokens["access_token"]})
    eu = base.json_ou_erro(r, "Não deu para ler o seu perfil")
    conta = {"id_externo": str(eu.get("user_id") or curto.get("user_id")), "nome": "@" + (eu.get("username") or "instagram"),
             "avatar_url": eu.get("profile_picture_url"), "escopos": ESCOPOS}
    return tokens, conta


def renovar(app_id, segredo, tokens):
    if time.time() - tokens.get("obtido_em", 0) < 86400 and tokens.get("expira_em", 0) > time.time():
        return {}  # o Instagram só renova token com mais de 24 h
    r = base.http("GET", f"{GRAPH}/refresh_access_token", params={"grant_type": "ig_refresh_token",
                                                                  "access_token": tokens["access_token"]})
    if r.status_code == 400:
        raise base.ErroRede("O acesso ao Instagram venceu (60 dias sem uso). Conecte de novo.")
    d = base.json_ou_erro(r, "Não deu para renovar o acesso ao Instagram")
    return {"access_token": d["access_token"], "expira_em": time.time() + int(d.get("expires_in", 5184000)),
            "obtido_em": time.time()}


def validar(exp: dict, privacidade: str) -> str | None:
    if privacidade != "publico":
        return "No Instagram, a API só publica Reels públicos."
    if exp["duracao_s"] < 3:
        return "O Instagram pede Reels com pelo menos 3 segundos."
    if exp["duracao_s"] > 15 * 60:
        return "O Instagram aceita Reels de até 15 minutos."
    return None


def publicar(ctx, conta, tokens, post):
    token = tokens["access_token"]
    arquivo = Path(post["arquivo"])
    total = arquivo.stat().st_size
    legenda = "\n\n".join(x for x in (post["titulo"], post["descricao"]) if x)[:2200]
    r = base.http("POST", f"{API}/{conta['id_externo']}/media", params={"access_token": token}, data={
        "media_type": "REELS", "upload_type": "resumable", "caption": legenda, "share_to_feed": "true"})
    container = base.json_ou_erro(r, "O Instagram recusou o Reel").get("id")
    if not container:
        raise base.ErroRede("O Instagram não abriu o envio.", tentar_de_novo=True)
    ctx.checar()
    with open(arquivo, "rb") as f:
        r = base.http("POST", f"{ENVIO}/{container}", data=f, timeout=900, headers={
            "Authorization": f"OAuth {token}", "offset": "0", "file_size": str(total)})
    base.json_ou_erro(r, "O Instagram recusou o arquivo")
    ctx.progresso(0.7, "O Instagram está processando o Reel")
    limite = time.time() + ESPERA_MAX
    while True:
        ctx.checar()
        r = base.http("GET", f"{API}/{container}", params={"fields": "status_code,status", "access_token": token})
        st = base.json_ou_erro(r, "Não deu para ver o andamento no Instagram")
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") in ("ERROR", "EXPIRED"):
            raise base.ErroRede(f"O Instagram não aceitou o vídeo: {st.get('status') or st['status_code']}.")
        if time.time() > limite:
            raise base.ErroRede("O Instagram demorou demais para processar o Reel.", tentar_de_novo=True)
        time.sleep(float(os.environ.get("CORTES_REDES_ESPERA", "5")))
    r = base.http("POST", f"{API}/{conta['id_externo']}/media_publish", params={"access_token": token},
                  data={"creation_id": container})
    midia = base.json_ou_erro(r, "O Instagram não publicou o Reel").get("id")
    r = base.http("GET", f"{API}/{midia}", params={"fields": "permalink", "access_token": token})
    link = base.json_ou_erro(r, "Link do Reel").get("permalink") if r.status_code < 400 else None
    return str(midia), link


def metricas(conta, tokens, post):
    r = base.http("GET", f"{API}/{post['id_externo']}/insights", params={
        "metric": "views,likes,comments,shares,saved,reach", "access_token": tokens["access_token"]})
    dados = base.json_ou_erro(r, "Métricas do Instagram").get("data") or []
    valores = {}
    for m in dados:
        v = (m.get("values") or [{}])[0].get("value")
        if v is None:
            v = (m.get("total_value") or {}).get("value")
        valores[m.get("name")] = v
    return {"views": valores.get("views"), "likes": valores.get("likes"), "comentarios": valores.get("comments"),
            "compartilhamentos": valores.get("shares"), "salvos": valores.get("saved"), "alcance": valores.get("reach")}


REDE = base.registrar(base.Rede(
    nome="instagram", titulo="Instagram", campos=("instagram_app_id", "instagram_app_segredo"),
    retorno_padrao=os.environ.get("CORTES_RETORNO_INSTAGRAM") or f"https://localhost:{base.PORTA_RETORNO}/",
    login=login, trocar=trocar, renovar=renovar, publicar=publicar, metricas=metricas, validar=validar,
    privacidades=("publico",),
    renovar_antes=7 * 86400,  # renova com 7 dias de folga (o Instagram renova no máximo uma vez por dia)
))
