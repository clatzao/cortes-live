import { useEffect, useRef, useState } from "react";
import { Download, Languages, Mic, Save } from "lucide-react";
import { api, avisar, Corte, erroTexto, EstadoIdiomas, IdiomaOpcao, SegmentoTraducao, Voz } from "../api";
import Progresso from "./Progresso";
import SeletorSegmentado from "./ui/SeletorSegmentado";
import { formatar } from "../tempo";

/** Aba "Idiomas" da janela do corte: traduzir a legenda, revisar, dublar e exportar a versão. */
export default function IdiomasCorte({ corte, onFechar, onSujo }: {
  corte: Corte;
  onFechar: () => void;
  onSujo: (sujo: boolean) => void;
}) {
  const [opcoes, setOpcoes] = useState<IdiomaOpcao[]>([]);
  const [idioma, setIdioma] = useState("en");
  const [estado, setEstado] = useState<EstadoIdiomas | null>(null);
  const [texto, setTexto] = useState<SegmentoTraducao[] | null>(null);
  const [vozes, setVozes] = useState<Voz[] | null>(null);
  const [erroVozes, setErroVozes] = useState<string | null>(null);
  const [voz, setVoz] = useState("");
  const [original, setOriginal] = useState<"abaixar" | "silenciar">("abaixar");
  const [versao, setVersao] = useState(0);
  const sujo = useRef(false);

  useEffect(() => {
    api.idiomas().then(setOpcoes).catch(() => {});
  }, []);

  // estado das traduções/dublagens; enquanto algum job anda, atualiza a cada 2 s
  useEffect(() => {
    let vivo = true;
    let t: number | undefined;
    const carregar = () =>
      api
        .idiomasDoCorte(corte.id)
        .then((e) => {
          if (!vivo) return;
          setEstado(e);
          const andando = [e.job_traducao, e.job_dublagem].some((j) => j && (j.status === "na_fila" || j.status === "executando"));
          if (andando) t = window.setTimeout(carregar, 2000);
        })
        .catch(() => {});
    carregar();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [corte.id, versao]);

  const trad = estado?.traducoes.find((x) => x.idioma === idioma) ?? null;
  const dub = estado?.dublagens.find((x) => x.idioma === idioma && x.existe) ?? null;
  const jt = estado?.job_traducao;
  const jd = estado?.job_dublagem;
  const traduzindo = !!jt && (jt.status === "na_fila" || jt.status === "executando");
  const dublando = !!jd && (jd.status === "na_fila" || jd.status === "executando");

  useEffect(() => {
    if (!sujo.current) setTexto(trad ? trad.segmentos : null);
  }, [trad?.segmentos, idioma]);

  useEffect(() => {
    setVozes(null);
    setErroVozes(null);
    api
      .vozes(idioma)
      .then((v) => {
        setVozes(v);
        setVoz((atual) => (v.some((x) => x.codigo === atual) ? atual : v[0]?.codigo ?? ""));
      })
      .catch((e) => setErroVozes(erroTexto(e)));
  }, [idioma]);

  function marcar(v: boolean) {
    sujo.current = v;
    onSujo(v);
  }

  async function traduzir() {
    try {
      await api.traduzirCorte(corte.id, idioma);
      marcar(false);
      setVersao((n) => n + 1);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvarTexto() {
    if (!texto) return;
    try {
      await api.salvarTraducao(corte.id, idioma, texto);
      marcar(false);
      setVersao((n) => n + 1);
      avisar("Tradução salva.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function dublar() {
    if (sujo.current && !(await salvarTextoAntes())) return;
    try {
      await api.dublarCorte(corte.id, { idioma, voz, audio_original: original });
      setVersao((n) => n + 1);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function salvarTextoAntes(): Promise<boolean> {
    try {
      await salvarTexto();
      return true;
    } catch {
      return false;
    }
  }

  async function exportar() {
    try {
      const j = await api.exportarCorte(corte.id, undefined, idioma);
      avisar(`${j.length} arquivo(s) em ${nomeIdioma} na fila de exportação.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  const nomeIdioma = opcoes.find((o) => o.codigo === idioma)?.nome ?? idioma;
  const vozEscolhida = vozes?.find((v) => v.codigo === voz);

  return (
    <>
      <div className="modal-corpo idiomas-corte">
        <div className="idiomas-linha">
          <label>
            Idioma da versão
            <select value={idioma} onChange={(e) => (marcar(false), setIdioma(e.target.value))}>
              {opcoes.map((o) => <option key={o.codigo} value={o.codigo}>{o.nome}</option>)}
            </select>
          </label>
          <button className="btn btn-primario" onClick={traduzir} disabled={traduzindo}>
            <Languages size={15} aria-hidden="true" /> {trad ? "Traduzir de novo" : "Traduzir a legenda"}
          </button>
        </div>
        <p className="sutil">A tradução usa o Gemini (Ajustes → IA e hardware). Cada frase mantém o tempo da fala original.</p>

        {traduzindo && jt && <Progresso valor={jt.progresso} texto={jt.mensagem} />}
        {jt?.status === "erro" && <div className="aviso aviso-erro" role="alert">{jt.mensagem}</div>}

        {texto && (
          <section className="traducao" aria-label={`Tradução em ${nomeIdioma}`}>
            <h3>Texto em {nomeIdioma} {trad?.editada ? <span className="chip">editado</span> : null}</h3>
            <ol className="lista-traducao">
              {texto.map((s, i) => (
                <li key={i}>
                  <time className="sutil">{formatar(s.inicio).slice(3, 8)}</time>
                  <input value={s.texto} aria-label={`Frase ${i + 1}`}
                    onChange={(e) => (marcar(true), setTexto(texto.map((x, k) => (k === i ? { ...x, texto: e.target.value } : x))))} />
                </li>
              ))}
            </ol>
            <button className="btn btn-peq" onClick={salvarTexto}><Save size={13} aria-hidden="true" /> Salvar o texto</button>
          </section>
        )}

        {trad && (
          <section className="dublagem" aria-label="Dublagem">
            <h3>Dublagem (opcional)</h3>
            {erroVozes && <div className="aviso aviso-erro" role="alert">{erroVozes}</div>}
            {vozes && vozes.length === 0 && (
              <p className="sutil">Ainda não há voz pronta em {nomeIdioma}. Dá para exportar só com a legenda traduzida.</p>
            )}
            {vozes && vozes.length > 0 && (
              <>
                <div className="idiomas-linha">
                  <label>
                    Voz
                    <select value={voz} onChange={(e) => setVoz(e.target.value)}>
                      {vozes.map((v) => (
                        <option key={v.codigo} value={v.codigo}>{v.nome}{v.baixada ? "" : ` · baixa ${v.tamanho_mb} MB`}</option>
                      ))}
                    </select>
                  </label>
                  <SeletorSegmentado rotulo="Áudio original" tamanho="sm" valor={original} aoMudar={setOriginal}
                    opcoes={[{ valor: "abaixar", rotulo: "Original baixinho" }, { valor: "silenciar", rotulo: "Sem o original" }]} />
                  <button className="btn" onClick={dublar} disabled={dublando || !voz}>
                    <Mic size={15} aria-hidden="true" /> {dub ? "Dublar de novo" : "Dublar"}
                  </button>
                </div>
                {vozEscolhida && !vozEscolhida.baixada && (
                  <p className="sutil">Na primeira vez a voz é baixada ({vozEscolhida.tamanho_mb} MB) e fica no PC.</p>
                )}
              </>
            )}
            {dublando && jd && <Progresso valor={jd.progresso} texto={jd.mensagem} />}
            {jd?.status === "erro" && <div className="aviso aviso-erro" role="alert">{jd.mensagem}</div>}
            {dub && !dublando && (
              <audio controls src={`${api.urlDublagem(corte.id, idioma)}?v=${versao}`} aria-label="Ouvir a dublagem" />
            )}
          </section>
        )}
      </div>
      <div className="modal-rodape">
        <span className="sutil">
          {trad ? `Exporta com a legenda em ${nomeIdioma}${dub ? " e a dublagem" : ""}.` : "Traduza para exportar a versão."}
        </span>
        <div className="acoes">
          <button className="btn" onClick={onFechar}>Fechar</button>
          <button className="btn btn-primario" onClick={exportar} disabled={!trad || traduzindo || dublando}>
            <Download size={15} aria-hidden="true" /> Exportar em {nomeIdioma}
          </button>
        </div>
      </div>
    </>
  );
}
