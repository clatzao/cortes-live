import Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Arrow, Ellipse, Group, Image as KImage, Label, Layer, Rect, Stage, Tag, Text, Transformer } from "react-konva";
import { Camada, CamadaImagem, CamadaTexto, Design } from "./modelo";

// ---------------------------------------------------------------- imagens

const cacheImagens = new Map<string, Promise<HTMLImageElement>>();

export function carregarImagem(src: string): Promise<HTMLImageElement> {
  let p = cacheImagens.get(src);
  if (!p) {
    p = new Promise((ok, erro) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => ok(img);
      img.onerror = () => erro(new Error(`Não foi possível carregar ${src}`));
      img.src = src;
    });
    cacheImagens.set(src, p);
  }
  return p;
}

function useImagem(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarImagem(src).then((i) => vivo && setImg(i)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, [src]);
  return img;
}

const cacheSilhuetas = new Map<string, HTMLCanvasElement>();

/** Silhueta colorida da imagem (para desenhar o contorno em volta do recorte). */
function silhueta(img: HTMLImageElement, cor: string): HTMLCanvasElement {
  const chave = `${img.src}|${cor}`;
  let c = cacheSilhuetas.get(chave);
  if (!c) {
    c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    // só a parte firme do recorte vira contorno (bordas semitransparentes geravam "fantasmas")
    const px = ctx.getImageData(0, 0, c.width, c.height);
    const d = px.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
    ctx.putImageData(px, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, c.width, c.height);
    cacheSilhuetas.set(chave, c);
  }
  return c;
}

// ---------------------------------------------------------------- camadas

function ImagemCamada({ c }: { c: CamadaImagem }) {
  const img = useImagem(c.src);
  const ref = useRef<Konva.Image>(null);

  // filtros do Konva exigem cache do nó; refaz quando os ajustes mudam
  useEffect(() => {
    const n = ref.current;
    if (!n || !img) return;
    if (c.brilho || c.contraste || c.saturacao) {
      n.cache();
    } else {
      n.clearCache();
    }
    n.getLayer()?.batchDraw();
  }, [img, c.brilho, c.contraste, c.saturacao, c.largura, c.altura]);

  if (!img) return <Rect width={c.largura} height={c.altura} fill="#333" />;
  const offsets: [number, number][] = [];
  if (c.contornoCor && c.contornoLargura > 0) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      offsets.push([Math.cos(a) * c.contornoLargura, Math.sin(a) * c.contornoLargura]);
    }
  }
  return (
    <>
      {offsets.map(([dx, dy], k) => (
        <KImage key={k} image={silhueta(img, c.contornoCor!)} x={dx} y={dy} width={c.largura} height={c.altura}
          listening={false} />
      ))}
      <KImage
        ref={ref}
        image={img}
        width={c.largura}
        height={c.altura}
        filters={[Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL]}
        brightness={c.brilho}
        contrast={c.contraste}
        saturation={c.saturacao}
      />
    </>
  );
}

function TextoCamada({ c, versaoFontes }: { c: CamadaTexto; versaoFontes: number }) {
  const pad = c.fundo ? c.tamanho * 0.22 : 0;
  return (
    <Label key={versaoFontes}>
      <Tag fill={c.fundo ?? undefined} cornerRadius={c.tamanho * 0.18} />
      <Text
        text={c.maiusculas ? c.texto.toUpperCase() : c.texto}
        width={c.largura}
        fontFamily={`"${c.fonte}", "Segoe UI Emoji", sans-serif`}
        fontStyle={c.peso}
        fontSize={c.tamanho}
        lineHeight={c.entrelinha}
        align={c.alinhamento}
        fill={c.cor}
        stroke={c.contornoLargura > 0 ? c.contornoCor : undefined}
        strokeWidth={c.contornoLargura * 2}
        fillAfterStrokeEnabled
        lineJoin="round"
        padding={pad}
        shadowEnabled={c.sombra}
        shadowColor="#000000"
        shadowBlur={c.tamanho * 0.12}
        shadowOffset={{ x: 0, y: c.tamanho * 0.05 }}
        shadowOpacity={0.65}
      />
    </Label>
  );
}

