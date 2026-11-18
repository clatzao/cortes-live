/** Modelo do design de thumbnail: camadas em coordenadas reais da imagem final. */

export type TamanhoThumb = "youtube" | "vertical" | "quadrado";

export const TAMANHOS: Record<TamanhoThumb, { nome: string; w: number; h: number }> = {
  youtube: { nome: "YouTube 1280×720", w: 1280, h: 720 },
  vertical: { nome: "Vertical 1080×1920", w: 1080, h: 1920 },
  quadrado: { nome: "Quadrada 1080×1080", w: 1080, h: 1080 },
};

interface Base {
  id: string;
  nome: string;
  x: number;
  y: number;
  rotacao: number;
  visivel: boolean;
  travada: boolean;
  opacidade: number;
}

export interface CamadaImagem extends Base {
  tipo: "imagem";
  src: string;
  largura: number;
  altura: number;
  brilho: number; // -1 a 1
  contraste: number; // -100 a 100
  saturacao: number; // -2 a 10 (Konva HSL)
  contornoCor: string | null; // contorno em volta do recorte
  contornoLargura: number;
  /** "quadro" e "pessoa" são trocados pela imagem do corte atual ao aplicar um template salvo */
  papel: "quadro" | "pessoa" | "livre";
}

export interface CamadaTexto extends Base {
  tipo: "texto";
  texto: string;
  largura: number;
  fonte: string;
  peso: string; // "normal", "bold" ou 100..900
  tamanho: number;
  cor: string;
  contornoCor: string;
  contornoLargura: number;
  sombra: boolean;
  alinhamento: "left" | "center" | "right";
  maiusculas: boolean;
  fundo: string | null; // caixa atrás do texto
  entrelinha: number;
}

export interface CamadaForma extends Base {
  tipo: "forma";
  forma: "seta" | "circulo" | "retangulo";
  largura: number;
  altura: number;
  cor: string;
  espessura: number;
  preenchimento: string | null;
}

export interface CamadaFundo extends Base {
  tipo: "fundo";
  cor1: string;
  cor2: string;
}

export type Camada = CamadaImagem | CamadaTexto | CamadaForma | CamadaFundo;

export interface Design {
  largura: number;
  altura: number;
  camadas: Camada[];
}

export interface Ingredientes {
  w: number;
  h: number;
  quadro: { url: string; rosto: number[] | null; largura: number; altura: number } | null;
  pessoa: { url: string; caixa: number[]; largura: number; altura: number } | null;
  texto: string;
  fonte: string;
}

let contador = 0;
export const novoId = () => `c${Date.now().toString(36)}${(contador++).toString(36)}`;

const base = (nome: string): Base => ({
  id: novoId(),
  nome,
  x: 0,
  y: 0,
  rotacao: 0,
  visivel: true,
  travada: false,
  opacidade: 1,
});

/** Imagem cobrindo a área toda (como "object-fit: cover"), centrada no rosto se houver. */
export function quadroCobrindo(ing: Ingredientes, brilho = 0): CamadaImagem | null {
  const q = ing.quadro;
  if (!q) return null;
  const escala = Math.max(ing.w / q.largura, ing.h / q.altura);
  const lw = q.largura * escala;
  const lh = q.altura * escala;
  const cx = q.rosto ? (q.rosto[0] + q.rosto[2] / 2) * lw : lw / 2;
  const cy = q.rosto ? (q.rosto[1] + q.rosto[3] / 2) * lh : lh / 2;
  return {
    ...base("Quadro"),
    tipo: "imagem",
    src: q.url,
    papel: "quadro",
    largura: lw,
    altura: lh,
    x: Math.min(0, Math.max(ing.w - lw, ing.w / 2 - cx)),
    y: Math.min(0, Math.max(ing.h - lh, ing.h / 2 - cy)),
    brilho,
    contraste: 10,
    saturacao: 0.3,
    contornoCor: null,
    contornoLargura: 0,
    travada: false,
  };
}

/** Pessoa recortada com altura `alturaRel` da imagem, centrada em `cx` (fração), apoiada embaixo. */
export function pessoa(ing: Ingredientes, alturaRel: number, cx: number, contorno: string | null): CamadaImagem | null {
  const p = ing.pessoa;
  if (!p) return null;
  const h = ing.h * alturaRel;
  const w = (p.largura / p.altura) * h;
  return {
    ...base("Pessoa"),
    tipo: "imagem",
    src: p.url,
    papel: "pessoa",
    largura: w,
    altura: h,
    x: ing.w * cx - w / 2,
    y: ing.h - h,
    brilho: 0.03,
    contraste: 15,
    saturacao: 0.4,
    contornoCor: contorno,
    contornoLargura: contorno ? Math.round(ing.h * 0.012) : 0,
  };
}

