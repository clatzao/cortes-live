import { Download, Film, Play, X } from "lucide-react";
import Progresso from "../Progresso";
import { hms } from "./CartaoLive";
import "./ui.css";

export interface DadosItemFeed {
  id: number;
  nome: string;
  posicao_s: number;       // onde o corte começa na live
  nota: number;            // 0-100
  motivo?: string | null;
  miniatura?: string | null;
  estado: "criando" | "pronto" | "erro";
  progresso?: number;
  erro?: string | null;
}

export function Feed({ children, rotulo }: { children: React.ReactNode; rotulo: string }) {
  return (
    <ol className="feed" aria-label={rotulo} aria-live="polite" aria-relevant="additions">
      {children}
    </ol>
  );
}

export default function ItemFeed({ item, novo = false, aoAbrir, aoExportar, aoDescartar }: {
  item: DadosItemFeed;
  novo?: boolean;
  aoAbrir?: () => void;
  aoExportar?: () => void;
  aoDescartar?: () => void;
}) {
  return (
    <li className={`item-feed${novo ? " novo" : ""}`}>
      {item.miniatura ? (
        <img className="item-feed-thumb" src={item.miniatura} alt="" />
      ) : (
        <div className="item-feed-thumb" aria-hidden="true"><Film size={18} /></div>
      )}
      <div className="item-feed-texto">
        <div className="item-feed-nome">{item.nome}</div>
        <div className="item-feed-meta">
          <span>na live <time>{hms(item.posicao_s)}</time></span>
          <span>nota <span className="nota">{item.nota}</span></span>
        </div>
        {item.estado === "criando" && <Progresso valor={item.progresso ?? 0} texto="Criando o corte" />}
        {item.estado === "erro" && <div className="item-feed-erro">{item.erro || "Não deu para criar este corte."}</div>}
        {item.estado === "pronto" && item.motivo && <div className="item-feed-motivo" title={item.motivo}>{item.motivo}</div>}
      </div>
      <div className="item-feed-acoes">
        <button type="button" className="btn-icone" onClick={aoAbrir} disabled={item.estado !== "pronto" || !aoAbrir} aria-label={`Abrir ${item.nome}`}
          title={aoAbrir ? "Abrir no editor" : "Abre no editor quando a live terminar"}>
          <Play size={15} aria-hidden="true" />
        </button>
        <button type="button" className="btn-icone" onClick={aoExportar} disabled={item.estado !== "pronto" || !aoExportar} aria-label={`Exportar ${item.nome}`}
          title={aoExportar ? "Exportar" : "Atravessa uma queda da live: exporta quando a live terminar"}>
          <Download size={15} aria-hidden="true" />
        </button>
        <button type="button" className="btn-icone" onClick={aoDescartar} disabled={!aoDescartar} aria-label={`Descartar ${item.nome}`} title="Descartar">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
