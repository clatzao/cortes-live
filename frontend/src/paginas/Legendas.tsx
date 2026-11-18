import { useEffect, useRef, useState } from "react";
import { api, avisar, erroTexto, Estilo, Fonte, Projeto } from "../api";

type Chave = keyof Estilo;

function Cor({ e, k, set, rotulo }: { e: Estilo; k: Chave; set: (k: Chave, v: unknown) => void; rotulo: string }) {
  return (
    <label className="campo-cor">
      <input type="color" value={e[k] as string} onChange={(ev) => set(k, ev.target.value.toUpperCase())} />
      {rotulo}
    </label>
  );
}

function Marca({ e, k, set, rotulo }: { e: Estilo; k: Chave; set: (k: Chave, v: unknown) => void; rotulo: string }) {
  return (
    <label className="corte-check">
      <input type="checkbox" checked={!!e[k]} onChange={(ev) => set(k, ev.target.checked)} />
      {rotulo}
    </label>
  );
}

function Deslizante(props: {
  e: Estilo;
  k: Chave;
  set: (k: Chave, v: unknown) => void;
  rotulo: string;
  min: number;
  max: number;
  passo: number;
  mostrar: (v: number) => string;
}) {
  const v = props.e[props.k] as number;
  return (
    <label className="campo-deslizante">
      <span>
        {props.rotulo} <strong>{props.mostrar(v)}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.passo}
        value={v}
        onChange={(ev) => props.set(props.k, Number(ev.target.value))}
      />
    </label>
  );
}

