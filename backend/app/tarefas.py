"""Jobs da fila: importar uma live e exportar cortes."""
import json
import re
import shutil
from pathlib import Path

from . import ajustes, config, db, formatos, hardware, jobs, legendas, marca, media, transcricao
from .jobs import Cancelado, Contexto

_INVALIDOS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_SEM_COR = re.compile(r"\x1b\[[0-9;]*m")  # códigos de cor que o yt-dlp põe nas mensagens


def nome_seguro(txt: str, limite: int = 60) -> str:
    limpo = _INVALIDOS.sub("", txt).strip().strip(".")
    limpo = re.sub(r"\s+", "_", limpo)
    return (limpo[:limite] or "sem_nome").rstrip("._")


def nome_legivel(txt: str, limite: int = 60) -> str:
    """Nome de pasta/arquivo com espaços (para as pastas que o usuário abre)."""
    limpo = re.sub(r"\s+", " ", _INVALIDOS.sub("", txt)).strip().strip(".")
    return (limpo[:limite].rstrip(" .") or "sem nome")


def pasta_saida(p: dict, c: dict) -> Path:
    """Vídeos/Cortes Live/<projeto>/<corte>: tudo de um corte (formatos, .srt, thumbs) junto."""
    pasta = config.EXPORTADOS / nome_legivel(p["nome"], 60) / f"{nome_legivel(c['nome'] or 'corte', 60)} ({c['id']})"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def pasta_projeto(projeto_id: int) -> Path:
    p = config.PROJETOS / str(projeto_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------- download por link

def _baixar(url: str, pasta: Path, ctx: Contexto, peso: float,
            ao_ter_audio=None) -> tuple[str, str | None]:
    """Baixa o vídeo do link. Quando o site separa áudio e vídeo (YouTube, Twitch), baixa o áudio
    primeiro e chama ao_ter_audio(caminho, titulo), para a transcrição começar enquanto o vídeo baixa."""

    import yt_dlp  # importado aqui para o programa abrir rápido

    faixa = {"nome": "", "ini": 0.0, "peso": 1.0}

    def gancho(d: dict) -> None:
        if ctx.cancelado():
            raise Cancelado()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            frac = (d.get("downloaded_bytes") or 0) / total if total else 0.0
            vel = _SEM_COR.sub("", d.get("_speed_str") or "").strip()
            ctx.progresso(peso * (faixa["ini"] + faixa["peso"] * min(1.0, frac)),
                          f"Baixando {faixa['nome']} {vel}".replace("  ", " ").strip())

    opcoes = {
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [gancho],
        "retries": 10,
        "fragment_retries": 10,
        # lives da Twitch/Kick vêm em milhares de pedacinhos (HLS): baixar 16 de cada vez acelera muito
        "concurrent_fragment_downloads": 16,
        # downloads diretos (YouTube) em blocos de 10 MB evitam a limitação de velocidade por conexão
        "http_chunk_size": 10 * 1024 * 1024,
    }
    qualidade = ajustes.ler()["download_qualidade"]
    if qualidade != "melhor":
        # a maior resolução até o limite; no empate, H.264 (que o programa decodifica bem mais rápido que AV1)
        opcoes["format_sort"] = [f"res:{qualidade}", "fps", "vcodec:h264"]
    if config.FFMPEG:
        opcoes["ffmpeg_location"] = str(Path(config.FFMPEG).parent)
    # O YouTube exige um runtime JavaScript; usa os que estiverem instalados.
    runtimes = {nome: {"path": caminho} for nome in ("deno", "node", "bun")
                if (caminho := shutil.which(nome))}
    if runtimes:
        opcoes["js_runtimes"] = runtimes

    def baixar(formato: str, nome_arquivo: str, mesclar: bool = False) -> str:
        # Lê o link de novo a cada etapa: o YouTube exige alguns segundos entre ler e baixar, e o yt-dlp
        # só respeita essa espera na mesma leitura (reaproveitar a prévia dava erro 403).
        extra = {"format": formato, "outtmpl": str(pasta / f"{nome_arquivo}.%(ext)s")}
        if mesclar:
            extra["merge_output_format"] = "mkv"
        with yt_dlp.YoutubeDL({**opcoes, **extra}) as ydl:
            info = ydl.extract_info(url, download=True)
        baixados = info.get("requested_downloads") or []
        caminho = baixados[0].get("filepath") if baixados else None
        if not caminho or not Path(caminho).exists():
            candidatos = sorted(pasta.glob(f"{nome_arquivo}.*"), key=lambda p: p.stat().st_size, reverse=True)
            if not candidatos:
                raise RuntimeError("O download terminou, mas o arquivo não foi encontrado.")
            caminho = str(candidatos[0])
        return caminho

    ctx.progresso(0, "Consultando o link", forcar=True)
    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            previa = ydl.extract_info(url, download=False)
        if previa.get("_type") == "playlist":
            raise RuntimeError("O link é uma playlist/canal. Cole o link de um vídeo ou VOD específico.")
        if previa.get("is_live") or previa.get("live_status") in ("is_live", "is_upcoming"):
            raise RuntimeError("Essa live ainda está ao vivo ou não começou. Aguarde ela virar VOD.")
        titulo = previa.get("title")
        fmts = previa.get("formats") or []
        so_audio = any(f.get("vcodec") == "none" and f.get("acodec") not in (None, "none") for f in fmts)
        so_video = any(f.get("acodec") == "none" and f.get("vcodec") not in (None, "none") for f in fmts)

        def tudo_junto(ini: float = 0.0) -> str:
            faixa.update(nome="", ini=ini, peso=1.0 - ini)
            return baixar("bv*+ba/b", "original", mesclar=True)

        if not (ao_ter_audio and so_audio and so_video):
            return tudo_junto(), titulo

        # 1) só o áudio (pequeno): a transcrição já pode começar
        faixa.update(nome="o áudio", ini=0.0, peso=0.15)
        try:
            audio = baixar("ba", "audio")
        except yt_dlp.utils.DownloadError:
            if ctx.cancelado():
                raise
            return tudo_junto(), titulo  # o site recusou o áudio separado: baixa do jeito normal
        ao_ter_audio(audio, titulo)
        # 2) só o vídeo, e junta com o áudio já baixado (sem recodificar)
        faixa.update(nome="o vídeo", ini=0.15, peso=0.85)
        try:
            video = baixar("bv", "video")
        except yt_dlp.utils.DownloadError:
            if ctx.cancelado():
                raise
            return tudo_junto(0.15), titulo
    except Cancelado:
        raise
    except yt_dlp.utils.DownloadError as e:
        if ctx.cancelado():
            raise Cancelado() from e
        raise RuntimeError(f"Falha no download: {_SEM_COR.sub('', str(e))}") from e

    ctx.progresso(peso, "Juntando áudio e vídeo", forcar=True)
    destino = pasta / "original.mkv"
    media.rodar_ffmpeg(["-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
                        str(destino)], 0, ctx, peso, 0.0, "Juntando áudio e vídeo")
    media.apagar_arquivo(Path(video))
    media.apagar_arquivo(Path(audio))  # a transcrição já leu o áudio antes (ou lê do vídeo final)
    return str(destino), titulo


# ---------------------------------------------------------------- importar

def _falha_importar(job: dict, msg: str) -> None:
    db.executar("UPDATE projetos SET status='erro', erro=? WHERE id=?", (msg[-1000:], job["projeto_id"]))


@jobs.registrar("importar", _falha_importar)
def importar(ctx: Contexto) -> str | None:
    p = db.um("SELECT * FROM projetos WHERE id=?", (ctx.job["projeto_id"],))
    if not p:
        raise RuntimeError("O projeto foi removido.")
    db.executar("UPDATE projetos SET status='processando', erro=NULL WHERE id=?", (p["id"],))
    pasta = pasta_projeto(p["id"])

    # A transcrição começa o quanto antes: num link, logo que o áudio baixa; num arquivo, antes do proxy.
    transcricao_iniciada = False

    def renomear(titulo: str | None) -> None:
        if titulo and p["nome"] == p["entrada"]:
            db.executar("UPDATE projetos SET nome=? WHERE id=?", (titulo[:200], p["id"]))

    def ao_ter_audio(audio: str, titulo: str | None) -> None:
        nonlocal transcricao_iniciada
        renomear(titulo)
        ia = media.analisar(audio, so_audio=True)
        if not ia["tem_audio"]:
            return
        media.gerar_ondas(audio, pasta / "ondas.json", ia, ctx, 0.075, 0.0)
        db.executar("UPDATE projetos SET duracao=? WHERE id=?", (ia["duracao"], p["id"]))
        jobs.enfileirar("transcrever", projeto_id=p["id"], params={"audio": audio})
        transcricao_iniciada = True

    base = 0.0
    if p["origem"] == "link":
        caminho, titulo = _baixar(p["entrada"], pasta, ctx, 0.5, ao_ter_audio)
        renomear(titulo)
        base = 0.5
    else:
        caminho = p["entrada"]
        if not Path(caminho).is_file():
            raise RuntimeError(f"Arquivo não encontrado: {caminho}")

    info = media.analisar(caminho)
    db.executar("UPDATE projetos SET caminho_original=?, duracao=?, largura=?, altura=?, fps=? WHERE id=?",
                (caminho, info["duracao"], info["largura"], info["altura"], info["fps"], p["id"]))

    resto = 1.0 - base
    if not transcricao_iniciada:
        media.gerar_ondas(caminho, pasta / "ondas.json", info, ctx, base, resto * 0.1)
        if info["tem_audio"]:
            jobs.enfileirar("transcrever", projeto_id=p["id"])
            transcricao_iniciada = True
    parcial = pasta / "proxy.parcial.mp4"
    try:
        media.gerar_proxy(caminho, parcial, info, ctx, base + resto * 0.1, resto * 0.9)
        parcial.replace(pasta / "proxy.mp4")
    finally:
        media.apagar_arquivo(parcial)
    media.miniaturas_em_segundo_plano(p["id"], info["duracao"])  # tira de quadros da timeline

    with transcricao.FIM:  # se a transcrição terminou antes do vídeo, os momentos virais começam agora
        db.executar("UPDATE projetos SET status='pronto', erro=NULL WHERE id=?", (p["id"],))
        if transcricao.completa(p["id"]):
            transcricao.depois_de_transcrever(p["id"])
    return None


# ---------------------------------------------------------------- exportar corte

@jobs.registrar("exportar")
def exportar(ctx: Contexto) -> str:
    c = db.um("SELECT * FROM cortes WHERE id=?", (ctx.job["corte_id"],))
    if not c:
        raise RuntimeError("O corte foi removido.")
    p = db.um("SELECT * FROM projetos WHERE id=?", (c["projeto_id"],))
    if not p or p["status"] != "pronto" or not p["caminho_original"]:
        raise RuntimeError("O projeto deste corte não está pronto.")
    if not Path(p["caminho_original"]).is_file():
        raise RuntimeError(f"O vídeo original sumiu: {p['caminho_original']}")

    fmt = ctx.params.get("formato") or "original"
    if fmt not in formatos.FORMATOS:
        raise RuntimeError(f"Formato desconhecido: {fmt}")

    pasta = pasta_saida(p, c)
    destino = pasta / f"{nome_legivel(formatos.FORMATOS[fmt]['nome'].replace(':', 'x'), 40)}.mp4"
    parcial = destino.with_name(destino.stem + ".parcial.mp4")
    temporaria = pasta_projeto(p["id"]) / f"export_{c['id']}_{ctx.id}"
    try:
        montagem = preparar_montagem(c, p, fmt, temporaria, ctx)
        args, total = formatos.comando(montagem, hardware.args_video("final"), str(parcial))
        media.rodar_ffmpeg(args, total, ctx, 0.25, 0.75, f"Renderizando {formatos.FORMATOS[fmt]['nome']}")
        parcial.replace(destino)
        srt = temporaria / "legenda.srt"
        if srt.exists():
            shutil.copyfile(srt, destino.with_suffix(".srt"))
    finally:
        media.apagar_arquivo(parcial)
        shutil.rmtree(temporaria, ignore_errors=True)
    return str(destino)


def layout_do_projeto(p: dict, m: dict | None = None) -> dict:
    m = m or marca.ler()
    return marca.validar_layout(json.loads(p["layout"]) if p.get("layout") else m["layout_padrao"])


def formatos_do_corte(c: dict, p: dict, m: dict | None = None) -> list[str]:
    for fonte in (c.get("formatos"), p.get("formatos")):
        if fonte:
            lista = [f for f in json.loads(fonte) if f in formatos.FORMATOS]
            if lista:
                return lista
    return (m or marca.ler())["formatos_padrao"]


def preparar_montagem(c: dict, p: dict, fmt: str, pasta: Path, ctx: Contexto | None = None,
                      previa_t: float | None = None, sobrescrever: dict | None = None) -> formatos.Montagem:
    """Monta tudo o que entra no vídeo (legenda, gancho, logo, música, intro/outro).

    previa_t: instante (relativo ao corte) para uma prévia de um quadro; sobrescrever: valores ainda
    não salvos vindos da tela (crop_x, layout, gancho) para a prévia ao vivo.
    """
    sobrescrever = sobrescrever or {}
    pasta.mkdir(parents=True, exist_ok=True)
    m = marca.ler()
    previa = previa_t is not None
    proxy = media.proxy_de(p["id"])
    rapida = previa and proxy.is_file()
    info = media.analisar_rapido(p["caminho_original"])
    layout = marca.validar_layout(sobrescrever["layout"]) if sobrescrever.get("layout") else layout_do_projeto(p, m)
    ow, oh = formatos.tamanho_saida(fmt, p["largura"], p["altura"])
    duracao = c["fim"] - c["inicio"]
    mt = formatos.Montagem(
        origem=str(proxy) if rapida else p["caminho_original"], fonte_reduzida=rapida, inicio=c["inicio"] + (previa_t or 0), duracao=duracao, fmt=fmt,
        largura=p["largura"], altura=p["altura"], fps=p["fps"] or 30, tem_audio=info["tem_audio"],
        crop_x=float(sobrescrever.get("crop_x", c["crop_x"] if c.get("crop_x") is not None else 0.5)),
        layout=layout,
    )

    if c["com_legenda"]:
        palavras = palavras_do_corte(c)
        if palavras is None and not previa:
            raise RuntimeError("A transcrição deste projeto ainda não terminou. Aguarde ou desligue a legenda "
                               "deste corte.")
        estilo = formatos.posicao_legenda(fmt, layout, legendas.obter_estilo(c["estilo"]))
        if previa:
            img, y = legendas.camada_em(palavras or [], estilo, ow, oh, previa_t)
            img.save(pasta / "legenda.png")
            mt.legenda = (pasta / "legenda.png", y)
        else:
            if ctx:
                ctx.progresso(0, "Desenhando a legenda", forcar=True)
            lista, faixa = legendas.gerar_quadros(palavras, estilo, ow, oh, duracao, pasta / "legenda",
                                                  (lambda f: ctx.progresso(0.25 * f)) if ctx else None)
            mt.legenda = (lista, faixa.y_video)
            (pasta / "legenda.srt").write_text(legendas.gerar_srt(palavras, estilo, duracao), encoding="utf-8")

    rec = marca.recursos_do_corte({**c, **({"recursos": sobrescrever["recursos"]} if "recursos" in sobrescrever
                                           else {})}, m)
    caixa_logo = None
    if rec["logo"]:
        logo = marca.imagem_logo(m, ow)
        logo.save(pasta / "logo.png")
        lx, ly = marca.posicao_logo(m, logo, ow, oh)
        mt.logo = (pasta / "logo.png", lx, ly)
        caixa_logo = (ly, ly + logo.height)

    texto_gancho = sobrescrever.get("gancho", c.get("gancho")) or ""
    if texto_gancho.strip():
        img, y = marca.imagem_gancho(texto_gancho, m, ow, oh)
        if caixa_logo and y < caixa_logo[1] and y + img.height > caixa_logo[0]:
            # o gancho encostaria no logo: desce (logo em cima) ou sobe (logo embaixo)
            margem = round(min(ow, oh) * 0.015)
            y = caixa_logo[1] + margem if caixa_logo[0] < oh / 2 else caixa_logo[0] - img.height - margem
            y = max(0, min(oh - img.height, y))
        img.save(pasta / "gancho.png")
        if not previa or not m["gancho"]["duracao"] or previa_t < m["gancho"]["duracao"]:
            mt.gancho = (pasta / "gancho.png", y, m["gancho"]["duracao"])
    if not previa:
        if rec["musica"]:
            mt.musica = (m["musica"]["arquivo"], m["musica"]["volume"], m["musica"]["abaixar_na_fala"])
        for k in ("intro", "outro"):
            if rec[k]:
                ix = media.analisar(m[k]["arquivo"])
                setattr(mt, k, formatos.Extra(m[k]["arquivo"], ix["duracao"], ix["tem_audio"]))
    return mt


def palavras_do_corte(c: dict) -> list[tuple[float, float, str]] | None:
    """Palavras do corte com tempo relativo ao início dele.

    Usa a legenda editada no corte, se houver; senão, a transcrição. None = sem transcrição ainda.
    """
    if c.get("legenda"):
        todas = [tuple(w) for w in json.loads(c["legenda"])]
    else:
        arq = transcricao.caminho(c["projeto_id"])
        if not arq.exists():
            return None
        dados = json.loads(arq.read_text(encoding="utf-8"))
        if dados.get("parcial") and dados.get("segmentos") and dados["segmentos"][-1]["fim"] < c["fim"]:
            return None  # a transcrição ainda não chegou no fim deste corte
        todas = [(w[0], w[1], w[2]) for s in dados.get("segmentos", []) for w in s["palavras"]]
    dur = c["fim"] - c["inicio"]
    res = []
    for ini, fim, txt in todas:
        if fim <= c["inicio"] or ini >= c["fim"]:
            continue
        res.append((round(max(0.0, ini - c["inicio"]), 3), round(min(dur, fim - c["inicio"]), 3), str(txt)))
    return res
