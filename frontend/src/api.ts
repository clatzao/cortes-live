export type StatusJob = "na_fila" | "executando" | "concluido" | "erro" | "cancelado";

export interface JobResumo {
  id: number;
  status: StatusJob;
  progresso: number;
  mensagem: string | null;
}

export interface Projeto {
  id: number;
  nome: string;
  origem: "arquivo" | "link";
  entrada: string;
  caminho_original: string | null;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  fps: number | null;
  status: "na_fila" | "processando" | "pronto" | "erro";
  erro: string | null;
  criado_em: number;
  idioma: Idioma;
  job: JobResumo | null;
  job_transcricao: JobResumo | null;
  tem_transcricao: boolean;
  formatos_efetivos: string[];
  layout_efetivo: Layout;
  job_analise: JobResumo | null;
  n_cortes: number;
  n_sugestoes: number;
}

export type Idioma = "pt" | "en" | "misto";

/** [início, fim, palavra, confiança] */
export type Palavra = [number, number, string, number];

export interface Segmento {
  inicio: number;
  fim: number;
  texto: string;
  palavras: Palavra[];
}

export interface Transcricao {
  parcial: boolean;
  idioma: Idioma;
  modelo: string;
  dispositivo: "cuda" | "cpu";
  compute_type: string;
  duracao: number;
  segmentos: Segmento[];
}

export interface Ajustes {
  whisper_modelo: string;
  whisper_dispositivo: string;
  gemini_modelo: string;
  gemini_tem_chave: boolean;
  gemini_chave_final: string;
  viral_min: number;
  viral_max: number;
  viral_qtd: number;
  viral_auto: boolean;
  estilo_padrao: string;
  legenda_padrao: boolean;
  auto_cortes: boolean;
  opcoes: { whisper_modelo: string[]; whisper_dispositivo: string[] };
}

export interface Sugestao {
  id: number;
  projeto_id: number;
  inicio: number;
  fim: number;
  nota: number;
  energia: number;
  motivo: string | null;
  nome: string | null;
  gancho: string | null;
  origem: "gemini" | "sinais";
  status: "nova" | "aceita" | "descartada";
  corte_id: number | null;
}

export interface Corte {
  id: number;
  projeto_id: number;
  nome: string;
  inicio: number;
  fim: number;
  criado_em: number;
  estilo: string;
  com_legenda: number;
  legenda: string | null;
  formatos: string | null;
  crop_x: number;
  gancho: string | null;
  recursos: string | null;
  formatos_efetivos: string[];
  recursos_efetivos: Recursos;
}

export interface Recursos {
  logo: boolean;
  intro: boolean;
  outro: boolean;
  musica: boolean;
}

export interface Formato {
  id: string;
  nome: string;
  w: number | null;
  h: number | null;
}

/** Retângulos em frações do quadro: [x, y, largura, altura] */
export interface Layout {
  cam: [number, number, number, number];
  jogo: [number, number, number, number];
  proporcao: number;
}

export interface Marca {
  logo: { arquivo: string | null; posicao: string; tamanho: number; opacidade: number; padrao: boolean };
  gancho: {
    fonte: string;
    variacao: string | null;
    tamanho: number;
    cor_texto: string;
    cor_caixa: string;
    posicao_y: number;
    duracao: number;
    maiusculas: boolean;
  };
  intro: { arquivo: string | null; padrao: boolean };
  outro: { arquivo: string | null; padrao: boolean };
  musica: { arquivo: string | null; volume: number; abaixar_na_fala: boolean; padrao: boolean };
  formatos_padrao: string[];
  layout_padrao: Layout;
  posicoes?: string[];
}

export interface Estilo {
  id: string;
  nome: string;
  fonte: string;
  variacao: string | null;
  tamanho: number;
  maiusculas: boolean;
  sem_pontuacao: boolean;
  palavras_por_vez: number;
  cor_texto: string;
  cor_destaque: string;
  cor_palavra_chave: string;
  contorno: number;
  cor_contorno: string;
  sombra: boolean;
  cor_sombra: string;
  brilho: boolean;
  cor_brilho: string;
  caixa: boolean;
  cor_caixa: string;
  escala_destaque: number;
  animacao: boolean;
  posicao_y: number;
  largura_max: number;
  emojis: boolean;
  palavras_chave: boolean;
  de_fabrica?: boolean;
}

export interface Fonte {
  id: string;
  nome: string;
  variacoes: string[];
}

/** [início, fim, texto] em tempo absoluto da live */
export type PalavraLegenda = [number, number, string];

