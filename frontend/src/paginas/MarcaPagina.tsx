import { useEffect, useState } from "react";
import { api, avisar, erroTexto, Fonte, Formato, Marca } from "../api";

const POSICOES: Record<string, string> = {
  sup_esq: "Canto superior esquerdo",
  sup_dir: "Canto superior direito",
  inf_esq: "Canto inferior esquerdo",
  inf_dir: "Canto inferior direito",
};

type Secao = "logo" | "intro" | "outro" | "musica";

export default function MarcaPagina() {
  const [m, setM] = useState<Marca | null>(null);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [sujo, setSujo] = useState(false);

  useEffect(() => {
    api.marca().then(setM).catch((e) => avisar(erroTexto(e), "erro"));
    api.fontes().then(setFontes).catch(() => {});
    api.formatos().then(setFormatos).catch(() => {});
  }, []);

  function mudar<S extends keyof Marca>(secao: S, valor: Partial<Marca[S]> | Marca[S]) {
    setM((a) =>
      a ? { ...a, [secao]: Array.isArray(valor) ? valor : { ...(a[secao] as object), ...(valor as object) } } : a,
    );
    setSujo(true);
  }

  async function procurar(secao: Secao) {
    const tipo = secao === "logo" ? "imagem" : secao === "musica" ? "audio" : "video";
    try {
      const r = await api.procurar(tipo);
      if (r.caminho) mudar(secao, { arquivo: r.caminho });
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvar() {
    if (!m) return;
    try {
      setM(await api.salvarMarca(m));
      setSujo(false);
      avisar("Marca salva. Vale para todos os projetos.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  if (!m) return <div className="pagina sutil">Carregando…</div>;

  const arquivo = (secao: Secao, rotulo: string) => (
    <div className="campo-arquivo">
      <input
        value={m[secao].arquivo ?? ""}
        placeholder={rotulo}
        onChange={(e) => mudar(secao, { arquivo: e.target.value || null })}
        aria-label={rotulo}
      />
      <button className="btn btn-peq" onClick={() => procurar(secao)}>
        Procurar…
      </button>
      {m[secao].arquivo && (
        <button className="btn btn-peq btn-perigo" onClick={() => mudar(secao, { arquivo: null })}>
          Remover
        </button>
      )}
    </div>
  );

  const padrao = (secao: Secao) => (
    <label className="corte-check">
      <input type="checkbox" checked={m[secao].padrao} onChange={(e) => mudar(secao, { padrao: e.target.checked })} />
      Ligado por padrão nos cortes novos
    </label>
  );

  const fonteGancho = fontes.find((f) => f.id === m.gancho.fonte);

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <h1>Marca do canal</h1>
        <button className="btn btn-primario" onClick={salvar} disabled={!sujo}>
          Salvar marca
        </button>
      </div>
      <p className="sutil">
        Vale para todos os projetos. Em cada corte, "Formatos e extras" liga ou desliga cada item.
      </p>

      <div className="grade-config">
        <section className="cartao campos">
          <h2>Logo / marca d'água</h2>
          {arquivo("logo", "Imagem do logo (PNG com fundo transparente é o ideal)")}
          <label>
            Posição
            <select value={m.logo.posicao} onChange={(e) => mudar("logo", { posicao: e.target.value })}>
              {Object.entries(POSICOES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="campo-deslizante">
            <span>
              Tamanho <strong>{Math.round(m.logo.tamanho * 100)}% da largura</strong>
            </span>
            <input type="range" min={0.04} max={0.4} step={0.01} value={m.logo.tamanho}
              onChange={(e) => mudar("logo", { tamanho: Number(e.target.value) })} />
          </label>
          <label className="campo-deslizante">
            <span>
              Opacidade <strong>{Math.round(m.logo.opacidade * 100)}%</strong>
            </span>
            <input type="range" min={0.1} max={1} step={0.05} value={m.logo.opacidade}
              onChange={(e) => mudar("logo", { opacidade: Number(e.target.value) })} />
          </label>
          {padrao("logo")}
        </section>

        <section className="cartao campos">
          <h2>Gancho (título no topo)</h2>
          <p className="sutil">O texto é escrito em cada corte. Aqui fica a aparência.</p>
          <label>
            Fonte
            <select
              value={m.gancho.fonte}
              onChange={(e) => {
                const f = fontes.find((x) => x.id === e.target.value);
                mudar("gancho", {
                  fonte: e.target.value,
                  variacao: f?.variacoes.includes("Black") ? "Black" : (f?.variacoes[0] ?? null),
                });
              }}
            >
              {fontes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          {fonteGancho && fonteGancho.variacoes.length > 0 && (
            <select value={m.gancho.variacao ?? ""} onChange={(e) => mudar("gancho", { variacao: e.target.value })}
              aria-label="Peso da fonte">
              {fonteGancho.variacoes.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          )}
          <label className="campo-deslizante">
            <span>
              Tamanho <strong>{Math.round(m.gancho.tamanho * 1000) / 10}%</strong>
            </span>
            <input type="range" min={0.02} max={0.1} step={0.002} value={m.gancho.tamanho}
              onChange={(e) => mudar("gancho", { tamanho: Number(e.target.value) })} />
          </label>
          <label className="campo-deslizante">
            <span>
              Altura na tela <strong>{Math.round(m.gancho.posicao_y * 100)}%</strong>
            </span>
            <input type="range" min={0.03} max={0.5} step={0.01} value={m.gancho.posicao_y}
              onChange={(e) => mudar("gancho", { posicao_y: Number(e.target.value) })} />
          </label>
          <div className="grupo-cores">
            <label className="campo-cor">
              <input type="color" value={m.gancho.cor_texto}
                onChange={(e) => mudar("gancho", { cor_texto: e.target.value.toUpperCase() })} />
              Texto
            </label>
            <label className="campo-cor">
              <input type="color" value={m.gancho.cor_caixa}
                onChange={(e) => mudar("gancho", { cor_caixa: e.target.value.toUpperCase() })} />
              Caixa
            </label>
            <label className="corte-check">
              <input type="checkbox" checked={m.gancho.maiusculas}
                onChange={(e) => mudar("gancho", { maiusculas: e.target.checked })} />
              MAIÚSCULAS
            </label>
          </div>
          <label>
            Fica na tela por (segundos; 0 = o corte todo)
            <input type="number" min={0} max={600} value={m.gancho.duracao}
              onChange={(e) => mudar("gancho", { duracao: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </section>

        <section className="cartao campos">
          <h2>Intro e outro</h2>
          <span className="sutil">Vídeo antes do corte</span>
          {arquivo("intro", "Vídeo de intro")}
          {padrao("intro")}
          <span className="sutil">Vídeo depois do corte</span>
          {arquivo("outro", "Vídeo de outro")}
          {padrao("outro")}
          <p className="sutil">São ajustados sozinhos ao formato de cada corte (com bordas se a proporção for outra).</p>
        </section>

        <section className="cartao campos">
          <h2>Música de fundo</h2>
          {arquivo("musica", "Arquivo de música (mp3, wav, m4a…)")}
          <label className="campo-deslizante">
            <span>
              Volume <strong>{Math.round(m.musica.volume * 100)}%</strong>
            </span>
            <input type="range" min={0} max={1} step={0.01} value={m.musica.volume}
              onChange={(e) => mudar("musica", { volume: Number(e.target.value) })} />
          </label>
          <label className="corte-check">
            <input type="checkbox" checked={m.musica.abaixar_na_fala}
              onChange={(e) => mudar("musica", { abaixar_na_fala: e.target.checked })} />
            Abaixar a música quando alguém fala
          </label>
          {padrao("musica")}
          <p className="sutil">A música repete se for mais curta que o corte e some aos poucos no final.</p>
        </section>

        <section className="cartao campos">
          <h2>Formatos padrão</h2>
          <p className="sutil">Usados em projetos novos (cada projeto e cada corte pode mudar).</p>
          {formatos.map((f) => (
            <label key={f.id} className="corte-check">
              <input
                type="checkbox"
                checked={m.formatos_padrao.includes(f.id)}
                onChange={(e) =>
                  mudar(
                    "formatos_padrao",
                    e.target.checked ? [...m.formatos_padrao, f.id] : m.formatos_padrao.filter((x) => x !== f.id),
                  )
                }
              />
              {f.nome}
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}
