import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Captions, Image as IconeImagem, Languages, Smartphone, X } from "lucide-react";
import { Corte, Estilo, Formato, Marca, Projeto } from "../api";
import { duracaoCurta } from "../tempo";
import EditorLegenda from "./EditorLegenda";
import OpcoesCorte from "./OpcoesCorte";
import IdiomasCorte from "./IdiomasCorte";

// o editor de thumb (Konva) só é baixado quando a aba é aberta
const EditorThumb = lazy(() => import("../thumb/EditorThumb"));

export type AbaCorte = "legenda" | "formatos" | "idiomas" | "thumb";

const ABAS: { id: AbaCorte; nome: string; dica: string; Icone: typeof Captions }[] = [
  { id: "legenda", nome: "Legenda", dica: "Estilo e texto da legenda", Icone: Captions },
  { id: "formatos", nome: "Formatos e extras", dica: "9:16, 1:1, 16:9, recorte, gancho, logo, música…", Icone: Smartphone },
  { id: "idiomas", nome: "Idiomas", dica: "Traduzir a legenda e dublar", Icone: Languages },
  { id: "thumb", nome: "Thumbnail", dica: "Capa do vídeo", Icone: IconeImagem },
];

interface Props {
  corte: Corte;
  projeto: Projeto;
  estilos: Estilo[];
  formatos: Formato[];
  marca: Marca | null;
  abaInicial: AbaCorte;
  onFechar: () => void;
  onAlterado: (c: Corte) => void;
  onProjeto: (p: Projeto, formatosMudaram: boolean) => void;
}

/** Tudo de um corte numa janela só, em abas. */
export default function JanelaCorte(p: Props) {
  const [aba, setAba] = useState<AbaCorte>(p.abaInicial);
  const [sujo, setSujo] = useState(false);
  const marcarSujo = useCallback((s: boolean) => setSujo(s), []);

  const podeSair = useCallback(
    () => !sujo || confirm("Há alterações não salvas nesta aba. Descartar?"),
    [sujo],
  );

  const fechar = useCallback(() => {
    if (podeSair()) p.onFechar();
  }, [podeSair, p]);

  function trocarAba(nova: AbaCorte) {
    if (nova === aba || !podeSair()) return;
    setSujo(false);
    setAba(nova);
  }

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelectorAll(".modal-fundo")[1]) fechar(); // ignora se houver outra janela por cima
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [fechar]);

  // renderizada direto no <body>: dentro do painel lateral ela ficava por baixo do menu do topo
  return createPortal(
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className={`modal ${aba === "thumb" ? "modal-thumb" : ""}`} role="dialog" aria-label={`Editar ${p.corte.nome}`}>
        <div className="modal-topo">
          <div className="janela-titulo">
            <h2 title={p.corte.nome}>{p.corte.nome}</h2>
            <span className="sutil">{duracaoCurta(p.corte.fim - p.corte.inicio)}</span>
          </div>
          <div className="abas-janela" role="tablist">
            {ABAS.map(({ id, nome, dica, Icone }) => (
              <button key={id} role="tab" aria-selected={aba === id} className={aba === id ? "ativo" : ""}
                onClick={() => trocarAba(id)} title={dica}>
                <Icone size={15} /> {nome}
              </button>
            ))}
          </div>
          <button className="btn-icone" onClick={fechar} aria-label="Fechar" title="Fechar (Esc)">
            <X size={18} />
          </button>
        </div>

        {aba === "legenda" && (
          <EditorLegenda corte={p.corte} estilos={p.estilos} onFechar={fechar} onAlterado={p.onAlterado}
            onSujo={marcarSujo} />
        )}
        {aba === "formatos" && (
          <OpcoesCorte corte={p.corte} projeto={p.projeto} formatos={p.formatos} marca={p.marca} onFechar={fechar}
            onAlterado={p.onAlterado} onProjeto={p.onProjeto} onSujo={marcarSujo} />
        )}
        {aba === "idiomas" && <IdiomasCorte corte={p.corte} onFechar={fechar} onSujo={marcarSujo} />}
        {aba === "thumb" && (
          <Suspense fallback={<p className="painel-pad sutil">Abrindo o editor de thumbnail…</p>}>
            <EditorThumb corte={p.corte} onSujo={marcarSujo} />
          </Suspense>
        )}
      </div>
    </div>,
    document.body,
  );
}
