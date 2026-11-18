"""Leitura de horários digitados pelo usuário (ex.: 01:23:10, 83:10, 4990.5)."""
import re

_TS = r"\d{1,3}(?::\d{1,2}){0,2}(?:[.,]\d+)?"
_INTERVALO = re.compile(rf"({_TS})\s*(?:-|–|—|até|ate|a|to)\s*({_TS})", re.IGNORECASE)
_UNICO = re.compile(rf"({_TS})")

DURACAO_PADRAO = 30.0


def para_segundos(txt: str) -> float:
    partes = txt.strip().replace(",", ".").split(":")
    total = 0.0
    for p in partes:
        total = total * 60 + float(p)
    return total


def formatar(seg: float) -> str:
    seg = max(0.0, seg)
    h = int(seg // 3600)
    m = int(seg % 3600 // 60)
    s = seg % 60
    return f"{h:02d}:{m:02d}:{s:04.1f}"


def ler_lista(texto: str, duracao: float) -> tuple[list[dict], list[str]]:
    """Converte linhas 'início - fim [nome]' em cortes. Linha só com um horário vira corte de 30 s."""
    cortes, invalidas = [], []
    for linha in texto.splitlines():
        bruto = linha.strip()
        if not bruto:
            continue
        m = _INTERVALO.search(bruto)
        try:
            if m:
                inicio, fim = para_segundos(m.group(1)), para_segundos(m.group(2))
                resto = (bruto[:m.start()] + " " + bruto[m.end():]).strip(" -–—:|")
            else:
                u = _UNICO.search(bruto)
                if not u:
                    raise ValueError
                inicio = para_segundos(u.group(1))
                fim = inicio + DURACAO_PADRAO
                resto = (bruto[:u.start()] + " " + bruto[u.end():]).strip(" -–—:|")
        except ValueError:
            invalidas.append(bruto)
            continue
        if fim < inicio:
            inicio, fim = fim, inicio
        fim = min(fim, duracao)
        if fim - inicio < 0.5 or inicio >= duracao:
            invalidas.append(bruto)
            continue
        cortes.append({"inicio": round(inicio, 2), "fim": round(fim, 2), "nome": resto[:120]})
    return cortes, invalidas