export default function Legendas() {
  const [estilos, setEstilos] = useState<Estilo[]>([]);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [atual, setAtual] = useState<Estilo | null>(null);
  const [sujo, setSujo] = useState(false);
  const [vertical, setVertical] = useState(true);
  const [fundoProjeto, setFundoProjeto] = useState<number | 0>(0);
  const [previa, setPrevia] = useState<string | null>(null);
  const [emojis, setEmojis] = useState("");
  const [chaves, setChaves] = useState("");
  const ultimaPrevia = useRef<string | null>(null);

  useEffect(() => {
    api.estilos().then((l) => {
      setEstilos(l);
      setAtual((a) => a ?? l[0] ?? null);
    });
    api.fontes().then(setFontes).catch(() => {});
    api.projetos().then((l) => setProjetos(l.filter((p) => p.status === "pronto"))).catch(() => {});
    api.dicionarios().then((d) => {
      setEmojis(Object.entries(d.emojis).map(([k, v]) => `${k} = ${v}`).join("\n"));
      setChaves(d.palavras_chave.join("\n"));
    });
  }, []);

  // Prévia ao vivo (espera 300 ms depois da última mudança)
  useEffect(() => {
    if (!atual) return;
    const id = setTimeout(() => {
      api
        .previaEstilo(atual, vertical, fundoProjeto || undefined)
        .then((url) => {
          if (ultimaPrevia.current) URL.revokeObjectURL(ultimaPrevia.current);
          ultimaPrevia.current = url;
          setPrevia(url);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [atual, vertical, fundoProjeto]);

  function set(k: Chave, v: unknown) {
    setAtual((a) => (a ? { ...a, [k]: v } : a));
    setSujo(true);
  }

  function escolher(e: Estilo) {
    if (sujo && !confirm("Descartar as alterações deste estilo?")) return;
    setAtual(e);
    setSujo(false);
  }

  async function salvar() {
    if (!atual) return;
    try {
      const salvo = await api.salvarEstilo(atual);
      const lista = await api.estilos();
      setEstilos(lista);
      setAtual(lista.find((x) => x.id === salvo.id) ?? salvo);
      setSujo(false);
      avisar("Estilo salvo.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  function duplicar() {
    if (!atual) return;
    const novo: Estilo = { ...atual, id: `meu-${Date.now().toString(36)}`, nome: `${atual.nome} (cópia)`, de_fabrica: false };
    setEstilos((l) => [...l, novo]);
    setAtual(novo);
    setSujo(true);
  }

  async function apagar() {
    if (!atual) return;
    const fabrica = atual.de_fabrica;
    const msg = fabrica
      ? `Restaurar "${atual.nome}" para o padrão de fábrica?`
      : `Excluir o estilo "${atual.nome}"? Cortes que usam ele passam para o Clássico.`;
    if (!confirm(msg)) return;
    try {
      await api.apagarEstilo(atual.id);
      const lista = await api.estilos();
      setEstilos(lista);
      setAtual(lista.find((x) => x.id === atual.id) ?? lista[0]);
      setSujo(false);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvarDicionarios() {
    const mapa: Record<string, string> = {};
    for (const linha of emojis.split("\n")) {
      const [k, ...resto] = linha.split("=");
      const v = resto.join("=").trim();
      if (k?.trim() && v) mapa[k.trim()] = v;
    }
    const lista = chaves
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const d = await api.salvarDicionarios({ emojis: mapa, palavras_chave: lista });
      setEmojis(Object.entries(d.emojis).map(([k, v]) => `${k} = ${v}`).join("\n"));
      setChaves(d.palavras_chave.join("\n"));
      avisar("Dicionários salvos.");
      setAtual((a) => (a ? { ...a } : a)); // atualiza a prévia
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  const fonte = fontes.find((f) => f.id === atual?.fonte);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="pagina pagina-larga">
      <div className="pagina-topo">
        <h1>Estilos de legenda</h1>
      </div>

      <div className="estilos-grade">
        <aside className="cartao lista-estilos">
          {estilos.map((e) => (
            <button key={e.id} className={`item-estilo ${atual?.id === e.id ? "ativo" : ""}`} onClick={() => escolher(e)}>
              {e.nome}
              {e.de_fabrica && <span className="sutil"> · padrão</span>}
            </button>
          ))}
          <button className="btn" onClick={duplicar} disabled={!atual}>
            + Duplicar como novo
          </button>
        </aside>

        {atual && (
          <section className="cartao form-estilo">
            <label className="campo-linha">
              Nome
              <input value={atual.nome} onChange={(e) => set("nome", e.target.value)} />
            </label>
            <div className="campo-linha">
              <label>
                Fonte{" "}
                <select
                  value={atual.fonte}
                  onChange={(e) => {
                    const f = fontes.find((x) => x.id === e.target.value);
                    set("fonte", e.target.value);
                    set("variacao", f?.variacoes.includes("Black") ? "Black" : (f?.variacoes[0] ?? null));
                  }}
                >
                  {fontes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </label>
              {fonte && fonte.variacoes.length > 0 && (
                <select value={atual.variacao ?? ""} onChange={(e) => set("variacao", e.target.value || null)}>
                  {fonte.variacoes.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Deslizante e={atual} k="tamanho" set={set} rotulo="Tamanho" min={0.03} max={0.15} passo={0.005} mostrar={pct} />
            <Deslizante
              e={atual}
              k="palavras_por_vez"
              set={set}
              rotulo="Palavras por vez"
              min={1}
              max={6}
              passo={1}
              mostrar={(v) => String(v)}
            />
            <Deslizante e={atual} k="posicao_y" set={set} rotulo="Altura na tela" min={0.1} max={0.9} passo={0.01} mostrar={pct} />
            <Deslizante e={atual} k="largura_max" set={set} rotulo="Largura máxima" min={0.5} max={1} passo={0.01} mostrar={pct} />
            <Deslizante
              e={atual}
              k="escala_destaque"
              set={set}
              rotulo="Aumento da palavra falada"
              min={1}
              max={1.4}
              passo={0.01}
              mostrar={(v) => `${Math.round((v - 1) * 100)}%`}
            />
            <Deslizante e={atual} k="contorno" set={set} rotulo="Contorno" min={0} max={0.3} passo={0.01} mostrar={pct} />

            <div className="grupo-cores">
              <Cor e={atual} k="cor_texto" set={set} rotulo="Texto" />
              <Cor e={atual} k="cor_destaque" set={set} rotulo="Palavra falada" />
              <Cor e={atual} k="cor_palavra_chave" set={set} rotulo="Palavra-chave" />
              <Cor e={atual} k="cor_contorno" set={set} rotulo="Contorno" />
            </div>

            <div className="grupo-opcoes">
              <Marca e={atual} k="maiusculas" set={set} rotulo="MAIÚSCULAS" />
              <Marca e={atual} k="sem_pontuacao" set={set} rotulo="Sem vírgulas/pontos" />
              <Marca e={atual} k="animacao" set={set} rotulo="Animação pop" />
              <Marca e={atual} k="emojis" set={set} rotulo="Emojis automáticos" />
              <Marca e={atual} k="palavras_chave" set={set} rotulo="Destacar palavras-chave" />
            </div>
            <div className="grupo-opcoes">
              <Marca e={atual} k="sombra" set={set} rotulo="Sombra" />
              {atual.sombra && <Cor e={atual} k="cor_sombra" set={set} rotulo="" />}
              <Marca e={atual} k="brilho" set={set} rotulo="Brilho neon" />
              {atual.brilho && <Cor e={atual} k="cor_brilho" set={set} rotulo="" />}
              <Marca e={atual} k="caixa" set={set} rotulo="Caixa na palavra falada" />
              {atual.caixa && <Cor e={atual} k="cor_caixa" set={set} rotulo="" />}
            </div>

            <div className="acoes">
              <button className="btn btn-primario" onClick={salvar} disabled={!sujo}>
                Salvar estilo
              </button>
              <button className="btn btn-perigo" onClick={apagar}>
                {atual.de_fabrica ? "Restaurar padrão" : "Excluir"}
              </button>
            </div>
          </section>
        )}

        <section className="cartao previa-estilo">
          <div className="acoes">
            <button className={`btn btn-peq ${vertical ? "btn-primario" : ""}`} onClick={() => setVertical(true)}>
              9:16
            </button>
            <button className={`btn btn-peq ${!vertical ? "btn-primario" : ""}`} onClick={() => setVertical(false)}>
              16:9
            </button>
            <select value={fundoProjeto} onChange={(e) => setFundoProjeto(Number(e.target.value))} aria-label="Fundo da prévia">
              <option value={0}>Fundo neutro</option>
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>
                  Quadro de: {p.nome}
                </option>
              ))}
            </select>
          </div>
          {previa && <img src={previa} alt="Prévia do estilo" className={vertical ? "previa-vertical" : "previa-horizontal"} />}
          <p className="sutil">A prévia usa o mesmo desenho do vídeo final.</p>
        </section>
      </div>

      <section className="cartao">
        <h2>Emojis e palavras-chave</h2>
        <div className="dicionarios">
          <label className="campos">
            Emojis automáticos (uma regra por linha: <code>começo da palavra = emoji</code>)
            <textarea rows={12} value={emojis} onChange={(e) => setEmojis(e.target.value)} />
          </label>
          <label className="campos">
            Palavras-chave destacadas (uma por linha; números são sempre destacados)
            <textarea rows={12} value={chaves} onChange={(e) => setChaves(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-primario" onClick={salvarDicionarios}>
          Salvar emojis e palavras-chave
        </button>
      </section>
    </div>
  );
}
