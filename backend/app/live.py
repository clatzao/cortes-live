"""Monitor de live: grava a transmissão sem recodificar, transcreve em blocos e cria cortes durante a live.

Fluxo (replica/architecture.md, marco 1):
  live_gravar    (faixa "live")    espera o canal ficar online, grava partes .ts, pede análises
  live_analisar  (faixa "pesada")  transcreve o trecho novo, acha momentos e cria os cortes
  live_finalizar (faixa "geral")   junta as partes num .mp4 e transforma a live num projeto normal

A linha do tempo da live é a soma das partes: se a transmissão cai e volta, a parte nova começa
onde a anterior terminou (o tempo em que ficou fora do ar não existe na gravação).
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import requests

from . import ajustes, config, cortes, db, jobs, legendas, media, transcricao, viral
from .jobs import Cancelado, Contexto
from .tempo import formatar

ESPERA_OFFLINE = 60      # s entre consultas enquanto o canal está offline
ESPERA_RECONEXAO = 20    # s entre consultas depois de uma queda
LIMITE_RECONEXAO = 300   # s fora do ar até considerar que a live acabou
MARGEM = 5               # s do fim que ainda não são analisados (podem estar chegando)
MINIMO_NOVO = 20         # s de áudio novo para valer uma análise
CONTEXTO = 600           # o Gemini lê os últimos 10 min para achar momentos
POR_ANALISE = 2          # momentos pedidos por análise
NOTA_MINIMA = 60         # nota mínima do Gemini para virar corte sozinho
ENERGIA_MINIMA = 35      # sem Gemini: só trechos com bastante volume viram corte
SOBREPOSICAO = 0.5       # momento que repete mais da metade de um anterior é descartado
SEM_CORTE_MAX = 480      # sem Gemini: após 8 min de live sem corte, o melhor trecho com fala vira corte
FALA_MINIMA_GARANTIA = 0.6  # ...desde que tenha fala em pelo menos 60% do tempo


def _energia_local(projeto_id: int, energia, de: int, ate: int):
    """Energia do trecho [de, ate) medida contra o próprio trecho, a partir do volume bruto (ondas.json).

    A energia normal compara com a live toda: depois de um começo barulhento, um trecho calmo chega todo zerado.
    """
    saida = energia.copy()
    try:
        ondas = json.loads((config.PROJETOS / str(projeto_id) / "ondas.json").read_text())
        rms = np.asarray(ondas["rms"], dtype=np.float32)
        taxa = int(ondas["taxa"])
    except (OSError, ValueError, KeyError):
        return saida
    usavel = len(rms) // taxa * taxa
    por_s = rms[:usavel].reshape(-1, taxa).mean(axis=1) if usavel else np.zeros(0, dtype=np.float32)
    trecho = por_s[de:min(ate, len(por_s))]
    if len(trecho) < 10:
        return saida
    mediana = float(np.median(trecho))
    mad = float(np.median(np.abs(trecho - mediana))) * 1.4826 + 1e-3
    fim = de + len(trecho)
    saida[de:fim] = np.clip((trecho - mediana) / mad, 0, 8)[: len(saida[de:fim])]
    return saida

# abaixo disso a gravação para sozinha (o que já foi gravado vira projeto); a variável serve para testes
DISCO_MINIMO_GB = float(os.environ.get("CORTES_DISCO_MINIMO_GB") or 2)
ATIVOS = ("aguardando", "gravando", "reconectando", "finalizando")
_OFFLINE = re.compile(r"not (currently )?live|is offline|offline|will begin|has not started|"
                      r"no video formats|live event|premieres in|is not live", re.IGNORECASE)
_SEM_COR = re.compile(r"\x1b\[[0-9;]*m")
_NAO_EXISTE = re.compile(r"does not exist|channel not found|user not found|HTTP Error 404", re.IGNORECASE)
_modelo_gemini: dict[str, str] = {}


# ---------------------------------------------------------------- endereço do canal

def normalizar(entrada: str) -> tuple[str, str, str]:
    """(plataforma, canal, url) a partir de um link ou só do nome do canal (nome sozinho = Twitch)."""
    e = entrada.strip().strip('"').strip()
    if not e:
        raise ValueError("Cole o link ou o nome do canal.")
    if not re.match(r"^https?://", e, re.IGNORECASE):
        if re.match(r"^(www\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be|m\.youtube\.com)/", e, re.IGNORECASE):
            e = "https://" + e
        elif e.startswith("@"):
            return "youtube", e, f"https://www.youtube.com/{e}/live"
        elif re.fullmatch(r"[A-Za-z0-9_]{2,25}", e):
            return "twitch", e.lower(), f"https://www.twitch.tv/{e.lower()}"
        else:
            raise ValueError("Não reconheci esse canal. Cole o link da Twitch, Kick ou YouTube.")
    m = re.match(r"^https?://(?:www\.|m\.)?twitch\.tv/([A-Za-z0-9_]+)/?(?:[?#].*)?$", e, re.IGNORECASE)
    if m:
        canal = m.group(1).lower()
        if canal in ("videos", "directory", "settings"):
            raise ValueError("Esse link não é de um canal. Cole o link do canal (twitch.tv/nome).")
        return "twitch", canal, f"https://www.twitch.tv/{canal}"
    m = re.match(r"^https?://(?:www\.)?kick\.com/([A-Za-z0-9_-]+)/?(?:[?#].*)?$", e, re.IGNORECASE)
    if m:
        canal = m.group(1).lower()
        return "kick", canal, f"https://kick.com/{canal}"
    m = re.match(r"^https?://(?:www\.|m\.)?youtube\.com/(@[A-Za-z0-9._-]+|channel/[A-Za-z0-9_-]+|c/[A-Za-z0-9._-]+)"
                 r"(?:/live|/streams|/featured)?/?(?:[?#].*)?$", e, re.IGNORECASE)
    if m:
        return "youtube", m.group(1).split("/")[-1], f"https://www.youtube.com/{m.group(1)}/live"
    m = re.match(r"^https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|live/)|youtu\.be/)([A-Za-z0-9_-]{6,})", e,
                 re.IGNORECASE)
    if m:
        return "youtube", m.group(1), f"https://www.youtube.com/watch?v={m.group(1)}"
    raise ValueError("Esse link não é de um canal da Twitch, Kick ou YouTube.")


# ---------------------------------------------------------------- acesso ao banco

def obter(live_id: int) -> dict | None:
    return db.um("SELECT * FROM lives WHERE id=?", (live_id,))


def _atualizar(live_id: int, **campos) -> None:
    campos["atualizado_em"] = db.agora()
    sets = ", ".join(f"{k}=?" for k in campos)
    db.executar(f"UPDATE lives SET {sets} WHERE id=?", (*campos.values(), live_id))


def partes(live_id: int) -> list[dict]:
    return db.listar("SELECT * FROM live_partes WHERE live_id=? ORDER BY ordem", (live_id,))


def pasta(live: dict) -> Path:
    p = config.PROJETOS / str(live["projeto_id"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def _deve_parar(live_id: int, ctx: Contexto) -> bool:
    v = obter(live_id)
    return not v or bool(v["parar"]) or ctx.cancelado()


def _dormir(live_id: int, ctx: Contexto, segundos: float) -> None:
    fim = time.time() + segundos
    while time.time() < fim:
        if _deve_parar(live_id, ctx):
            return
        time.sleep(1)


def analise_pendente(live_id: int) -> bool:
    return db.um("SELECT id FROM jobs WHERE tipo='live_analisar' AND status IN ('na_fila','executando') "
                 "AND (params LIKE ? OR params LIKE ?)",
                 (f'%"live_id": {live_id}}}%', f'%"live_id": {live_id},%')) is not None


# ---------------------------------------------------------------- consulta e gravação

def _opcoes_ytdlp() -> dict:
    # "b" = áudio e vídeo juntos; as lives do YouTube só têm separados ("bv*+ba"), que o streamlink junta ao gravar
    opcoes: dict = {"quiet": True, "no_warnings": True, "noplaylist": True, "format": "b/bv*+ba/best"}
    qualidade = ajustes.ler()["download_qualidade"]
    if qualidade != "melhor":
        opcoes["format_sort"] = [f"res:{qualidade}", "fps", "vcodec:h264"]
    runtimes = {n: {"path": c} for n in ("deno", "node", "bun") if (c := shutil.which(n))}
    if runtimes:
        opcoes["js_runtimes"] = runtimes  # o YouTube exige um runtime JavaScript
    return opcoes


def consultar(url: str) -> dict | None:
    """Informações da transmissão, ou None se o canal está offline. Erros que não são 'offline' sobem."""
    import yt_dlp

    try:
        with yt_dlp.YoutubeDL(_opcoes_ytdlp()) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        msg = _SEM_COR.sub("", str(e))
        if _OFFLINE.search(msg):
            return None
        if _NAO_EXISTE.search(msg):
            raise RuntimeError("Esse canal não existe. Confira o nome ou o link.") from e
        raise RuntimeError(f"Não consegui abrir o canal: {msg}") from e
    if info.get("_type") == "playlist" or not info.get("is_live") and info.get("live_status") != "is_live":
        return None
    if not info.get("url") and not info.get("requested_formats"):
        raise RuntimeError("A live está no ar, mas não encontrei um endereço de vídeo para gravar.")
    return info


def _cmd_streamlink(url: str) -> list[str]:
    """Comando do streamlink (Twitch e YouTube), na qualidade escolhida em Ajustes (sem passar do limite)."""
    cmd = [sys.executable, "-m", "streamlink", "--stdout", "--loglevel", "warning"]
    if config.FFMPEG:
        cmd += ["--ffmpeg-ffmpeg", str(config.FFMPEG)]  # o YouTube manda áudio e vídeo separados: o streamlink junta
    qualidade = ajustes.ler()["download_qualidade"]
    if qualidade != "melhor":
        cmd += ["--stream-sorting-excludes", f">{qualidade}p"]
    return cmd + [url, "best"]


def _gravar_parte(live_id: int, info: dict, ctx: Contexto) -> None:
    """Grava uma parte até a transmissão cair ou até pedirem para parar."""
    live = obter(live_id)
    anteriores = partes(live_id)
    ordem = len(anteriores) + 1
    deslocamento = sum(p["duracao_s"] for p in anteriores)
    arquivo = pasta(live) / f"parte_{ordem}.ts"
    parte_id = db.executar("INSERT INTO live_partes (live_id, ordem, caminho, deslocamento_s, criado_em) "
                           "VALUES (?,?,?,?,?)", (live_id, ordem, str(arquivo), deslocamento, db.agora()))
    if ordem == 1:
        db.executar("UPDATE projetos SET caminho_original=? WHERE id=?", (str(arquivo), live["projeto_id"]))
    _atualizar(live_id, status="gravando")  # o canal está no ar: a tela já mostra "ao vivo" enquanto conecta
    titulo = (info.get("description") if live["plataforma"] == "twitch" else None) or info.get("title")
    if titulo:
        _atualizar(live_id, titulo=str(titulo)[:200])

    fonte: subprocess.Popen | None = None  # streamlink (só Twitch), que entrega o vídeo ao FFmpeg pelo pipe
    if live["plataforma"] in ("twitch", "youtube"):
        # Twitch: o streamlink descarta os anúncios que a Twitch mistura na live (sem login, a Twitch troca o
        # conteúdo pela tela de intervalo comercial). YouTube: as lives vêm com áudio e vídeo separados e o
        # streamlink junta os dois. Kick vai direto pelo FFmpeg com o endereço do yt-dlp.
        alvo = live["url"] if live["plataforma"] == "twitch" else (info.get("webpage_url") or live["url"])
        fonte = subprocess.Popen(_cmd_streamlink(alvo), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, creationflags=config.SEM_JANELA)
        entrada = ["-f", "mpegts", "-i", "pipe:0"]
    else:
        cabecalhos = "".join(f"{k}: {v}\r\n" for k, v in (info.get("http_headers") or {}).items())
        entrada = (["-headers", cabecalhos] if cabecalhos else []) + [
            "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10", "-i", info["url"]]
    cmd = [config.FFMPEG, "-hide_banner", "-loglevel", "error", *entrada,
           "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-f", "mpegts",
           "-progress", "pipe:1", "-nostats", "-y", str(arquivo)]
    proc = subprocess.Popen(cmd, stdin=fonte.stdout if fonte else subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, creationflags=config.SEM_JANELA)
    if fonte:
        fonte.stdout.close()  # o FFmpeg é o único leitor: se ele fechar, o streamlink para sozinho
    estado = {"dur": 0.0}
    erros: list[str] = []

    def ler_progresso() -> None:
        for linha in proc.stdout:
            t = linha.decode("utf-8", "ignore").strip()
            if t.startswith("out_time_us=") and t[12:].isdigit():
                estado["dur"] = int(t[12:]) / 1_000_000

    def ler_erros() -> None:
        for linha in proc.stderr:
            erros.append(linha.decode("utf-8", "ignore").strip())
            del erros[:-20]

    def ler_erros_fonte() -> None:
        for linha in fonte.stderr:
            t = linha.decode("utf-8", "ignore").strip()
            if t:
                erros.append("streamlink: " + t)
                del erros[:-20]

    threading.Thread(target=ler_progresso, daemon=True).start()
    threading.Thread(target=ler_erros, daemon=True).start()
    if fonte:
        threading.Thread(target=ler_erros_fonte, daemon=True).start()

    medido = False
    try:
        while proc.poll() is None:
            time.sleep(1)
            dur = estado["dur"]
            if dur > 0:
                db.executar("UPDATE live_partes SET duracao_s=? WHERE id=?", (dur, parte_id))
                atual = obter(live_id)
                campos = {"gravado_s": deslocamento + dur}
                if atual["status"] != "gravando":
                    campos["status"] = "gravando"
                if not atual["iniciada_em"]:
                    campos["iniciada_em"] = db.agora()
                _atualizar(live_id, **campos)
                if not medido and dur > 4 and ordem == 1:
                    medido = _medir_video(live["projeto_id"], arquivo)
                if (deslocamento + dur) - atual["analisado_ate"] >= atual["janela_s"] and not analise_pendente(live_id):
                    jobs.enfileirar("live_analisar", projeto_id=live["projeto_id"], params={"live_id": live_id},
                                    mensagem="Aguardando para analisar o trecho novo")
            if disco_livre_gb() < DISCO_MINIMO_GB and not obter(live_id)["parar"]:
                _atualizar(live_id, parar=1, erro=f"Gravação parada: menos de {DISCO_MINIMO_GB:g} GB livres no disco.")
            if _deve_parar(live_id, ctx):
                if fonte:  # sem dados novos o FFmpeg fecha o arquivo direito sozinho
                    media.encerrar(fonte)
                else:
                    try:
                        proc.stdin.write(b"q")  # pede para o FFmpeg fechar o arquivo direito
                        proc.stdin.flush()
                    except OSError:
                        pass
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
                break
    finally:
        media.encerrar(proc)
        if fonte:
            media.encerrar(fonte)
        if estado["dur"] > 0:
            db.executar("UPDATE live_partes SET duracao_s=? WHERE id=?", (estado["dur"], parte_id))
            _atualizar(live_id, gravado_s=deslocamento + estado["dur"])
    if estado["dur"] <= 0:  # nada gravado nesta tentativa: a parte vazia não entra na linha do tempo
        db.executar("DELETE FROM live_partes WHERE id=?", (parte_id,))
        media.apagar_arquivo(arquivo)
        if erros and not _deve_parar(live_id, ctx):
            raise RuntimeError("A gravação não começou: " + " | ".join(erros[-3:]))


def _medir_video(projeto_id: int, arquivo: Path) -> bool:
    try:
        info = media.analisar(str(arquivo))
    except Exception:  # noqa: BLE001 - o arquivo ainda pode estar curto demais; tenta de novo depois
        return False
    db.executar("UPDATE projetos SET largura=?, altura=?, fps=? WHERE id=?",
                (info["largura"], info["altura"], info["fps"], projeto_id))
    return True


def _falha_gravar(job: dict, msg: str) -> None:
    lid = json.loads(job["params"] or "{}").get("live_id")
    if not lid:
        return
    if partes(lid):  # já tinha gravado alguma coisa: aproveita o que existe
        _atualizar(lid, erro=msg[-500:])
        jobs.enfileirar("live_finalizar", projeto_id=job["projeto_id"], params={"live_id": lid})
    else:
        _atualizar(lid, status="erro", erro=msg[-500:], encerrada_em=db.agora())
        db.executar("UPDATE projetos SET status='erro', erro=? WHERE id=?", (msg[-1000:], job["projeto_id"]))


LIVES_SIMULTANEAS = 4  # gravar é quase só rede e disco (sem recodificar): várias lives cabem ao mesmo tempo


@jobs.registrar("live_gravar", _falha_gravar, faixa="live", trabalhadores=LIVES_SIMULTANEAS)
def gravar(ctx: Contexto) -> str:
    lid = ctx.params["live_id"]
    live = obter(lid)
    if not live:
        raise RuntimeError("O monitor desta live foi removido.")
    caiu_em: float | None = None
    primeira = True
    while not _deve_parar(lid, ctx):
        ctx.progresso(0, "Consultando o canal", forcar=True)
        try:
            info = consultar(live["url"])
        except RuntimeError:
            if primeira:
                raise  # canal inexistente ou link errado: avisa logo
            info = None  # falha passageira de rede no meio da live: trata como queda
        primeira = False
        if info is None:
            if partes(lid):
                caiu_em = caiu_em or time.time()
                if time.time() - caiu_em > LIMITE_RECONEXAO:
                    break  # ficou fora do ar tempo demais: a live acabou
                _atualizar(lid, status="reconectando")
                ctx.progresso(0, "A transmissão caiu. Tentando voltar a gravar", forcar=True)
                _dormir(lid, ctx, ESPERA_RECONEXAO)
            else:
                _atualizar(lid, status="aguardando")
                ctx.progresso(0, "Esperando o canal entrar ao vivo", forcar=True)
                _dormir(lid, ctx, ESPERA_OFFLINE)
            continue
        caiu_em = None
        ctx.progresso(0, "Gravando a live", forcar=True)
        _gravar_parte(lid, info, ctx)
    if ctx.cancelado():
        raise Cancelado()
    jobs.enfileirar("live_finalizar", projeto_id=live["projeto_id"], params={"live_id": lid},
                    mensagem="Aguardando para finalizar a live")
    v = obter(lid)
    return f"Gravação encerrada: {formatar(v['gravado_s'])[:8]} gravados."


# ---------------------------------------------------------------- análise em blocos

def _audio_do_trecho(live: dict, de: float, ate: float, destino: Path, ctx: Contexto) -> np.ndarray:
    """Áudio 16 kHz mono de [de, ate] na linha do tempo da live (de uma ou várias partes, ou do .mp4 final)."""
    p = db.um("SELECT caminho_original FROM projetos WHERE id=?", (live["projeto_id"],)) or {}
    final = p.get("caminho_original") or ""
    if live["status"] in ("finalizando", "encerrada") and final.endswith(".mp4") and Path(final).is_file():
        fontes = [(final, 0.0, float("inf"))]
    else:
        fontes = [(x["caminho"], x["deslocamento_s"], x["deslocamento_s"] + x["duracao_s"]) for x in partes(live["id"])]
    pedacos = []
    for caminho, ini, fim in fontes:
        a, b = max(de, ini), min(ate, fim)
        if b - a < 0.5 or not Path(caminho).is_file():
            continue
        media.rodar_ffmpeg(["-ss", f"{a - ini:.3f}", "-i", caminho, "-t", f"{b - a:.3f}", "-map", "0:a:0", "-vn",
                            "-ac", "1", "-ar", str(transcricao.TAXA), "-f", "s16le", str(destino)],
                           b - a, ctx, 0.0, 0.05, "Lendo o áudio do trecho novo")
        bruto = np.fromfile(destino, dtype=np.int16)
        media.apagar_arquivo(destino)
        esperado = int(round((b - a) * transcricao.TAXA))
        bruto = bruto[:esperado] if len(bruto) >= esperado else np.pad(bruto, (0, esperado - len(bruto)))
        pedacos.append(bruto.astype(np.float32) / 32768.0)
    if not pedacos:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(pedacos)


def _acrescentar_ondas(projeto_id: int, de: float, audio: np.ndarray) -> None:
    """Pico e volume a cada 0,1 s do trecho novo, no ondas.json do projeto (timeline e detecção de momentos)."""
    arq = config.PROJETOS / str(projeto_id) / "ondas.json"
    try:
        dados = json.loads(arq.read_text())
    except (OSError, ValueError):
        dados = {"taxa": media.TAXA_ONDAS, "picos": [], "rms": []}
    bloco = transcricao.TAXA // media.TAXA_ONDAS
    usavel = len(audio) // bloco * bloco
    f = audio[:usavel].reshape(-1, bloco) if usavel else np.zeros((0, bloco), dtype=np.float32)
    inicio = int(round(de * media.TAXA_ONDAS))
    for chave, valores in (("picos", np.abs(f).max(axis=1) if len(f) else []),
                           ("rms", np.sqrt((f * f).mean(axis=1)) if len(f) else [])):
        lista = dados[chave][:inicio]
        lista += [0] * (inicio - len(lista))
        lista += np.round(np.asarray(valores) * 100).astype(int).tolist()
        dados[chave] = lista
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados))
    tmp.replace(arq)


def _transcrever(p: dict, de: float, audio: np.ndarray, ctx: Contexto, final: bool) -> int:
    """Transcreve o trecho e acrescenta à transcrição do projeto. Devolve quantas frases novas."""
    modelo, _chave = transcricao._carregar(ctx)
    parametros: dict = {"word_timestamps": True, "vad_filter": True,
                        "vad_parameters": {"min_silence_duration_ms": 500},
                        "condition_on_previous_text": False, "beam_size": 1}
    if p["idioma"] == "misto":
        parametros["multilingual"] = True
    else:
        parametros["language"] = p["idioma"]
    novos: list[dict] = []
    if len(audio) > transcricao.TAXA:
        segs, _ = modelo.transcribe(audio, **parametros)
        transcricao._juntar(segs, de, novos, ctx, de + len(audio) / transcricao.TAXA, time.time())
    arq = transcricao.caminho(p["id"])
    with transcricao.FIM:
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            dados = {"parcial": True, "idioma": p["idioma"], "modelo": "", "dispositivo": "", "compute_type": "",
                     "duracao": 0, "segmentos": []}
        dados["segmentos"] = [s for s in dados["segmentos"] if s["inicio"] < de] + novos
        dados["duracao"] = de + len(audio) / transcricao.TAXA
        dados["parcial"] = not final
        transcricao._salvar(arq, dados)
    return len(novos)


def _sobrepoe(a: tuple[float, float], b: tuple[float, float]) -> bool:
    inter = min(a[1], b[1]) - max(a[0], b[0])
    return inter > SOBREPOSICAO * min(a[1] - a[0], b[1] - b[0])


def _momentos(p: dict, live: dict, de: float, ate: float, ctx: Contexto) -> tuple[int, str]:
    """Acha momentos nos últimos minutos e já cria os cortes. Devolve (cortes criados, de onde vieram)."""
    arq = transcricao.caminho(p["id"])
    segmentos = [s for s in json.loads(arq.read_text(encoding="utf-8")).get("segmentos", []) if s.get("texto")]
    janela_de = max(0.0, ate - CONTEXTO)
    no_contexto = [s for s in segmentos if s["fim"] > janela_de]
    if sum(s["fim"] - s["inicio"] for s in no_contexto) < 15:
        return 0, "pouca fala"
    aj = ajustes.ler()
    mn, mx = int(aj["viral_min"]), max(int(aj["viral_min"]), int(aj["viral_max"]))
    palavras = sorted((w for s in segmentos for w in s.get("palavras", [])), key=lambda w: w[0])
    energia = viral._energia_por_segundo(p["id"], ate)
    marc, fala = viral._palavras_por_segundo(segmentos, ate, set(legendas.ler_dicionarios()["palavras_chave"]))

    candidatos: list[dict] = []
    origem = "sinais"
    chave = aj["gemini_chave"]
    if chave:
        try:
            if chave not in _modelo_gemini:
                _modelo_gemini[chave] = viral.escolher_modelo(viral.listar_modelos(chave), aj["gemini_modelo"])
            linhas = [f"[{formatar(s['inicio'])[:8]}] {s['texto']}" for s in no_contexto]
            picos = [x for x in viral.picos_de_volume(energia) if janela_de <= x <= ate]
            prompt = viral.montar_prompt(linhas, janela_de, ate, picos, POR_ANALISE, mn, mx)
            for item in viral.gerar(chave, _modelo_gemini[chave], prompt, ctx, tentativas=2):
                ini, fim = viral._tempo(item.get("inicio")), viral._tempo(item.get("fim"))
                nota = int(min(100, max(0, int(item.get("nota") or 0))))
                if ini is None or fim is None or fim <= ini or nota < NOTA_MINIMA:
                    continue
                candidatos.append({"inicio": ini, "fim": fim, "nota": nota,
                                   "motivo": str(item.get("motivo") or "")[:300],
                                   "nome": str(item.get("nome") or "")[:80],
                                   "gancho": str(item.get("gancho") or "")[:120]})
            origem = "gemini"
        except Cancelado:
            raise
        except (viral.ErroGemini, requests.RequestException):
            candidatos = []  # cota do dia ou rede: segue só com volume e palavras
    garantir = False
    if origem == "sinais":
        i0 = int(janela_de)
        # volume comparado com o próprio trecho (não com a live toda): numa live de volume constante o momento
        # mais agitado dos últimos minutos ainda se destaca
        energia = _energia_local(p["id"], energia, i0, int(ate) + 1)
        achados = viral.sugestoes_por_sinais(energia[i0:int(ate) + 1], marc[i0:int(ate) + 1],
                                             fala[i0:int(ate) + 1], mn, mx, POR_ANALISE)
        candidatos = [{**c, "inicio": c["inicio"] + i0, "fim": c["fim"] + i0} for c in achados]
        # garantia: muito tempo sem corte numa live com fala → o melhor trecho com fala vira corte mesmo sem pico
        ultimo = db.um("SELECT MAX(fim) AS f FROM sugestoes WHERE projeto_id=?", (p["id"],))["f"] or 0.0
        garantir = ate - ultimo >= SEM_CORTE_MAX

    existentes = [(s["inicio"], s["fim"]) for s in
                  db.listar("SELECT inicio, fim FROM sugestoes WHERE projeto_id=?", (p["id"],))]
    criados = 0
    for c in candidatos:
        ini, fim = viral.ajustar_limites(c["inicio"], c["fim"], segmentos, palavras, ate, mn, mx)
        if fim - ini < min(mn, 5) or fim <= de - mx:  # curto demais, ou só repete o que já foi analisado
            continue
        if any(_sobrepoe((ini, fim), e) for e in existentes):
            continue
        trecho = energia[int(ini):int(fim) + 1]
        energia_pct = int(min(100, round(float(trecho.mean()) / 4 * 100))) if len(trecho) else 0
        if origem == "sinais" and energia_pct < ENERGIA_MINIMA:
            falado = float(fala[int(ini):int(fim) + 1].mean()) if fim > ini else 0.0
            if not (garantir and falado >= FALA_MINIMA_GARANTIA):
                continue
            garantir = False  # um corte de garantia por análise
            c = {**c, "motivo": "O trecho com mais fala e reação dos últimos minutos (escolhido sem o Gemini, "
                                "por volume, risadas e palavras)."}
        nome = c.get("nome") or f"Momento {formatar(ini)[:8]}"
        sid = db.executar("INSERT INTO sugestoes (projeto_id, inicio, fim, nota, energia, motivo, nome, gancho, "
                          "origem, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (p["id"], ini, fim, c["nota"], energia_pct, c.get("motivo"), nome, c.get("gancho") or "",
                           origem, db.agora()))
        cid = cortes.aceitar_sugestao(db.um("SELECT * FROM sugestoes WHERE id=?", (sid,)), ate)
        if cid:
            db.executar("UPDATE cortes SET origem='live' WHERE id=?", (cid,))
            criados += 1
        existentes.append((ini, fim))
    return criados, origem


@jobs.registrar("live_analisar", faixa="pesada")
def analisar(ctx: Contexto) -> str:
    lid = ctx.params["live_id"]
    final = bool(ctx.params.get("final"))
    live = obter(lid)
    if not live:
        raise RuntimeError("O monitor desta live foi removido.")
    p = db.um("SELECT * FROM projetos WHERE id=?", (live["projeto_id"],))
    if not p:
        raise RuntimeError("O projeto da live foi removido.")
    de = live["analisado_ate"]
    ate = live["gravado_s"] - (0 if final else MARGEM)
    if ate - de < (1 if final else MINIMO_NOVO):
        if final:
            _fechar_transcricao(p["id"])
        return "Pouco áudio novo para analisar."

    temporario = pasta(live) / f"live_audio_{ctx.id}.raw"
    audio = _audio_do_trecho(live, de, ate, temporario, ctx)
    ate = de + len(audio) / transcricao.TAXA  # o que realmente foi lido
    ctx.progresso(0.1, f"Transcrevendo {formatar(de)[:8]} a {formatar(ate)[:8]}", forcar=True)
    _acrescentar_ondas(p["id"], de, audio)
    frases = _transcrever(p, de, audio, ctx, final)
    del audio
    _atualizar(lid, analisado_ate=ate)
    ctx.progresso(0.85, "Procurando momentos", forcar=True)
    criados, origem = _momentos(p, live, de, ate, ctx)
    total = db.um("SELECT COUNT(*) AS n FROM cortes WHERE projeto_id=? AND origem='live'", (p["id"],))["n"]
    fonte = {"gemini": "Gemini", "sinais": "volume e palavras", "pouca fala": "pouca fala no trecho"}[origem]
    resumo = (f"{formatar(de)[:8]}–{formatar(ate)[:8]}: {frases} frase(s), "
              f"{criados} corte(s) novo(s) ({fonte}).")
    _atualizar(lid, cortes_criados=total, ultima_analise=resumo)
    if final:
        _fechar_transcricao(p["id"])
    return resumo


def _fechar_transcricao(projeto_id: int) -> None:
    arq = transcricao.caminho(projeto_id)
    with transcricao.FIM:
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        dados["parcial"] = False
        transcricao._salvar(arq, dados)


# ---------------------------------------------------------------- fim da live

def _falha_finalizar(job: dict, msg: str) -> None:
    lid = json.loads(job["params"] or "{}").get("live_id")
    if lid:
        _atualizar(lid, status="erro", erro=f"Falha ao finalizar: {msg[-400:]}", encerrada_em=db.agora())
    db.executar("UPDATE projetos SET status='erro', erro=? WHERE id=?", (msg[-1000:], job["projeto_id"]))


@jobs.registrar("live_finalizar", _falha_finalizar, faixa="geral")
def finalizar(ctx: Contexto) -> str:
    lid = ctx.params["live_id"]
    live = obter(lid)
    if not live:
        raise RuntimeError("O monitor desta live foi removido.")
    lista = [x for x in partes(lid) if x["duracao_s"] > 0 and Path(x["caminho"]).is_file()]
    if not lista:
        _atualizar(lid, status="encerrada", encerrada_em=db.agora())
        db.executar("UPDATE projetos SET status='erro', erro=? WHERE id=?",
                    ("O canal não entrou ao vivo enquanto o monitor estava ligado.", live["projeto_id"]))
        return "Nada foi gravado."
    _atualizar(lid, status="finalizando")
    dir_ = pasta(live)
    destino = dir_ / "original.mp4"
    parcial = dir_ / "original.parcial.mp4"
    total = sum(x["duracao_s"] for x in lista)
    try:
        if len(lista) == 1:
            entrada = ["-i", lista[0]["caminho"]]
        else:
            indice = dir_ / "partes.txt"
            indice.write_text("".join(f"file '{Path(x['caminho']).as_posix()}'\n" for x in lista), encoding="utf-8")
            entrada = ["-f", "concat", "-safe", "0", "-i", str(indice)]
        media.rodar_ffmpeg([*entrada, "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
                            "-movflags", "+faststart", str(parcial)], total, ctx, 0.0, 0.2, "Juntando a gravação")
        parcial.replace(destino)
    finally:
        media.apagar_arquivo(parcial)
        media.apagar_arquivo(dir_ / "partes.txt")

    info = media.analisar(str(destino))
    db.executar("UPDATE projetos SET caminho_original=?, duracao=?, largura=?, altura=?, fps=? WHERE id=?",
                (str(destino), info["duracao"], info["largura"], info["altura"], info["fps"], live["projeto_id"]))
    _atualizar(lid, status="encerrada", encerrada_em=db.agora(), gravado_s=info["duracao"])
    media.gerar_ondas(str(destino), dir_ / "ondas.json", info, ctx, 0.2, 0.05)
    proxy_parcial = dir_ / "proxy.parcial.mp4"
    try:
        media.gerar_proxy(str(destino), proxy_parcial, info, ctx, 0.25, 0.75)
        proxy_parcial.replace(dir_ / "proxy.mp4")
    finally:
        media.apagar_arquivo(proxy_parcial)
    media.miniaturas_em_segundo_plano(live["projeto_id"], info["duracao"])
    db.executar("UPDATE projetos SET status='pronto', erro=NULL WHERE id=?", (live["projeto_id"],))
    for x in lista:  # o .mp4 final já tem tudo
        media.apagar_arquivo(Path(x["caminho"]))
    # o fim da live (depois da última análise) ainda não foi transcrito: análise final
    jobs.enfileirar("live_analisar", projeto_id=live["projeto_id"], params={"live_id": lid, "final": True},
                    mensagem="Aguardando a análise final da live")
    return f"Live finalizada: {formatar(info['duracao'])[:8]}."


def disco_livre_gb() -> float:
    return shutil.disk_usage(config.PROJETOS).free / 1024 ** 3


def parte_da_live(projeto: dict, inicio: float, fim: float) -> bool:
    """Durante a gravação, um corte só pode ser exportado se estiver inteiro na 1ª parte e já gravado."""
    if not projeto.get("live_id"):
        return False
    lista = partes(projeto["live_id"])
    return bool(lista) and fim <= lista[0]["duracao_s"] - 1 and math.isfinite(inicio)
