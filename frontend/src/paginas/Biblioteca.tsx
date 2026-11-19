import { useEffect, useState } from "react";
import { FolderOpen, Search, Trash2 } from "lucide-react";
import { api, avisar, erroTexto, ItemBiblioteca } from "../api";
import { duracaoCurta } from "../tempo";

function tamanho(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** S20: tudo o que já foi exportado, de todos os projetos. */
export default function Biblioteca() {
  const [itens, setItens] = useState<ItemBiblioteca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [formato, setFormato] = useState("");

  useEffect(() => {
    let vivo = true;
    const id = setTimeout(() => {
      api
        .biblioteca({ busca, formato })
        .then((l) => vivo && (setItens(l), setErro(null)))
        .catch((e) => vivo && setErro(erroTexto(e)));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [busca, formato]);

  async function abrir(i: ItemBiblioteca) {
    try {
      await api.abrirNaBiblioteca(i.id);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function tirar(i: ItemBiblioteca) {
    try {
      await api.tirarDaBiblioteca(i.id);
      setItens((l) => (l ? l.filter((x) => x.id !== i.id) : l));
      avisar("Tirado da lista. O arquivo continua na pasta.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  const formatos = Array.from(new Map((itens ?? []).map((i) => [i.formato, i.formato_nome])).entries());

  return (
    <div className="pagina-biblioteca">
      <div className="biblioteca-topo">
        <h1>Biblioteca</h1>
        <div className="biblioteca-filtros">
          <label className="campo-busca">
            <Search size={15} aria-hidden="true" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar por corte ou projeto"
              aria-label="Procurar por corte ou projeto" />
          </label>
          <select value={formato} onChange={(e) => setFormato(e.target.value)} aria-label="Filtrar por formato">
            <option value="">Todos os formatos</option>
            {formatos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <button className="btn" onClick={() => api.abrirExportados().catch(() => {})}>
            <FolderOpen size={15} aria-hidden="true" /> Abrir pasta
          </button>
        </div>
      </div>

      {erro && <div className="aviso aviso-erro" role="alert">Não deu para carregar a biblioteca: {erro}</div>}
      {itens === null && !erro && <p className="sutil">Carregando…</p>}
      {itens !== null && itens.length === 0 && (
        <div className="vazio">
          <strong>{busca || formato ? "Nada encontrado com esse filtro." : "Nenhum corte exportado ainda."}</strong>
          <p className="sutil">Os vídeos que você exportar aparecem aqui, de todos os projetos.</p>
        </div>
      )}

      <div className="grade-biblioteca">
        {itens?.map((i) => (
          <article key={i.id} className="item-biblioteca">
            {i.existe ? (
              <video className="item-biblioteca-video" src={`${api.urlVideoBiblioteca(i.id)}#t=0.5`} preload="metadata"
                controls aria-label={`Vídeo: ${i.corte_nome}`} />
            ) : (
              <div className="item-biblioteca-video item-biblioteca-sumiu">O arquivo foi movido ou apagado.</div>
            )}
            <div className="item-biblioteca-texto">
              <strong title={i.corte_nome}>{i.corte_nome || "Corte"}</strong>
              <span className="sutil" title={i.projeto_nome}>{i.projeto_nome}</span>
              <span className="sutil">
                {i.formato_nome} · {i.resolucao}p · {duracaoCurta(i.duracao_s)} · {tamanho(i.tamanho_bytes)}
              </span>
              <span className="sutil">{new Date(i.criado_em * 1000).toLocaleString("pt-BR")}</span>
            </div>
            <div className="item-biblioteca-acoes">
              <button className="btn" onClick={() => abrir(i)} disabled={!i.existe}>
                <FolderOpen size={15} aria-hidden="true" /> Mostrar na pasta
              </button>
              <button className="btn-icone" onClick={() => tirar(i)} title="Tirar da lista (o arquivo continua na pasta)"
                aria-label={`Tirar ${i.corte_nome} da lista`}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
