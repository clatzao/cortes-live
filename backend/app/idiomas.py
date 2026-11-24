"""Tradução da legenda (Gemini, ou o tradutor local sem chave) e dublagem com vozes prontas (Piper, local).

Tradução: as frases do corte vão para o Gemini numeradas e voltam na mesma ordem (sem chave, cada frase passa
pelo tradutor local, ver traducao_local.py); cada frase mantém o tempo da original. A legenda traduzida reparte o tempo de cada frase entre as palavras.

Dublagem: cada frase traduzida vira fala com a voz escolhida (Piper, ONNX, roda na CPU). Se a fala for
mais longa que o espaço da frase, acelera até ACELERACAO_MAX; o que ainda sobrar invade a pausa seguinte.
O áudio original fica por baixo, mais baixo (ou mudo).
"""
import json
import subprocess
import threading
import wave
from pathlib import Path

import numpy as np
import requests

from . import ajustes, config, db, jobs, media, tarefas, viral
from .jobs import Contexto

BASE_VOZES = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
PASTA_VOZES = config.DADOS / "modelos" / "piper"
ACELERACAO_MAX = 1.3
VOLUME_ORIGINAL = {"abaixar": 0.15, "silenciar": 0.0}
_lock = threading.RLock()  # catalogo() e baixar_voz() são chamados com a trava já presa
_vozes_carregadas: dict[str, object] = {}

# idiomas mais usados em cortes; o Gemini traduz para qualquer um, a voz depende do catálogo do Piper
IDIOMAS = {
    "pt": "Português", "en": "Inglês", "es": "Espanhol", "fr": "Francês", "de": "Alemão", "it": "Italiano",
    "ja": "Japonês", "ko": "Coreano", "zh": "Chinês", "ru": "Russo", "ar": "Árabe", "hi": "Hindi",
    "tr": "Turco", "pl": "Polonês", "nl": "Holandês", "uk": "Ucraniano", "vi": "Vietnamita", "id": "Indonésio",
}


def _criar_tabelas() -> None:
    db.executar("""CREATE TABLE IF NOT EXISTS traducoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        corte_id INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
        idioma TEXT NOT NULL,
        segmentos TEXT NOT NULL DEFAULT '[]',
        editada INTEGER NOT NULL DEFAULT 0,
        criado_em REAL NOT NULL,
        atualizado_em REAL NOT NULL,
        UNIQUE (corte_id, idioma))""")
    db.executar("""CREATE TABLE IF NOT EXISTS dublagens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        corte_id INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
        idioma TEXT NOT NULL,
        voz TEXT NOT NULL,
        audio_original TEXT NOT NULL DEFAULT 'abaixar' CHECK (audio_original IN ('abaixar','silenciar')),
        caminho_audio TEXT,
        criado_em REAL NOT NULL,
        UNIQUE (corte_id, idioma))""")


_criar_tabelas()


# ---------------------------------------------------------------- frases do corte

def frases_do_corte(c: dict) -> list[dict]:
    """Frases do corte com tempo relativo ao início dele: [{inicio, fim, texto}]."""
    palavras = tarefas.palavras_do_corte(c)
    if palavras is None:
        raise RuntimeError("A transcrição deste corte ainda não está pronta.")
    frases: list[dict] = []
    atual: list[tuple[float, float, str]] = []
    for w in palavras:
        if atual and (w[0] - atual[-1][1] > 0.8 or len(atual) >= 14 or atual[-1][2].rstrip().endswith((".", "!", "?"))):
            frases.append({"inicio": atual[0][0], "fim": atual[-1][1], "texto": " ".join(x[2] for x in atual)})
            atual = []
        atual.append(w)
    if atual:
        frases.append({"inicio": atual[0][0], "fim": atual[-1][1], "texto": " ".join(x[2] for x in atual)})
    return frases


def traducao(corte_id: int, idioma: str) -> dict | None:
    t = db.um("SELECT * FROM traducoes WHERE corte_id=? AND idioma=?", (corte_id, idioma))
    if t:
        t = dict(t)
        t["segmentos"] = json.loads(t["segmentos"])
    return t


def palavras_traduzidas(corte_id: int, idioma: str) -> list[tuple[float, float, str]] | None:
    """Palavras da legenda traduzida: o tempo de cada frase é repartido pelas palavras (pelo tamanho)."""
    t = traducao(corte_id, idioma)
    if not t:
        return None
    res = []
    for s in t["segmentos"]:
        ws = s["texto"].split()
        if not ws:
            continue
        total = sum(len(w) + 1 for w in ws)
        ini = s["inicio"]
        for w in ws:
            d = (s["fim"] - s["inicio"]) * (len(w) + 1) / total
            res.append((round(ini, 3), round(ini + d, 3), w))
            ini += d
    return res


# ---------------------------------------------------------------- tradução

ESQUEMA_TRADUCAO = {"type": "ARRAY", "items": {"type": "STRING"}}