export function texto(ing: Ingredientes, extra: Partial<CamadaTexto>): CamadaTexto {
  return {
    ...base("Texto"),
    tipo: "texto",
    texto: ing.texto || "TEXTO AQUI",
    largura: ing.w * 0.5,
    fonte: ing.fonte,
    peso: "900",
    tamanho: Math.round(Math.min(ing.w, ing.h) * 0.14),
    cor: "#FFE11A",
    contornoCor: "#000000",
    contornoLargura: Math.round(Math.min(ing.w, ing.h) * 0.014),
    sombra: true,
    alinhamento: "center",
    maiusculas: true,
    fundo: null,
    entrelinha: 1.0,
    ...extra,
  };
}

function forma(nome: string, f: CamadaForma["forma"], extra: Partial<CamadaForma>): CamadaForma {
  return {
    ...base(nome),
    tipo: "forma",
    forma: f,
    largura: 200,
    altura: 200,
    cor: "#FF2B2B",
    espessura: 14,
    preenchimento: null,
    ...extra,
  };
}

const semNulos = (l: (Camada | null)[]) => l.filter((c): c is Camada => c !== null);

export interface Template {
  id: string;
  nome: string;
  montar?: (ing: Ingredientes) => Camada[];
  /** templates salvos pelo usuário guardam o design com frações (independente do tamanho) */
  salvo?: Design;
}

export const TEMPLATES: Template[] = [
  {
    id: "reacao",
    nome: "Reação + texto grande",
    montar: (ing) => {
      const vertical = ing.h > ing.w;
      const lado = ing.pessoa ? (vertical ? 0.5 : 0.28) : 0.5;
      return semNulos([
        quadroCobrindo(ing, ing.pessoa ? -0.12 : 0),
        pessoa(ing, vertical ? 0.62 : 0.98, lado, "#FFFFFF"),
        texto(ing, vertical
          ? { x: ing.w * 0.06, y: ing.h * 0.08, largura: ing.w * 0.88 }
          : { x: ing.w * (ing.pessoa ? 0.5 : 0.08), y: ing.h * 0.18, largura: ing.w * (ing.pessoa ? 0.46 : 0.84) }),
      ]);
    },
  },
  {
    id: "faixa",
    nome: "Faixa no rodapé",
    montar: (ing) => {
      const alt = ing.h * 0.24;
      return semNulos([
        quadroCobrindo(ing),
        forma("Faixa", "retangulo", { x: 0, y: ing.h - alt, largura: ing.w, altura: alt, cor: "#FFE11A",
          espessura: 0, preenchimento: "#FFE11A" }),
        texto(ing, { x: ing.w * 0.04, y: ing.h - alt + alt * 0.12, largura: ing.w * 0.92, cor: "#111111",
          contornoLargura: 0, sombra: false, tamanho: Math.round(alt * 0.6) }),
      ]);
    },
  },
  {
    id: "colorido",
    nome: "Fundo colorido + pessoa",
    montar: (ing) => {
      const vertical = ing.h > ing.w;
      return semNulos([
        { ...base("Fundo"), tipo: "fundo", cor1: "#7C4DFF", cor2: "#FF4FD8" },
        ing.pessoa ? pessoa(ing, vertical ? 0.66 : 0.95, vertical ? 0.5 : 0.3, "#FFFFFF") : quadroCobrindo(ing),
        texto(ing, vertical
          ? { x: ing.w * 0.06, y: ing.h * 0.07, largura: ing.w * 0.88, cor: "#FFFFFF" }
          : { x: ing.w * 0.52, y: ing.h * 0.2, largura: ing.w * 0.44, cor: "#FFFFFF" }),
      ]);
    },
  },
  {
    id: "seta",
    nome: "Seta + círculo",
    montar: (ing) => {
      const r = ing.quadro?.rosto;
      const lado = Math.min(ing.w, ing.h) * 0.34;
      // destaca o rosto (ou o centro) com um círculo
      const q = quadroCobrindo(ing);
      let cx = ing.w * 0.62;
      let cy = ing.h * 0.5;
      if (r && q) {
        cx = q.x + (r[0] + r[2] / 2) * q.largura;
        cy = q.y + (r[1] + r[3] / 2) * q.altura;
      }
      return semNulos([
        q,
        forma("Círculo", "circulo", { x: cx - lado / 2, y: cy - lado / 2, largura: lado, altura: lado,
          espessura: Math.round(lado * 0.06) }),
        forma("Seta", "seta", { x: cx - lado * 1.6, y: cy + lado * 0.9, largura: lado * 1.05, altura: lado * 0.2,
          rotacao: -35, espessura: Math.round(lado * 0.07) }),
        texto(ing, { x: ing.w * 0.04, y: ing.h * 0.05, largura: ing.w * 0.6, cor: "#FFFFFF",
          alinhamento: "left", tamanho: Math.round(Math.min(ing.w, ing.h) * 0.12) }),
      ]);
    },
  },
];

