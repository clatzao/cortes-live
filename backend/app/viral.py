"""Momentos virais: a IA (Gemini) lê a transcrição e os sinais de volume e palavras-chave.

Sem chave do Gemini (ou se a API falhar), as sugestões saem só dos sinais, para
a função nunca ficar indisponível.
"""
import bisect
import json
import math
import re
import time

import numpy as np
import requests

from . import ajustes, config, db, jobs, legendas, transcricao
from .jobs import Cancelado, Contexto
from .tempo import formatar, para_segundos

API = "https://generativelanguage.googleapis.com/v1beta"
RISOS = ("kkk", "haha", "hehe", "rsrs", "lol", "lmao", "kkkk")
CHARS_POR_BLOCO = 120_000  # ~30 mil tokens por pedido: cabe com folga no limite gratuito


class ErroGemini(RuntimeError):
    pass


# ---------------------------------------------------------------- API do Gemini

def _cabecalho(chave: str) -> dict:
    # chave no cabeçalho (nunca na URL)
    return {"x-goog-api-key": chave, "Content-Type": "application/json"}


def _verificar(r: requests.Response) -> None:
    if r.ok:
        return
    try:
        msg = r.json().get("error", {}).get("message", "")
    except ValueError:
        msg = r.text[:300]
    if r.status_code in (400, 401, 403) and ("API key" in msg or "API_KEY" in msg or r.status_code != 400):
        raise ErroGemini(f"Chave do Gemini recusada ({r.status_code}): {msg}")
    if r.status_code == 429:
        raise ErroGemini(f"Limite do plano gratuito do Gemini atingido. Tente mais tarde. ({msg[:200]})")
    raise ErroGemini(f"Gemini respondeu {r.status_code}: {msg[:300]}")


def listar_modelos(chave: str) -> list[str]:
    r = requests.get(f"{API}/models", headers=_cabecalho(chave), params={"pageSize": 200}, timeout=20)
    _verificar(r)
    return [m["name"].split("/", 1)[-1] for m in r.json().get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])]


def _versao(nome: str) -> float:
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", nome)
    return float(m.group(1)) if m else 0.0


def escolher_modelo(nomes: list[str], preferido: str = "auto") -> str:
    if preferido and preferido != "auto" and preferido in nomes:
        return preferido
    ruins = ("lite", "image", "tts", "live", "audio", "embedding", "vision", "robotics", "computer")
    flash = [n for n in nomes if n.startswith("gemini") and "flash" in n and not any(x in n for x in ruins)]
    estaveis = [n for n in flash if "preview" not in n and "exp" not in n] or flash
    if not estaveis:
        raise ErroGemini("Nenhum modelo Gemini Flash disponível para esta chave.")
    return max(estaveis, key=lambda n: (_versao(n), "latest" not in n, -len(n)))


ESQUEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "inicio": {"type": "STRING"},
            "fim": {"type": "STRING"},
            "nota": {"type": "INTEGER"},
            "motivo": {"type": "STRING"},
            "nome": {"type": "STRING"},
            "gancho": {"type": "STRING"},
        },
        "required": ["inicio", "fim", "nota", "motivo", "nome", "gancho"],
    },
}


def gerar(chave: str, modelo: str, prompt: str, ctx: Contexto | None = None, tentativas: int = 4,
          esquema: dict | None = None, temperatura: float = 0.4) -> list:
    corpo = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": esquema or ESQUEMA,
                             "temperature": temperatura},
    }
    for n in range(tentativas):
        try:
            r = requests.post(f"{API}/models/{modelo}:generateContent", headers=_cabecalho(chave), json=corpo,
                              timeout=300)
        except requests.RequestException as e:
            if n == tentativas - 1:
                raise ErroGemini(f"Sem conexão com o Gemini: {e}") from e
            r = None
        if r is not None and r.ok:
            dados = r.json()
            cands = dados.get("candidates") or []
            if not cands:
                motivo = dados.get("promptFeedback", {}).get("blockReason", "sem resposta")
                raise ErroGemini(f"O Gemini não respondeu ({motivo}).")
            texto = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))
            try:
                res = json.loads(texto)
            except ValueError as e:
                raise ErroGemini("O Gemini devolveu uma resposta fora do formato esperado.") from e
            return res if isinstance(res, list) else []
        if r is not None and r.status_code not in (429, 500, 503) or n == tentativas - 1:
            _verificar(r)  # erro definitivo (ou última tentativa)
        espera = 20 * (n + 1)
        for _ in range(espera):  # espera o limite liberar, sem travar o cancelamento
            if ctx and ctx.cancelado():
                raise Cancelado()
            time.sleep(1)
    return []


