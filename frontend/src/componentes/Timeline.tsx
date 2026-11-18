import { useEffect, useMemo, useRef, useState } from "react";
import { Corte, Ondas } from "../api";
import { formatar } from "../tempo";

interface Props {
  duracao: number;
  ondas: Ondas | null;
  tempo: number;
  tocando: boolean;
  cortes: Corte[];
  corteAtivo: number | null;
  selecao: { inicio: number | null; fim: number | null };
  onSeek: (t: number) => void;
  onSelecao: (inicio: number, fim: number) => void;
  onCorte: (id: number) => void;
}

const ALTURA = 160;
const Y_REGUA = 20;
const Y_FAIXA = 40; // faixa com os cortes vai de Y_REGUA até Y_FAIXA
const PASSOS = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const SPAN_MIN = 2;

function cor(nome: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || "#888";
}

export default function Timeline(p: Props) {
  const embrulho = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [largura, setLargura] = useState(800);
  const [vista, setVista] = useState({ a: 0, b: Math.max(p.duracao, SPAN_MIN) });
  const [versaoTema, setVersaoTema] = useState(0);
  const arraste = useRef<{ x0: number; t0: number; movendo: boolean } | null>(null);

  const span = vista.b - vista.a;
  const picoMax = useMemo(() => {
    let m = 1;
    for (const v of p.ondas?.picos ?? []) if (v > m) m = v;
    return m;
  }, [p.ondas]);

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
    s = Math.min(Math.max(s, SPAN_MIN), Math.max(p.duracao, SPAN_MIN));
    a = Math.min(Math.max(0, a), Math.max(0, p.duracao - s));
    return { a, b: a + s };
  }

  function zoom(fator: number, centro: number) {
    setVista((v) => {
      const s = v.b - v.a;
      const novo = Math.min(Math.max(s * fator, SPAN_MIN), Math.max(p.duracao, SPAN_MIN));
      return limitar(centro - (centro - v.a) * (novo / s), novo);
    });
  }

  // Acompanha a reprodução quando o cursor sai da área visível
  useEffect(() => {
    if (p.tocando && (p.tempo > vista.b || p.tempo < vista.a)) setVista(limitar(p.tempo - span * 0.1, span));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tempo, p.tocando]);

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

  // Desenho
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

    c.fillStyle = cor("--tl-fundo");
    c.fillRect(0, 0, w, ALTURA);

    // Régua
    const passo = PASSOS.find((s) => s * pps >= 90) ?? 7200;
    c.fillStyle = cor("--tl-regua");
    c.fillRect(0, 0, w, Y_REGUA);
    c.strokeStyle = cor("--tl-linha");
    c.fillStyle = cor("--texto-sutil");
    c.font = "11px system-ui, sans-serif";
    c.textBaseline = "middle";
    c.beginPath();
    for (let t = Math.floor(vista.a / passo) * passo; t <= vista.b; t += passo) {
      const px = Math.round(x(t)) + 0.5;
      c.moveTo(px, Y_REGUA - 6);
      c.lineTo(px, ALTURA);
      c.fillText(formatar(t, passo < 1), px + 4, Y_REGUA / 2);
    }
    c.stroke();

    // Forma de onda
    const meio = (Y_FAIXA + ALTURA) / 2;
    const alturaOnda = (ALTURA - Y_FAIXA) / 2 - 4;
    if (p.ondas) {
      const { taxa, picos } = p.ondas;
      c.fillStyle = cor("--tl-onda");
      for (let px = 0; px < w; px++) {
        const t1 = vista.a + px / pps;
        const i1 = Math.floor(t1 * taxa);
        const i2 = Math.max(i1 + 1, Math.floor((t1 + 1 / pps) * taxa));
        let v = 0;
        for (let i = i1; i < i2 && i < picos.length; i++) if (picos[i] > v) v = picos[i];
        const h = Math.max(1, (v / picoMax) * alturaOnda);
        c.fillRect(px, meio - h, 1, h * 2);
      }
    }

    // Cortes
    c.font = "11px system-ui, sans-serif";
    for (const corte of p.cortes) {
      if (corte.fim < vista.a || corte.inicio > vista.b) continue;
      const x1 = Math.max(0, x(corte.inicio));
      const x2 = Math.min(w, x(corte.fim));
      const ativo = corte.id === p.corteAtivo;
      c.fillStyle = cor(ativo ? "--destaque" : "--tl-corte");
      c.fillRect(x1, Y_REGUA + 2, Math.max(2, x2 - x1), Y_FAIXA - Y_REGUA - 4);
      c.globalAlpha = ativo ? 0.22 : 0.12;
      c.fillRect(x1, Y_FAIXA, Math.max(2, x2 - x1), ALTURA - Y_FAIXA);
      c.globalAlpha = 1;
      if (x2 - x1 > 40) {
        c.fillStyle = cor("--tl-corte-texto");
        c.save();
        c.beginPath();
        c.rect(x1, Y_REGUA, x2 - x1 - 4, Y_FAIXA - Y_REGUA);
        c.clip();
        c.fillText(corte.nome, x1 + 4, (Y_REGUA + Y_FAIXA) / 2);
        c.restore();
      }
    }

    // Seleção atual
    const { inicio, fim } = p.selecao;
    c.strokeStyle = cor("--tl-selecao");
    c.lineWidth = 2;
    if (inicio !== null && fim !== null) {
      c.fillStyle = cor("--tl-selecao");
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

    // Cursor de reprodução
    const xc = x(p.tempo);
    if (xc >= 0 && xc <= w) {
      c.strokeStyle = cor("--tl-cabeca");
      c.fillStyle = cor("--tl-cabeca");
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
      c.lineWidth = 1;
    }
  }, [largura, vista, p.tempo, p.ondas, p.cortes, p.selecao, p.corteAtivo, versaoTema, span, picoMax]);

  function tempoEm(clientX: number): number {
    const r = canvas.current!.getBoundingClientRect();
    return Math.min(p.duracao, Math.max(0, vista.a + ((clientX - r.left) / r.width) * span));
  }

  function aoPressionar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const t = tempoEm(e.clientX);
    if (y >= Y_REGUA && y <= Y_FAIXA) {
      const achado = p.cortes.find((c) => t >= c.inicio && t <= c.fim);
      if (achado) {
        p.onCorte(achado.id);
        return;
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { x0: e.clientX, t0: t, movendo: false };
  }

  function aoMover(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = arraste.current;
    if (!a) return;
    if (!a.movendo && Math.abs(e.clientX - a.x0) > 4) a.movendo = true;
    if (a.movendo) {
      const t = tempoEm(e.clientX);
      p.onSelecao(Math.min(a.t0, t), Math.max(a.t0, t));
    }
  }

  function aoSoltar(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = arraste.current;
    arraste.current = null;
    if (a && !a.movendo) p.onSeek(tempoEm(e.clientX));
  }

  const podeRolar = span < p.duracao - 0.01;

  return (
    <div className="timeline" ref={embrulho}>
      <canvas
        ref={canvas}
        style={{ width: "100%", height: ALTURA, display: "block", cursor: "crosshair", touchAction: "none" }}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={() => (arraste.current = null)}
      />
      <div className="timeline-controles">
        <button className="btn btn-peq" onClick={() => zoom(0.5, p.tempo)} title="Aproximar">
          +
        </button>
        <button className="btn btn-peq" onClick={() => zoom(2, p.tempo)} title="Afastar">
          −
        </button>
        <button className="btn btn-peq" onClick={() => setVista({ a: 0, b: Math.max(p.duracao, SPAN_MIN) })}>
          Ver tudo
        </button>
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
        <span className="sutil timeline-dica">Rolagem = zoom · Shift+rolagem = mover · arraste = selecionar</span>
      </div>
    </div>
  );
}
