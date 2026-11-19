import { useEffect, useRef, useState } from "react";
import { Crosshair, Lock, RotateCcw } from "lucide-react";
import { api, avisar, Corte, erroTexto, focoEm, Formato, Marca, Projeto, Recursos, trilhaDoCorte } from "../api";
import SeletorSegmentado from "./ui/SeletorSegmentado";
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
  const [enq, setEnq] = useState<"fixo" | "auto">(corte.enquadramento ?? "fixo");
  const [corteAtual, setCorteAtual] = useState(corte);
  const trilha = trilhaDoCorte(corteAtual);
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
  const pedido = useRef(0);
  const areaRecorte = useRef<HTMLDivElement>(null);

  // Prévia do quadro final (espera 400 ms parado)
  useEffect(() => {
    const id = setTimeout(() => {
      const meu = ++pedido.current;
      setGerando(true);
      api
        .previaFormato({ corte_id: corte.id, formato: verFormato, t, crop_x: cropX, enquadramento: enq, gancho, recursos })
        .then((u) => {
          if (meu !== pedido.current) return URL.revokeObjectURL(u); // chegou uma mais nova
          if (ultima.current) URL.revokeObjectURL(ultima.current);
          ultima.current = u;
          setPrevia(u);
          setErroPrevia(null);
        })
        .catch((e) => setErroPrevia(erroTexto(e)))
        .finally(() => setGerando(false));
    }, 250);
    return () => clearTimeout(id);
  }, [corte.id, verFormato, t, cropX, enq, trilha !== null, gancho, recursos, projetoAtual.layout_efetivo]);

  // Enquadramento automático salvo mas ainda sem trilha: acompanha até o cálculo terminar.
  const esperandoTrilha = corteAtual.enquadramento === "auto" && trilha === null;
  useEffect(() => {
    if (!esperandoTrilha) return;
    const id = setInterval(() => {
      api
        .cortes(corte.projeto_id)
        .then((lista) => {
          const c = lista.find((x) => x.id === corte.id);
          if (!c) return;
          setCorteAtual(c);
          if (c.enquadramento === "fixo") {
            setEnq("fixo");
            avisar("Nenhum rosto encontrado neste corte: o recorte continua fixo.", "erro");
          }
          if (trilhaDoCorte(c) || c.enquadramento === "fixo") onAlterado(c);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [esperandoTrilha, corte.id, corte.projeto_id]);

  function alternar(f: string) {
    setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
    setVerFormato(f);
    setSujo(true);
  }

  function moverRecorte(e: React.PointerEvent) {
    if (enq === "auto") return; // no automático quem decide é a trilha
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
      const c = await api.editarCorte(corte.id, { formatos: sel, crop_x: cropX, enquadramento: enq, gancho: gancho.trim() || null, recursos });
      setCorteAtual(c);
      onAlterado(c);
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
  const centro = enq === "auto" && trilha ? focoEm(trilha, t) : cropX;
  const esquerda = Math.min(1 - frac, Math.max(0, centro - frac / 2));

  async function recalcular() {
    try {
      const c = await api.enquadrarCorte(corte.id);
      setCorteAtual(c);
      setEnq("auto");
      avisar("Procurando quem fala neste corte. Acompanhe na fila.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

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
                <SeletorSegmentado
                  rotulo="Enquadramento"
                  valor={enq}
                  aoMudar={(v) => (setEnq(v), setSujo(true))}
                  opcoes={[
                    { valor: "fixo", rotulo: "Fixo", icone: <Lock size={14} aria-hidden="true" /> },
                    { valor: "auto", rotulo: "Segue quem fala", icone: <Crosshair size={14} aria-hidden="true" /> },
                  ]}
                />
                <p className="sutil">
                  {enq === "fixo"
                    ? "Arraste a janela para escolher o que aparece (vale para 9:16 e 1:1)."
                    : trilha
                      ? "O recorte acompanha o rosto de quem está falando. A janela mostra a posição neste instante."
                      : corteAtual.enquadramento === "auto"
                        ? "Procurando quem fala neste corte… (acompanhe na fila)"
                        : "Salve para o programa achar quem fala neste corte."}
                </p>
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
                {enq === "fixo" ? (
                  <button className="btn btn-peq" onClick={() => (setCropX(0.5), setSujo(true))}>
                    Centralizar
                  </button>
                ) : (
                  <button className="btn btn-peq" onClick={recalcular} disabled={esperandoTrilha}>
                    <RotateCcw size={13} aria-hidden="true" /> Recalcular
                  </button>
                )}
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
