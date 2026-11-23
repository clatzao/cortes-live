import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Instagram, Loader2, Music2, Send, X, Youtube } from "lucide-react";
import { api, avisar, ContaSocial, erroTexto, ItemBiblioteca, NomeRede, Privacidade } from "../api";
import CampoDataHora, { erroDoHorario } from "./ui/CampoDataHora";
import SeletorSegmentado from "./ui/SeletorSegmentado";

const PRIVACIDADES: { valor: Privacidade; rotulo: string }[] = [
  { valor: "publico", rotulo: "Público" },
  { valor: "nao_listado", rotulo: "Não listado" },
  { valor: "privado", rotulo: "Privado" },
];

function Icone({ rede }: { rede: NomeRede }) {
  if (rede === "youtube") return <Youtube size={16} aria-hidden="true" />;
  if (rede === "instagram") return <Instagram size={16} aria-hidden="true" />;
  return <Music2 size={16} aria-hidden="true" />;
}

/** S24: publicar agora ou agendar um arquivo da Biblioteca numa ou mais contas. */
export default function JanelaPublicar({ item, aoFechar }: { item: ItemBiblioteca; aoFechar: () => void }) {
  const [contas, setContas] = useState<ContaSocial[] | null>(null);
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [titulo, setTitulo] = useState(item.corte_nome || "");
  const [descricao, setDescricao] = useState("");
  const [privacidade, setPrivacidade] = useState<Privacidade>("publico");
  const [quando, setQuando] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.contas().then((c) => {
      const ativas = c.filter((x) => x.status === "ativa");
      setContas(c);
      setMarcadas(ativas.length === 1 ? [ativas[0].id] : []);
    }).catch((e) => setErro(erroTexto(e)));
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aoFechar]);

  const escolhidas = useMemo(() => (contas ?? []).filter((c) => marcadas.includes(c.id)), [contas, marcadas]);
  const temInstagram = escolhidas.some((c) => c.rede === "instagram");
  const tiktokPrivado = escolhidas.some((c) => c.rede === "tiktok" && c.so_privado);
  // o Instagram só publica Reels públicos pela API
  const opcoes = temInstagram ? PRIVACIDADES.filter((p) => p.valor === "publico") : PRIVACIDADES;
  useEffect(() => {
    if (temInstagram && privacidade !== "publico") setPrivacidade("publico");
  }, [temInstagram, privacidade]);

  function alternar(id: number) {
    setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function enviar() {
    setErro(null);
    if (!marcadas.length) return setErro("Escolha pelo menos uma conta.");
    if (quando !== null && erroDoHorario(quando)) return setErro(erroDoHorario(quando));
    setEnviando(true);
    try {
      const posts = await api.criarPosts({ exportacao_id: item.id, conta_ids: marcadas, titulo, descricao, privacidade,
        agendado_para: quando === null ? null : quando / 1000 });
      avisar(quando === null ? `Publicando em ${posts.length} conta(s). Acompanhe em Posts.`
        : `Agendado em ${posts.length} conta(s) para ${new Date(quando).toLocaleString("pt-BR")}.`);
      aoFechar();
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setEnviando(false);
    }
  }

  const ativas = (contas ?? []).filter((c) => c.status === "ativa");
  return createPortal(
    <div className="modal-fundo" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal janela-publicar" role="dialog" aria-modal="true" aria-labelledby="titulo-publicar">
        <div className="modal-topo">
          <h2 id="titulo-publicar"><Send size={18} aria-hidden="true" /> Publicar nas redes</h2>
          <button className="btn-icone" onClick={aoFechar} aria-label="Fechar"><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="modal-corpo">
          <p className="sutil" title={item.caminho}>{item.corte_nome || "Corte"} · {item.formato_nome}</p>
          {contas === null && !erro && <p className="sutil">Carregando as contas…</p>}
          {contas !== null && ativas.length === 0 && (
            <div className="vazio">
              <strong>Nenhuma conta conectada.</strong>
              <p className="sutil">Conecte o YouTube, o TikTok ou o Instagram em <a href="#/ajustes/contas" onClick={aoFechar}>Ajustes → Contas</a>.</p>
            </div>
          )}
          {ativas.length > 0 && (
            <>
              <fieldset className="contas-escolha">
                <legend>Onde publicar</legend>
                {ativas.map((c) => (
                  <label key={c.id} className="linha-check">
                    <input type="checkbox" checked={marcadas.includes(c.id)} onChange={() => alternar(c.id)} />
                    <Icone rede={c.rede} /> {c.nome} <span className="sutil">({c.rede_titulo})</span>
                  </label>
                ))}
              </fieldset>
              <label className="campo-bloco">
                Título
                <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={100} />
              </label>
              <label className="campo-bloco">
                Descrição e hashtags
                <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} maxLength={2200}
                  placeholder="#cortes #live" />
              </label>
              <div className="campo-bloco">
                <span>Quem pode ver</span>
                <SeletorSegmentado rotulo="Quem pode ver" valor={privacidade} opcoes={opcoes}
                  aoMudar={(v) => setPrivacidade(v as Privacidade)} />
                {temInstagram && <small className="sutil">O Instagram só publica Reels públicos pela API.</small>}
                {tiktokPrivado && <small className="sutil">No TikTok sai como privado até o seu app ser aprovado.</small>}
              </div>
              <CampoDataHora valor={quando} aoMudar={setQuando} desabilitado={enviando} />
            </>
          )}
          {erro && <div className="campo-data-erro" role="alert">{erro}</div>}
        </div>
        <div className="modal-rodape">
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          {ativas.length > 0 && (
            <button className="btn btn-primario" onClick={enviar} disabled={enviando || !marcadas.length}>
              {enviando ? <Loader2 size={15} className="girando" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              {quando === null ? "Publicar agora" : "Agendar"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
