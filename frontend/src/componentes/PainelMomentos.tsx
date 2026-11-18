import { useEffect, useState } from "react";
import { api, avisar, Corte, erroTexto, Job, Sugestao } from "../api";
import { duracaoCurta, formatar } from "../tempo";

interface Props {
  projetoId: number;
  temTranscricao: boolean;
  /** job de análise mais recente deste projeto */
  job: Job | null;
  onSeek: (t: number) => void;
  onPrevia: (inicio: number, fim: number) => void;
  onCorteCriado: (c: Corte) => void;
}

function corNota(n: number): string {
  if (n >= 80) return "nota-alta";
  if (n >= 60) return "nota-media";
  return "nota-baixa";
}

export default function PainelMomentos({ projetoId, temTranscricao, job, onSeek, onPrevia, onCorteCriado }: Props) {
  const [lista, setLista] = useState<Sugestao[] | null>(null);
  const [min, setMin] = useState(30);
  const [max, setMax] = useState(60);
  const [qtd, setQtd] = useState(10);
  const [enviando, setEnviando] = useState(false);

  const ativo = job?.status === "na_fila" || job?.status === "executando";

  useEffect(() => {
    api
      .ajustes()
      .then((a) => {
        setMin(a.viral_min);
        setMax(a.viral_max);
        setQtd(a.viral_qtd);
      })
      .catch(() => {});
  }, []);

  // recarrega quando a análise termina
  useEffect(() => {
    if (ativo) return;
    api.sugestoes(projetoId).then(setLista).catch(() => setLista([]));
  }, [projetoId, ativo, job?.id]);

  async function analisar() {
    if (max < min) {
      avisar("A duração máxima precisa ser maior que a mínima.", "erro");
      return;
    }
    setEnviando(true);
    try {
      await api.analisar(projetoId, { min, max, qtd });
      avisar("Análise na fila. As sugestões aparecem aqui quando terminar.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function aceitar(s: Sugestao) {
    try {
      const c = await api.aceitarSugestao(s.id);
      onCorteCriado(c);
      setLista((l) => l && l.map((x) => (x.id === s.id ? { ...x, status: "aceita", corte_id: c.id } : x)));
      avisar(`"${c.nome}" virou corte.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function descartar(s: Sugestao) {
    try {
      await api.descartarSugestao(s.id);
      setLista((l) => l && l.filter((x) => x.id !== s.id));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  return (
    <div className="momentos">
      <div className="momentos-topo">
        <div className="margens">
          <label>
            De
            <input type="number" min={5} max={600} value={min} onChange={(e) => setMin(Number(e.target.value) || 5)} />
          </label>
          <label>
            até
            <input type="number" min={5} max={900} value={max} onChange={(e) => setMax(Number(e.target.value) || 5)} />
            s
          </label>
          <label>
            Quantos
            <input type="number" min={1} max={50} value={qtd} onChange={(e) => setQtd(Number(e.target.value) || 1)} />
          </label>
        </div>
        <button className="btn btn-primario" onClick={analisar} disabled={!temTranscricao || ativo || enviando}>
          {ativo ? "Analisando…" : lista && lista.length ? "Analisar de novo" : "Encontrar momentos virais"}
        </button>
        {!temTranscricao && <p className="sutil">A análise usa a transcrição. Aguarde ela terminar.</p>}
        {ativo && (
          <div className="transcricao-status">
            <div className="progresso-barra">
              <div className="progresso-cheio" style={{ width: `${Math.round((job?.progresso ?? 0) * 100)}%` }} />
            </div>
            <span className="sutil">{job?.mensagem}</span>
          </div>
        )}
        {job?.status === "concluido" && job.saida && <p className="sutil aviso-analise">{job.saida}</p>}
        {job?.status === "erro" && <p className="erro-texto">{job.mensagem}</p>}
      </div>

      <div className="lista-momentos">
        {lista?.length === 0 && !ativo && temTranscricao && (
          <p className="sutil">Nenhuma sugestão ainda. Clique em "Encontrar momentos virais".</p>
        )}
        {lista?.map((s) => (
          <div key={s.id} className={`momento ${s.status === "aceita" ? "momento-aceito" : ""}`}>
            <div className="momento-topo">
              <span className={`nota ${corNota(s.nota)}`} title="Chance de viralizar (0 a 100)">
                {s.nota}
              </span>
              <strong className="momento-nome">{s.nome}</strong>
              <span className="sutil" title="Volume/agitação do trecho">
                ⚡{s.energia}
              </span>
            </div>
            <button className="acerto-tempo" onClick={() => onSeek(s.inicio)}>
              {formatar(s.inicio, false)} → {formatar(s.fim, false)} ({duracaoCurta(s.fim - s.inicio)})
            </button>
            {s.motivo && <p className="momento-motivo">{s.motivo}</p>}
            {s.gancho && <p className="momento-gancho">“{s.gancho}”</p>}
            <div className="acoes">
              <button className="btn btn-peq" onClick={() => onPrevia(s.inicio, s.fim)}>
                ▶ Assistir
              </button>
              {s.status === "aceita" ? (
                <span className="status status-concluido">✓ Virou corte</span>
              ) : (
                <>
                  <button className="btn btn-peq btn-primario" onClick={() => aceitar(s)}>
                    Virar corte
                  </button>
                  <button className="btn btn-peq btn-perigo" onClick={() => descartar(s)}>
                    Descartar
                  </button>
                </>
              )}
              {s.origem === "sinais" && <span className="chip-formato" title="Sem IA: só volume e palavras">sinais</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
