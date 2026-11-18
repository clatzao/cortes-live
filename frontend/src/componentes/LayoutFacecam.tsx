import { useEffect, useRef, useState } from "react";
import { api, avisar, Corte, erroTexto, Layout, Marca, Projeto } from "../api";

interface Props {
  projeto: Projeto;
  corte: Corte;
  marca: Marca | null;
  onFechar: () => void;
  onSalvo: (p: Projeto) => void;
}

type Ret = [number, number, number, number];
const limitar = (v: number) => Math.min(1, Math.max(0, v));

/** Marca, num quadro da live, onde ficam a câmera e o jogo (vale para o projeto todo). */
export default function LayoutFacecam({ projeto, corte, marca, onFechar, onSalvo }: Props) {
  const [layout, setLayout] = useState<Layout>(projeto.layout_efetivo);
  const [modo, setModo] = useState<"cam" | "jogo">("cam");
  const [desenho, setDesenho] = useState<Ret | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [comoPadrao, setComoPadrao] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const inicio = useRef<[number, number] | null>(null);
  const ultima = useRef<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => {
      const meu = ++pedido.current;
      api
        .previaFormato({ corte_id: corte.id, formato: "vertical_split", t: 1, layout })
        .then((u) => {
          if (meu !== pedido.current) return URL.revokeObjectURL(u); // chegou uma mais nova
          if (ultima.current) URL.revokeObjectURL(ultima.current);
          ultima.current = u;
          setPrevia(u);
        })
        .catch((e) => avisar(erroTexto(e), "erro"));
    }, 250);
    return () => clearTimeout(id);
  }, [layout, corte.id]);

  function ponto(e: React.PointerEvent): [number, number] {
    const r = area.current!.getBoundingClientRect();
    return [limitar((e.clientX - r.left) / r.width), limitar((e.clientY - r.top) / r.height)];
  }

  function aoPressionar(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = ponto(e);
    setDesenho([...inicio.current, 0, 0]);
  }

  function aoMover(e: React.PointerEvent) {
    if (!inicio.current) return;
    const [x0, y0] = inicio.current;
    const [x1, y1] = ponto(e);
    setDesenho([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]);
  }

  function aoSoltar() {
    inicio.current = null;
    if (desenho && desenho[2] > 0.03 && desenho[3] > 0.03) {
      const r = desenho.map((v) => Math.round(v * 10000) / 10000) as Ret;
      setLayout((l) => ({ ...l, [modo]: r }));
      if (modo === "cam") setModo("jogo");
    }
    setDesenho(null);
  }

  async function salvar() {
    try {
      const p = await api.editarProjeto(projeto.id, { layout });
      if (comoPadrao && marca) await api.salvarMarca({ ...marca, layout_padrao: layout });
      onSalvo(p);
      avisar("Layout de câmera e jogo salvo.");
      onFechar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  const caixa = (r: Ret, classe: string, rotulo: string) => (
    <div
      className={`ret ${classe}`}
      style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }}
    >
      <span>{rotulo}</span>
    </div>
  );

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal" role="dialog" aria-label="Marcar câmera e jogo">
        <div className="modal-topo">
          <h2>Câmera + jogo · {projeto.nome}</h2>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-corpo layout-grade">
          <div>
            <div className="acoes">
              <button className={`btn btn-peq ${modo === "cam" ? "btn-primario" : ""}`} onClick={() => setModo("cam")}>
                1. Desenhar a câmera
              </button>
              <button className={`btn btn-peq ${modo === "jogo" ? "btn-primario" : ""}`} onClick={() => setModo("jogo")}>
                2. Desenhar o jogo
              </button>
            </div>
            <p className="sutil">Arraste no quadro para desenhar o retângulo selecionado. O enquadramento é ajustado sozinho.</p>
            <div
              className="quadro-marcacao"
              ref={area}
              onPointerDown={aoPressionar}
              onPointerMove={aoMover}
              onPointerUp={aoSoltar}
              style={{ aspectRatio: `${projeto.largura} / ${projeto.altura}` }}
            >
              <img src={api.urlQuadro(projeto.id, corte.inicio + 1)} alt="Quadro da live" draggable={false} />
              {caixa(layout.jogo, "ret-jogo", "Jogo")}
              {caixa(layout.cam, "ret-cam", "Câmera")}
              {desenho && caixa(desenho, modo === "cam" ? "ret-cam" : "ret-jogo", "")}
            </div>
            <label className="campo-deslizante">
              <span>
                Altura da câmera no vídeo <strong>{Math.round(layout.proporcao * 100)}%</strong>
              </span>
              <input
                type="range"
                min={0.2}
                max={0.7}
                step={0.01}
                value={layout.proporcao}
                onChange={(e) => setLayout((l) => ({ ...l, proporcao: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="previa-lateral">
            {previa ? <img src={previa} alt="Prévia 9:16 câmera + jogo" /> : <p className="sutil">Gerando prévia…</p>}
          </div>
        </div>
        <div className="modal-rodape">
          <label className="corte-check">
            <input type="checkbox" checked={comoPadrao} onChange={(e) => setComoPadrao(e.target.checked)} />
            Usar também como padrão para novos projetos
          </label>
          <div className="acoes">
            <button className="btn" onClick={onFechar}>
              Cancelar
            </button>
            <button className="btn btn-primario" onClick={salvar}>
              Salvar layout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