export interface Job extends JobResumo {
  tipo: "importar" | "exportar" | "transcrever" | "analisar";
  projeto_id: number | null;
  corte_id: number | null;
  saida: string | null;
  params: string;
  criado_em: number;
  atualizado_em: number;
  projeto_nome: string | null;
  corte_nome: string | null;
}

export interface Ondas {
  taxa: number;
  picos: number[];
  rms: number[];
}

export interface Hardware {
  detectando?: boolean;
  ffmpeg: string | null;
  placas: string[];
  nvidia: { nome: string; vram_gb: number; driver: string; compute_cap: number | null }[];
  ram_gb: number;
  cpus: number;
  encoder: string;
  encoder_nome: string;
  encoders_disponiveis: string[];
  whisper: {
    dispositivo: "cuda" | "cpu";
    modelo: string;
    compute_type: string;
    alternativas_compute: string[];
    gpu: string | null;
    motivo: string;
  };
}

async function req<T>(url: string, metodo = "GET", corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) {
    let msg = `Erro ${r.status}`;
    try {
      const d = await r.json();
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = d.detail.map((x: { msg: string }) => x.msg).join("; ");
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  hardware: () => req<Hardware>("/api/hardware"),
  detectarHardware: () => req<Hardware>("/api/hardware/detectar", "POST"),
  procurar: (tipo: "video" | "imagem" | "audio" = "video") =>
    req<{ caminho: string | null }>(`/api/procurar?tipo=${tipo}`, "POST"),
  formatos: () => req<Formato[]>("/api/formatos"),
  marca: () => req<Marca>("/api/marca"),
  salvarMarca: (m: Marca) => req<Marca>("/api/marca", "PUT", m),
  urlQuadro: (projetoId: number, t: number, largura = 960) =>
    `/api/projetos/${projetoId}/quadro?t=${t.toFixed(2)}&largura=${largura}`,
  /** Prévia de um quadro do vídeo final num formato; devolve URL de blob. */
  previaFormato: async (dados: {
    corte_id: number;
    formato: string;
    t: number;
    crop_x?: number;
    layout?: Layout;
    gancho?: string;
    recursos?: Recursos;
  }): Promise<string> => {
    const r = await fetch("/api/previa-formato", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!r.ok) {
      let msg = `Erro ${r.status}`;
      try {
        msg = (await r.json()).detail ?? msg;
      } catch {
        /* sem JSON */
      }
      throw new Error(msg);
    }
    return URL.createObjectURL(await r.blob());
  },

  projetos: () => req<Projeto[]>("/api/projetos"),
  projeto: (id: number) => req<Projeto>(`/api/projetos/${id}`),
  criarProjeto: (entrada: string, auto_cortes = false) => req<Projeto>("/api/projetos", "POST", { entrada, auto_cortes }),
  exportarProjeto: (id: number) => req<{ cortes: number; arquivos: number }>(`/api/projetos/${id}/exportar`, "POST"),
  reprocessar: (id: number) => req<Projeto>(`/api/projetos/${id}/reprocessar`, "POST"),
  apagarProjeto: (id: number) => req<{ ok: boolean }>(`/api/projetos/${id}`, "DELETE"),
  ondas: (id: number) => req<Ondas>(`/api/projetos/${id}/ondas`),
  editarProjeto: (id: number, dados: { nome?: string; idioma?: Idioma; formatos?: string[]; layout?: Layout }) =>
    req<Projeto>(`/api/projetos/${id}`, "PATCH", dados),
  transcrever: (id: number) => req<Projeto>(`/api/projetos/${id}/transcrever`, "POST"),
  transcricao: (id: number) => req<Transcricao>(`/api/projetos/${id}/transcricao`),
  ajustes: () => req<Ajustes>("/api/ajustes"),
  salvarAjustes: (dados: Partial<Omit<Ajustes, "opcoes" | "gemini_tem_chave" | "gemini_chave_final">> & {
    gemini_chave?: string;
  }) => req<Ajustes>("/api/ajustes", "PUT", dados),
  testarGemini: () => req<{ ok: boolean; modelo_escolhido: string; modelos: string[] }>("/api/ajustes/testar-gemini", "POST"),
  analisar: (projetoId: number, dados: { min?: number; max?: number; qtd?: number }) =>
    req<Job>(`/api/projetos/${projetoId}/analisar`, "POST", dados),
  sugestoes: (projetoId: number) => req<Sugestao[]>(`/api/projetos/${projetoId}/sugestoes`),
  aceitarSugestao: (id: number) => req<Corte>(`/api/sugestoes/${id}/aceitar`, "POST"),
  aceitarSugestoes: (projetoId: number, ids: number[]) =>
    req<Corte[]>(`/api/projetos/${projetoId}/sugestoes/aceitar`, "POST", { ids }),
  descartarSugestao: (id: number) => req<{ ok: boolean }>(`/api/sugestoes/${id}/descartar`, "POST"),
  urlProxy: (id: number) => `/api/projetos/${id}/proxy`,

  cortes: (projetoId: number) => req<Corte[]>(`/api/projetos/${projetoId}/cortes`),
  criarCorte: (projetoId: number, inicio: number, fim: number, nome?: string) =>
    req<Corte>(`/api/projetos/${projetoId}/cortes`, "POST", { inicio, fim, nome }),
  criarEmLote: (projetoId: number, texto: string) =>
    req<{ criados: Corte[]; invalidas: string[] }>(`/api/projetos/${projetoId}/cortes/lote`, "POST", { texto }),
  editarCorte: (
    id: number,
    dados: Partial<Pick<Corte, "inicio" | "fim" | "nome" | "estilo" | "crop_x">> & {
      com_legenda?: boolean;
      formatos?: string[] | null;
      recursos?: Recursos | null;
      gancho?: string | null;
    },
  ) => req<Corte>(`/api/cortes/${id}`, "PATCH", dados),
  legenda: (id: number) => req<{ palavras: PalavraLegenda[] | null; editada: boolean }>(`/api/cortes/${id}/legenda`),
  salvarLegenda: (id: number, palavras: PalavraLegenda[]) =>
    req<{ palavras: PalavraLegenda[] | null; editada: boolean }>(`/api/cortes/${id}/legenda`, "PUT", { palavras }),
  restaurarLegenda: (id: number) =>
    req<{ palavras: PalavraLegenda[] | null; editada: boolean }>(`/api/cortes/${id}/legenda`, "DELETE"),
  urlPreviaCorte: (id: number, t: number, estilo?: string) =>
    `/api/cortes/${id}/previa?t=${t.toFixed(2)}${estilo ? `&estilo=${encodeURIComponent(estilo)}` : ""}`,

  estilos: () => req<Estilo[]>("/api/legendas/estilos"),
  salvarEstilo: (e: Estilo) => req<Estilo>(`/api/legendas/estilos/${encodeURIComponent(e.id)}`, "PUT", e),
  apagarEstilo: (id: string) => req<{ ok: boolean }>(`/api/legendas/estilos/${encodeURIComponent(id)}`, "DELETE"),
  fontes: () => req<Fonte[]>("/api/legendas/fontes"),
  dicionarios: () => req<{ emojis: Record<string, string>; palavras_chave: string[] }>("/api/legendas/dicionarios"),
  salvarDicionarios: (dados: { emojis?: Record<string, string>; palavras_chave?: string[] }) =>
    req<{ emojis: Record<string, string>; palavras_chave: string[] }>("/api/legendas/dicionarios", "PUT", dados),
  /** Prévia de um estilo (ainda não salvo); devolve URL de blob da imagem. */
  previaEstilo: async (estilo: Estilo, vertical: boolean, projetoId?: number): Promise<string> => {
    const r = await fetch("/api/legendas/previa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estilo, vertical, projeto_id: projetoId ?? null }),
    });
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    return URL.createObjectURL(await r.blob());
  },
  apagarCorte: (id: number) => req<{ ok: boolean }>(`/api/cortes/${id}`, "DELETE"),
  exportarCorte: (id: number, formatos?: string[]) =>
    req<Job[]>(`/api/cortes/${id}/exportar`, "POST", formatos ? { formatos } : {}),

  fila: () => req<Job[]>("/api/fila"),
  cancelarJob: (id: number) => req<{ ok: boolean }>(`/api/fila/${id}/cancelar`, "POST"),
  limparFila: () => req<{ ok: boolean }>("/api/fila/finalizados", "DELETE"),
  abrirSaida: (id: number) => req<{ ok: boolean }>(`/api/fila/${id}/abrir`, "POST"),
  abrirExportados: () => req<{ ok: boolean }>("/api/abrir-exportados", "POST"),
};

/** Mostra uma mensagem rápida no canto da tela. */
export function avisar(texto: string, tipo: "ok" | "erro" = "ok") {
  window.dispatchEvent(new CustomEvent("aviso", { detail: { texto, tipo } }));
}

/** Formato de um job de exportação (guardado nos parâmetros). */
export function formatoDoJob(j: Job): string | null {
  try {
    return JSON.parse(j.params || "{}").formato ?? null;
  } catch {
    return null;
  }
}

export const NOME_CURTO_FORMATO: Record<string, string> = {
  vertical_crop: "9:16",
  vertical_split: "9:16 cam+jogo",
  vertical_blur: "9:16 desfocado",
  horizontal: "16:9",
  quadrado: "1:1",
  original: "Original",
};

export function erroTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