# ---------------------------------------------------------------- sinais

def _energia_por_segundo(projeto_id: int, duracao: float) -> np.ndarray:
    """Volume de cada segundo, em 'desvios' acima do normal da live (0 = normal)."""
    n = int(math.ceil(duracao)) + 1
    try:
        ondas = json.loads((config.PROJETOS / str(projeto_id) / "ondas.json").read_text())
        rms = np.asarray(ondas["rms"], dtype=np.float32)
        taxa = int(ondas["taxa"])
    except (OSError, ValueError, KeyError):
        return np.zeros(n, dtype=np.float32)
    usavel = len(rms) // taxa * taxa
    seg = rms[:usavel].reshape(-1, taxa).mean(axis=1) if usavel else np.zeros(1, dtype=np.float32)
    mediana = float(np.median(seg))
    mad = float(np.median(np.abs(seg - mediana))) * 1.4826 + 1e-3
    z = np.clip((seg - mediana) / mad, 0, 8)
    saida = np.zeros(n, dtype=np.float32)
    saida[: min(n, len(z))] = z[: min(n, len(z))]
    return saida


def _palavras_por_segundo(segmentos: list[dict], duracao: float, chaves: set[str]
                          ) -> tuple[np.ndarray, np.ndarray]:
    """(palavras marcantes por segundo, fala presente 0/1 por segundo)."""
    n = int(math.ceil(duracao)) + 1
    marc = np.zeros(n, dtype=np.float32)
    fala = np.zeros(n, dtype=np.float32)
    for s in segmentos:
        a, b = int(s["inicio"]), int(math.ceil(s["fim"]))
        fala[max(0, a):min(n, b)] = 1
        for w in s.get("palavras", []):
            bruto = w[2]
            norm = legendas.normalizar(bruto)
            i = min(n - 1, max(0, int(w[0])))
            if norm in chaves or any(r in norm for r in RISOS):
                marc[i] += 1
            if "!" in bruto or "?!" in bruto:
                marc[i] += 0.5
    return marc, fala


def picos_de_volume(energia: np.ndarray, quantos: int = 30, distancia: int = 45) -> list[int]:
    ordem = np.argsort(-energia)
    escolhidos: list[int] = []
    for i in ordem:
        if energia[i] < 1.5 or len(escolhidos) >= quantos:
            break
        if all(abs(int(i) - j) >= distancia for j in escolhidos):
            escolhidos.append(int(i))
    return sorted(escolhidos)


def sugestoes_por_sinais(energia: np.ndarray, marc: np.ndarray, fala: np.ndarray, mn: float, mx: float,
                         qtd: int) -> list[dict]:
    """Janelas com mais volume, palavras marcantes e fala; sem sobreposição."""
    n = len(energia)
    largura = int(round((mn + mx) / 2))
    if n <= largura + 1:
        return []
    def soma(v):
        c = np.concatenate([[0.0], np.cumsum(v)])
        return c[largura:] - c[:-largura]
    e = soma(np.minimum(energia, 5)) / largura
    p = soma(marc) / largura * 10
    f = soma(fala) / largura
    nota = 0.55 * e + 0.3 * np.minimum(p, 5) + 0.6 * f
    nota[f < 0.4] = 0  # trecho quase sem fala não vira corte
    escolhidos: list[dict] = []
    for i in np.argsort(-nota):
        if nota[i] <= 0 or len(escolhidos) >= qtd:
            break
        ini, fim = float(i), float(i + largura)
        if any(not (fim <= c["inicio"] or ini >= c["fim"]) for c in escolhidos):
            continue
        escolhidos.append({"inicio": ini, "fim": fim, "bruta": float(nota[i])})
    if escolhidos:
        topo = max(c["bruta"] for c in escolhidos) or 1
        for c in escolhidos:
            c["nota"] = int(round(40 + 50 * c["bruta"] / topo))
            c["motivo"] = "Volume alto e reação forte neste trecho (sinais de áudio e palavras)."
            c["nome"] = ""
            c["gancho"] = ""
    return escolhidos


