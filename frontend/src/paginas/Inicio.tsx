import { FormEvent, useEffect, useState } from "react";
import { Check, Download, Film, FolderOpen, Loader2, Radio, RotateCcw, Scissors, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import { api, avisar, erroTexto, Projeto } from "../api";
import Progresso from "../componentes/Progresso";
import { duracaoCurta } from "../tempo";

const ROTULO_STATUS: Record<Projeto["status"], string> = {
  na_fila: "Na fila",
  processando: "Processando",
  gravando: "Gravando a live",
  pronto: "Pronto",
  erro: "Erro",
};

/** Andamento do projeto: transcrição → momentos → cortes. */
function Etapas({ p }: { p: Projeto }) {
  const estado = (j: Projeto["job"]) =>
    !j ? "pendente" : j.status === "concluido" ? "ok" : j.status === "erro" ? "erro"
      : j.status === "cancelado" ? "pendente" : "andando";
  // o histórico da fila pode ter sido limpo: o que existe no disco também conta como feito
  const trJob = estado(p.job_transcricao);
  const tr = trJob === "andando" || trJob === "erro" ? trJob : p.tem_transcricao ? "ok" : trJob;
  const anJob = estado(p.job_analise);
  const an = anJob === "andando" || anJob === "erro" ? anJob : p.n_sugestoes > 0 ? "ok" : anJob;
  const icone = (s: string) =>
    s === "ok" ? <Check size={13} /> : s === "erro" ? <X size={13} /> : s === "andando" ? <Loader2 size={13} className="girando" /> : null;
  const pct = (j: Projeto["job"]) => (j && (j.status === "executando") ? ` ${Math.round(j.progresso * 100)}%` : "");
  return (
    <div className="etapas">
      <span className={`etapa etapa-${tr}`} title={p.job_transcricao?.mensagem ?? "Transcrição"}>
        {icone(tr)} Transcrição{pct(p.job_transcricao)}
      </span>
      <span className={`etapa etapa-${an}`} title={p.job_analise?.mensagem ?? "Momentos virais"}>
        {an === "ok" ? <Sparkles size={13} /> : icone(an)}{" "}
        {an === "ok" && p.n_sugestoes ? `${p.n_sugestoes} momento(s)` : `Momentos${pct(p.job_analise)}`}
      </span>
      <span className={`etapa ${p.n_cortes ? "etapa-ok" : "etapa-pendente"}`}>
        <Scissors size={13} /> {p.n_cortes} corte(s)
      </span>
    </div>
  );
}

export default function Inicio() {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [auto, setAuto] = useState(false);

  const carregar = () => api.projetos().then(setProjetos).catch(() => {});

  useEffect(() => {
    api.ajustes().then((a) => setAuto(a.auto_cortes)).catch(() => {});
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 2000);
    return () => clearInterval(t);
  }, []);

  async function importar(e: FormEvent) {
    e.preventDefault();
    if (!entrada.trim()) return;
    setEnviando(true);
    try {
      await api.criarProjeto(entrada.trim(), auto);
      setEntrada("");
      avisar(auto
        ? "Importação iniciada. Os cortes vão aparecer sozinhos no projeto; é só revisar e exportar."
        : "Importação iniciada. Acompanhe o progresso abaixo.");
      carregar();
    } catch (err) {
      avisar(erroTexto(err), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function procurar() {
    try {
      const r = await api.procurar();
      if (r.caminho) setEntrada(r.caminho);
    } catch (err) {
      avisar(erroTexto(err), "erro");
    }
  }

  async function apagar(p: Projeto) {
    const extra = p.origem === "link" ? " O vídeo baixado também será apagado." : " Seu arquivo original não será apagado.";
    if (!confirm(`Excluir o projeto "${p.nome}"?${extra} Os cortes já exportados continuam na pasta de exportados.`)) return;
    try {
      await api.apagarProjeto(p.id);
      carregar();
    } catch (err) {
      avisar(erroTexto(err), "erro");
    }
  }

  async function exportarTudo(p: Projeto) {
    if (!confirm(`Exportar os ${p.n_cortes} corte(s) de "${p.nome}" nos formatos de cada um?`)) return;
    try {
      const r = await api.exportarProjeto(p.id);
      avisar(`${r.arquivos} arquivo(s) na fila de exportação.`);
    } catch (err) {
      avisar(erroTexto(err), "erro");
    }
  }

  async function reprocessar(p: Projeto) {
    try {
      await api.reprocessar(p.id);
      carregar();
    } catch (err) {
      avisar(erroTexto(err), "erro");
    }
  }

  return (
    <div className="pagina">
      <section className="cartao importar">
        <h1>Importar live</h1>
        <p className="sutil">
          Cole o link (Twitch, YouTube, Kick) ou escolha um arquivo do PC. Use apenas lives suas ou com permissão.
        </p>
        <form onSubmit={importar} className="linha-importar">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="https://www.twitch.tv/videos/…  ou  C:\Lives\live.mkv"
            aria-label="Link ou caminho do arquivo"
          />
          <button type="button" className="btn" onClick={procurar} title="Abre a janela do Windows para escolher o vídeo">
            <FolderOpen size={15} /> Procurar arquivo…
          </button>
          <button type="submit" className="btn btn-primario" disabled={enviando || !entrada.trim()}>
            <Download size={15} /> {enviando ? "Enviando…" : "Importar"}
          </button>
        </form>
        <label className="corte-check auto-cortes" title="Transcreve, acha os momentos virais e já cria os cortes com o seu Padrão dos cortes. Você revisa e exporta.">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <Wand2 size={15} /> Criar os cortes automaticamente (você só revisa e exporta)
        </label>
      </section>

      <section>
        <h2>Projetos</h2>
        {projetos === null && <p className="sutil">Carregando…</p>}
        {projetos?.length === 0 && (
          <div className="cartao vazio">
            <Film size={32} />
            <strong>Nenhum projeto ainda</strong>
            <ol>
              <li>Importe uma live acima (arquivo do PC ou link).</li>
              <li>A transcrição e os momentos virais saem sozinhos.</li>
              <li>Abra o projeto, ajuste os cortes e exporte.</li>
            </ol>
          </div>
        )}
        <div className="grade-projetos">
          {projetos?.map((p) => {
            const pronto = p.status === "pronto";
            const andamento = (p.status === "processando" || p.status === "na_fila") && p.job;
            return (
              <article key={p.id} className="cartao projeto">
                <a className={`capa ${pronto ? "" : "capa-inativa"}`} href={pronto ? `#/projeto/${p.id}` : undefined}
                  title={pronto ? "Abrir o editor" : undefined}>
                  {pronto ? <img src={`/api/projetos/${p.id}/capa`} alt="" loading="lazy" /> : <Film size={36} />}
                  {p.duracao ? <span className="capa-duracao">{duracaoCurta(p.duracao)}</span> : null}
                </a>
                <div className="projeto-corpo">
                  <div className="projeto-topo">
                    <h3 title={p.nome}>{p.nome}</h3>
                    {p.status !== "pronto" && <span className={`status status-${p.status}`}>{ROTULO_STATUS[p.status]}</span>}
                  </div>
                  <div className="sutil projeto-info">
                    {p.origem === "live" ? "Live" : p.origem === "link" ? "Link" : "Arquivo"}
                    {p.altura ? ` · ${p.altura}p${p.fps ? Math.round(p.fps) : ""}` : ""}
                  </div>
                  {andamento && <Progresso valor={p.job!.progresso} texto={p.job!.mensagem} />}
                  {p.status === "erro" && <pre className="erro-texto">{p.erro}</pre>}
                  {pronto && <Etapas p={p} />}
                  <div className="acoes">
                    {pronto && (
                      <a className="btn btn-primario" href={`#/projeto/${p.id}`}>
                        <Scissors size={15} /> Abrir
                      </a>
                    )}
                    {pronto && p.n_cortes > 0 && (
                      <button className="btn" onClick={() => exportarTudo(p)} title="Exporta todos os cortes deste projeto">
                        <Upload size={15} /> Exportar todos
                      </button>
                    )}
                    {p.live_id && !pronto && (
                      <a className="btn btn-primario" href={`#/live/${p.live_id}`}>
                        <Radio size={15} /> Ver a live
                      </a>
                    )}
                    {p.status === "erro" && p.origem !== "live" && (
                      <button className="btn" onClick={() => reprocessar(p)}>
                        <RotateCcw size={15} /> Tentar de novo
                      </button>
                    )}
                    <button className="btn-icone btn-perigo empurrar-direita" onClick={() => apagar(p)}
                      title="Excluir projeto" aria-label="Excluir projeto">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
