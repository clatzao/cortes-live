import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine, FileText, Keyboard, ListPlus, Pause, Play, RefreshCw, Scissors,
  Sparkles, Upload,
} from "lucide-react";

const ATALHOS: [string[], string][] = [
  [["Espaço"], "tocar/pausar"],
  [["I"], "início"],
  [["O"], "fim"],
  [["Enter"], "criar corte"],
  [["Esc"], "limpar seleção"],
  [["←", "→"], "1 s (Shift 5 s)"],
  [[",", "."], "0,1 s"],
  [["+", "−"], "zoom"],
];
import { api, avisar, Corte, erroTexto, Estilo, Formato, Idioma, Job, Marca, Miniaturas, Ondas, Projeto } from "../api";
import JanelaCorte, { AbaCorte } from "../componentes/JanelaCorte";
import PainelMomentos from "../componentes/PainelMomentos";
import Timeline from "../componentes/Timeline";
import CorteItem from "../componentes/CorteItem";
import PainelTranscricao from "../componentes/PainelTranscricao";
import { formatar, duracaoCurta } from "../tempo";

interface Selecao {
  inicio: number | null;
  fim: number | null;
}

export default function Editor({ id, fila }: { id: number; fila: Job[] }) {
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [ondas, setOndas] = useState<Ondas | null>(null);
  const [miniaturas, setMiniaturas] = useState<{ meta: Miniaturas; url: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tempo, setTempo] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [selecao, setSelecao] = useState<Selecao>({ inicio: null, fim: null });
  const [corteAtivo, setCorteAtivo] = useState<number | null>(null);
  const [aba, setAba] = useState<"momentos" | "cortes" | "transcricao" | "timestamps">("momentos");
  const [textoLote, setTextoLote] = useState("");
  const [resultadoLote, setResultadoLote] = useState<string | null>(null);
  const [estilos, setEstilos] = useState<Estilo[]>([]);
  const [listaFormatos, setListaFormatos] = useState<Formato[]>([]);
  const [marca, setMarca] = useState<Marca | null>(null);
  const [janela, setJanela] = useState<{ corteId: number; aba: AbaCorte } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fimPrevia = useRef<number | null>(null);
  const tempoMostrado = useRef(0);
  const relogio = useCallback(() => video.current?.currentTime ?? tempoMostrado.current, []);

  useEffect(() => {
    api.estilos().then(setEstilos).catch(() => {});
    api.formatos().then(setListaFormatos).catch(() => {});
    api.marca().then(setMarca).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .projeto(id)
      .then((p) => {
        setProjeto(p);
        if (p.status !== "pronto") setErro("Este projeto ainda não terminou de processar.");
      })
      .catch((e) => setErro(erroTexto(e)));
    api.cortes(id).then(setCortes).catch(() => {});
    api.ondas(id).then(setOndas).catch(() => {});
  }, [id]);

  // Tira de quadros da timeline (projetos antigos: o servidor gera na primeira vez, ~5 s a cada 10 min de live)
  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout>;
    const tentar = (n: number) =>
      api
        .miniaturas(id)
        .then((m) => {
          if (!vivo) return;
          if (m) setMiniaturas({ meta: m, url: api.urlMiniaturas(id, m.versao) });
          else if (n < 120) espera = setTimeout(() => tentar(n + 1), 3000);
        })
        .catch(() => {});
    tentar(0);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [id]);

  async function ajustarCorte(cid: number, inicio: number, fim: number) {
    try {
      const novo = await api.editarCorte(cid, { inicio, fim });
      setCortes((l) => l.map((x) => (x.id === novo.id ? novo : x)).sort((a, b) => a.inicio - b.inicio));
      setCorteAtivo(cid);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  // Encerra a prévia no fim do corte. O tempo da tela (relógio, texto, cortes) só é atualizado ~5x/s
  // durante a reprodução: atualizar a cada quadro re-renderizava o editor inteiro 60x/s e travava tudo.
  // O cursor da timeline lê o vídeo direto, então continua suave.
  useEffect(() => {
    let raf = 0;
    const laco = () => {
      const v = video.current;
      if (v) {
        const t = v.currentTime;
        if (Math.abs(tempoMostrado.current - t) > (v.paused ? 0.005 : 0.2)) {
          tempoMostrado.current = t;
          setTempo(t);
        }
        if (fimPrevia.current !== null && t >= fimPrevia.current) {
          v.pause();
          fimPrevia.current = null;
        }
      }
      raf = requestAnimationFrame(laco);
    };
    raf = requestAnimationFrame(laco);
    return () => cancelAnimationFrame(raf);
  }, []);

  const duracao = projeto?.duracao ?? 0;

  const buscar = useCallback(
    (t: number) => {
      const v = video.current;
      const alvo = Math.min(Math.max(0, t), duracao);
      if (v) v.currentTime = alvo;
      tempoMostrado.current = alvo;
      setTempo(alvo);
    },
    [duracao],
  );

  const alternarPlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    fimPrevia.current = null;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  function tocarTrecho(inicio: number, fim: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = inicio;
    fimPrevia.current = fim;
    v.play().catch(() => {});
  }

  function previa(c: Corte) {
    setCorteAtivo(c.id);
    tocarTrecho(c.inicio, c.fim);
  }

  const adicionarCorte = useCallback(
    async (inicio: number, fim: number, nome?: string) => {
      try {
        const c = await api.criarCorte(id, inicio, fim, nome);
        setCortes((lista) => [...lista, c].sort((a, b) => a.inicio - b.inicio));
        setCorteAtivo(c.id);
        avisar(`"${c.nome}" criado (${duracaoCurta(c.fim - c.inicio)}).`);
        return true;
      } catch (e) {
        avisar(erroTexto(e), "erro");
        return false;
      }
    },
    [id],
  );

  const criarCorte = useCallback(async () => {
    let { inicio, fim } = selecao;
    if (inicio === null) {
      avisar("Marque o início (tecla I) ou arraste na timeline.", "erro");
      return;
    }
    if (fim === null) fim = relogio();
    if (fim < inicio) [inicio, fim] = [fim, inicio];
    if (await adicionarCorte(inicio, fim)) setSelecao({ inicio: null, fim: null });
  }, [selecao, relogio, adicionarCorte]);

  async function transcrever() {
    try {
      setProjeto(await api.transcrever(id));
      avisar("Transcrição colocada na fila.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function trocarIdioma(idioma: Idioma) {
    try {
      setProjeto(await api.editarProjeto(id, { idioma }));
      if (confirm("Idioma alterado. Transcrever de novo agora com o novo idioma?")) await transcrever();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  // Atalhos de teclado
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".modal-fundo")) return; // editor de legenda aberto
      const k = e.key.toLowerCase();
      const tempo = relogio();
      if (k === " ") {
        e.preventDefault();
        alternarPlay();
      } else if (k === "i") setSelecao((s) => ({ inicio: tempo, fim: s.fim !== null && s.fim > tempo ? s.fim : null }));
      else if (k === "o")
        setSelecao((s) => ({ inicio: s.inicio !== null && s.inicio < tempo ? s.inicio : null, fim: tempo }));
      else if (k === "enter") criarCorte();
      else if (k === "escape") setSelecao({ inicio: null, fim: null });
      else if (k === "arrowleft") buscar(tempo - (e.shiftKey ? 5 : 1));
      else if (k === "arrowright") buscar(tempo + (e.shiftKey ? 5 : 1));
      else if (k === ",") buscar(tempo - 0.1);
      else if (k === ".") buscar(tempo + 0.1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [relogio, alternarPlay, criarCorte, buscar]);

  async function criarLote() {
    try {
      const r = await api.criarEmLote(id, textoLote);
      setCortes((lista) => [...lista, ...r.criados].sort((a, b) => a.inicio - b.inicio));
      setResultadoLote(
        `${r.criados.length} corte(s) criado(s).` +
          (r.invalidas.length ? ` Ignoradas (${r.invalidas.length}): ${r.invalidas.join(" | ")}` : ""),
      );
      if (r.criados.length) {
        setTextoLote("");
        setAba("cortes");
      }
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function exportar(c: Corte) {
    try {
      const jobs = await api.exportarCorte(c.id);
      avisar(`${c.nome}: ${jobs.length} formato(s) na fila de exportação.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function exportarTodos() {
    if (!confirm(`Exportar os ${cortes.length} cortes nos formatos de cada um?`)) return;
    try {
      const r = await api.exportarProjeto(id);
      avisar(`${r.arquivos} arquivo(s) na fila de exportação.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function remover(c: Corte) {
    if (!confirm(`Excluir "${c.nome}"?`)) return;
    try {
      await api.apagarCorte(c.id);
      setCortes((l) => l.filter((x) => x.id !== c.id));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  if (erro)
    return (
      <div className="pagina">
        <p className="erro-texto">{erro}</p>
        <a className="btn" href="#/">
          Voltar
        </a>
      </div>
    );
  if (!projeto) return <div className="pagina sutil">Carregando…</div>;

  const jobsDoCorte = (corteId: number) => fila.filter((j) => j.tipo === "exportar" && j.corte_id === corteId);
  const jobTranscricao =
    fila.find((j) => j.tipo === "transcrever" && j.projeto_id === id) ?? projeto.job_transcricao ?? null;
  const jobAnalise = fila.find((j) => j.tipo === "analisar" && j.projeto_id === id) ?? null;
  const temTranscricao = projeto.tem_transcricao || jobTranscricao?.status === "concluido";
  const durSel =
    selecao.inicio !== null ? Math.abs((selecao.fim ?? tempo) - selecao.inicio) : null;

  return (
    <div className="editor">
      <div className="editor-principal">
        <div className="editor-cabecalho">
          <a href="#/" className="btn btn-peq" title="Voltar para a lista de projetos">
            <ArrowLeft size={14} /> Projetos
          </a>
          <h1 title={projeto.nome}>{projeto.nome}</h1>
          <span className="sutil">
            {duracaoCurta(duracao)} · {projeto.largura}×{projeto.altura}
          </span>
          <div className="editor-cabecalho-dir">
            <label className="sutil" htmlFor="idioma">
              Idioma
            </label>
            <select id="idioma" value={projeto.idioma} onChange={(e) => trocarIdioma(e.target.value as Idioma)}>
              <option value="pt">Português</option>
              <option value="en">Inglês</option>
              <option value="misto">Misto (PT + EN)</option>
            </select>
            <button
              className="btn btn-peq"
              onClick={() => confirm("Transcrever a live de novo? A transcrição atual será substituída.") && transcrever()}
            >
              <RefreshCw size={13} /> Transcrever de novo
            </button>
          </div>
        </div>

        <div className="player">
          <video
            ref={video}
            src={api.urlProxy(id)}
            preload="auto"
            onPlay={() => setTocando(true)}
            onPause={() => setTocando(false)}
            onClick={alternarPlay}
          />
        </div>

        <div className="barra-controles">
          <button className="btn" onClick={alternarPlay} title="Tocar / pausar (Espaço)">
            {tocando ? <><Pause size={15} /> Pausar</> : <><Play size={15} /> Tocar</>}
          </button>
          <span className="tempo-atual">
            {formatar(tempo)} / {formatar(duracao)}
          </span>
          <div className="separador" />
          <button className="btn" onClick={() => setSelecao((s) => ({ ...s, inicio: relogio() }))}
            title="Marcar o início do corte aqui (tecla I)">
            <ArrowRightToLine size={15} /> Início
          </button>
          <button className="btn" onClick={() => setSelecao((s) => ({ ...s, fim: relogio() }))}
            title="Marcar o fim do corte aqui (tecla O)">
            Fim <ArrowLeftToLine size={15} />
          </button>
          <span className="sutil">
            {selecao.inicio !== null ? formatar(selecao.inicio) : "--:--:--"} →{" "}
            {selecao.fim !== null ? formatar(selecao.fim) : "--:--:--"}
            {durSel !== null && ` (${duracaoCurta(durSel)})`}
          </span>
          <button className="btn btn-primario" onClick={criarCorte} disabled={selecao.inicio === null}
            title={selecao.inicio === null ? "Marque o início (I) ou arraste na timeline" : "Criar corte com a seleção (Enter)"}>
            <Scissors size={15} /> Criar corte
          </button>
        </div>

        <Timeline
          duracao={duracao}
          ondas={ondas}
          miniaturas={miniaturas}
          onAjustarCorte={ajustarCorte}
          tempo={tempo}
          relogio={relogio}
          tocando={tocando}
          cortes={cortes}
          corteAtivo={corteAtivo}
          selecao={selecao}
          onSeek={buscar}
          onSelecao={(inicio, fim) => setSelecao({ inicio, fim })}
          onCorte={(cid) => {
            setCorteAtivo(cid);
            const c = cortes.find((x) => x.id === cid);
            if (c) buscar(c.inicio);
          }}
        />
        <div className="atalhos" aria-label="Atalhos de teclado">
          <Keyboard size={14} />
          {ATALHOS.map(([teclas, acao]) => (
            <span key={acao} className="atalho">
              {teclas.map((t) => <kbd key={t}>{t}</kbd>)} {acao}
            </span>
          ))}
        </div>
      </div>

      <aside className="editor-lateral">
        <div className="abas">
          <button className={aba === "momentos" ? "ativo" : ""} onClick={() => setAba("momentos")}
            title="Momentos com mais chance de viralizar">
            <Sparkles size={14} /> Momentos
            {jobAnalise && (jobAnalise.status === "executando" || jobAnalise.status === "na_fila") && " …"}
          </button>
          <button className={aba === "transcricao" ? "ativo" : ""} onClick={() => setAba("transcricao")}
            title="Texto da live: buscar frases e criar cortes pelo texto">
            <FileText size={14} /> Texto
            {jobTranscricao && (jobTranscricao.status === "executando" || jobTranscricao.status === "na_fila") &&
              ` ${Math.round(jobTranscricao.progresso * 100)}%`}
          </button>
          <button className={aba === "cortes" ? "ativo" : ""} onClick={() => setAba("cortes")} title="Seus cortes">
            <Scissors size={14} /> Cortes ({cortes.length})
          </button>
          <button className={aba === "timestamps" ? "ativo" : ""} onClick={() => setAba("timestamps")}
            title="Colar uma lista de horários para criar vários cortes">
            <ListPlus size={14} /> Horários
          </button>
        </div>

        {aba === "momentos" && (
          <PainelMomentos
            projetoId={id}
            duracao={projeto?.duracao}
            temTranscricao={temTranscricao}
            job={jobAnalise}
            onSeek={buscar}
            onPrevia={tocarTrecho}
            onCorteCriado={(c) => {
              setCortes((l) => [...l.filter((x) => x.id !== c.id), c].sort((a, b) => a.inicio - b.inicio));
              setCorteAtivo(c.id);
            }}
            onCortesCriados={(novos) => {
              const ids = new Set(novos.map((c) => c.id));
              setCortes((l) => [...l.filter((x) => !ids.has(x.id)), ...novos].sort((a, b) => a.inicio - b.inicio));
            }}
          />
        )}

        {aba === "transcricao" && (
          <PainelTranscricao
            projetoId={id}
            duracao={duracao}
            tempo={tempo}
            statusJob={jobTranscricao?.status ?? null}
            progresso={jobTranscricao?.progresso ?? 0}
            mensagem={jobTranscricao?.mensagem ?? null}
            onSeek={buscar}
            onCriarCorte={(inicio, fim, nome) => adicionarCorte(inicio, fim, nome)}
            onTranscrever={transcrever}
          />
        )}

        {aba === "cortes" && (
          <div className="lista-cortes">
            {cortes.length === 0 && (
              <p className="sutil">
                Nenhum corte. Arraste na timeline ou use I/O e Enter. Também dá para colar uma lista de horários.
              </p>
            )}
            {cortes.length > 0 && (
              <button className="btn" onClick={exportarTodos} title="Coloca todos os cortes na fila de exportação">
                <Upload size={15} /> Exportar todos ({cortes.length})
              </button>
            )}
            {cortes.map((c) => (
              <CorteItem
                key={c.id}
                corte={c}
                ativo={c.id === corteAtivo}
                jobs={jobsDoCorte(c.id)}
                tempoAtual={tempo}
                estilos={estilos}
                onEditar={(abaJanela) => {
                  video.current?.pause();
                  setJanela({ corteId: c.id, aba: abaJanela });
                }}
                onSelecionar={() => {
                  setCorteAtivo(c.id);
                  buscar(c.inicio);
                }}
                onAlterado={(novo) => setCortes((l) => l.map((x) => (x.id === novo.id ? novo : x)))}
                onPrevia={() => previa(c)}
                onExportar={() => exportar(c)}
                onRemover={() => remover(c)}
              />
            ))}
          </div>
        )}

        {janela &&
          (() => {
            const c = cortes.find((x) => x.id === janela.corteId);
            return c ? (
              <JanelaCorte
                corte={c}
                projeto={projeto}
                estilos={estilos}
                formatos={listaFormatos}
                marca={marca}
                abaInicial={janela.aba}
                onFechar={() => setJanela(null)}
                onAlterado={(novo) => setCortes((l) => l.map((x) => (x.id === novo.id ? novo : x)))}
                onProjeto={(p, formatosMudaram) => {
                  setProjeto(p);
                  if (formatosMudaram) api.cortes(id).then(setCortes).catch(() => {});
                }}
              />
            ) : null;
          })()}

        {aba === "timestamps" && (
          <div className="lote">
            <p className="sutil">
              Um corte por linha: <code>01:23:10 - 01:24:05 Nome opcional</code>. Linha com um horário só vira um
              corte de 30 s.
            </p>
            <textarea
              value={textoLote}
              onChange={(e) => setTextoLote(e.target.value)}
              rows={12}
              placeholder={"00:12:30 - 00:13:05 Reação ao jogo\n01:02:10 - 01:02:50\n1:45:00"}
            />
            <button className="btn btn-primario" onClick={criarLote} disabled={!textoLote.trim()}>
              Criar cortes
            </button>
            {resultadoLote && <p className="sutil">{resultadoLote}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
