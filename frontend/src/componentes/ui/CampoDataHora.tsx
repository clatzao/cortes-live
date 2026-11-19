import { useId } from "react";
import SeletorSegmentado from "./SeletorSegmentado";
import "./ui.css";

const FUSO = "America/Sao_Paulo";
const LIMITE_DIAS = 30;

/** Partes de data/hora em Brasília para um instante (epoch ms). */
function partes(ms: number): { data: string; hora: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "00";
  return { data: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
}

/** Data + hora digitadas (horário de Brasília) para epoch ms. O Brasil não tem horário de verão desde 2019: UTC-3. */
function paraEpoch(data: string, hora: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const ms = Date.parse(`${data}T${hora}:00-03:00`);
  return Number.isNaN(ms) ? null : ms;
}

export function erroDoHorario(ms: number | null, agora = Date.now()): string | null {
  if (ms === null) return "Escolha a data e a hora.";
  if (ms < agora + 60_000) return "Esse horário já passou.";
  if (ms > agora + LIMITE_DIAS * 86_400_000) return `Dá para agendar até ${LIMITE_DIAS} dias à frente.`;
  return null;
}

/** `valor` = null publica agora; um número (epoch ms) agenda. */
export default function CampoDataHora({ valor, aoMudar, desabilitado = false }: {
  valor: number | null;
  aoMudar: (v: number | null) => void;
  desabilitado?: boolean;
}) {
  const id = useId();
  const modo = valor === null ? "agora" : "agendar";
  const atual = valor === null ? partes(Date.now() + 3_600_000) : partes(valor);
  const erro = valor === null ? null : erroDoHorario(valor);

  function mudar(data: string, hora: string) {
    const ms = paraEpoch(data, hora);
    if (ms !== null) aoMudar(ms);
  }

  function atalho(diasAFrente: number, hora?: string) {
    if (hora === undefined) return aoMudar(Date.now() + 3_600_000);
    const amanha = partes(Date.now() + diasAFrente * 86_400_000);
    mudar(amanha.data, hora);
  }

  return (
    <fieldset className="campo-data" disabled={desabilitado}>
      <legend>Quando publicar</legend>
      <SeletorSegmentado
        rotulo="Quando publicar"
        valor={modo}
        opcoes={[{ valor: "agora", rotulo: "Agora" }, { valor: "agendar", rotulo: "Agendar" }]}
        aoMudar={(v) => aoMudar(v === "agora" ? null : Date.now() + 3_600_000)}
        desabilitado={desabilitado}
      />
      {modo === "agendar" && (
        <>
          <div className="campo-data-linha">
            <input
              type="date"
              aria-label="Data"
              value={atual.data}
              onChange={(e) => mudar(e.target.value, atual.hora)}
              aria-invalid={!!erro}
              aria-describedby={`${id}-dica ${erro ? `${id}-erro` : ""}`}
            />
            <input
              type="time"
              aria-label="Hora"
              value={atual.hora}
              onChange={(e) => mudar(atual.data, e.target.value)}
              aria-invalid={!!erro}
              aria-describedby={`${id}-dica ${erro ? `${id}-erro` : ""}`}
            />
            <button type="button" className="btn" onClick={() => atalho(0)}>+1 h</button>
            <button type="button" className="btn" onClick={() => atalho(1, "12:00")}>Amanhã 12:00</button>
            <button type="button" className="btn" onClick={() => atalho(1, "18:00")}>Amanhã 18:00</button>
          </div>
          <div id={`${id}-dica`} className="campo-data-dica">Horário de Brasília. O Cortes Live precisa estar aberto ou na bandeja.</div>
          {erro && <div id={`${id}-erro`} className="campo-data-erro" role="alert">{erro}</div>}
        </>
      )}
    </fieldset>
  );
}
