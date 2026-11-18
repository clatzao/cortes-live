import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Ajustes, api, avisar, erroTexto, Estilo, Formato, Marca } from "../api";

type Extra = "logo" | "intro" | "outro" | "musica";
const EXTRAS: { id: Extra; nome: string }[] = [
  { id: "logo", nome: "Logo / marca d'água" },
  { id: "intro", nome: "Intro" },
  { id: "outro", nome: "Outro" },
  { id: "musica", nome: "Música de fundo" },
];

/** Como todo corte novo nasce: legenda, formatos, extras e os momentos virais. */
export default function Predefinicao() {
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [marca, setMarca] = useState<Marca | null>(null);
  const [estilos, setEstilos] = useState<Estilo[]>([]);
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    Promise.all([api.ajustes(), api.marca(), api.estilos(), api.formatos()])
      .then(([a, m, e, f]) => {
        setAj(a);
        setMarca(m);
        setEstilos(e);
        setFormatos(f);
      })
      .catch((e) => avisar(erroTexto(e), "erro"));
  }, []);

  if (!aj || !marca) return <div className="pagina sutil">Carregando…</div>;

  const mudarAj = (d: Partial<Ajustes>) => {
    setAj({ ...aj, ...d });
    setSujo(true);
  };
  const mudarMarca = (d: Partial<Marca>) => {
    setMarca({ ...marca, ...d });
    setSujo(true);
  };

  async function salvar() {
    if (!aj || !marca) return;
    if (!marca.formatos_padrao.length) return avisar("Escolha pelo menos um formato.", "erro");
    if (aj.viral_max < aj.viral_min) return avisar("A duração máxima precisa ser maior que a mínima.", "erro");
    setSalvando(true);
    try {
      const [a, m] = await Promise.all([
        api.salvarAjustes({
          estilo_padrao: aj.estilo_padrao,
          legenda_padrao: aj.legenda_padrao,
          viral_min: aj.viral_min,
          viral_max: aj.viral_max,
          viral_qtd: aj.viral_qtd,
          viral_auto: aj.viral_auto,
        }),
        api.salvarMarca(marca),
      ]);
      setAj({ ...aj, ...a });
      setMarca(m);
      setSujo(false);
      avisar("Padrão dos cortes salvo.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <h1>Padrão dos cortes</h1>
        <button className="btn btn-primario" onClick={salvar} disabled={!sujo || salvando}>
          <Save size={15} /> {salvando ? "Salvando…" : "Salvar padrão"}
        </button>
      </div>
      <p className="sutil">
        Todo corte novo já nasce assim (inclusive os do modo automático). Depois dá para mudar cada corte em "Editar".
      </p>

      <div className="grade-config">
        <section className="cartao campos">
          <h2>Legenda</h2>
          <label className="corte-check">
            <input type="checkbox" checked={aj.legenda_padrao} onChange={(e) => mudarAj({ legenda_padrao: e.target.checked })} />
            Cortes novos com legenda
          </label>
          <label>
            Estilo
            <select value={aj.estilo_padrao} onChange={(e) => mudarAj({ estilo_padrao: e.target.value })}
              disabled={!aj.legenda_padrao}>
              {estilos.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </label>
          <a className="sutil" href="#/ajustes/legendas">Criar ou mudar estilos em Legendas →</a>
        </section>

        <section className="cartao campos">
          <h2>Formatos</h2>
          <p className="sutil">Arquivos gerados ao exportar (cada projeto e cada corte pode mudar).</p>
          {formatos.map((f) => (
            <label key={f.id} className="corte-check">
              <input
                type="checkbox"
                checked={marca.formatos_padrao.includes(f.id)}
                onChange={(e) =>
                  mudarMarca({
                    formatos_padrao: e.target.checked
                      ? [...marca.formatos_padrao, f.id]
                      : marca.formatos_padrao.filter((x) => x !== f.id),
                  })
                }
              />
              {f.nome}
            </label>
          ))}
        </section>

        <section className="cartao campos">
          <h2>Extras da marca</h2>
          {EXTRAS.map(({ id, nome }) => {
            const temArquivo = !!marca[id].arquivo;
            return (
              <label key={id} className="corte-check" title={temArquivo ? "" : "Escolha o arquivo em Marca do canal"}>
                <input type="checkbox" checked={marca[id].padrao} disabled={!temArquivo}
                  onChange={(e) => mudarMarca({ [id]: { ...marca[id], padrao: e.target.checked } } as Partial<Marca>)} />
                {nome}
                {!temArquivo && <span className="sutil"> (sem arquivo)</span>}
              </label>
            );
          })}
          <a className="sutil" href="#/ajustes/marca">Escolher logo, intro, outro e música em Marca do canal →</a>
        </section>

        <section className="cartao campos">
          <h2>Momentos virais</h2>
          <div className="margens">
            <label>
              Cortes de
              <input type="number" min={5} max={600} value={aj.viral_min}
                onChange={(e) => mudarAj({ viral_min: Number(e.target.value) || 5 })} />
            </label>
            <label>
              até
              <input type="number" min={5} max={900} value={aj.viral_max}
                onChange={(e) => mudarAj({ viral_max: Number(e.target.value) || 5 })} />
              s
            </label>
            <label>
              Quantos
              <input type="number" min={1} max={50} value={aj.viral_qtd}
                onChange={(e) => mudarAj({ viral_qtd: Number(e.target.value) || 1 })} />
            </label>
          </div>
          <label className="corte-check">
            <input type="checkbox" checked={aj.viral_auto} onChange={(e) => mudarAj({ viral_auto: e.target.checked })} />
            Procurar momentos sozinho quando a transcrição terminar
          </label>
        </section>
      </div>
    </div>
  );
}
