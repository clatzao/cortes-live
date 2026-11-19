import { useState } from "react";
import { Radio, RotateCcw, Square, Twitch, Youtube } from "lucide-react";
import StatusPill, { Estado } from "./StatusPill";
import Medidor from "./Medidor";
import "./ui.css";

export type Plataforma = "twitch" | "kick" | "youtube";
export type EstadoLive = "aguardando" | "gravando" | "reconectando" | "finalizando" | "encerrada" | "erro";

export interface DadosLive {
  plataforma: Plataforma;
  canal: string;
  status: EstadoLive;
  gravado_s: number;
  cortes: number;
  disco_livre_gb?: number;
  erro?: string | null;
}

const NOME: Record<Plataforma, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

export function IconePlataforma({ p, tamanho = 16 }: { p: Plataforma; tamanho?: number }) {
  if (p === "twitch") return <Twitch size={tamanho} aria-hidden="true" />;
  if (p === "youtube") return <Youtube size={tamanho} aria-hidden="true" />;
  return <Radio size={tamanho} aria-hidden="true" />;
}

export function hms(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const PILL: Record<EstadoLive, Estado> = {
  aguardando: "aguardando",
  gravando: "ao_vivo",
  reconectando: "reconectando",
  finalizando: "finalizando",
  encerrada: "encerrada",
  erro: "falhou",
};

export default function CartaoLive({ live, compacto = false, aoParar, aoTentar }: {
  live: DadosLive;
  compacto?: boolean;
  aoParar?: () => void;
  aoTentar?: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const ativa = live.status === "aguardando" || live.status === "gravando" || live.status === "reconectando";
  const ritmo = live.gravado_s > 600 ? Math.round(live.cortes / (live.gravado_s / 3600)) : null;

  return (
    <article
      className={`cartao-live${compacto ? " compacto" : ""}${live.status === "gravando" ? " gravando" : ""}`}
      aria-label={`Live de ${live.canal} na ${NOME[live.plataforma]}`}
    >
      <div className="cartao-live-topo">
        <div className="cartao-live-canal">
          <IconePlataforma p={live.plataforma} />
          <span>{live.canal}</span>
        </div>
        <StatusPill estado={PILL[live.status]} tamanho={compacto ? "sm" : "md"} anunciar />
        {ativa && aoParar && !confirmar && (
          <button type="button" className="btn btn-perigo" onClick={() => setConfirmar(true)}>
            <Square size={14} aria-hidden="true" /> Parar
          </button>
        )}
        {confirmar && (
          <span className="design-linha" style={{ marginLeft: "auto" }}>
            <span className="sutil">Parar de gravar?</span>
            <button type="button" className="btn" onClick={() => setConfirmar(false)}>Continuar</button>
            <button type="button" className="btn btn-perigo" autoFocus onClick={() => { setConfirmar(false); aoParar?.(); }}>
              Parar agora
            </button>
          </span>
        )}
        {live.status === "erro" && aoTentar && (
          <button type="button" className="btn" onClick={aoTentar}>
            <RotateCcw size={14} aria-hidden="true" /> Tentar de novo
          </button>
        )}
      </div>

      {live.status === "aguardando" && <div className="sutil">Esperando o canal entrar ao vivo. Confere a cada minuto.</div>}
      {live.status === "erro" && live.erro && <div className="cartao-live-erro">{live.erro}</div>}

      {live.status !== "aguardando" && !(live.status === "erro" && live.gravado_s === 0) && (
        <div className="cartao-live-numeros">
          <div className="numero">
            <b>{hms(live.gravado_s)}</b>
            <small>gravado</small>
          </div>
          <div className="numero">
            <b>{live.cortes}</b>
            <small>{live.cortes === 1 ? "corte criado" : "cortes criados"}</small>
          </div>
          {ritmo !== null && !compacto && (
            <div className="numero">
              <b>{ritmo}/h</b>
              <small>ritmo</small>
            </div>
          )}
          {live.disco_livre_gb !== undefined && !compacto && (
            <Medidor
              rotulo="Disco livre"
              valor={live.disco_livre_gb}
              max={Math.max(100, live.disco_livre_gb)}
              texto={`${live.disco_livre_gb.toFixed(0)} GB`}
              aviso={10}
              critico={2}
            />
          )}
        </div>
      )}
    </article>
  );
}
