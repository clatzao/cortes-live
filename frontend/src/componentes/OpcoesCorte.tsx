import { useEffect, useRef, useState } from "react";
import { api, avisar, Corte, erroTexto, Formato, Marca, Projeto, Recursos } from "../api";
import { formatar } from "../tempo";
import LayoutFacecam from "./LayoutFacecam";

interface Props {
  corte: Corte;
  projeto: Projeto;
  formatos: Formato[];
  marca: Marca | null;
  onFechar: () => void;
  onAlterado: (c: Corte) => void;
  onProjeto: (p: Projeto, formatosMudaram: boolean) => void;
  onSujo?: (sujo: boolean) => void;
}

const RECURSOS: { k: keyof Recursos; nome: string }[] = [
  { k: "logo", nome: "Logo" },
  { k: "intro", nome: "Intro" },
  { k: "outro", nome: "Outro" },
  { k: "musica", nome: "Música de fundo" },
];

const RECORTE: Record<string, number> = { vertical_crop: 9 / 16, quadrado: 1 };

/** Aba "Formatos e extras" da janela do corte. */
export default function OpcoesCorte({ corte, projeto, formatos, marca, onFechar, onAlterado, onProjeto, onSujo }: Props) {
  const [sel, setSel] = useState<string[]>(corte.formatos_efetivos);
  const [cropX, setCropX] = useState(corte.crop_x ?? 0.5);
  const [gancho, setGancho] = useState(corte.gancho ?? "");
  const [recursos, setRecursos] = useState<Recursos>(corte.recursos_efetivos);
  const [verFormato, setVerFormato] = useState(corte.formatos_efetivos[0] ?? "vertical_crop");
  const [t, setT] = useState(Math.min(1, (corte.fim - corte.inicio) / 2));
  const [previa, setPrevia] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [layoutAberto, setLayoutAberto] = useState(false);
  const [projetoAtual, setProjetoAtual] = useState(projeto);
  const [sujo, setSujo] = useState(false);
  const ultima = useRef<string | null>(null);
  const areaRecorte = useRef<HTMLDivElement>(null);

  // Prévia do quadro final (espera 400 ms parado)
  useEffect(() => {
    const id = setTimeout(() => {
      setGerando(true);
      api
        .previaFormato({ corte_id: corte.id, formato: verFormato, t, crop_x: cropX, gancho, recursos })
        .then((u) => {
          if (ultima.current) URL.revokeObjectURL(ultima.current);
          ultima.current = u;
          setPrevia(u);
          setErroPrevia(null);
        })
        .catch((e) => setErroPrevia(erroTexto(e)))
        .finally(() => setGerando(false));
    }, 400);
    return () => clearTimeout(id);
  }, [corte.id, verFormato, t, cropX, gancho, recursos, projetoAtual.layout_efetivo]);

  function alternar(f: string) {
    setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
    setVerFormato(f);
    setSujo(true);
  }

  function moverRecorte(e: React.PointerEvent) {
    if (e.type === "pointermove" && e.buttons !== 1) return;
    const r = areaRecorte.current!.getBoundingClientRect();
    const frac = larguraRecorte();
    const x = (e.clientX - r.left) / r.width;
    setCropX(Math.round(Math.min(1 - frac / 2, Math.max(frac / 2, x)) * 1000) / 1000);
    setSujo(true);
  }

  function larguraRecorte(): number {
    const a = RECORTE[verFormato] ?? 9 / 16;
    return Math.min(1, ((projetoAtual.altura ?? 1) * a) / (projetoAtual.largura ?? 1));
  }

  async function salvar(fechar = true) {
    if (sel.length === 0) {
      avisar("Escolha pelo menos um formato.", "erro");
      return false;
    }
    try {
      onAlterado(await api.editarCorte(corte.id, { formatos: sel, crop_x: cropX, gancho: gancho.trim() || null, recursos }));
      setSujo(false);
      if (fechar) onFechar();
      return true;
    } catch (e) {
      avisar(erroTexto(e), "erro");
      return false;
    }
  }

  async function aplicarNoProjeto() {
    if (sel.length === 0) return;
    if (!confirm("Usar estes formatos em todos os cortes deste projeto?")) return;
    try {
      const p = await api.editarProjeto(projeto.id, { formatos: sel });
      setProjetoAtual(p);
      onProjeto(p, true);
      avisar("Formatos aplicados a todos os cortes do projeto.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  // a janela do corte pergunta antes de fechar ou trocar de aba com alterações não salvas
  useEffect(() => onSujo?.(sujo), [sujo, onSujo]);
  const fechar = onFechar;

  const frac = larguraRecorte();
  const esquerda = Math.min(1 - frac, Math.max(0, cropX - frac / 2));

  return (
    <>
        <div className="modal-corpo opcoes-grade">
          <div className="opcoes-lado">
            <h3>Formatos para exportar</h3>
            <div className="lista-formatos">
              {formatos.map((f) => (
                <label key={f.id} className={`formato-item ${verFormato === f.id ? "formato-visto" : ""}`}>
                  <input type="checkbox" checked={sel.includes(f.id)} onChange={() => alternar(f.id)} />
                  <span onClick={(e) => (e.preventDefault(), setVerFormato(f.id))}>
                    {f.nome}
                    <span className="sutil"> {f.w ? `${f.w}×${f.h}` : ""}</span>
                  </span>
                </label>
              ))}
            </div>
            <button className="btn btn-peq" onClick={aplicarNoProjeto} disabled={sel.length === 0}>
              Usar estes formatos em todo o projeto
            </button>

            {verFormato === "vertical_split" && (
              <button className="btn" onClick={() => setLayoutAberto(true)}>
                ▣ Marcar câmera e jogo
              </button>
            )}

            {RECORTE[verFormato] !== undefined && (
              <div>
                <h3>Recorte</h3>
                <p className="sutil">Arraste a janela para escolher o que aparece (vale para 9:16 e 1:1).</p>
                <div
                  className="quadro-marcacao"
                  ref={areaRecorte}
                  onPointerDown={moverRecorte}
                  onPointerMove={moverRecorte}
                  style={{ aspectRatio: `${projetoAtual.largura} / ${projetoAtual.altura}` }}
                >
                  <img src={api.urlQuadro(projeto.id, corte.inicio + t, 640)} alt="Quadro original" draggable={false} />
                  <div className="janela-recorte" style={{ left: `${esquerda * 100}%`, width: `${frac * 100}%` }} />
                </div>
                <button className="btn btn-peq" onClick={() => (setCropX(0.5), setSujo(true))}>
                  Centralizar
                </button>
              </div>
            )}

            <h3>Gancho (título no topo)</h3>
            <input
              value={gancho}
              maxLength={200}
              placeholder="Ex.: ELE NÃO ACREDITOU NESSA JOGADA"
              onChange={(e) => (setGancho(e.target.value), setSujo(true))}
            />

            <h3>Extras</h3>
            <div className="grupo-opcoes">
              {RECURSOS.map(({ k, nome }) => {
                const disponivel = !!marca?.[k].arquivo;
                return (
                  <label key={k} className="corte-check" title={disponivel ? "" : "Configure o arquivo na página Marca"}>
                    <input
                      type="checkbox"
                      disabled={!disponivel}
                      checked={disponivel && recursos[k]}
                      onChange={(e) => (setRecursos((r) => ({ ...r, [k]: e.target.checked })), setSujo(true))}
                    />
                    {nome}
                    {!disponivel && <span className="sutil">(sem arquivo)</span>}
                  </label>
                );
              })}
            </div>
            <a className="sutil" href="#/ajustes/marca" onClick={onFechar}>
              Configurar logo, intro, outro e música
            </a>
          </div>

          <div className="previa-lateral">
            <div className="sutil">
              Prévia: {formatos.find((f) => f.id === verFormato)?.nome}
              {gerando && " · atualizando…"}
            </div>
            {erroPrevia ? <p className="erro-texto">{erroPrevia}</p> : previa && <img src={previa} alt="Prévia do vídeo final" />}
            <input
              type="range"
              min={0}
              max={Math.max(0.1, corte.fim - corte.inicio - 0.1)}
              step={0.1}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              aria-label="Instante da prévia"
            />
            <div className="sutil">
              {formatar(t)} · intro, outro e música não aparecem na prévia, só no vídeo
            </div>
          </div>
        </div>

        <div className="modal-rodape">
          <span className="sutil">{sel.length} formato(s) marcado(s)</span>
          <div className="acoes">
            <button className="btn" onClick={fechar}>
              Fechar
            </button>
            <button className="btn btn-primario" disabled={!sujo}
              onClick={() => salvar(false).then((ok) => ok && avisar("Formatos e extras salvos."))}>
              Salvar
            </button>
          </div>
        </div>

      {layoutAberto && (
        <LayoutFacecam
          projeto={projetoAtual}
          corte={corte}
          marca={marca}
          onFechar={() => setLayoutAberto(false)}
          onSalvo={(p) => {
            setProjetoAtual(p);
            onProjeto(p, false);
          }}
        />
      )}
    </>
  );
}