def _traduzir_textos(textos: list[str], idioma: str, ctx: Contexto) -> list[str]:
    aj = ajustes.ler()
    if not aj["gemini_chave"]:
        raise RuntimeError("A tradução usa o Gemini. Configure a chave em Ajustes → IA e hardware.")
    modelo = viral.escolher_modelo(viral.listar_modelos(aj["gemini_chave"]), aj["gemini_modelo"])
    nome = IDIOMAS.get(idioma, idioma)
    linhas = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(textos))
    prompt = (f"Traduza para {nome} ({idioma}) as frases numeradas abaixo, de um corte de live para redes sociais. "
              "Mantenha o tom falado e as gírias com equivalentes naturais, frases curtas, sem explicações. "
              f"Devolva uma lista JSON com exatamente {len(textos)} textos, na mesma ordem, sem os números.\n\n{linhas}")
    res = viral.gerar(aj["gemini_chave"], modelo, prompt, ctx, esquema=ESQUEMA_TRADUCAO, temperatura=0.2)
    res = [str(x).strip() for x in res]
    if len(res) != len(textos):
        raise RuntimeError(f"O Gemini devolveu {len(res)} frases para {len(textos)}. Tente de novo.")
    return res


def idioma_falado(projeto_id: int) -> str:
    """Idioma da fala do projeto (o "misto" conta como português, o caso mais comum aqui)."""
    p = db.um("SELECT idioma FROM projetos WHERE id=?", (projeto_id,))
    return p["idioma"] if p and p["idioma"] in IDIOMAS else "pt"


@jobs.registrar("traduzir", faixa="ia")
def traduzir(ctx: Contexto) -> str:
    c = db.um("SELECT * FROM cortes WHERE id=?", (ctx.job["corte_id"],))
    if not c:
        raise RuntimeError("O corte foi removido.")
    idioma = ctx.params["idioma"]
    frases = frases_do_corte(c)
    if not frases:
        raise RuntimeError("Este corte não tem fala para traduzir.")
    ctx.progresso(0.2, f"Traduzindo {len(frases)} frase(s) para {IDIOMAS.get(idioma, idioma)}", forcar=True)
    originais = [f["texto"] for f in frases]
    if ajustes.ler()["gemini_chave"]:
        textos, motor = _traduzir_textos(originais, idioma, ctx), "Gemini"
    else:
        from . import traducao_local
        textos, motor = traducao_local.traduzir(originais, idioma_falado(c["projeto_id"]), idioma, ctx), "tradutor local"
    segs = [{"inicio": round(f["inicio"], 3), "fim": round(f["fim"], 3), "texto": t} for f, t in zip(frases, textos)]
    agora = db.agora()
    db.executar("INSERT INTO traducoes (corte_id, idioma, segmentos, editada, criado_em, atualizado_em) "
                "VALUES (?,?,?,0,?,?) ON CONFLICT(corte_id, idioma) DO UPDATE SET segmentos=excluded.segmentos, "
                "editada=0, atualizado_em=excluded.atualizado_em", (c["id"], idioma, db.json_dump(segs), agora, agora))
    return f"{len(segs)} frase(s) traduzida(s) para {IDIOMAS.get(idioma, idioma)} ({motor})."


# ---------------------------------------------------------------- vozes

def catalogo() -> dict:
    """Catálogo de vozes do Piper (baixado uma vez e guardado)."""
    arq = PASTA_VOZES / "voices.json"
    with _lock:
        if not arq.exists():
            PASTA_VOZES.mkdir(parents=True, exist_ok=True)
            r = requests.get(BASE_VOZES + "voices.json", timeout=60)
            r.raise_for_status()
            arq.write_bytes(r.content)
    return json.loads(arq.read_text(encoding="utf-8"))


def vozes(idioma: str | None = None) -> list[dict]:
    res = []
    for codigo, v in catalogo().items():
        fam = v["language"]["family"]
        if idioma and fam != idioma:
            continue
        arqs = [f for f in v["files"] if f.endswith((".onnx", ".onnx.json"))]
        res.append({"codigo": codigo, "idioma": fam, "regiao": v["language"]["code"],
                    "nome": f'{v["name"]} ({v["language"]["name_native"]}, {v["quality"]})',
                    "qualidade": v["quality"], "tamanho_mb": round(sum(v["files"][f]["size_bytes"] for f in arqs) / 1e6),
                    "baixada": (PASTA_VOZES / f"{codigo}.onnx").is_file()})
    ordem = {"high": 0, "medium": 1, "low": 2, "x_low": 3}
    return sorted(res, key=lambda x: (x["idioma"], ordem.get(x["qualidade"], 9), x["nome"]))


