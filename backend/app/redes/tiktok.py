"""TikTok: Login Kit (computador, com PKCE) e Content Posting API (envio direto do arquivo).

App: criado no TikTok for Developers com Login Kit + Content Posting API ("Direct Post"). Enquanto o app não passa
pela auditoria do TikTok, os posts só podem sair como privados ("só eu"): a conta fica marcada `so_privado`.
"""
import os
import time
from pathlib import Path

from . import base

AUTH = "https://www.tiktok.com/v2/auth/authorize/"
API = "https://open.tiktokapis.com/v2"
ESCOPOS = ["user.info.basic", "video.publish", "video.list"]
PEDACO = 10 * 1024 * 1024      # entre 5 e 64 MB; arquivo menor que 64 MB vai num pedaço só
UNICO_ATE = 64 * 1024 * 1024
PRIVACIDADE = {"publico": "PUBLIC_TO_EVERYONE", "nao_listado": "FOLLOWER_OF_CREATOR", "privado": "SELF_ONLY"}
ESPERA_MAX = 600               # s esperando o TikTok processar o vídeo


def login(app_id, retorno, state, verificador):
    return base.link_de_login(AUTH, {
        "client_key": app_id, "scope": ",".join(ESCOPOS), "response_type": "code", "redirect_uri": retorno,
        "state": state, "code_challenge": base.desafio(verificador, hexa=True), "code_challenge_method": "S256"})


def _tokens(d: dict) -> dict:
    agora = time.time()
    return {"access_token": d["access_token"], "refresh_token": d.get("refresh_token"),
            "expira_em": agora + int(d.get("expires_in", 86400)),
            "refresh_expira_em": agora + int(d.get("refresh_expires_in", 31536000)), "open_id": d.get("open_id")}


def _resposta(r, oque: str) -> dict:
    dados = base.json_ou_erro(r, oque)
    erro = dados.get("error")
    if isinstance(erro, dict) and erro.get("code") not in (None, "", "ok"):
        codigo = erro.get("code")
        msg = f"{oque}: {erro.get('message') or codigo}"
        if codigo in ("access_token_invalid", "scope_not_authorized"):
            raise base.ErroRede(msg, reconectar=True)
        raise base.ErroRede(msg, tentar_de_novo=codigo in ("rate_limit_exceeded", "internal_error"))
    return dados


def trocar(app_id, segredo, codigo, retorno, verificador):
    r = base.http("POST", f"{API}/oauth/token/", data={
        "client_key": app_id, "client_secret": segredo, "code": codigo, "grant_type": "authorization_code",
        "redirect_uri": retorno, "code_verifier": verificador})
    dados = _resposta(r, "O TikTok recusou o login")
    if not dados.get("access_token"):
        raise base.ErroRede(f"O TikTok recusou o login: {dados.get('error_description') or dados.get('error')}")
    tokens = _tokens(dados)
    escopos = [e for e in (dados.get("scope") or "").split(",") if e]
    if "video.publish" not in escopos:
        raise base.ErroRede("A permissão de publicar vídeos não foi aceita. Conecte de novo e marque todas.")
    r = base.http("GET", f"{API}/user/info/", params={"fields": "open_id,display_name,avatar_url"},
                  headers={"Authorization": f"Bearer {tokens['access_token']}"})
    usuario = (_resposta(r, "Não deu para ler o seu perfil").get("data") or {}).get("user") or {}
    so_privado = _so_privado(tokens)
    conta = {"id_externo": usuario.get("open_id") or tokens["open_id"], "nome": usuario.get("display_name") or "TikTok",
             "avatar_url": usuario.get("avatar_url"), "escopos": escopos, "so_privado": so_privado}
    return tokens, conta


def _criador(tokens) -> dict:
    r = base.http("POST", f"{API}/post/publish/creator_info/query/", json={},
                  headers={"Authorization": f"Bearer {tokens['access_token']}",
                           "Content-Type": "application/json; charset=UTF-8"})
    return _resposta(r, "Não deu para ler as opções da sua conta").get("data") or {}


def _so_privado(tokens) -> bool:
    try:
        opcoes = _criador(tokens).get("privacy_level_options") or []
    except base.ErroRede:
        return False
    return bool(opcoes) and set(opcoes) <= {"SELF_ONLY"}


def renovar(app_id, segredo, tokens):
    r = base.http("POST", f"{API}/oauth/token/", data={
        "client_key": app_id, "client_secret": segredo, "grant_type": "refresh_token",
        "refresh_token": tokens.get("refresh_token")})
    dados = base.json_ou_erro(r, "Não deu para renovar o acesso ao TikTok")
    if not dados.get("access_token"):
        raise base.ErroRede("O TikTok cancelou o acesso da conta. Conecte de novo.")
    return _tokens(dados)


def revogar(app_id, segredo, tokens):
    base.http("POST", f"{API}/oauth/revoke/", data={"client_key": app_id, "client_secret": segredo,
                                                       "token": tokens.get("access_token")})


