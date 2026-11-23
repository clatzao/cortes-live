import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { api, erroTexto } from "../api";

const URL_CHAVE = "https://aistudio.google.com/apikey";

/** Passo a passo de 1 minuto para colar a chave grátis do Gemini (sem sair da tela onde a pessoa está). */
export function JanelaGemini({ onFechar, onPronto }: { onFechar: () => void; onPronto: () => void }) {
  const [chave, setChave] = useState("");
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  async function salvar() {
    if (!chave.trim()) {
      setErro("Cole a chave copiada no Google AI Studio.");
      return;
    }
    setTestando(true);
    setErro(null);
    try {
      await api.salvarAjustes({ gemini_chave: chave.trim() });
      const r = await api.testarGemini();
      setOk(r.modelo_escolhido);
      onPronto();
    } catch (e) {
      // chave que não funciona não fica salva (senão o aviso some com o Gemini desligado)
      await api.salvarAjustes({ gemini_chave: "" }).catch(() => {});
      setErro(`A chave não funcionou: ${erroTexto(e)}`);
    } finally {
      setTestando(false);
    }
  }

  return createPortal(
    <div className="modal-fundo" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal assistente-gemini" role="dialog" aria-modal="true" aria-labelledby="titulo-gemini">
        <div className="modal-topo">
          <h2 id="titulo-gemini"><Sparkles size={18} aria-hidden="true" /> Ligar o Gemini (grátis, 1 minuto)</h2>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar"><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="modal-corpo">
          <p className="sutil">
            O Gemini lê a fala e escolhe os melhores momentos; sem ele o programa só usa volume e palavras-chave. O
            Google oferece uma cota grátis, e a chave fica só neste PC.
          </p>
          {ok ? (
            <div className="assistente-ok" role="status">
              <CheckCircle2 size={20} aria-hidden="true" /> Pronto! O Gemini está ligado (modelo {ok}).
            </div>
          ) : (
            <ol className="assistente-passos">
              <li>
                <strong>Abra o Google AI Studio</strong> e entre com sua conta do Google.
                <div className="acoes">
                  <button className="btn" onClick={() => api.abrirLink("gemini_chave").catch(() => window.open(URL_CHAVE, "_blank"))}>
                    <ExternalLink size={14} aria-hidden="true" /> Abrir aistudio.google.com/apikey
                  </button>
                </div>
              </li>
              <li><strong>Clique em "Create API key"</strong> (criar chave) e copie a chave que aparecer.</li>
              <li>
                <label htmlFor="chave-gemini"><strong>Cole a chave aqui:</strong></label>
                <div className="assistente-linha">
                  <input id="chave-gemini" type="password" value={chave} onChange={(e) => setChave(e.target.value)}
                    placeholder="AIza…" autoComplete="off" spellCheck={false} aria-invalid={!!erro}
                    aria-describedby={erro ? "erro-gemini" : undefined} onKeyDown={(e) => e.key === "Enter" && salvar()} />
                  <button className="btn btn-primario" onClick={salvar} disabled={testando}>
                    {testando ? <Loader2 size={15} className="girando" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                    Salvar e testar
                  </button>
                </div>
                {erro && <div id="erro-gemini" className="campo-data-erro" role="alert">{erro}</div>}
              </li>
            </ol>
          )}
        </div>
        <div className="modal-rodape">
          <span className="sutil">Dá para trocar ou remover depois em Ajustes → IA e hardware.</span>
          <button className="btn" onClick={onFechar}>{ok ? "Fechar" : "Agora não"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Aviso que aparece só quando não há chave do Gemini, com o botão para o passo a passo. */
export default function AvisoGemini({ motivo }: { motivo: string }) {
  const [temChave, setTemChave] = useState<boolean | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    api.ajustes().then((a) => setTemChave(a.gemini_tem_chave)).catch(() => {});
  }, []);

  if (temChave !== false) return null;
  return (
    <>
      <div className="aviso-gemini" role="note">
        <Sparkles size={16} aria-hidden="true" />
        <span>{motivo}</span>
        <button className="btn btn-peq btn-primario" onClick={() => setAberto(true)}>Ligar o Gemini grátis</button>
      </div>
      {aberto && <JanelaGemini onFechar={() => setAberto(false)} onPronto={() => setTemChave(true)} />}
    </>
  );
}
