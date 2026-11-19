import { KeyboardEvent, ReactNode, useRef } from "react";
import "./ui.css";

export interface Opcao<T extends string> {
  valor: T;
  rotulo: string;
  icone?: ReactNode;
  desabilitada?: boolean;
}

/** Grupo de opções exclusivas (radiogroup): setas mudam a escolha, Home/End vão às pontas. */
export default function SeletorSegmentado<T extends string>({ opcoes, valor, aoMudar, rotulo, tamanho = "md", desabilitado = false }: {
  opcoes: Opcao<T>[];
  valor: T;
  aoMudar: (v: T) => void;
  rotulo: string;
  tamanho?: "sm" | "md";
  desabilitado?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ativas = opcoes.map((o, i) => (o.desabilitada || desabilitado ? -1 : i)).filter((i) => i >= 0);

  function teclado(e: KeyboardEvent, i: number) {
    const pos = ativas.indexOf(i);
    let alvo: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") alvo = ativas[(pos + 1) % ativas.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") alvo = ativas[(pos - 1 + ativas.length) % ativas.length];
    else if (e.key === "Home") alvo = ativas[0];
    else if (e.key === "End") alvo = ativas[ativas.length - 1];
    if (alvo === undefined) return;
    e.preventDefault();
    aoMudar(opcoes[alvo].valor);
    refs.current[alvo]?.focus();
  }

  return (
    <div className={`segmentado${tamanho === "sm" ? " segmentado-sm" : ""}`} role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o, i) => {
        const marcada = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={marcada}
            tabIndex={marcada ? 0 : -1}
            disabled={desabilitado || o.desabilitada}
            onClick={() => aoMudar(o.valor)}
            onKeyDown={(e) => teclado(e, i)}
          >
            {o.icone}
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
