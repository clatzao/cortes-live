import { FormEvent, useEffect, useState } from "react";
import { Loader2, Radio, Trash2 } from "lucide-react";
import { api, avisar, erroTexto, Idioma, Live } from "../api";
import SeletorSegmentado from "../componentes/ui/SeletorSegmentado";
import CartaoLive, { DadosLive, EstadoLive } from "../componentes/ui/CartaoLive";

/** Live da API → dados do cartão (o cartão não conhece "cancelada"). */
export function paraCartao(v: Live, disco?: number): DadosLive {
  const status: EstadoLive = v.status === "cancelada" ? "encerrada" : v.status;
  return {
    plataforma: v.plataforma,
    canal: v.canal,
    status,
    gravado_s: v.gravado_s,
    cortes: v.cortes_criados,
    disco_livre_gb: disco,
    erro: v.erro,
  };
}

const ATIVAS = new Set(["aguardando", "gravando", "reconectando", "finalizando"]);

/** S08: monitorar um canal novo e ver as lives monitoradas. */
export default function Lives() {
  const [lives, setLives] = useState<Live[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("pt");

  const carregar = () =>
    api
      .lives()
      .then((l) => {
        setLives(l);
        setErroLista(null);
      })
      .catch((e) => setErroLista(erroTexto(e)));

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 3000);
    return () => clearInterval(t);
  }, []);

  async function monitorar(e: FormEvent) {
    e.preventDefault();
    if (!entrada.trim()) {
      setErroCampo("Cole o link ou o nome do canal.");
      return;
    }
    setEnviando(true);
    setErroCampo(null);
    try {
      const v = await api.criarLive(entrada.trim(), idioma);
      setEntrada("");
      window.location.hash = `#/live/${v.id}`;
    } catch (err) {
      setErroCampo(erroTexto(err));
    } finally {
      setEnviando(false);
    }
  }

  async function remover(v: Live) {
    try {
      await api.removerLive(v.id);
      carregar();
    } catch (err) {
      avisar(erroTexto(err), "erro");
    }
  }

  const ativas = (lives ?? []).filter((v) => ATIVAS.has(v.status));
  const antigas = (lives ?? []).filter((v) => !ATIVAS.has(v.status));

  return (
    <div className="pagina-lives">
      <section className="cartao nova-live">
        <h1>Cortar uma live enquanto ela acontece</h1>
        <p className="sutil">
          O Cortes Live grava a transmissão, analisa o que foi dito a cada 3 minutos e cria os cortes sozinho. Se o
          canal ainda não estiver no ar, ele espera começar.
        </p>
        <form onSubmit={monitorar} className="nova-live-form" noValidate>
          <label htmlFor="canal-live" className="nova-live-rotulo">Canal ou link</label>
          <div className="nova-live-linha">
            <input
              id="canal-live"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="twitch.tv/canal, kick.com/canal ou youtube.com/@canal"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!erroCampo}
              aria-describedby={erroCampo ? "canal-live-erro" : "canal-live-dica"}
              disabled={enviando}
            />
            <button className="btn btn-primario" type="submit" disabled={enviando}>
              {enviando ? <Loader2 size={15} className="girando" aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}
              Monitorar
            </button>
          </div>
          <div className="nova-live-idioma">
            <span className="sutil" id="idioma-live">Idioma falado na live</span>
            <SeletorSegmentado rotulo="Idioma falado na live" tamanho="sm" valor={idioma} aoMudar={setIdioma}
              desabilitado={enviando}
              opcoes={[{ valor: "pt", rotulo: "Português" }, { valor: "en", rotulo: "Inglês" }, { valor: "misto", rotulo: "Misto" }]} />
          </div>
          {erroCampo ? (
            <div id="canal-live-erro" className="campo-data-erro" role="alert">{erroCampo}</div>
          ) : (
            <div id="canal-live-dica" className="campo-data-dica">Só o nome também serve: vira um canal da Twitch.</div>
          )}
        </form>
      </section>

      {erroLista && <div className="aviso aviso-erro" role="alert">Não deu para carregar as lives: {erroLista}</div>}

      {lives === null && !erroLista && <p className="sutil">Carregando…</p>}

      {lives !== null && lives.length === 0 && (
        <div className="vazio">
          <strong>Nenhuma live monitorada ainda.</strong>
          <p className="sutil">Cole o canal acima. Os cortes aparecem aqui conforme a live avança.</p>
        </div>
      )}

      {ativas.length > 0 && (
        <section className="lista-lives" aria-label="Lives em andamento">
          <h2>Agora</h2>
          <div className="grade-lives">
            {ativas.map((v) => (
              <a key={v.id} className="link-cartao" href={`#/live/${v.id}`} aria-label={`Abrir a live de ${v.canal}`}>
                <CartaoLive live={paraCartao(v)} compacto />
              </a>
            ))}
          </div>
        </section>
      )}

      {antigas.length > 0 && (
        <section className="lista-lives" aria-label="Lives anteriores">
          <h2>Anteriores</h2>
          <div className="grade-lives">
            {antigas.map((v) => (
              <div key={v.id} className="live-antiga">
                <a className="link-cartao" href={`#/live/${v.id}`} aria-label={`Abrir a live de ${v.canal}`}>
                  <CartaoLive live={paraCartao(v)} compacto />
                </a>
                <button className="btn-icone" onClick={() => remover(v)} title="Tirar da lista (o projeto continua)"
                  aria-label={`Tirar a live de ${v.canal} da lista`}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {ativas.length > 0 && (
        <p className="sutil">
          Para parar uma gravação, abra a live. Até 4 lives gravam ao mesmo tempo.
        </p>
      )}
    </div>
  );
}
