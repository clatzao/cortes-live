import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, avisar, Corte, erroTexto, Estilo, Formato, Idioma, Job, Marca, Ondas, Projeto } from "../api";
import EditorLegenda from "../componentes/EditorLegenda";
import OpcoesCorte from "../componentes/OpcoesCorte";
import PainelMomentos from "../componentes/PainelMomentos";
// o editor de thumb (Konva) só é baixado quando aberto
const EditorThumb = lazy(() => import("../thumb/EditorThumb"));
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
  const [opcoesAbertas, setOpcoesAbertas] = useState<number | null>(null);
  const [thumbAberta, setThumbAberta] = useState<number | null>(null);
  const [legendaAberta, setLegendaAberta] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fimPrevia = useRef<number | null>(null);

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

  // Atualiza o cursor a cada quadro e encerra a prévia no fim do corte
  useEffect(() => {
    let raf = 0;
    const laco = () => {
      const v = video.current;
      if (v) {
        const t = v.currentTime;
        setTempo((ant) => (Math.abs(ant - t) > 0.005 ? t : ant));
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
    if (fim === null) fim = tempo;
    if (fim < inicio) [inicio, fim] = [fim, inicio];
    if (await adicionarCorte(inicio, fim)) setSelecao({ inicio: null, fim: null });
  }, [selecao, tempo, adicionarCorte]);

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
  }, [tempo, alternarPlay, criarCorte, buscar]);

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
    for (const c of cortes) await exportar(c);
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
          <a href="#/" className="btn btn-peq">
            ← Projetos
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
              Transcrever de novo
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
          <button className="btn" onClick={alternarPlay} title="Espaço">
            {tocando ? "❚❚ Pausar" : "▶ Tocar"}
          </button>
          <span className="tempo-atual">
            {formatar(tempo)} / {formatar(duracao)}
          </span>
          <div className="separador" />
          <button className="btn" onClick={() => setSelecao((s) => ({ ...s, inicio: tempo }))} title="Tecla I">
            [ Início
          </button>
          <button className="btn" onClick={() => setSelecao((s) => ({ ...s, fim: tempo }))} title="Tecla O">
            Fim ]
          </button>
          <span className="sutil">
            {selecao.inicio !== null ? formatar(selecao.inicio) : "--:--:--"} →{" "}
            {selecao.fim !== null ? formatar(selecao.fim) : "--:--:--"}
            {durSel !== null && ` (${duracaoCurta(durSel)})`}
          </span>
          <button className="btn btn-primario" onClick={criarCorte} disabled={selecao.inicio === null} title="Enter">
            + Criar corte
          </button>
        </div>

        <Timeline
          duracao={duracao}
          ondas={ondas}
          tempo={tempo}
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
        <p className="sutil atalhos">
          Atalhos: Espaço tocar/pausar · I início · O fim · Enter criar corte · Esc limpar · ←/→ 1s (Shift 5s) · , e .
          0,1s
        </p>
      </div>

      <aside className="editor-lateral">
        <div className="abas">
          <button className={aba === "momentos" ? "ativo" : ""} onClick={() => setAba("momentos")}>
            Momentos
            {jobAnalise && (jobAnalise.status === "executando" || jobAnalise.status === "na_fila") && " …"}
          </button>
          <button className={aba === "transcricao" ? "ativo" : ""} onClick={() => setAba("transcricao")}>
            Transcrição
            {jobTranscricao && (jobTranscricao.status === "executando" || jobTranscricao.status === "na_fila") &&
              ` ${Math.round(jobTranscricao.progresso * 100)}%`}
          </button>
          <button className={aba === "cortes" ? "ativo" : ""} onClick={() => setAba("cortes")}>
            Cortes ({cortes.length})
          </button>
          <button className={aba === "timestamps" ? "ativo" : ""} onClick={() => setAba("timestamps")}>
            Colar timestamps
          </button>
        </div>

        {aba === "momentos" && (
          <PainelMomentos
            projetoId={id}
            temTranscricao={temTranscricao}
            job={jobAnalise}
            onSeek={buscar}
            onPrevia={tocarTrecho}
            onCorteCriado={(c) => {
              setCortes((l) => [...l.filter((x) => x.id !== c.id), c].sort((a, b) => a.inicio - b.inicio));
              setCorteAtivo(c.id);
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
            {cortes.length > 1 && (
              <button className="btn" onClick={exportarTodos}>
                Exportar todos ({cortes.length})
              </button>
            )}
            {cortes.map((c) => (
              <CorteItem
                key={c.id}
                corte={c}
                ativo={c.id === corteAtivo}
                jobs={jobsDoCorte(c.id)}
                onOpcoes={() => {
                  video.current?.pause();
                  setOpcoesAbertas(c.id);
                }}
                onThumb={() => {
                  video.current?.pause();
                  setThumbAberta(c.id);
                }}
                tempoAtual={tempo}
                estilos={estilos}
                onEditarLegenda={() => {
                  video.current?.pause();
                  setLegendaAberta(c.id);
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

        {thumbAberta !== null &&
          (() => {
            const c = cortes.find((x) => x.id === thumbAberta);
            return c ? (
              <Suspense fallback={<div className="modal-fundo"><div className="modal painel-pad">Abrindo o editor…</div></div>}>
                <EditorThumb corte={c} onFechar={() => setThumbAberta(null)} />
              </Suspense>
            ) : null;
          })()}

        {opcoesAbertas !== null &&
          (() => {
            const c = cortes.find((x) => x.id === opcoesAbertas);
            return c ? (
              <OpcoesCorte
                corte={c}
                projeto={projeto}
                formatos={listaFormatos}
                marca={marca}
                onFechar={() => setOpcoesAbertas(null)}
                onAlterado={(novo) => setCortes((l) => l.map((x) => (x.id === novo.id ? novo : x)))}
                onProjeto={(p, formatosMudaram) => {
                  setProjeto(p);
                  if (formatosMudaram) api.cortes(id).then(setCortes).catch(() => {});
                }}
              />
            ) : null;
          })()}

        {legendaAberta !== null &&
          (() => {
            const c = cortes.find((x) => x.id === legendaAberta);
            return c ? (
              <EditorLegenda
                corte={c}
                estilos={estilos}
                onFechar={() => setLegendaAberta(null)}
                onAlterado={(novo) => setCortes((l) => l.map((x) => (x.id === novo.id ? novo : x)))}
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