function Conteudo({ c, design, versaoFontes }: { c: Camada; design: Design; versaoFontes: number }) {
  switch (c.tipo) {
    case "imagem":
      return <ImagemCamada c={c} />;
    case "texto":
      return <TextoCamada c={c} versaoFontes={versaoFontes} />;
    case "fundo":
      return (
        <Rect
          width={design.largura}
          height={design.altura}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: design.largura, y: design.altura }}
          fillLinearGradientColorStops={[0, c.cor1, 1, c.cor2]}
        />
      );
    case "forma":
      if (c.forma === "retangulo")
        return (
          <Rect width={c.largura} height={c.altura} stroke={c.espessura ? c.cor : undefined} strokeWidth={c.espessura}
            fill={c.preenchimento ?? undefined} cornerRadius={Math.min(c.largura, c.altura) * 0.04} />
        );
      if (c.forma === "circulo")
        return (
          <Ellipse x={c.largura / 2} y={c.altura / 2} radiusX={c.largura / 2} radiusY={c.altura / 2} stroke={c.cor}
            strokeWidth={c.espessura} fill={c.preenchimento ?? undefined} />
        );
      return (
        <Arrow points={[0, c.altura / 2, c.largura, c.altura / 2]} stroke={c.cor} fill={c.cor}
          strokeWidth={c.espessura} pointerLength={c.espessura * 2.6} pointerWidth={c.espessura * 2.6}
          lineCap="round" hitStrokeWidth={Math.max(30, c.espessura * 3)} />
      );
  }
}

// ---------------------------------------------------------------- palco

interface Props {
  design: Design;
  escala: number;
  selecionada: string | null;
  versaoFontes: number;
  onSelecionar: (id: string | null) => void;
  onAlterar: (id: string, patch: Partial<Camada>) => void;
  stageRef: React.RefObject<Konva.Stage>;
}

export default function Palco({ design, escala, selecionada, versaoFontes, onSelecionar, onAlterar, stageRef }: Props) {
  const trRef = useRef<Konva.Transformer>(null);
  const atual = design.camadas.find((c) => c.id === selecionada);

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const no = selecionada && atual && !atual.travada && atual.tipo !== "fundo" ? stage.findOne(`#${selecionada}`) : null;
    tr.nodes(no ? [no] : []);
    tr.getLayer()?.batchDraw();
  }, [selecionada, atual, design, stageRef]);

  function fimTransformacao(c: Camada, no: Konva.Node) {
    const sx = no.scaleX();
    const sy = no.scaleY();
    no.scaleX(1);
    no.scaleY(1);
    const patch: Partial<Camada> = { x: no.x(), y: no.y(), rotacao: no.rotation() };
    if (c.tipo === "imagem" || c.tipo === "forma") {
      Object.assign(patch, { largura: Math.max(5, c.largura * sx), altura: Math.max(5, c.altura * sy) });
      if (c.tipo === "imagem") Object.assign(patch, { contornoLargura: c.contornoLargura * Math.sqrt(sx * sy) });
    }
    if (c.tipo === "texto") {
      // cantos mudam o tamanho da letra; laterais só a largura da caixa
      const canto = Math.abs(sy - 1) > 0.001;
      Object.assign(patch, canto
        ? { tamanho: Math.max(6, c.tamanho * sy), largura: Math.max(20, c.largura * sx),
            contornoLargura: c.contornoLargura * sy }
        : { largura: Math.max(20, c.largura * sx) });
    }
    onAlterar(c.id, patch);
  }

  const tipoSel = atual?.tipo;

  return (
    <Stage
      ref={stageRef}
      width={design.largura * escala}
      height={design.altura * escala}
      scaleX={escala}
      scaleY={escala}
      onMouseDown={(e) => e.target === e.target.getStage() && onSelecionar(null)}
      onTouchStart={(e) => e.target === e.target.getStage() && onSelecionar(null)}
    >
      <Layer>
        <Rect width={design.largura} height={design.altura} fill="#111" listening={false} />
        {design.camadas.map((c) => (
          <Group
            key={c.id}
            id={c.id}
            x={c.x}
            y={c.y}
            rotation={c.rotacao}
            opacity={c.opacidade}
            visible={c.visivel}
            draggable={!c.travada && c.tipo !== "fundo"}
            listening={c.tipo !== "fundo" || !c.travada}
            onMouseDown={() => onSelecionar(c.id)}
            onTap={() => onSelecionar(c.id)}
            onDragEnd={(e) => onAlterar(c.id, { x: e.target.x(), y: e.target.y() })}
            onTransformEnd={(e) => fimTransformacao(c, e.target)}
          >
            <Conteudo c={c} design={design} versaoFontes={versaoFontes} />
          </Group>
        ))}
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={tipoSel === "imagem"}
          enabledAnchors={
            tipoSel === "texto"
              ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
              : undefined
          }
          borderStroke="#7c4dff"
          anchorStroke="#7c4dff"
          anchorSize={10}
          ignoreStroke
          boundBoxFunc={(antes, depois) => (depois.width < 10 || depois.height < 10 ? antes : depois)}
        />
      </Layer>
    </Stage>
  );
}
