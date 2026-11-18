"""Formatos de saída (presets) e montagem do comando do FFmpeg.

O mesmo montador gera a exportação completa e a prévia de um quadro, então a
prévia do site mostra exatamente o enquadramento do vídeo final.
"""
from dataclasses import dataclass, field
from pathlib import Path

FORMATOS = {
    "vertical_crop": {"nome": "9:16 recorte", "w": 1080, "h": 1920},
    "vertical_split": {"nome": "9:16 câmera + jogo", "w": 1080, "h": 1920},
    "vertical_blur": {"nome": "9:16 fundo desfocado", "w": 1080, "h": 1920},
    "horizontal": {"nome": "16:9", "w": 1920, "h": 1080},
    "quadrado": {"nome": "1:1", "w": 1080, "h": 1080},
    "original": {"nome": "Original", "w": None, "h": None},
}
USA_RECORTE = {"vertical_crop", "quadrado"}


def _par(v: float) -> int:
    return max(2, int(round(v)) // 2 * 2)


def tamanho_saida(fmt: str, w: int, h: int) -> tuple[int, int]:
    f = FORMATOS[fmt]
    return (_par(w), _par(h)) if f["w"] is None else (f["w"], f["h"])


def posicao_legenda(fmt: str, layout: dict, estilo: dict) -> dict:
    """No formato câmera + jogo a legenda fica na divisa entre as duas partes."""
    if fmt == "vertical_split":
        return {**estilo, "posicao_y": layout["proporcao"]}
    return estilo


def _ajustar(rect: list[float], w: int, h: int, aspecto: float) -> tuple[int, int, int, int]:
    """Retângulo (frações) → pixels, reduzido no centro até ter a proporção pedida."""
    x, y, rw, rh = rect[0] * w, rect[1] * h, rect[2] * w, rect[3] * h
    if rw / rh > aspecto:
        novo = rh * aspecto
        x += (rw - novo) / 2
        rw = novo
    else:
        novo = rw / aspecto
        y += (rh - novo) / 2
        rh = novo
    rw, rh = _par(rw), _par(rh)
    x = min(max(0, int(x)), w - rw)
    y = min(max(0, int(y)), h - rh)
    return rw, rh, x, y


def filtro_video(fmt: str, w: int, h: int, crop_x: float, layout: dict, ent: str, sai: str) -> str:
    ow, oh = tamanho_saida(fmt, w, h)
    if fmt in USA_RECORTE:
        a = ow / oh
        cw = _par(min(w, h * a))
        ch = _par(min(h, cw / a))
        cx = int(min(max(0, crop_x * w - cw / 2), w - cw))
        cy = (h - ch) // 2
        return f"{ent}crop={cw}:{ch}:{cx}:{cy},scale={ow}:{oh}:flags=lanczos,setsar=1{sai}"
    if fmt == "vertical_blur":
        bw, bh = ow // 4, oh // 4
        return (f"{ent}split=2[bga][fga];"
                f"[bga]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},boxblur=10:2,"
                f"scale={ow}:{oh},eq=brightness=-0.06[bgb];"
                f"[fga]scale={ow}:{oh}:force_original_aspect_ratio=decrease:flags=lanczos[fgb];"
                f"[bgb][fgb]overlay=(W-w)/2:(H-h)/2,setsar=1{sai}")
    if fmt == "vertical_split":
        topo = _par(oh * layout["proporcao"])
        base = oh - topo
        c = _ajustar(layout["cam"], w, h, ow / topo)
        j = _ajustar(layout["jogo"], w, h, ow / base)
        return (f"{ent}split=2[cama][joga];"
                f"[cama]crop={c[0]}:{c[1]}:{c[2]}:{c[3]},scale={ow}:{topo}:flags=lanczos[camb];"
                f"[joga]crop={j[0]}:{j[1]}:{j[2]}:{j[3]},scale={ow}:{base}:flags=lanczos[jogb];"
                f"[camb][jogb]vstack,setsar=1{sai}")
    if fmt == "horizontal":
        return (f"{ent}scale={ow}:{oh}:force_original_aspect_ratio=decrease:flags=lanczos,"
                f"pad={ow}:{oh}:(ow-iw)/2:(oh-ih)/2,setsar=1{sai}")
    return f"{ent}scale={ow}:{oh},setsar=1{sai}"


@dataclass
class Extra:
    """Arquivo de mídia que entra antes/depois do corte (intro/outro)."""
    arquivo: str
    duracao: float
    tem_audio: bool


@dataclass
class Montagem:
    origem: str
    inicio: float
    duracao: float
    fmt: str
    largura: int
    altura: int
    fps: float
    tem_audio: bool
    crop_x: float = 0.5
    layout: dict = field(default_factory=dict)
    legenda: tuple[Path, int] | None = None        # (lista ffconcat ou PNG único, y)
    gancho: tuple[Path, int, float] | None = None   # (PNG, y, duração; 0 = corte todo)
    logo: tuple[Path, int, int] | None = None       # (PNG, x, y)
    musica: tuple[str, float, bool] | None = None   # (arquivo, volume, abaixar na fala)
    intro: Extra | None = None
    outro: Extra | None = None


def comando(m: Montagem, video_args: list[str], destino: str, previa: bool = False) -> tuple[list[str], float]:
    """Argumentos do FFmpeg (sem o executável). Com previa=True gera um único quadro JPEG em stdout."""
    ow, oh = tamanho_saida(m.fmt, m.largura, m.altura)
    fps = min(60.0, m.fps or 30.0)
    args: list[str] = []
    filtros: list[str] = []
    n = 0

    def entrada(*opcoes: str) -> int:
        nonlocal n
        args.extend(opcoes)
        n += 1
        return n - 1

    dur = 0.04 if previa else m.duracao
    principal = entrada("-ss", f"{m.inicio:.3f}", "-t", f"{dur:.3f}", "-i", m.origem)
    filtros.append(filtro_video(m.fmt, m.largura, m.altura, m.crop_x, m.layout, f"[{principal}:v]", "[v0]"))
    atual = "[v0]"

    def sobrepor(idx: int, x: int, y: int, rotulo: str, rgba: bool = True) -> None:
        nonlocal atual
        fonte = f"[{idx}:v]"
        if rgba:
            filtros.append(f"{fonte}format=rgba[{rotulo}a]")
            fonte = f"[{rotulo}a]"
        # na prévia (1 quadro) a imagem pode "acabar" antes do quadro principal: repete a última
        eof = "repeat" if previa else "pass"
        filtros.append(f"{atual}{fonte}overlay={x}:{y}:eof_action={eof}[{rotulo}]")
        atual = f"[{rotulo}]"

    if m.legenda:
        arq, y = m.legenda
        if arq.suffix == ".txt":
            i = entrada("-f", "concat", "-safe", "0", "-i", str(arq))
        else:
            i = entrada("-loop", "1", "-t", f"{dur:.3f}", "-i", str(arq))
        sobrepor(i, 0, y, "vleg")
    if m.gancho:
        arq, y, gdur = m.gancho
        tempo = dur if not gdur or previa else min(gdur, m.duracao)
        i = entrada("-loop", "1", "-t", f"{tempo:.3f}", "-i", str(arq))
        sobrepor(i, 0, y, "vgan")
    if m.logo:
        arq, x, y = m.logo
        i = entrada("-loop", "1", "-t", f"{dur:.3f}", "-i", str(arq))
        sobrepor(i, x, y, "vlogo")

    if previa:
        filtros.append(f"{atual}format=yuvj420p[vout]")
        args += ["-filter_complex", ";".join(filtros), "-map", "[vout]", "-frames:v", "1",
                 "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "-"]
        return args, dur

    filtros.append(f"{atual}fps={fps:g},format=yuv420p[vm]")
    norm_audio = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"

    # áudio do corte (silêncio se o vídeo não tiver)
    if m.tem_audio:
        filtros.append(f"[{principal}:a]{norm_audio}[am0]")
    else:
        i = entrada("-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo")
        filtros.append(f"[{i}:a]{norm_audio}[am0]")

    if m.musica:
        arq, vol, abaixar = m.musica
        i = entrada("-stream_loop", "-1", "-t", f"{dur:.3f}", "-i", arq)
        fade = max(0.0, dur - 1.5)
        filtros.append(f"[{i}:a]{norm_audio},volume={vol:.3f},afade=t=in:d=0.8,afade=t=out:st={fade:.3f}:d=1.5[mus]")
        if abaixar:
            # a voz controla um compressor na música: quando alguém fala, a música abaixa
            filtros.append("[am0]asplit=2[voz][sc]")
            # medido: ~10 dB a menos na música durante a fala; volume cheio nas pausas
            filtros.append("[mus][sc]sidechaincompress=threshold=0.005:ratio=20:attack=15:release=500[musd]")
            filtros.append("[voz][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am]")
        else:
            filtros.append("[am0][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am]")
    else:
        filtros.append("[am0]anull[am]")

    partes_v, partes_a = [], []
    total = dur

    def preparar_extra(extra: Extra, nome: str) -> None:
        nonlocal total
        i = entrada("-i", extra.arquivo)
        filtros.append(f"[{i}:v]scale={ow}:{oh}:force_original_aspect_ratio=decrease,"
                       f"pad={ow}:{oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps:g},format=yuv420p[{nome}v]")
        if extra.tem_audio:
            filtros.append(f"[{i}:a]{norm_audio}[{nome}a]")
        else:
            j = entrada("-f", "lavfi", "-t", f"{extra.duracao:.3f}", "-i", "anullsrc=r=48000:cl=stereo")
            filtros.append(f"[{j}:a]{norm_audio}[{nome}a]")
        partes_v.append(f"[{nome}v]")
        partes_a.append(f"[{nome}a]")
        total += extra.duracao

    if m.intro:
        preparar_extra(m.intro, "intro")
    partes_v.append("[vm]")
    partes_a.append("[am]")
    if m.outro:
        preparar_extra(m.outro, "outro")

    if len(partes_v) > 1:
        pares = "".join(v + a for v, a in zip(partes_v, partes_a))
        filtros.append(f"{pares}concat=n={len(partes_v)}:v=1:a=1[vout][aout]")
        saidas = ["-map", "[vout]", "-map", "[aout]"]
    else:
        saidas = ["-map", "[vm]", "-map", "[am]"]

    args += ["-filter_complex", ";".join(filtros), *saidas, *video_args,
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", destino]
    return args, total