def baixar_voz(codigo: str, ctx: Contexto | None = None) -> Path:
    v = catalogo().get(codigo)
    if not v:
        raise RuntimeError(f"Voz desconhecida: {codigo}")
    destino = PASTA_VOZES / f"{codigo}.onnx"
    if destino.is_file() and destino.with_suffix(".onnx.json").is_file():
        return destino
    for f in [x for x in v["files"] if x.endswith((".onnx", ".onnx.json"))]:
        alvo = PASTA_VOZES / Path(f).name
        parcial = alvo.with_name(alvo.name + ".parcial")
        with requests.get(BASE_VOZES + f, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(parcial, "wb") as out:
                for bloco in r.iter_content(1 << 20):
                    if ctx:
                        ctx.checar()
                    out.write(bloco)
        parcial.replace(alvo)
    return destino


def _voz(codigo: str, ctx: Contexto):
    from piper import PiperVoice

    with _lock:
        if codigo not in _vozes_carregadas:
            ctx.progresso(0.05, "Preparando a voz (na primeira vez ela é baixada)", forcar=True)
            _vozes_carregadas.clear()  # uma voz na memória por vez
            _vozes_carregadas[codigo] = PiperVoice.load(str(baixar_voz(codigo, ctx)))
        return _vozes_carregadas[codigo]


# ---------------------------------------------------------------- dublagem

def _falar(voz, texto: str, destino: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(destino), "wb") as w:
        voz.synthesize_wav(texto, w)
    with wave.open(str(destino)) as w:
        taxa = w.getframerate()
        dados = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return dados, taxa


def _acelerar(dados: np.ndarray, taxa: int, fator: float, pasta: Path) -> np.ndarray:
    """Fala mais rápida sem mudar o tom (atempo do FFmpeg)."""
    ent, sai = pasta / "ace_in.raw", pasta / "ace_out.raw"
    dados.tofile(ent)
    subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(taxa),
                    "-ac", "1", "-i", str(ent), "-filter:a", f"atempo={fator:.3f}", "-f", "s16le", str(sai)],
                   check=True, creationflags=config.SEM_JANELA)
    return np.fromfile(sai, dtype=np.int16)


def caminho_dublagem(corte_id: int, idioma: str) -> Path:
    c = db.um("SELECT projeto_id FROM cortes WHERE id=?", (corte_id,))
    return config.PROJETOS / str(c["projeto_id"]) / "dublagens" / f"corte{corte_id}_{idioma}.wav"


@jobs.registrar("dublar", faixa="pesada")
def dublar(ctx: Contexto) -> str:
    c = db.um("SELECT * FROM cortes WHERE id=?", (ctx.job["corte_id"],))
    if not c:
        raise RuntimeError("O corte foi removido.")
    idioma, codigo = ctx.params["idioma"], ctx.params["voz"]
    t = traducao(c["id"], idioma)
    if not t:
        raise RuntimeError("Traduza a legenda antes de dublar.")
    voz = _voz(codigo, ctx)
    dur = c["fim"] - c["inicio"]
    destino = caminho_dublagem(c["id"], idioma)
    destino.parent.mkdir(parents=True, exist_ok=True)
    trabalho = destino.parent / f"tmp_{ctx.id}"
    trabalho.mkdir(exist_ok=True)
    taxa = voz.config.sample_rate
    trilha = np.zeros(int(dur * taxa) + taxa, dtype=np.int32)
    segs = t["segmentos"]
    acelerados = 0
    try:
        for i, s in enumerate(segs):
            ctx.checar()
            ctx.progresso(0.1 + 0.85 * i / max(1, len(segs)), f"Dublando frase {i + 1} de {len(segs)}")
            if not s["texto"].strip():
                continue
            fala, taxa_v = _falar(voz, s["texto"], trabalho / "frase.wav")
            if taxa_v != taxa:
                taxa = taxa_v
            proxima = segs[i + 1]["inicio"] if i + 1 < len(segs) else dur
            espaco = max(0.3, proxima - s["inicio"])
            fator = len(fala) / taxa / espaco
            if fator > 1.02:
                fala = _acelerar(fala, taxa, min(ACELERACAO_MAX, fator), trabalho)
                acelerados += 1
            a = int(s["inicio"] * taxa)
            b = min(len(trilha), a + len(fala))
            trilha[a:b] += fala[: b - a]
        final = np.clip(trilha[: int(dur * taxa)], -32768, 32767).astype(np.int16)
        with wave.open(str(destino), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(taxa)
            w.writeframes(final.tobytes())
    finally:
        for f in trabalho.glob("*"):
            media.apagar_arquivo(f)
        trabalho.rmdir()
    modo = ctx.params.get("audio_original", "abaixar")
    db.executar("INSERT INTO dublagens (corte_id, idioma, voz, audio_original, caminho_audio, criado_em) VALUES "
                "(?,?,?,?,?,?) ON CONFLICT(corte_id, idioma) DO UPDATE SET voz=excluded.voz, "
                "audio_original=excluded.audio_original, caminho_audio=excluded.caminho_audio, criado_em=excluded.criado_em",
                (c["id"], idioma, codigo, modo, str(destino), db.agora()))
    extra = f" {acelerados} frase(s) aceleradas para caber." if acelerados else ""
    return f"Dublagem pronta: {len(segs)} frase(s).{extra}"


def dublagem(corte_id: int, idioma: str) -> dict | None:
    d = db.um("SELECT * FROM dublagens WHERE corte_id=? AND idioma=?", (corte_id, idioma))
    if d and d["caminho_audio"] and Path(d["caminho_audio"]).is_file():
        return dict(d)
    return None
