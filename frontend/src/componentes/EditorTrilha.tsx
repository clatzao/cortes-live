import { KeyboardEvent, PointerEvent, useRef } from "react";
import { focoEm } from "../api";

const PINCEL_S = 0.6; // quanto tempo em volta do ponto a correção alcança (esmaece até a borda)
const PASSO_X = 0.02; // setas ↑/↓
const PASSO_T = 0.5; // setas ←/→

/** Aplica uma correção de posição em volta do instante t (pincel suave). */
export function pincelar(pontos: [number, number][], t: number, x: number): [number, number][] {
  return pontos.map(([pt, px]) => {
    const d = Math.abs(pt - t);
    if (d >= PINCEL_S) return [pt, px];
    const peso = 1 - d / PINCEL_S;
    return [pt, Math.round((px + (x - px) * peso) * 10000) / 10000];
  });
}

/**
 * Gráfico da posição do recorte ao longo do corte (esquerda → direita = começo → fim; em cima = esquerda
 * do vídeo). Arrastar corrige a posição naquele trecho; teclado: ←/→ anda no tempo, ↑/↓ move o recorte.
 */
export default function EditorTrilha({ pontos, duracao, t, onT, onPontos }: {
  pontos: [number, number][];
  duracao: number;
  t: number;
  onT: (t: number) => void;
  onPontos: (p: [number, number][]) => void;
}) {
  const area = useRef<SVGSVGElement>(null);
  const ultimo = useRef<{ t: number; x: number } | null>(null);
  const L = 1000;
  const A = 100;
  const caminho = pontos.map(([pt, px], i) => `${i ? "L" : "M"}${((pt / duracao) * L).toFixed(1)},${(px * A).toFixed(1)}`).join(" ");
  const xAgora = focoEm(pontos, t);

  function aplicar(e: PointerEvent<SVGSVGElement>) {
    if (e.type === "pointermove" && e.buttons !== 1) return;
    const r = area.current!.getBoundingClientRect();
    const novoT = Math.min(duracao, Math.max(0, ((e.clientX - r.left) / r.width) * duracao));
    const novoX = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const antes = e.type === "pointerdown" ? null : ultimo.current;
    ultimo.current = { t: novoT, x: novoX };
    let novos = pontos;
    if (antes) {
      // o mouse pula entre eventos num arrasto rápido: preenche o caminho entre o ponto anterior e este
      const [a, b] = antes.t <= novoT ? [antes, { t: novoT, x: novoX }] : [{ t: novoT, x: novoX }, antes];
      novos = novos.map(([pt, px]) =>
        pt >= a.t && pt <= b.t ? [pt, Math.round((a.x + ((b.x - a.x) * (pt - a.t)) / Math.max(1e-6, b.t - a.t)) * 10000) / 10000] : [pt, px],
      );
    }
    onT(novoT);
    onPontos(pincelar(novos, novoT, novoX));
  }

  function teclado(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onT(Math.min(duracao, Math.max(0, t + (e.key === "ArrowRight" ? PASSO_T : -PASSO_T))));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const novoX = Math.min(1, Math.max(0, xAgora + (e.key === "ArrowDown" ? PASSO_X : -PASSO_X)));
      onPontos(pincelar(pontos, t, novoX));
    }
  }

  return (
    <div className="editor-trilha">
      <svg
        ref={area}
        viewBox={`0 0 ${L} ${A}`}
        preserveAspectRatio="none"
        role="slider"
        tabIndex={0}
        aria-label="Posição do recorte ao longo do corte"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(xAgora * 100)}
        aria-valuetext={`${Math.round(xAgora * 100)}% da largura aos ${t.toFixed(1)} s`}
        onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), aplicar(e))}
        onPointerMove={aplicar}
        onKeyDown={teclado}
      >
        <line x1={0} x2={L} y1={A / 2} y2={A / 2} className="trilha-meio" />
        <path d={caminho} className="trilha-linha" vectorEffect="non-scaling-stroke" />
        <line x1={(t / duracao) * L} x2={(t / duracao) * L} y1={0} y2={A} className="trilha-agora" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="trilha-legenda sutil">
        <span>Arraste para corrigir um trecho. Teclado: ←/→ anda, ↑/↓ move o recorte.</span>
        <span>esquerda do vídeo em cima · direita embaixo</span>
      </div>
    </div>
  );
}
