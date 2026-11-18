import { useEffect, useState } from "react";
import { api, avisar, Corte, erroTexto, Estilo, PalavraLegenda } from "../api";
import { formatar } from "../tempo";

interface Props {
  corte: Corte;
  estilos: Estilo[];
  onFechar: () => void;
  onAlterado: (c: Corte) => void;
  onSujo?: (sujo: boolean) => void;
}

/** Aba "Legenda" da janela do corte. */
export default function EditorLegenda({ corte, estilos, onFechar, onAlterado, onSujo }: Props) {
  const [palavras, setPalavras] = useState<PalavraLegenda[] | null>(null);
  const [editada, setEditada] = useState(false);
  const [semTranscricao, setSemTranscricao] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [t, setT] = useState(corte.inicio + 0.05);
  const [tPrevia, setTPrevia] = useState(t);
  const [versao, setVersao] = useState(0);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .legenda(corte.id)
      .then((r) => {
        setPalavras(r.palavras ?? []);
        setEditada(r.editada);
        setSemTranscricao(r.palavras === null);
        if (r.palavras?.length) {
          setT(r.palavras[0][0] + 0.05);
          setTPrevia(r.palavras[0][0] + 0.05);
        }
      })
      .catch((e) => avisar(erroTexto(e), "erro"));
  }, [corte.id]);

  // Só pede uma nova prévia quando o usuário para de mexer no controle
  useEffect(() => {
    const id = setTimeout(() => setTPrevia(t), 200);
    return () => clearTimeout(id);
  }, [t]);

  // a janela do corte pergunta antes de fechar ou trocar de aba com alterações não salvas
  useEffect(() => onSujo?.(sujo), [sujo, onSujo]);

  const fechar = onFechar;

  function alterarTexto(i: number, texto: string) {
    setPalavras((l) => l && l.map((w, j) => (j === i ? [w[0], w[1], texto] : w)));
    setSujo(true);
  }

  function remover(i: number) {
    setPalavras((l) => l && l.filter((_, j) => j !== i));
    setSujo(true);
  }

  async function salvar() {
    if (!palavras) return;
    setSalvando(true);
    try {
      const r = await api.salvarLegenda(corte.id, palavras);
      setPalavras(r.palavras ?? []);
      setEditada(r.editada);
      setSujo(false);
      setVersao((v) => v + 1);
      avisar("Legenda salva.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function restaurar() {
    if (!confirm("Descartar a edição e voltar ao texto da transcrição?")) return;
    try {
      const r = await api.restaurarLegenda(corte.id);
      setPalavras(r.palavras ?? []);
      setEditada(false);
      setSujo(false);
      setVersao((v) => v + 1);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function trocarEstilo(estilo: string) {
    try {
      onAlterado(await api.editarCorte(corte.id, { estilo }));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  const atual = palavras?.findIndex((w, i) => t >= w[0] && (i + 1 >= palavras.length || t < palavras[i + 1][0])) ?? -1;

  return (
    <>
        <div className="modal-corpo legenda-grade">
          <div className="legenda-previa">
            <img
              src={`${api.urlPreviaCorte(corte.id, tPrevia, corte.estilo)}&v=${versao}`}
              alt="Prévia da legenda neste instante"
            />
            <input
              type="range"
              min={corte.inicio}
              max={corte.fim}
              step={0.05}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              aria-label="Instante da prévia"
            />
            <div className="sutil">
              {formatar(t - corte.inicio)} de {formatar(corte.fim - corte.inicio)}
              {sujo && " · salve para ver as edições na prévia"}
            </div>
          </div>

          <div className="legenda-lado">
            <label className="campo-linha">
              Estilo
              <select value={corte.estilo} onChange={(e) => trocarEstilo(e.target.value)}>
                {estilos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
              <a className="sutil" href="#/ajustes/legendas" onClick={onFechar}>
                Editar estilos
              </a>
            </label>

            {semTranscricao && (
              <p className="erro-texto">A transcrição ainda não chegou neste trecho. Aguarde para editar a legenda.</p>
            )}
            {palavras && palavras.length === 0 && !semTranscricao && (
              <p className="sutil">Nenhuma fala reconhecida neste corte.</p>
            )}
            <p className="sutil">
              Clique numa palavra para vê-la na prévia. Corrija o texto direto no campo; × remove a palavra.
              {editada && " (legenda editada)"}
            </p>
            <div className="palavras">
              {palavras?.map((w, i) => (
                <span
                  key={i}
                  className={`palavra-chip ${i === atual ? "palavra-atual" : ""}`}
                  onMouseDown={() => setT(w[0] + 0.05)}
                  title={formatar(w[0] - corte.inicio)}
                >
                  <input
                    value={w[2]}
                    size={Math.max(2, w[2].length)}
                    onChange={(e) => alterarTexto(i, e.target.value)}
                    aria-label={`Palavra ${i + 1}`}
                  />
                  <button onClick={() => remover(i)} aria-label={`Remover palavra ${i + 1}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-rodape">
          <button className="btn" onClick={restaurar} disabled={!editada}>
            Restaurar da transcrição
          </button>
          <div className="acoes">
            <button className="btn" onClick={fechar}>
              Fechar
            </button>
            <button className="btn btn-primario" onClick={salvar} disabled={!sujo || salvando}>
              {salvando ? "Salvando…" : "Salvar legenda"}
            </button>
          </div>
        </div>
    </>
  );
}
