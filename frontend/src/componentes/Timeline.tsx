import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import { Corte, Miniaturas, Ondas } from "../api";
import { formatar } from "../tempo";

interface Props {
  duracao: number;
  ondas: Ondas | null;
  miniaturas: { meta: Miniaturas; url: string } | null;
  tempo: number;
  /** tempo exato do vídeo, lido a cada quadro só para desenhar o cursor (sem re-renderizar a tela) */
  relogio: () => number;
  tocando: boolean;
  cortes: Corte[];
  corteAtivo: number | null;
  selecao: { inicio: number | null; fim: number | null };
  onSeek: (t: number) => void;
  onSelecao: (inicio: number, fim: number) => void;
  onCorte: (id: number) => void;
  /** borda ou corte inteiro arrastado na timeline */
  onAjustarCorte: (id: number, inicio: number, fim: number) => void;
}

// faixas (de cima para baixo): régua, cortes, miniaturas, forma de onda
const Y_REGUA = 20;
const Y_FAIXA = 42;
const Y_MINI = Y_FAIXA;
const ALT_MINI = 54;
const Y_ONDA = Y_MINI + ALT_MINI;
const ALTURA = Y_ONDA + 70;
const PASSOS = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const SPAN_MIN = 2;
const PEGA = 6; // px de tolerância para pegar uma borda
const DUR_MIN = 0.5;

const NOMES_CORES = ["--tl-fundo", "--tl-regua", "--tl-linha", "--texto-sutil", "--tl-onda", "--tl-onda-forte",
  "--destaque", "--tl-corte", "--tl-corte-texto", "--tl-selecao", "--tl-cabeca"] as const;
type Cores = Record<(typeof NOMES_CORES)[number], string>;

/** Lê as cores do tema uma vez (getComputedStyle a cada quadro era caro). */
function lerCores(): Cores {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(NOMES_CORES.map((n) => [n, css.getPropertyValue(n).trim() || "#888"])) as Cores;
}

type Arraste =
  | { tipo: "selecao"; x0: number; t0: number; movendo: boolean }
  | { tipo: "borda"; id: number; lado: "inicio" | "fim"; x0: number; movendo: boolean }
  | { tipo: "mover"; id: number; x0: number; t0: number; ini0: number; fim0: number; movendo: boolean }
  | { tipo: "bordaSel"; lado: "inicio" | "fim"; x0: number; movendo: boolean };