# ---------------------------------------------------------------- ajuste fino dos tempos

_FIM_FRASE = re.compile(r"[.!?…]['\"”)]*$")


def _fronteiras(segmentos: list[dict], palavras: list[list]) -> tuple[list[float], list[float]]:
    """Inícios e fins de frase pela pontuação das palavras.

    Os limites dos segmentos do Whisper não servem: ele quebra frases no meio. Só são usados se a
    transcrição não tiver palavras com tempo.
    """
    if not palavras:
        return sorted({s["inicio"] for s in segmentos}), sorted({s["fim"] for s in segmentos})
    inicios = {palavras[0][0]}
    fins = {palavras[-1][1]}
    for i, w in enumerate(palavras):
        if _FIM_FRASE.search(str(w[2]).strip()):
            fins.add(w[1])
            if i + 1 < len(palavras):
                inicios.add(palavras[i + 1][0])
    return sorted(inicios), sorted(fins)


def _mais_proximo(lista: list[float], alvo: float, de: float, ate: float) -> float | None:
    i = bisect.bisect_left(lista, de)
    candidatos = [v for v in lista[i:bisect.bisect_right(lista, ate)]]
    return min(candidatos, key=lambda v: abs(v - alvo)) if candidatos else None


def ajustar_limites(inicio: float, fim: float, segmentos: list[dict], palavras: list[list], duracao: float,
                    mn: float, mx: float) -> tuple[float, float]:
    """Encaixa o corte no começo de uma frase e no fim de uma ideia, dentro da duração pedida."""
    ini_frases, fim_frases = _fronteiras(segmentos, palavras)
    ini_palavras = [w[0] for w in palavras]
    fim_palavras = [w[1] for w in palavras]

    novo = _mais_proximo(ini_frases, inicio, inicio - 4, inicio + 1.5)
    if novo is None:  # sem começo de frase por perto: pelo menos no começo de uma palavra
        novo = _mais_proximo(ini_palavras, inicio, inicio - 1, inicio + 1)
    inicio = novo if novo is not None else inicio

    novo = _mais_proximo(fim_frases, fim, fim - 1.5, fim + 4)
    if novo is None:
        novo = _mais_proximo(fim_palavras, fim, fim - 1, fim + 1)
    fim = novo if novo is not None else fim

    if fim - inicio > mx:  # longo demais: termina no último fim de frase (ou palavra) que cabe
        limite = inicio + mx
        cabe = [v for v in fim_frases if inicio + mn <= v <= limite]
        if not cabe:
            k = bisect.bisect_right(fim_palavras, limite) - 1
            cabe = [fim_palavras[k]] if k >= 0 and fim_palavras[k] > inicio + mn * 0.8 else [limite]
        fim = max(cabe)
    if fim - inicio < mn:  # curto demais: estende até o próximo fim de frase que caiba
        cabe = [v for v in fim_frases if inicio + mn <= v <= inicio + mx]
        fim = min(cabe) if cabe else min(duracao, inicio + mn)
    inicio = max(0.0, inicio - 0.3)
    fim = min(duracao, fim + 0.4)
    return round(inicio, 2), round(fim, 2)


