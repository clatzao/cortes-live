import { useCallback, useEffect, useState } from "react";
import { Ban, CalendarClock, ExternalLink, Instagram, Music2, RefreshCw, RotateCcw, Trash2, Youtube } from "lucide-react";
import { api, avisar, erroTexto, NomeRede, Post } from "../api";
import Progresso from "../componentes/Progresso";
import CampoDataHora, { erroDoHorario } from "../componentes/ui/CampoDataHora";
import StatusPill from "../componentes/ui/StatusPill";

function Icone({ rede }: { rede: NomeRede }) {
  if (rede === "youtube") return <Youtube size={16} aria-hidden="true" />;
  if (rede === "instagram") return <Instagram size={16} aria-hidden="true" />;
  return <Music2 size={16} aria-hidden="true" />;
}

const PRIV: Record<string, string> = { publico: "público", nao_listado: "não listado", privado: "privado" };

function quando(t: number) {
  return new Date(t * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function numero(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString("pt-BR");
}

/** S25: agendados, publicados e métricas de cada post. */
export default function Posts() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: number; ms: number } | null>(null);

  const carregar = useCallback(() => {
    api.posts().then((p) => { setPosts(p); setErro(null); }).catch((e) => setErro(erroTexto(e)));
  }, []);
  useEffect(() => {
    carregar();
    const t = window.setInterval(carregar, 3000);
    return () => window.clearInterval(t);
  }, [carregar]);

  async function agir(f: () => Promise<unknown>, ok?: string) {
    try {
      await f();
      if (ok) avisar(ok);
      carregar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvarHorario() {
    if (!editando) return;
    const problema = erroDoHorario(editando.ms);
    if (problema) return avisar(problema, "erro");
    await agir(() => api.mudarPost(editando.id, { agendado_para: editando.ms / 1000 }), "Horário mudado.");
    setEditando(null);
  }

  const proximos = (posts ?? []).filter((p) => p.status === "agendado" || p.status === "enviando");
  const feitos = (posts ?? []).filter((p) => !(p.status === "agendado" || p.status === "enviando"));

  function linha(p: Post) {
    const nome = p.titulo || p.corte_nome || "Corte";
    return (
      <li key={p.id} className="item-post">
        <div className="item-post-rede" title={p.rede}><Icone rede={p.rede} /></div>
        <div className="item-post-texto">
          <strong title={p.arquivo}>{nome}</strong>
          <span className="sutil">{p.conta_nome} · {PRIV[p.privacidade]}{p.rede === "tiktok" && p.so_privado ? " (TikTok: só privado)" : ""}</span>
          <span className="sutil">
            {p.status === "publicado" && p.publicado_em ? `Publicado em ${quando(p.publicado_em)}` : `Para ${quando(p.agendado_para)}`}
          </span>
          {p.status === "enviando" && <Progresso valor={p.envio_progresso ?? 0} texto={p.envio_mensagem || "Enviando"} />}
          {p.erro && p.status !== "publicado" && <span className="item-feed-erro">{p.erro}</span>}
          {p.metricas && (
            <span className="metricas-post" aria-label="Métricas">
              <span>{numero(p.metricas.views)} views</span>
              <span>{numero(p.metricas.likes)} curtidas</span>
              <span>{numero(p.metricas.comentarios)} comentários</span>
              {p.metricas.compartilhamentos != null && <span>{numero(p.metricas.compartilhamentos)} compart.</span>}
              {p.metricas.salvos != null && <span>{numero(p.metricas.salvos)} salvos</span>}
            </span>
          )}
          {editando?.id === p.id && (
            <div className="editar-horario">
              <CampoDataHora valor={editando.ms} aoMudar={(v) => v !== null && setEditando({ id: p.id, ms: v })} />
              <div className="acoes">
                <button className="btn btn-primario" onClick={salvarHorario}>Salvar horário</button>
                <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
        <div className="item-post-acoes">
          <StatusPill estado={p.status === "cancelado" ? "encerrada" : p.status} texto={p.status === "cancelado" ? "Cancelado" : undefined}
            tamanho="sm" />
          {p.status === "agendado" && editando?.id !== p.id && (
            <button className="btn-icone" onClick={() => setEditando({ id: p.id, ms: Math.max(p.agendado_para * 1000, Date.now() + 3_600_000) })}
              aria-label={`Mudar horário de ${nome}`} title="Mudar horário"><CalendarClock size={15} aria-hidden="true" /></button>
          )}
          {(p.status === "agendado" || p.status === "enviando") && (
            <button className="btn-icone" onClick={() => agir(() => api.cancelarPost(p.id), "Post cancelado.")}
              aria-label={`Cancelar ${nome}`} title="Cancelar"><Ban size={15} aria-hidden="true" /></button>
          )}
          {(p.status === "falhou" || p.status === "cancelado") && (
            <button className="btn-icone" onClick={() => agir(() => api.tentarPost(p.id), "Vai tentar de novo agora.")}
              aria-label={`Tentar de novo ${nome}`} title="Tentar de novo"><RotateCcw size={15} aria-hidden="true" /></button>
          )}
          {p.status === "publicado" && p.url && (
            <button className="btn-icone" onClick={() => agir(() => api.abrirPost(p.id))}
              aria-label={`Abrir ${nome} no navegador`} title="Abrir na rede"><ExternalLink size={15} aria-hidden="true" /></button>
          )}
          {p.status !== "agendado" && p.status !== "enviando" && (
            <button className="btn-icone" onClick={() => agir(() => api.removerPost(p.id))}
              aria-label={`Tirar ${nome} da lista`} title="Tirar da lista (não apaga na rede)"><Trash2 size={15} aria-hidden="true" /></button>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="pagina-posts">
      <div className="biblioteca-topo">
        <h1>Posts</h1>
        <div className="biblioteca-filtros">
          <button className="btn" onClick={() => agir(() => api.atualizarMetricas(), "Atualizando as métricas.")}>
            <RefreshCw size={15} aria-hidden="true" /> Atualizar métricas
          </button>
        </div>
      </div>
      {erro && <div className="aviso aviso-erro" role="alert">Não deu para carregar os posts: {erro}</div>}
      {posts === null && !erro && <p className="sutil">Carregando…</p>}
      {posts !== null && posts.length === 0 && (
        <div className="vazio">
          <strong>Nenhum post ainda.</strong>
          <p className="sutil">Publique ou agende pela <a href="#/biblioteca">Biblioteca</a> (botão Publicar em cada vídeo).</p>
        </div>
      )}
      {proximos.length > 0 && (
        <section aria-labelledby="titulo-proximos">
          <h2 id="titulo-proximos">Próximos</h2>
          <ol className="lista-posts">{proximos.map(linha)}</ol>
        </section>
      )}
      {feitos.length > 0 && (
        <section aria-labelledby="titulo-feitos">
          <h2 id="titulo-feitos">Publicados e outros</h2>
          <ol className="lista-posts">{feitos.map(linha)}</ol>
        </section>
      )}
    </div>
  );
}
