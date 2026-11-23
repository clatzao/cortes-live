import { useEffect, useState } from "react";
import { Play, Scissors, Sparkles, X } from "lucide-react";
import { api, avisar, Corte, erroTexto, Job, Sugestao } from "../api";
import AvisoGemini from "./AssistenteGemini";
import { custoAnalise, duracaoCurta, formatar } from "../tempo";

interface Props {
  projetoId: number;
  temTranscricao: boolean;
  /** job de análise mais recente deste projeto */
  job: Job | null;
  onSeek: (t: number) => void;
  onPrevia: (inicio: number, fim: number) => void;
  onCorteCriado: (c: Corte) => void;
  onCortesCriados: (lista: Corte[]) => void;
  /** duração do vídeo, para a linha de custo */
  duracao?: number | null;
}

function corNota(n: number): string {
  if (n >= 80) return "nota-alta";
  if (n >= 60) return "nota-media";
  return "nota-baixa";
}

export default function PainelMomentos({ projetoId, temTranscricao, job, onSeek, onPrevia, onCorteCriado, onCortesCriados, duracao }: Props) {
  const [lista, setLista] = useState<Sugestao[] | null>(null);
  const [min, setMin] = useState(30);
  const [max, setMax] = useState(60);
  const [qtd, setQtd] = useState(10);
  const [enviando, setEnviando] = useState(false);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

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
    setMarcados(new Set());
  }, [projetoId, ativo, job?.id]);

  const pendentes = (lista ?? []).filter((s) => s.status !== "aceita");
  const todosMarcados = pendentes.length > 0 && pendentes.every((s) => marcados.has(s.id));

  function marcar(id: number, sim: boolean) {
    setMarcados((m) => {
      const n = new Set(m);
      if (sim) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function aceitarMarcados() {
    const ids = pendentes.filter((s) => marcados.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    try {
      const criados = await api.aceitarSugestoes(projetoId, ids);
      onCortesCriados(criados);
      api.sugestoes(projetoId).then(setLista).catch(() => {});
      setMarcados(new Set());
      avisar(`${criados.length} corte(s) criado(s). Veja na aba Cortes.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

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
        <button className="btn btn-primario" onClick={analisar} disabled={!temTranscricao || ativo || enviando}
          title="A IA lê a live e sugere os trechos com mais chance de viralizar">
          <Sparkles size={15} />
          {ativo ? "Analisando…" : lista && lista.length ? "Analisar de novo" : "Encontrar momentos virais"}
        </button>
        <AvisoGemini motivo="Sem o Gemini, os momentos são escolhidos só por volume e palavras-chave." />
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
        {job?.status === "concluido" && !!duracao && <p className="sutil custo-zero">{custoAnalise(duracao)}</p>}
        {job?.status === "erro" && <p className="erro-texto">{job.mensagem}</p>}
      </div>

      {pendentes.length > 1 && (
        <div className="barra-marcados">
          <label className="corte-check">
            <input type="checkbox" checked={todosMarcados}
              onChange={(e) => setMarcados(e.target.checked ? new Set(pendentes.map((s) => s.id)) : new Set())} />
            Marcar todos
          </label>
          <button className="btn btn-peq btn-primario empurrar-direita" disabled={!marcados.size} onClick={aceitarMarcados}
            title="Cria um corte para cada momento marcado">
            <Scissors size={13} /> Virar {marcados.size || ""} corte(s)
          </button>
        </div>
      )}

      <div className="lista-momentos">
        {lista?.length === 0 && !ativo && temTranscricao && (
          <p className="sutil">Nenhuma sugestão ainda. Clique em "Encontrar momentos virais".</p>
        )}
        {lista?.map((s) => (
          <div key={s.id} className={`momento ${s.status === "aceita" ? "momento-aceito" : ""}`}>
            <div className="momento-topo">
              {s.status !== "aceita" && (
                <input type="checkbox" className="momento-marca" checked={marcados.has(s.id)}
                  onChange={(e) => marcar(s.id, e.target.checked)} aria-label={`Marcar ${s.nome}`} />
              )}
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
              <button className="btn btn-peq" onClick={() => onPrevia(s.inicio, s.fim)} title="Assistir este trecho">
                <Play size={13} /> Assistir
              </button>
              {s.status === "aceita" ? (
                <span className="status status-concluido">✓ Virou corte</span>
              ) : (
                <>
                  <button className="btn btn-peq btn-primario" onClick={() => aceitar(s)}
                    title="Cria um corte com este trecho, nome e gancho">
                    <Scissors size={13} /> Virar corte
                  </button>
                  <button className="btn-icone btn-perigo empurrar-direita" onClick={() => descartar(s)}
                    title="Descartar sugestão" aria-label="Descartar sugestão">
                    <X size={15} />
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
