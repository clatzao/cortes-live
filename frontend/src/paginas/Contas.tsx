import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ClipboardPaste, Copy, ExternalLink, Instagram, KeyRound, Music2, Plus, Youtube } from "lucide-react";
import { Ajustes, api, avisar, ContaSocial, erroTexto, InfoRede, NomeRede } from "../api";
import CartaoConta from "../componentes/ui/CartaoConta";

const LINK: Record<NomeRede, "google_cloud" | "tiktok_dev" | "meta_dev"> = {
  youtube: "google_cloud", tiktok: "tiktok_dev", instagram: "meta_dev",
};
const SITE: Record<NomeRede, string> = {
  youtube: "console.cloud.google.com", tiktok: "developers.tiktok.com", instagram: "developers.facebook.com",
};
const PASSOS: Record<NomeRede, string[]> = {
  youtube: [
    "Crie um projeto e ative a \"YouTube Data API v3\" (APIs e serviços → Biblioteca).",
    "Tela de consentimento OAuth: tipo Externo, com o seu e-mail. Depois clique em \"Publicar app\" (em modo Teste o acesso expira a cada 7 dias).",
    "Credenciais → Criar credenciais → ID do cliente OAuth → tipo \"App para computador\".",
    "Copie o ID do cliente e a chave secreta para os campos abaixo.",
  ],
  tiktok: [
    "Manage apps → Connect an app. Adicione os produtos Login Kit e Content Posting API (ligue o \"Direct Post\").",
    "No Login Kit, cadastre o endereço de retorno abaixo em Redirect URI.",
    "Copie o Client key e o Client secret para os campos abaixo.",
    "Enquanto o TikTok não aprovar o app (auditoria), os vídeos saem só como privados.",
  ],
  instagram: [
    "A sua conta do Instagram precisa ser Profissional (Criador ou Empresa).",
    "Crie um app do tipo Empresa e adicione o produto Instagram → \"API com login do Instagram\".",
    "Em \"Configurar login comercial\", cadastre o endereço de retorno abaixo; em Funções, adicione a sua conta como testadora e aceite o convite no Instagram.",
    "Copie o ID e a chave secreta do app do Instagram para os campos abaixo.",
  ],
};

function IconeRede({ rede }: { rede: NomeRede }) {
  if (rede === "youtube") return <Youtube size={18} aria-hidden="true" />;
  if (rede === "instagram") return <Instagram size={18} aria-hidden="true" />;
  return <Music2 size={18} aria-hidden="true" />;
}