def validar(exp: dict, privacidade: str) -> str | None:
    if exp["duracao_s"] < 3:
        return "O TikTok pede vídeos com pelo menos 3 segundos."
    if exp["duracao_s"] > 600:
        return "O TikTok aceita até 10 minutos por esta API."
    return None


def publicar(ctx, conta, tokens, post):
    auth = {"Authorization": f"Bearer {tokens['access_token']}", "Content-Type": "application/json; charset=UTF-8"}
    criador = _criador(tokens)
    opcoes = criador.get("privacy_level_options") or ["SELF_ONLY"]
    nivel = PRIVACIDADE[post["privacidade"]]
    if nivel not in opcoes:
        if opcoes == ["SELF_ONLY"]:
            nivel = "SELF_ONLY"  # app sem auditoria: o TikTok só deixa postar como privado
        else:
            raise base.ErroRede(f"O TikTok não deixa essa privacidade nesta conta (aceita: {', '.join(opcoes)}).")
    maximo = criador.get("max_video_post_duration_sec")
    if maximo and post["duracao_s"] > maximo:
        raise base.ErroRede(f"Esta conta do TikTok aceita vídeos de até {maximo} s.")
    arquivo = Path(post["arquivo"])
    total = arquivo.stat().st_size
    tamanho = total if total < UNICO_ATE else PEDACO
    pedacos = max(1, total // tamanho)
    legenda = "\n\n".join(x for x in (post["titulo"], post["descricao"]) if x)[:2200]
    r = base.http("POST", f"{API}/post/publish/video/init/", headers=auth, json={
        "post_info": {"title": legenda, "privacy_level": nivel, "disable_duet": False, "disable_comment": False,
                      "disable_stitch": False},
        "source_info": {"source": "FILE_UPLOAD", "video_size": total, "chunk_size": tamanho,
                        "total_chunk_count": pedacos}})
    dados = _resposta(r, "O TikTok recusou o envio").get("data") or {}
    publish_id, destino = dados.get("publish_id"), dados.get("upload_url")
    if not publish_id or not destino:
        raise base.ErroRede("O TikTok não abriu o envio.", tentar_de_novo=True)
    with open(arquivo, "rb") as f:
        for i in range(pedacos):
            ctx.checar()
            inicio = i * tamanho
            fim = total - 1 if i == pedacos - 1 else inicio + tamanho - 1  # o último leva o resto
            f.seek(inicio)
            corpo = f.read(fim - inicio + 1)
            r = base.http("PUT", destino, data=corpo, timeout=300, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(corpo)),
                "Content-Range": f"bytes {inicio}-{fim}/{total}"})
            if r.status_code >= 400:
                raise base.ErroRede(f"O TikTok recusou o pedaço {i + 1} do vídeo (HTTP {r.status_code}).",
                                    tentar_de_novo=True)
            ctx.progresso(0.1 + 0.6 * (i + 1) / pedacos, f"Enviando ao TikTok: {(i + 1) * 100 // pedacos}%")
    limite = time.time() + ESPERA_MAX
    while time.time() < limite:
        ctx.checar()
        r = base.http("POST", f"{API}/post/publish/status/fetch/", headers=auth, json={"publish_id": publish_id})
        st = _resposta(r, "Não deu para ver o andamento no TikTok").get("data") or {}
        if st.get("status") == "PUBLISH_COMPLETE":
            ids = st.get("publicaly_available_post_id") or st.get("publicly_available_post_id") or []
            vid = str(ids[0]) if ids else publish_id
            return vid, (f"https://www.tiktok.com/@/video/{ids[0]}" if ids else None)
        if st.get("status") == "FAILED":
            raise base.ErroRede(f"O TikTok não publicou: {st.get('fail_reason') or 'motivo não informado'}.")
        ctx.progresso(0.8, "O TikTok está processando o vídeo")
        time.sleep(float(os.environ.get("CORTES_REDES_ESPERA", "5")))
    raise base.ErroRede("O TikTok demorou demais para processar. Confira no app do TikTok.")


def metricas(conta, tokens, post):
    if not post.get("id_externo") or not post["id_externo"].isdigit():
        return {}
    r = base.http("POST", f"{API}/video/query/", params={"fields": "id,view_count,like_count,comment_count,share_count"},
                  json={"filters": {"video_ids": [post["id_externo"]]}},
                  headers={"Authorization": f"Bearer {tokens['access_token']}",
                           "Content-Type": "application/json; charset=UTF-8"})
    videos = (_resposta(r, "Métricas do TikTok").get("data") or {}).get("videos") or []
    if not videos:
        return {}
    v = videos[0]
    return {"views": v.get("view_count"), "likes": v.get("like_count"), "comentarios": v.get("comment_count"),
            "compartilhamentos": v.get("share_count")}


REDE = base.registrar(base.Rede(
    nome="tiktok", titulo="TikTok", campos=("tiktok_cliente_chave", "tiktok_cliente_segredo"),
    retorno_padrao=os.environ.get("CORTES_RETORNO_TIKTOK") or f"http://127.0.0.1:{base.PORTA_RETORNO}/",
    login=login, trocar=trocar, renovar=renovar, publicar=publicar, metricas=metricas, validar=validar,
    revogar=revogar,
))