def _sem_sobreposicao(lista: list[dict], qtd: int) -> list[dict]:
    escolhidos: list[dict] = []
    for s in sorted(lista, key=lambda x: -x["nota"]):
        if any(not (s["fim"] <= c["inicio"] + 1 or s["inicio"] >= c["fim"] - 1) for c in escolhidos):
            continue
        escolhidos.append(s)
        if len(escolhidos) >= qtd:
            break
    return escolhidos


# ---------------------------------------------------------------- prompt

def montar_prompt(linhas: list[str], de: float, ate: float, picos: list[int], n: int, mn: int, mx: int) -> str:
    sinais = ""
    if picos:
        sinais = ("Momentos com volume bem acima do normal (gritos, risadas, agitação) — use como pista, não como "
                  "regra: " + ", ".join(formatar(p)[:8] for p in picos) + "\n\n")
    return (
        "Você é um editor especialista em cortes virais de lives para TikTok, Reels e YouTube Shorts.\n"
        f"Abaixo está a transcrição de um trecho de uma live (de {formatar(de)[:8]} até {formatar(ate)[:8]}), "
        "uma frase por linha, com o horário de início entre colchetes.\n\n"
        f"{sinais}"
        f"Encontre os {n} melhores momentos para virar cortes virais. Critérios: gancho forte nos primeiros "
        "segundos, emoção (risada, raiva, surpresa, euforia), história com começo e fim, frase marcante ou "
        "polêmica, reação exagerada, informação útil ou curiosa. Evite trechos que dependem de contexto que não "
        "está no corte.\n\n"
        "Regras:\n"
        f"- Cada corte deve durar entre {mn} e {mx} segundos.\n"
        "- Comece no início de uma frase e termine no fim de uma ideia (nunca no meio de uma frase).\n"
        "- Os cortes não podem se sobrepor.\n"
        "- \"inicio\" e \"fim\" no formato hh:mm:ss, usando os horários da transcrição.\n"
        "- \"nota\": de 0 a 100, a chance de viralizar.\n"
        "- \"motivo\": uma frase curta explicando por que funciona.\n"
        "- \"nome\": título curto para identificar o corte (até 6 palavras).\n"
        "- \"gancho\": texto chamativo para o topo do vídeo, até 8 palavras, no idioma da live, sem hashtags.\n"
        "Ordene do melhor para o pior.\n\n"
        "TRANSCRIÇÃO:\n" + "\n".join(linhas)
    )


def _blocos(segmentos: list[dict]) -> list[tuple[list[str], float, float]]:
    blocos, atual, tam = [], [], 0
    for s in segmentos:
        linha = f"[{formatar(s['inicio'])[:8]}] {s['texto']}"
        if atual and tam + len(linha) > CHARS_POR_BLOCO:
            blocos.append(atual)
            atual, tam = [], 0
        atual.append((linha, s))
        tam += len(linha) + 1
    if atual:
        blocos.append(atual)
    return [([l for l, _ in b], b[0][1]["inicio"], b[-1][1]["fim"]) for b in blocos]


def _tempo(txt) -> float | None:
    try:
        return para_segundos(str(txt).strip())
    except ValueError:
        return None


# ---------------------------------------------------------------- job