/** S23: contas das redes (login oficial), os apps de desenvolvedor e o início com o Windows. */
export default function Contas() {
  const [redes, setRedes] = useState<InfoRede[] | null>(null);
  const [contas, setContas] = useState<ContaSocial[]>([]);
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    Promise.all([api.redes(), api.contas(), api.ajustes()])
      .then(([r, c, a]) => { setRedes(r); setContas(c); setAj(a); setErro(null); })
      .catch((e) => setErro(erroTexto(e)));
  }, []);
  useEffect(recarregar, [recarregar]);

  async function iniciarComWindows(ligar: boolean) {
    try {
      setAj(await api.salvarAjustes({ iniciar_com_windows: ligar }));
      avisar(ligar ? "O Cortes Live vai abrir na bandeja ao ligar o PC." : "Não abre mais sozinho com o Windows.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function avisosDoWindows(ligar: boolean) {
    try {
      setAj(await api.salvarAjustes({ notificacoes: ligar }));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  return (
    <div className="pagina-contas">
      <h1>Contas das redes</h1>
      <p className="sutil">
        Conecte as suas contas para publicar e agendar os cortes direto da Biblioteca. O login é feito no site oficial de
        cada rede; o Cortes Live guarda o acesso cifrado só neste PC.
      </p>
      {erro && <div className="aviso aviso-erro" role="alert">Não deu para carregar: {erro}</div>}

      {aj && (
        <section className="secao-contas" aria-labelledby="titulo-agendamento">
          <h2 id="titulo-agendamento">Bandeja e avisos</h2>
          <label className="linha-check">
            <input type="checkbox" checked={aj.iniciar_com_windows} disabled={!aj.iniciar_com_windows_disponivel}
              onChange={(e) => iniciarComWindows(e.target.checked)} />
            Abrir o Cortes Live na bandeja ao ligar o PC
          </label>
          <p className="sutil">
            {aj.iniciar_com_windows_disponivel
              ? "Os posts agendados só saem com o programa aberto ou na bandeja (fechar a janela deixa ele na bandeja, perto do relógio). Os atrasados saem assim que ele abrir."
              : "Disponível no programa instalado."}
          </p>
          <label className="linha-check">
            <input type="checkbox" checked={aj.notificacoes} disabled={!aj.notificacoes_disponivel}
              onChange={(e) => avisosDoWindows(e.target.checked)} />
            Avisar no Windows quando exportar, publicar, a live começar ou acabar, ou der erro
          </label>
        </section>
      )}

      {redes?.map((r) => (
        <SecaoRede key={r.nome} rede={r} contas={contas.filter((c) => c.rede === r.nome)} aoMudar={recarregar} />
      ))}
    </div>
  );
}

function SecaoRede({ rede, contas, aoMudar }: { rede: InfoRede; contas: ContaSocial[]; aoMudar: () => void }) {
  const [appId, setAppId] = useState(rede.app_id);
  const [segredo, setSegredo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [login, setLogin] = useState<{ state: string } | null>(null);
  const [colado, setColado] = useState("");
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<number | null>(null);
  const titulo = `titulo-rede-${rede.nome}`;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  async function salvarApp() {
    if (!appId.trim()) return avisar("Cole o ID do app.", "erro");
    if (!segredo.trim() && !rede.configurada) return avisar("Cole a chave secreta do app.", "erro");
    setSalvando(true);
    try {
      await api.salvarAjustes({ [rede.campo_id]: appId.trim(), ...(segredo.trim() ? { [rede.campo_segredo]: segredo.trim() } : {}) });
      setSegredo("");
      avisar(`App do ${rede.titulo} salvo.`);
      aoMudar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  function parar() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  }

  async function conectar() {
    setErroLogin(null);
    setColado("");
    try {
      const l = await api.conectarRede(rede.nome);
      setLogin({ state: l.state });
      parar();
      timer.current = window.setInterval(async () => {
        try {
          const e = await api.estadoLogin(l.state);
          if (e.status === "ok") {
            parar();
            setLogin(null);
            avisar(`Conta do ${rede.titulo} conectada.`);
            aoMudar();
          } else if (e.status !== "aguardando") {
            parar();
            setLogin(null);
            setErroLogin(e.msg);
          }
        } catch {
          /* tenta na próxima */
        }
      }, 1500);
    } catch (e) {
      setErroLogin(erroTexto(e));
    }
  }

  async function colar() {
    if (!colado.trim()) return;
    try {
      await api.colarRetorno(colado.trim());
      parar();
      setLogin(null);
      setColado("");
      avisar(`Conta do ${rede.titulo} conectada.`);
      aoMudar();
    } catch (e) {
      setErroLogin(erroTexto(e));
    }
  }

  async function desconectar(c: ContaSocial) {
    try {
      await api.desconectarConta(c.id);
      avisar(`${c.nome} desconectada.`);
      aoMudar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(rede.retorno);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      avisar("Não deu para copiar: selecione o endereço e copie à mão.", "erro");
    }
  }

  return (
    <section className="secao-contas" aria-labelledby={titulo}>
      <h2 id={titulo}><IconeRede rede={rede.nome} /> {rede.titulo}</h2>

      {contas.map((c) => (
        <CartaoConta key={c.id} conta={{ rede: c.rede, estado: c.status === "ativa" ? "ativa" : "expirada", nome: c.nome,
          avatar: c.avatar_url, so_privado: !!c.so_privado }} aoConectar={conectar} aoDesconectar={() => desconectar(c)} />
      ))}
      {rede.configurada && contas.length === 0 && (
        <CartaoConta conta={{ rede: rede.nome, estado: login ? "conectando" : "desconectada" }} aoConectar={conectar} />
      )}
      {rede.configurada && contas.length > 0 && !login && (
        <div>
          <button type="button" className="btn" onClick={conectar}>
            <Plus size={14} aria-hidden="true" /> Conectar outra conta do {rede.titulo}
          </button>
        </div>
      )}

      {login && (
        <div className="colar-retorno">
          <p className="sutil">
            {rede.retorno_automatico
              ? "Termine o login na janela do navegador que abriu. Se no fim aparecer uma página de erro, copie o endereço da barra do navegador e cole aqui:"
              : "Termine o login no navegador. No fim vai aparecer uma página que não abre (é normal): copie o endereço inteiro da barra do navegador e cole aqui:"}
          </p>
          <div className="assistente-linha">
            <input value={colado} onChange={(e) => setColado(e.target.value)} placeholder="https://localhost:53682/?code=…"
              aria-label={`Endereço de retorno do ${rede.titulo}`} onKeyDown={(e) => e.key === "Enter" && colar()} />
            <button className="btn btn-primario" onClick={colar}><ClipboardPaste size={15} aria-hidden="true" /> Concluir</button>
            <button className="btn" onClick={() => { parar(); setLogin(null); }}>Cancelar</button>
          </div>
        </div>
      )}
      {erroLogin && <div className="campo-data-erro" role="alert">{erroLogin}</div>}

      <details className="app-rede" open={!rede.configurada}>
        <summary><KeyRound size={14} aria-hidden="true" /> App de desenvolvedor do {rede.titulo}
          {rede.configurada ? <span className="sutil"> · configurado</span> : <span className="sutil"> · falta configurar</span>}
        </summary>
        <ol className="assistente-passos">
          <li>
            Abra <button type="button" className="btn btn-peq" onClick={() => api.abrirLink(LINK[rede.nome]).catch(() => {})}>
              <ExternalLink size={13} aria-hidden="true" /> {SITE[rede.nome]}
            </button>
          </li>
          {PASSOS[rede.nome].map((p) => <li key={p}>{p}</li>)}
        </ol>
        <div className="campos-app">
          <label>
            Endereço de retorno (cadastre no app)
            <span className="assistente-linha">
              <input readOnly value={rede.retorno} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={copiar} aria-label="Copiar o endereço de retorno">
                {copiado ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copiado ? "Copiado" : "Copiar"}
              </button>
            </span>
          </label>
          <label>
            ID do app
            <input value={appId} onChange={(e) => setAppId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            Chave secreta do app
            <input type="password" value={segredo} onChange={(e) => setSegredo(e.target.value)} autoComplete="off"
              placeholder={rede.configurada ? "•••••• (salva; cole outra para trocar)" : ""} spellCheck={false} />
          </label>
          <div>
            <button className="btn btn-primario" onClick={salvarApp} disabled={salvando}>Salvar app</button>
          </div>
        </div>
      </details>
    </section>
  );
}