export default function Timeline(p: Props) {
  const embrulho = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLCanvasElement>(null);
  const [largura, setLargura] = useState(800);
  const [vista, setVista] = useState({ a: 0, b: Math.max(p.duracao, SPAN_MIN) });
  const [versaoTema, setVersaoTema] = useState(0);
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null);
  // corte sendo arrastado: desenhado com os valores novos até soltar
  const [provisorio, setProvisorio] = useState<{ id: number; inicio: number; fim: number } | null>(null);
  const [ponteiro, setPonteiro] = useState("crosshair");
  const arraste = useRef<Arraste | null>(null);
  const mouseX = useRef<number | null>(null);

  const span = vista.b - vista.a;
  const spanTotal = Math.max(p.duracao, SPAN_MIN);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cores = useMemo(lerCores, [versaoTema]);
  const picoMax = useMemo(() => {
    let m = 1;
    for (const v of p.ondas?.picos ?? []) if (v > m) m = v;
    return m;
  }, [p.ondas]);

  const cortesVisiveis = useMemo(
    () => (provisorio ? p.cortes.map((c) => (c.id === provisorio.id ? { ...c, ...provisorio } : c)) : p.cortes),
    [p.cortes, provisorio],
  );

  // Imagem com as miniaturas
  useEffect(() => {
    if (!p.miniaturas) return setSprite(null);
    const img = new Image();
    img.onload = () => setSprite(img);
    img.src = p.miniaturas.url;
  }, [p.miniaturas]);

  // Largura do componente
  useEffect(() => {
    const el = embrulho.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redesenha ao trocar o tema
  useEffect(() => {
    const mo = new MutationObserver(() => setVersaoTema((v) => v + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setVersaoTema((v) => v + 1);
    mq.addEventListener("change", f);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", f);
    };
  }, []);

  function limitar(a: number, s: number) {
    s = Math.min(Math.max(s, SPAN_MIN), spanTotal);
    a = Math.min(Math.max(0, a), Math.max(0, p.duracao - s));
    return { a, b: a + s };
  }

  function zoom(fator: number, centro: number) {
    setVista((v) => {
      const s = v.b - v.a;
      const novo = Math.min(Math.max(s * fator, SPAN_MIN), spanTotal);
      return limitar(centro - (centro - v.a) * (novo / s), novo);
    });
  }

  function focar(inicio: number, fim: number) {
    const s = Math.max(SPAN_MIN, (fim - inicio) * 1.25);
    setVista(limitar((inicio + fim) / 2 - s / 2, s));
  }

  // Acompanha a reprodução quando o cursor sai da área visível
  useEffect(() => {
    if (p.tocando && (p.tempo > vista.b || p.tempo < vista.a)) setVista(limitar(p.tempo - span * 0.1, span));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tempo, p.tocando]);

  // Teclas + e - (zoom no cursor) e 0 (ver tudo)
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest("input, textarea, select, [contenteditable]") || document.querySelector(".modal-fundo")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoom(0.5, p.relogio());
      else if (e.key === "-" || e.key === "_") zoom(2, p.relogio());
      else if (e.key === "0") setVista({ a: 0, b: spanTotal });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  });

  // Rolagem do mouse: zoom; Shift+rolagem: mover
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const f = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const t = vista.a + ((e.clientX - r.left) / r.width) * span;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / r.width;
        setVista((v) => limitar(v.a + d * (v.b - v.a), v.b - v.a));
      } else {
        zoom(e.deltaY > 0 ? 1.25 : 0.8, t);
      }
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  });

  // Desenho (tudo menos o cursor)
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(largura * dpr);
    el.height = Math.round(ALTURA * dpr);
    const c = el.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = largura;
    const pps = w / span;
    const x = (t: number) => (t - vista.a) * pps;

    c.fillStyle = cores["--tl-fundo"];
    c.fillRect(0, 0, w, ALTURA);

    // Miniaturas: um quadro a cada ~96 px, escolhido pelo tempo daquele ponto
    if (sprite && p.miniaturas) {
      const m = p.miniaturas.meta;
      const larg = ALT_MINI * (m.largura / m.altura);
      const passoT = larg / pps;
      for (let t = Math.floor(vista.a / passoT) * passoT; t < vista.b; t += passoT) {
        const i = Math.min(m.n - 1, Math.max(0, Math.round((t + passoT / 2) / m.intervalo)));
        const sx = (i % m.colunas) * m.largura;
        const sy = Math.floor(i / m.colunas) * m.altura;
        c.drawImage(sprite, sx, sy, m.largura, m.altura, Math.round(x(t)), Y_MINI, Math.ceil(larg), ALT_MINI);
      }
    } else {
      c.fillStyle = cores["--tl-regua"];
      c.fillRect(0, Y_MINI, w, ALT_MINI);
    }

    // Régua
    const passo = PASSOS.find((s) => s * pps >= 90) ?? 7200;
    c.fillStyle = cores["--tl-regua"];
    c.fillRect(0, 0, w, Y_REGUA);
    c.strokeStyle = cores["--tl-linha"];
    c.fillStyle = cores["--texto-sutil"];
    c.font = "11px system-ui, sans-serif";
    c.textBaseline = "middle";
    c.beginPath();
    for (let t = Math.floor(vista.a / passo) * passo; t <= vista.b; t += passo) {
      const px = Math.round(x(t)) + 0.5;
      c.moveTo(px, Y_REGUA - 6);
      c.lineTo(px, Y_REGUA);
      c.moveTo(px, Y_ONDA);
      c.lineTo(px, ALTURA);
      c.fillText(formatar(t, passo < 1), px + 4, Y_REGUA / 2);
    }
    c.stroke();

    // Forma de onda: trechos altos (gritos, risadas) em destaque
    const meio = (Y_ONDA + ALTURA) / 2;
    const alturaOnda = (ALTURA - Y_ONDA) / 2 - 3;
    if (p.ondas) {
      const { taxa, picos } = p.ondas;
      const forte = picoMax * 0.6;
      for (let px = 0; px < w; px++) {
        const t1 = vista.a + px / pps;
        const i1 = Math.floor(t1 * taxa);
        const i2 = Math.max(i1 + 1, Math.floor((t1 + 1 / pps) * taxa));
        let v = 0;
        for (let i = i1; i < i2 && i < picos.length; i++) if (picos[i] > v) v = picos[i];
        const h = Math.max(1, (v / picoMax) * alturaOnda);
        c.fillStyle = v >= forte ? cores["--tl-onda-forte"] : cores["--tl-onda"];
        c.fillRect(px, meio - h, 1, h * 2);
      }
    }

    // Cortes
    c.font = "11px system-ui, sans-serif";
    for (const corte of cortesVisiveis) {
      if (corte.fim < vista.a || corte.inicio > vista.b) continue;
      const x1 = x(corte.inicio);
      const x2 = x(corte.fim);
      const ativo = corte.id === p.corteAtivo || corte.id === provisorio?.id;
      const cor = cores[ativo ? "--destaque" : "--tl-corte"];
      c.fillStyle = cor;
      c.fillRect(x1, Y_REGUA + 2, Math.max(2, x2 - x1), Y_FAIXA - Y_REGUA - 4);
      c.globalAlpha = ativo ? 0.28 : 0.14;
      c.fillRect(x1, Y_FAIXA, Math.max(2, x2 - x1), ALTURA - Y_FAIXA);
      c.globalAlpha = 1;
      // alças nas bordas (arrastar)
      c.fillStyle = cores["--tl-corte-texto"];
      if (x2 - x1 > 14) {
        c.fillRect(x1 + 2, Y_REGUA + 6, 2, Y_FAIXA - Y_REGUA - 12);
        c.fillRect(x2 - 4, Y_REGUA + 6, 2, Y_FAIXA - Y_REGUA - 12);
      }
      if (ativo) {
        c.strokeStyle = cor;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x1, Y_FAIXA);
        c.lineTo(x1, ALTURA);
        c.moveTo(x2, Y_FAIXA);
        c.lineTo(x2, ALTURA);
        c.stroke();
        c.lineWidth = 1;
      }
      if (x2 - x1 > 40) {
        c.fillStyle = cores["--tl-corte-texto"];
        c.save();
        c.beginPath();
        c.rect(x1 + 6, Y_REGUA, x2 - x1 - 12, Y_FAIXA - Y_REGUA);
        c.clip();
        c.fillText(corte.nome, x1 + 8, (Y_REGUA + Y_FAIXA) / 2);
        c.restore();
      }
    }

    // Seleção atual
    const { inicio, fim } = p.selecao;
    c.strokeStyle = cores["--tl-selecao"];
    c.lineWidth = 2;
    if (inicio !== null && fim !== null) {
      c.fillStyle = cores["--tl-selecao"];
      c.globalAlpha = 0.25;
      c.fillRect(x(inicio), Y_FAIXA, x(fim) - x(inicio), ALTURA - Y_FAIXA);
      c.globalAlpha = 1;
    }
    for (const t of [inicio, fim]) {
      if (t === null) continue;
      c.beginPath();
      c.moveTo(x(t), Y_FAIXA);
      c.lineTo(x(t), ALTURA);
      c.stroke();
    }
    c.lineWidth = 1;
  }, [largura, vista, p.ondas, cortesVisiveis, p.selecao, p.corteAtivo, provisorio, cores, span, picoMax, sprite,
    p.miniaturas]);

  // Cursor de reprodução e linha do mouse numa camada própria, redesenhada a cada quadro sem tocar no resto
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const relogio = useRef(p.relogio);
  relogio.current = p.relogio;
  useEffect(() => {
    const el = cursor.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(largura * dpr);
    el.height = Math.round(ALTURA * dpr);
    const c = el.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = "11px system-ui, sans-serif";
    c.textBaseline = "middle";
    let raf = 0;
    let ultimo = "";
    const laco = () => {
      const { a, b } = vistaRef.current;
      const xc = ((relogio.current() - a) / (b - a)) * largura;
      const xm = mouseX.current;
      const chave = `${xc.toFixed(1)}|${xm ?? ""}`;
      if (chave !== ultimo) {
        ultimo = chave;
        c.clearRect(0, 0, largura, ALTURA);
        if (xm !== null) {
          // linha fina e horário onde o mouse está
          const tm = a + (xm / largura) * (b - a);
          c.fillStyle = cores["--texto-sutil"];
          c.globalAlpha = 0.6;
          c.fillRect(Math.round(xm), Y_REGUA, 1, ALTURA - Y_REGUA);
          c.globalAlpha = 1;
          const rot = formatar(tm, b - a < 60);
          const lw = c.measureText(rot).width + 8;
          const lx = Math.min(largura - lw, Math.max(0, xm + 4));
          c.fillStyle = cores["--tl-regua"];
          c.fillRect(lx, 1, lw, Y_REGUA - 2);
          c.fillStyle = cores["--texto-sutil"];
          c.fillText(rot, lx + 4, Y_REGUA / 2);
        }
        if (xc >= 0 && xc <= largura) {
          c.strokeStyle = cores["--tl-cabeca"];
          c.fillStyle = cores["--tl-cabeca"];
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(xc, 0);
          c.lineTo(xc, ALTURA);
          c.stroke();
          c.beginPath();
          c.moveTo(xc - 6, 0);
          c.lineTo(xc + 6, 0);
          c.lineTo(xc, 8);
          c.fill();
        }
      }
      raf = requestAnimationFrame(laco);
    };
    raf = requestAnimationFrame(laco);
    return () => cancelAnimationFrame(raf);
  }, [largura, cores, vista]);

  function tempoEm(clientX: number): number {
    const r = canvas.current!.getBoundingClientRect();
    return Math.min(p.duracao, Math.max(0, vista.a + ((clientX - r.left) / r.width) * span));
  }

  /** O que está sob o mouse: borda de corte, corte (na faixa de cima), borda da seleção ou nada. */
  function alvoEm(clientX: number, clientY: number): Arraste | null {
    const r = canvas.current!.getBoundingClientRect();
    const y = clientY - r.top;
    const px = clientX - r.left;
    const x = (t: number) => ((t - vista.a) / span) * r.width;
    const t = tempoEm(clientX);
    if (y < Y_REGUA) return null;
    // bordas: o corte ativo tem preferência quando dois se encostam
    const ordem = [...p.cortes].sort((a, b) => Number(b.id === p.corteAtivo) - Number(a.id === p.corteAtivo));
    for (const c of ordem) {
      for (const lado of ["inicio", "fim"] as const) {
        if (Math.abs(x(c[lado]) - px) <= PEGA) return { tipo: "borda", id: c.id, lado, x0: clientX, movendo: false };
      }
    }
    const { inicio, fim } = p.selecao;
    if (inicio !== null && fim !== null && y >= Y_FAIXA) {
      for (const lado of ["inicio", "fim"] as const) {
        if (Math.abs(x(p.selecao[lado]!) - px) <= PEGA) return { tipo: "bordaSel", lado, x0: clientX, movendo: false };
      }
    }
    if (y <= Y_FAIXA) {
      const c = p.cortes.find((k) => t >= k.inicio && t <= k.fim);
      if (c) return { tipo: "mover", id: c.id, x0: clientX, t0: t, ini0: c.inicio, fim0: c.fim, movendo: false };
    }
    return null;
  }

  function aoPressionar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = alvoEm(e.clientX, e.clientY) ?? { tipo: "selecao", x0: e.clientX, t0: tempoEm(e.clientX), movendo: false };
  }

  function aoMover(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    mouseX.current = e.clientX - r.left;
    const a = arraste.current;
    if (!a) {
      const alvo = alvoEm(e.clientX, e.clientY);
      setPonteiro(!alvo ? "crosshair" : alvo.tipo === "mover" ? "grab" : "ew-resize");
      return;
    }
    if (!a.movendo && Math.abs(e.clientX - a.x0) > 3) a.movendo = true;
    if (!a.movendo) return;
    const t = tempoEm(e.clientX);
    if (a.tipo === "selecao") {
      p.onSelecao(Math.min(a.t0, t), Math.max(a.t0, t));
    } else if (a.tipo === "bordaSel") {
      const outro = p.selecao[a.lado === "inicio" ? "fim" : "inicio"]!;
      p.onSelecao(Math.min(outro, t), Math.max(outro, t));
    } else if (a.tipo === "borda") {
      const c = p.cortes.find((k) => k.id === a.id)!;
      const novo =
        a.lado === "inicio"
          ? { id: c.id, inicio: Math.min(t, c.fim - DUR_MIN), fim: c.fim }
          : { id: c.id, inicio: c.inicio, fim: Math.max(t, c.inicio + DUR_MIN) };
      setProvisorio(novo);
    } else {
      const dur = a.fim0 - a.ini0;
      const ini = Math.min(Math.max(0, a.ini0 + (t - a.t0)), Math.max(0, p.duracao - dur));
      setProvisorio({ id: a.id, inicio: ini, fim: ini + dur });
      setPonteiro("grabbing");
    }
  }

  function aoSoltar(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = arraste.current;
    arraste.current = null;
    if (!a) return;
    if (!a.movendo) {
      if (a.tipo === "mover") p.onCorte(a.id);
      else p.onSeek(tempoEm(e.clientX));
      return;
    }
    if ((a.tipo === "borda" || a.tipo === "mover") && provisorio) {
      p.onAjustarCorte(provisorio.id, Math.round(provisorio.inicio * 100) / 100, Math.round(provisorio.fim * 100) / 100);
    }
    setProvisorio(null);
  }

  function duploClique(e: React.MouseEvent<HTMLCanvasElement>) {
    const t = tempoEm(e.clientX);
    const c = p.cortes.find((k) => t >= k.inicio && t <= k.fim);
    if (c) focar(c.inicio, c.fim);
  }

  const ativo = p.cortes.find((c) => c.id === p.corteAtivo) ?? null;
  const podeRolar = span < p.duracao - 0.01;
  // barra de zoom em escala logarítmica: 0 = ver tudo, 100 = 2 s
  const nivel = spanTotal > SPAN_MIN ? (Math.log(spanTotal / span) / Math.log(spanTotal / SPAN_MIN)) * 100 : 0;

  return (
    <div className="timeline" ref={embrulho}>
      <div className="timeline-telas">
        <canvas
          ref={canvas}
          style={{ width: "100%", height: ALTURA, display: "block", cursor: ponteiro, touchAction: "none" }}
          onPointerDown={aoPressionar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerLeave={() => (mouseX.current = null)}
          onPointerCancel={() => {
            arraste.current = null;
            setProvisorio(null);
          }}
          onDoubleClick={duploClique}
        />
        <canvas ref={cursor} className="timeline-cursor" style={{ width: "100%", height: ALTURA }} aria-hidden />
      </div>
      <div className="timeline-controles">
        <button className="btn-icone" onClick={() => zoom(2, p.relogio())} title="Afastar (−)" aria-label="Afastar">
          <ZoomOut size={16} />
        </button>
        <input type="range" className="timeline-zoom" min={0} max={100} step={1} value={Math.round(nivel)}
          aria-label="Zoom da timeline" title="Zoom"
          onChange={(e) => {
            const s = spanTotal / Math.pow(spanTotal / SPAN_MIN, Number(e.target.value) / 100);
            const centro = p.relogio();
            setVista(limitar(centro - s / 2, s));
          }} />
        <button className="btn-icone" onClick={() => zoom(0.5, p.relogio())} title="Aproximar (+)" aria-label="Aproximar">
          <ZoomIn size={16} />
        </button>
        <button className="btn btn-peq" onClick={() => setVista({ a: 0, b: spanTotal })} title="Ver a live inteira (0)">
          <Maximize2 size={13} /> Tudo
        </button>
        {ativo && (
          <button className="btn btn-peq" onClick={() => focar(ativo.inicio, ativo.fim)}
            title="Aproximar no corte selecionado (ou dê dois cliques nele)">
            <Scissors size={13} /> No corte
          </button>
        )}
        <input
          type="range"
          className="timeline-rolagem"
          min={0}
          max={Math.max(0, p.duracao - span)}
          step={span / 200}
          value={vista.a}
          disabled={!podeRolar}
          onChange={(e) => setVista(limitar(Number(e.target.value), span))}
          aria-label="Mover a timeline"
        />
        <span className="sutil timeline-dica">
          Arraste para selecionar · puxe as bordas de um corte para ajustar · rolagem = zoom
        </span>
      </div>
    </div>
  );
}
