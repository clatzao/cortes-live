"""Imitação das APIs do YouTube, TikTok e Instagram, só para os testes (nunca fala com as redes de verdade).

O motor de teste roda com CORTES_REDES_TESTE apontando para cá: https://host/caminho vira http://127.0.0.1:porta/host/caminho.
POST /_controle {"falhar": "youtube"} faz o próximo envio daquela rede ser recusado.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

ESTADO = {"falhar": set(), "envios": {}, "publicados": []}
_lock = threading.Lock()


class Falsa(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # ------------------------------------------------------------ utilidades
    @property
    def base(self) -> str:
        return f"http://{self.headers['Host']}"

    def _corpo(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _form(self, corpo: bytes) -> dict:
        tipo = self.headers.get("Content-Type", "")
        if "json" in tipo:
            return json.loads(corpo or b"{}")
        return {k: v[0] for k, v in parse_qs(corpo.decode("utf-8", "replace")).items()}

    def _json(self, dados, codigo=200, extra: dict | None = None):
        b = json.dumps(dados).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def _vazio(self, codigo, extra: dict | None = None):
        self.send_response(codigo)
        self.send_header("Content-Length", "0")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _falhar(self, rede: str) -> bool:
        with _lock:
            if rede in ESTADO["falhar"]:
                ESTADO["falhar"].discard(rede)
                return True
        return False

    # ------------------------------------------------------------ login (aprova na hora e volta ao retorno)
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        if p in ("/accounts.google.com/o/oauth2/v2/auth", "/www.tiktok.com/v2/auth/authorize/",
                 "/www.instagram.com/oauth/authorize"):
            codigo = {"accounts.google.com": "yt-codigo", "www.tiktok.com": "tt-codigo"}.get(p.split("/")[1], "ig-codigo")
            destino = f"{q['redirect_uri']}?{urlencode({'code': codigo, 'state': q['state']})}"
            if "instagram" in p:
                destino += "#_"
            return self._vazio(302, {"Location": destino})
        if p == "/_estado":
            with _lock:
                return self._json({"publicados": ESTADO["publicados"]})
        # YouTube
        if p == "/www.googleapis.com/youtube/v3/channels":
            return self._json({"items": [{"id": "UC-teste", "snippet": {"title": "Canal de Teste",
                                                                        "thumbnails": {"default": {"url": ""}}}}]})
        if p == "/www.googleapis.com/youtube/v3/videos":
            return self._json({"items": [{"statistics": {"viewCount": "1234", "likeCount": "56", "commentCount": "7"}}]})
        # TikTok
        if p == "/open.tiktokapis.com/v2/user/info/":
            return self._json({"data": {"user": {"open_id": "tt-open-id", "display_name": "TikTok de Teste"}},
                               "error": {"code": "ok"}})
        # Instagram
        if p == "/graph.instagram.com/access_token":
            return self._json({"access_token": "ig-longo", "expires_in": 5184000})
        if p == "/graph.instagram.com/v23.0/me":
            return self._json({"user_id": "1784", "username": "perfil_teste"})
        if p.startswith("/graph.instagram.com/v23.0/cont-"):
            return self._json({"status_code": "FINISHED"})
        if p.endswith("/insights"):
            return self._json({"data": [{"name": "views", "values": [{"value": 900}]},
                                        {"name": "likes", "values": [{"value": 80}]}]})
        if p.startswith("/graph.instagram.com/v23.0/midia-"):
            return self._json({"permalink": "https://www.instagram.com/reel/teste/"})
        return self._json({"error": f"falsa: GET {p} não existe"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        corpo = self._corpo()
        if p == "/_controle":
            with _lock:
                ESTADO["falhar"].add(json.loads(corpo)["falhar"])
            return self._json({"ok": True})
        # YouTube
        if p == "/oauth2.googleapis.com/token":
            return self._json({"access_token": "yt-acesso", "expires_in": 3600, "refresh_token": "yt-renova"})
        if p == "/oauth2.googleapis.com/revoke":
            return self._json({})
        if p == "/www.googleapis.com/upload/youtube/v3/videos":
            if self._falhar("youtube"):
                return self._json({"error": {"message": "Vídeo recusado (teste)"}}, 400)
            total = int(self.headers.get("X-Upload-Content-Length") or 0)
            meta = json.loads(corpo or b"{}")
            with _lock:
                sid = str(len(ESTADO["envios"]) + 1)
                ESTADO["envios"][sid] = {"total": total, "recebido": 0, "meta": meta}
            return self._vazio(200, {"Location": f"{self.base}/www.googleapis.com/upload/sessao/{sid}"})
        # TikTok
        if p == "/open.tiktokapis.com/v2/oauth/token/":
            return self._json({"access_token": "tt-acesso", "expires_in": 86400, "refresh_token": "tt-renova",
                               "refresh_expires_in": 31536000, "open_id": "tt-open-id",
                               "scope": "user.info.basic,video.publish,video.list"})
        if p == "/open.tiktokapis.com/v2/post/publish/creator_info/query/":
            return self._json({"data": {"privacy_level_options": ["SELF_ONLY"], "max_video_post_duration_sec": 600},
                               "error": {"code": "ok"}})
        if p == "/open.tiktokapis.com/v2/post/publish/video/init/":
            info = json.loads(corpo)
            with _lock:
                ESTADO["publicados"].append({"rede": "tiktok", "privacidade": info["post_info"]["privacy_level"],
                                             "titulo": info["post_info"]["title"]})
            return self._json({"data": {"publish_id": "p-1", "upload_url": f"{self.base}/open-upload.tiktokapis.com/up/1"},
                               "error": {"code": "ok"}})
        if p == "/open.tiktokapis.com/v2/post/publish/status/fetch/":
            return self._json({"data": {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [7300000000001]},
                               "error": {"code": "ok"}})
        if p == "/open.tiktokapis.com/v2/video/query/":
            return self._json({"data": {"videos": [{"view_count": 500, "like_count": 40, "comment_count": 3,
                                                    "share_count": 2}]}, "error": {"code": "ok"}})
        # Instagram
        if p == "/api.instagram.com/oauth/access_token":
            return self._json({"access_token": "ig-curto", "user_id": 1784})
        if p == "/graph.instagram.com/v23.0/1784/media":
            form = self._form(corpo)
            with _lock:
                ESTADO["publicados"].append({"rede": "instagram", "titulo": form.get("caption", "")})
            return self._json({"id": "cont-1"})
        if p.startswith("/rupload.facebook.com/ig-api-upload/"):
            return self._json({"success": True})
        if p == "/graph.instagram.com/v23.0/1784/media_publish":
            return self._json({"id": "midia-1"})
        return self._json({"error": f"falsa: POST {p} não existe"}, 404)

    def do_PUT(self):
        p = urlparse(self.path).path
        corpo = self._corpo()
        if p.startswith("/www.googleapis.com/upload/sessao/"):
            sid = p.rsplit("/", 1)[1]
            with _lock:
                env = ESTADO["envios"][sid]
                env["recebido"] += len(corpo)
                pronto = env["recebido"] >= env["total"]
                if pronto:
                    ESTADO["publicados"].append({"rede": "youtube", "titulo": env["meta"]["snippet"]["title"],
                                                 "privacidade": env["meta"]["status"]["privacyStatus"],
                                                 "bytes": env["recebido"]})
            if not pronto:
                return self._vazio(308, {"Range": f"bytes=0-{env['recebido'] - 1}"})
            return self._json({"id": f"yt-video-{sid}"})
        if p.startswith("/open-upload.tiktokapis.com/"):
            return self._vazio(201)
        return self._json({"error": f"falsa: PUT {p} não existe"}, 404)


def ligar(porta: int) -> ThreadingHTTPServer:
    s = ThreadingHTTPServer(("127.0.0.1", porta), Falsa)
    threading.Thread(target=s.serve_forever, daemon=True, name="redes-falsas").start()
    return s