/** Converte um design para frações (para salvar como template reutilizável em qualquer tamanho). */
export function paraTemplate(d: Design): Design {
  const fx = 1 / d.largura;
  const fy = 1 / d.altura;
  const fm = 1 / Math.min(d.largura, d.altura);
  return {
    largura: 1,
    altura: 1,
    camadas: d.camadas.map((c) => {
      const n = { ...c, x: c.x * fx, y: c.y * fy } as Camada;
      if (n.tipo === "imagem" || n.tipo === "forma") {
        n.largura *= fx;
        n.altura *= fy;
      }
      if (n.tipo === "texto") {
        n.largura *= fx;
        n.tamanho *= fm;
        n.contornoLargura *= fm;
      }
      if (n.tipo === "forma") n.espessura *= fm;
      if (n.tipo === "imagem") n.contornoLargura *= fm;
      return n;
    }),
  };
}

export function deTemplate(t: Design, ing: Ingredientes): Camada[] {
  const fm = Math.min(ing.w, ing.h);
  return t.camadas.flatMap((c): Camada[] => {
    const n = { ...c, id: novoId(), x: c.x * ing.w, y: c.y * ing.h } as Camada;
    if (n.tipo === "imagem") {
      n.largura *= ing.w;
      n.altura *= ing.h;
      n.contornoLargura *= fm;
      if (n.papel === "quadro") {
        const q = quadroCobrindo(ing, n.brilho);
        return q ? [{ ...q, id: n.id, contraste: n.contraste, saturacao: n.saturacao }] : [];
      }
      if (n.papel === "pessoa") {
        if (!ing.pessoa) return [];
        n.src = ing.pessoa.url;
        n.largura = (ing.pessoa.largura / ing.pessoa.altura) * n.altura; // mantém a proporção do novo recorte
      }
    }
    if (n.tipo === "texto") {
      n.largura *= ing.w;
      n.tamanho *= fm;
      n.contornoLargura *= fm;
      if (ing.texto) n.texto = ing.texto;
    }
    if (n.tipo === "forma") {
      n.largura *= ing.w;
      n.altura *= ing.h;
      n.espessura *= fm;
    }
    return [n];
  });
}

export function novoTexto(ing: { w: number; h: number; fonte: string }, conteudo = "TEXTO"): CamadaTexto {
  return texto({ ...ing, quadro: null, pessoa: null, texto: conteudo }, {
    x: ing.w * 0.25,
    y: ing.h * 0.4,
    largura: ing.w * 0.5,
  });
}

export function novaForma(f: CamadaForma["forma"], w: number, h: number): CamadaForma {
  const lado = Math.min(w, h) * 0.3;
  const nomes = { seta: "Seta", circulo: "Círculo", retangulo: "Retângulo" };
  return forma(nomes[f], f, {
    x: w / 2 - lado / 2,
    y: h / 2 - (f === "seta" ? lado * 0.1 : lado / 2),
    largura: lado,
    altura: f === "seta" ? lado * 0.2 : lado,
    espessura: Math.round(lado * 0.06),
  });
}

export function novaImagem(src: string, iw: number, ih: number, w: number, h: number): CamadaImagem {
  const escala = Math.min((w * 0.4) / iw, (h * 0.4) / ih);
  return {
    ...base("Imagem"),
    tipo: "imagem",
    src,
    papel: "livre",
    largura: iw * escala,
    altura: ih * escala,
    x: w / 2 - (iw * escala) / 2,
    y: h / 2 - (ih * escala) / 2,
    brilho: 0,
    contraste: 0,
    saturacao: 0,
    contornoCor: null,
    contornoLargura: 0,
  };
}

/** Pesos que aparecem nas fontes variáveis. */
export const PESOS: Record<string, string> = {
  Thin: "100",
  ExtraLight: "200",
  Light: "300",
  Regular: "400",
  Medium: "500",
  SemiBold: "600",
  Bold: "700",
  ExtraBold: "800",
  Black: "900",
};
