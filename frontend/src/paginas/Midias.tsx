import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, avisar, erroTexto, Midia, TipoMidia } from "../api";
import SeletorSegmentado from "../componentes/ui/SeletorSegmentado";
import { duracaoCurta } from "../tempo";

const TEXTO: Record<TipoMidia, { titulo: string; dica: string }> = {
  gancho: {
    titulo: "Hooks em vídeo",
    dica: "Um vídeo curto que entra antes do corte para prender a atenção. Escolha qual usar na janela de cada corte.",
  },
  broll: {
    titulo: "B-roll",
    dica: "Vídeos que cobrem a tela por alguns segundos durante o corte. Com palavras-chave, o programa sugere onde " +
      "colocar cada um quando a palavra é dita (ex.: \"carro, corrida\").",
  },
};

/** Ajustes → Mídias: os vídeos do próprio usuário usados como hook e B-roll. */
export default function Midias() {
  const [tipo, setTipo] = useState<TipoMidia>("broll");
  const [lista, setLista] = useState<Midia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<number, string>>({});

  const carregar = () =>
    api
      .midias(tipo)
      .then((l) => {
        setLista(l);
        setTags(Object.fromEntries(l.map((m) => [m.id, m.tags.join(", ")])));
        setErro(null);
      })
      .catch((e) => setErro(erroTexto(e)));

  useEffect(() => {
    setLista(null);
    carregar();
  }, [tipo]);

  async function adicionar() {
    try {
      const r = await api.procurar("video");
      if (!r.caminho) return;
      const res = await api.adicionarMidias(tipo, [r.caminho]);
      res.erros.forEach((x) => avisar(x, "erro"));
      carregar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvarTags(m: Midia) {
    const texto = tags[m.id] ?? "";
    if (texto === m.tags.join(", ")) return;
    try {
      const nova = await api.editarMidia(m.id, { tags: texto.split(",") });
      setLista((l) => l?.map((x) => (x.id === m.id ? nova : x)) ?? l);
      setTags((t) => ({ ...t, [m.id]: nova.tags.join(", ") }));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function remover(m: Midia) {
    if (!confirm(`Tirar "${m.nome}" da biblioteca de mídias? O arquivo continua no seu PC.`)) return;
    try {
      await api.removerMidia(m.id);
      carregar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  return (
    <div className="cartao midias">
      <div className="midias-topo">
        <SeletorSegmentado rotulo="Tipo de mídia" valor={tipo} aoMudar={setTipo}
          opcoes={[{ valor: "broll", rotulo: "B-roll" }, { valor: "gancho", rotulo: "Hooks em vídeo" }]} />
        <button className="btn btn-primario" onClick={adicionar}>
          <Plus size={15} aria-hidden="true" /> Adicionar vídeo
        </button>
      </div>
      <h2>{TEXTO[tipo].titulo}</h2>
      <p className="sutil">{TEXTO[tipo].dica} Use só vídeos seus ou com permissão.</p>
      {erro && <div className="aviso aviso-erro" role="alert">{erro}</div>}
      {lista === null && !erro && <p className="sutil">Carregando…</p>}
      {lista?.length === 0 && (
        <div className="vazio">
          <strong>Nenhum vídeo ainda.</strong>
          <p className="sutil">Clique em "Adicionar vídeo" e escolha um arquivo do PC.</p>
        </div>
      )}
      <ul className="lista-midias">
        {lista?.map((m) => (
          <li key={m.id} className="midia">
            {m.existe ? (
              <img className="midia-quadro" src={api.urlQuadroMidia(m.id)} alt="" loading="lazy" />
            ) : (
              <div className="midia-quadro midia-sumiu">Arquivo sumiu</div>
            )}
            <div className="midia-texto">
              <strong title={m.caminho}>{m.nome}</strong>
              <span className="sutil">{m.duracao_s ? duracaoCurta(m.duracao_s) : "?"} · {m.largura}×{m.altura}</span>
              {tipo === "broll" && (
                <label className="midia-tags">
                  <span className="sutil">Palavras-chave</span>
                  <input value={tags[m.id] ?? ""} placeholder="ex.: carro, corrida, velocidade"
                    onChange={(e) => setTags((t) => ({ ...t, [m.id]: e.target.value }))}
                    onBlur={() => salvarTags(m)} onKeyDown={(e) => e.key === "Enter" && salvarTags(m)} />
                </label>
              )}
            </div>
            <button className="btn-icone" onClick={() => remover(m)} title="Tirar da biblioteca"
              aria-label={`Tirar ${m.nome} da biblioteca`}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
