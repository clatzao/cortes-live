import { FormEvent, useEffect, useState } from "react";
import { api, avisar, erroTexto, Projeto } from "../api";
import Progresso from "../componentes/Progresso";
import { duracaoCurta } from "../tempo";

const ROTULO_STATUS: Record<Projeto["status"], string> = {
  na_fila: "Na fila",
  processando: "Processando",
  pronto: "Pronto",
  erro: "Erro",
};

export default function Inicio() {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = () => api.projetos().then(setProjetos).catch(() => {});

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
      await api.criarProjeto(entrada.trim());
      setEntrada("");
      avisar("Importação iniciada. Acompanhe o progresso abaixo.");
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
          <button type="button" className="btn" onClick={procurar}>
            Procurar arquivo…
          </button>
          <button type="submit" className="btn btn-primario" disabled={enviando || !entrada.trim()}>
            {enviando ? "Enviando…" : "Importar"}
          </button>
        </form>
      </section>

      <section>
        <h2>Projetos</h2>
        {projetos === null && <p className="sutil">Carregando…</p>}
        {projetos?.length === 0 && <p className="sutil">Nenhum projeto ainda. Importe sua primeira live acima.</p>}
        <div className="grade-projetos">
          {projetos?.map((p) => (
            <article key={p.id} className="cartao projeto">
              <div className="projeto-topo">
                <h3 title={p.nome}>{p.nome}</h3>
                <span className={`status status-${p.status}`}>{ROTULO_STATUS[p.status]}</span>
              </div>
              <div className="sutil projeto-info">
                {p.origem === "link" ? "Link" : "Arquivo"}
                {p.duracao ? ` · ${duracaoCurta(p.duracao)}` : ""}
                {p.altura ? ` · ${p.altura}p${p.fps ? Math.round(p.fps) : ""}` : ""}
              </div>
              {(p.status === "processando" || p.status === "na_fila") && p.job && (
                <Progresso valor={p.job.progresso} texto={p.job.mensagem} />
              )}
              {p.status === "erro" && <pre className="erro-texto">{p.erro}</pre>}
              {p.status === "pronto" && p.job_transcricao && (
                <div className="sutil projeto-info">
                  {p.job_transcricao.status === "executando" || p.job_transcricao.status === "na_fila" ? (
                    <Progresso valor={p.job_transcricao.progresso} texto={p.job_transcricao.mensagem ?? "Transcrição na fila"} />
                  ) : p.job_transcricao.status === "concluido" ? (
                    "✓ Transcrito"
                  ) : p.job_transcricao.status === "erro" ? (
                    <span className="status-erro">Transcrição falhou — abra o editor para tentar de novo</span>
                  ) : (
                    "Transcrição cancelada"
                  )}
                </div>
              )}
              <div className="acoes">
                {p.status === "pronto" && (
                  <a className="btn btn-primario" href={`#/projeto/${p.id}`}>
                    Abrir editor
                  </a>
                )}
                {p.status === "erro" && (
                  <button className="btn" onClick={() => reprocessar(p)}>
                    Tentar de novo
                  </button>
                )}
                <button className="btn btn-perigo" onClick={() => apagar(p)}>
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