@jobs.registrar("analisar", faixa="ia")
def analisar(ctx: Contexto) -> str:
    p = db.um("SELECT * FROM projetos WHERE id=?", (ctx.job["projeto_id"],))
    if not p:
        raise RuntimeError("O projeto foi removido.")
    arq = transcricao.caminho(p["id"])
    if not arq.exists():
        raise RuntimeError("Este projeto ainda não tem transcrição.")
    dados = json.loads(arq.read_text(encoding="utf-8"))
    segmentos = [s for s in dados.get("segmentos", []) if s.get("texto")]
    if not segmentos:
        raise RuntimeError("A transcrição não tem falas para analisar.")
    aj = ajustes.ler()
    mn = int(ctx.params.get("min") or aj["viral_min"])
    mx = max(mn, int(ctx.params.get("max") or aj["viral_max"]))
    qtd = int(ctx.params.get("qtd") or aj["viral_qtd"])
    duracao = float(p["duracao"])
    palavras = sorted((w for s in segmentos for w in s.get("palavras", [])), key=lambda w: w[0])

    ctx.progresso(0.05, "Calculando volume e palavras-chave", forcar=True)
    chaves = set(legendas.ler_dicionarios()["palavras_chave"])
    energia = _energia_por_segundo(p["id"], duracao)
    marc, fala = _palavras_por_segundo(segmentos, duracao, chaves)
    picos = picos_de_volume(energia)

    candidatos: list[dict] = []
    origem = "gemini"
    aviso = ""
    chave = aj["gemini_chave"]
    if chave:
        try:
            ctx.progresso(0.1, "Escolhendo o modelo do Gemini", forcar=True)
            modelo = escolher_modelo(listar_modelos(chave), aj["gemini_modelo"])
            blocos = _blocos(segmentos)
            total_chars = sum(len(l) for b in blocos for l in b[0]) or 1
            for i, (linhas, de, ate) in enumerate(blocos):
                ctx.checar()
                n = min(qtd, max(2, math.ceil(qtd * sum(len(l) for l in linhas) / total_chars) + 2))
                ctx.progresso(0.15 + 0.75 * i / len(blocos),
                              f"Gemini ({modelo}) lendo a live: parte {i + 1} de {len(blocos)}", forcar=True)
                picos_bloco = [x for x in picos if de <= x <= ate]
                for item in gerar(chave, modelo, montar_prompt(linhas, de, ate, picos_bloco, n, mn, mx), ctx):
                    ini, fim = _tempo(item.get("inicio")), _tempo(item.get("fim"))
                    if ini is None or fim is None or fim <= ini or ini >= duracao:
                        continue
                    candidatos.append({
                        "inicio": ini, "fim": fim,
                        "nota": int(min(100, max(0, int(item.get("nota") or 0)))),
                        "motivo": str(item.get("motivo") or "")[:300],
                        "nome": str(item.get("nome") or "")[:80],
                        "gancho": str(item.get("gancho") or "")[:120],
                    })
            aviso = f"Analisado pelo Gemini ({modelo}) com sinais de volume."
        except Cancelado:
            raise
        except (ErroGemini, requests.RequestException) as e:
            candidatos = []
            aviso = f"Gemini indisponível — sugestões só por volume e palavras-chave. Motivo: {e}"
    else:
        aviso = "Sem chave do Gemini — sugestões só por volume e palavras-chave. Configure a chave em Configurações."

    if not candidatos:
        origem = "sinais"
        candidatos = sugestoes_por_sinais(energia, marc, fala, mn, mx, qtd)

    ctx.progresso(0.95, "Ajustando os cortes às frases", forcar=True)
    finais = []
    for c in candidatos:
        ini, fim = ajustar_limites(c["inicio"], c["fim"], segmentos, palavras, duracao, mn, mx)
        if fim - ini < min(mn, 5):
            continue
        trecho = energia[int(ini):int(fim) + 1]
        energia_pct = int(min(100, round(float(trecho.mean()) / 4 * 100))) if len(trecho) else 0
        finais.append({**c, "inicio": ini, "fim": fim, "energia": energia_pct})
    finais = _sem_sobreposicao(finais, qtd)

    db.executar("DELETE FROM sugestoes WHERE projeto_id=? AND status='nova'", (p["id"],))
    agora = db.agora()
    for s in finais:
        nome = s["nome"] or f"Momento {formatar(s['inicio'])[:8]}"
        db.executar("INSERT INTO sugestoes (projeto_id, inicio, fim, nota, energia, motivo, nome, gancho, origem, "
                    "criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (p["id"], s["inicio"], s["fim"], s["nota"], s["energia"], s["motivo"], nome, s["gancho"],
                     origem, agora))
    return f"{len(finais)} sugestão(ões). {aviso}"
