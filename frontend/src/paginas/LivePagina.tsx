import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Film } from "lucide-react";
import { api, avisar, erroTexto, LiveDetalhe } from "../api";
import CartaoLive from "../componentes/ui/CartaoLive";
import ItemFeed, { Feed } from "../componentes/ui/ItemFeed";
import Progresso from "../componentes/Progresso";
import { paraCartao } from "./Lives";

const DESTAQUE_MS = 4000;

/** S09: a live sendo gravada, com os cortes chegando. */
export default function LivePagina({ id }: { id: number }) {
  const [v, setV] = useState<LiveDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novos, setNovos] = useState<Set<number>>(new Set());
  const vistos = useRef<Set<number> | null>(null);

  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      api
        .live(id)
        .then((d) => {
          if (!vivo) return;
          setV(d);
          setErro(null);
          // destaca por alguns segundos só os cortes que chegaram depois de abrir a tela
          const ids = d.cortes.map((c) => c.id);
          if (vistos.current === null) {
            vistos.current = new Set(ids);
          } else {
            const chegaram = ids.filter((x) => !vistos.current!.has(x));
            if (chegaram.length) {
              chegaram.forEach((x) => vistos.current!.add(x));
              setNovos((n) => new Set([...n, ...chegaram]));
              setTimeout(() => setNovos((n) => new Set([...n].filter((x) => !chegaram.includes(x)))), DESTAQUE_MS);
            }
          }
        })
        .catch((e) => vivo && setErro(erroTexto(e)));
    carregar();
    const t = setInterval(carregar, 2000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [id]);

  async function parar() {
    try {
      await api.pararLive(id);
      avisar("Parando a gravação. A live vira um projeto em seguida.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function exportar(corteId: number) {
    try {
      const j = await api.exportarCorte(corteId);
      avisar(`${j.length} arquivo(s) na fila de exportação.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function descartar(corteId: number) {
    try {
      await api.apagarCorte(corteId);
      setV((d) => (d ? { ...d, cortes: d.cortes.filter((c) => c.id !== corteId) } : d));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  if (erro && !v) {
    return (
      <div className="pagina-live">
        <a className="voltar" href="#/lives"><ArrowLeft size={15} aria-hidden="true" /> Lives</a>
        <div className="aviso aviso-erro" role="alert">{erro}</div>
      </div>
    );
  }
  if (!v) return <p className="sutil">Carregando…</p>;

  const pronto = v.projeto_status === "pronto";
  const gravando = v.status === "gravando" || v.status === "reconectando";
  const analise = v.job_analise;
  const final = v.job_final;
  const proxima = Math.max(0, v.janela_s - (v.gravado_s - v.analisado_ate));

  return (
    <div className="pagina-live">
      <a className="voltar" href="#/lives"><ArrowLeft size={15} aria-hidden="true" /> Lives</a>
      {v.titulo && <p className="titulo-live" title={v.titulo}>{v.titulo}</p>}

      <CartaoLive
        live={paraCartao(v, v.status === "encerrada" ? undefined : v.disco_livre_gb)}
        aoParar={["aguardando", "gravando", "reconectando"].includes(v.status) && !v.parar ? parar : undefined}
      />

      <div className="estado-live" aria-live="polite">
        {v.parar === 1 && v.status !== "encerrada" && v.status !== "finalizando" && <p className="sutil">Parando a gravação…</p>}
        {analise?.status === "executando" && <Progresso valor={analise.progresso} texto={analise.mensagem} />}
        {gravando && analise?.status !== "executando" && (
          <p className="sutil">
            {v.analisado_ate > 0 ? "Próxima análise" : "Primeira análise"} em ~{Math.ceil(proxima / 60)} min de gravação.
          </p>
        )}
        {v.ultima_analise && <p className="sutil">Última análise: {v.ultima_analise}</p>}
        {final && (final.status === "executando" || final.status === "na_fila") && (
          <Progresso valor={final.progresso} texto={final.mensagem ?? "Preparando o projeto"} />
        )}
        {final?.status === "erro" && <div className="aviso aviso-erro" role="alert">{final.mensagem}</div>}
        {pronto && v.projeto_id && (
          <p>
            A live virou um projeto.{" "}
            <a className="btn btn-primario" href={`#/projeto/${v.projeto_id}`}><Film size={15} aria-hidden="true" /> Abrir no editor</a>
          </p>
        )}
      </div>

      <section className="feed-live" aria-label="Cortes desta live">
        <h2>Cortes ({v.cortes.length})</h2>
        {v.cortes.length === 0 ? (
          <div className="vazio">
            <strong>{v.status === "aguardando" ? "A live ainda não começou." : "Nenhum corte ainda."}</strong>
            <p className="sutil">
              {v.status === "aguardando"
                ? "Assim que o canal entrar ao vivo, a gravação começa sozinha."
                : "Os cortes aparecem aqui conforme os melhores momentos são encontrados."}
            </p>
          </div>
        ) : (
          <Feed rotulo="Cortes desta live">
            {v.cortes.map((c) => (
              <ItemFeed
                key={c.id}
                novo={novos.has(c.id)}
                item={{ id: c.id, nome: c.nome, posicao_s: c.inicio, nota: c.nota ?? 0, motivo: c.motivo, estado: "pronto" }}
                aoAbrir={pronto && v.projeto_id ? () => (window.location.hash = `#/projeto/${v.projeto_id}`) : undefined}
                aoExportar={c.exportavel ? () => exportar(c.id) : undefined}
                aoDescartar={() => descartar(c.id)}
              />
            ))}
          </Feed>
        )}
      </section>
    </div>
  );
}
