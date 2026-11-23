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
  origem: "arquivo" | "link" | "live";
  entrada: string;
  caminho_original: string | null;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  fps: number | null;
  status: "na_fila" | "processando" | "gravando" | "pronto" | "erro";
  live_id: number | null;
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
  export_resolucao: string;
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
  download_qualidade: string;
  youtube_cliente_id: string;
  youtube_cliente_segredo_tem: boolean;
  tiktok_cliente_chave: string;
  tiktok_cliente_segredo_tem: boolean;
  instagram_app_id: string;
  instagram_app_segredo_tem: boolean;
  iniciar_com_windows: boolean;
  iniciar_com_windows_disponivel: boolean;
  opcoes: { whisper_modelo: string[]; whisper_dispositivo: string[]; download_qualidade: string[]; export_resolucao: string[] };
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
  enquadramento: "fixo" | "auto";
  trilha_foco: string | null;
  gancho_midia_id: number | null;
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

export interface Miniaturas {
  intervalo: number;
  n: number;
  colunas: number;
  largura: number;
  altura: number;
  versao: number;
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

export type StatusLive = "aguardando" | "gravando" | "reconectando" | "finalizando" | "encerrada" | "erro" | "cancelada";

export interface Live {
  id: number;
  plataforma: "twitch" | "kick" | "youtube";
  canal: string;
  url: string;
  titulo: string | null;
  status: StatusLive;
  erro: string | null;
  projeto_id: number | null;
  janela_s: number;
  analisado_ate: number;
  gravado_s: number;
  cortes_criados: number;
  parar: number;
  ultima_analise: string | null;
  iniciada_em: number | null;
  encerrada_em: number | null;
  criado_em: number;
  partes: number;
  job_gravacao: JobResumo | null;
  job_analise: JobResumo | null;
  job_final: JobResumo | null;
  projeto_status: Projeto["status"] | null;
}

export interface CorteLive {
  id: number;
  nome: string;
  inicio: number;
  fim: number;
  gancho: string | null;
  criado_em: number;
  nota: number | null;
  motivo: string | null;
  fonte: "gemini" | "sinais" | null;
  exportavel: boolean;
}

export interface IdiomaOpcao {
  codigo: string;
  nome: string;
}

export interface SegmentoTraducao {
  inicio: number;
  fim: number;
  texto: string;
}

export interface Voz {
  codigo: string;
  idioma: string;
  regiao: string;
  nome: string;
  qualidade: string;
  tamanho_mb: number;
  baixada: boolean;
}

export interface EstadoIdiomas {
  traducoes: { idioma: string; segmentos: SegmentoTraducao[]; editada: number; atualizado_em: number }[];
  dublagens: { idioma: string; voz: string; audio_original: string; existe: boolean }[];
  job_traducao: (JobResumo & { saida: string | null }) | null;
  job_dublagem: (JobResumo & { saida: string | null }) | null;
}

export type TipoMidia = "gancho" | "broll";

export interface Midia {
  id: number;
  tipo: TipoMidia;
  nome: string;
  caminho: string;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  tem_audio: number;
  tags: string[];
  existe: boolean;
}

export interface BrollItem {
  midia_id: number;
  inicio_s: number;
  fim_s: number;
  modo: "tela_cheia" | "metade";
  origem: "manual" | "auto";
  nome?: string;
  palavra?: string;
}

export interface ItemBiblioteca {
  id: number;
  corte_id: number | null;
  projeto_id: number | null;
  projeto_nome: string;
  corte_nome: string;
  formato: string;
  formato_nome: string;
  resolucao: string;
  idioma: string | null;
  caminho: string;
  duracao_s: number;
  tamanho_bytes: number;
  criado_em: number;
  existe: boolean;
}

export type NomeRede = "youtube" | "tiktok" | "instagram";
export type Privacidade = "publico" | "nao_listado" | "privado";

export interface InfoRede {
  nome: NomeRede;
  titulo: string;
  retorno: string;
  retorno_automatico: boolean;
  privacidades: Privacidade[];
  configurada: boolean;
  campo_id: string;
  campo_segredo: string;
  app_id: string;
}

export interface ContaSocial {
  id: number;
  rede: NomeRede;
  rede_titulo: string;
  nome: string;
  avatar_url: string | null;
  status: "ativa" | "expirada" | "revogada";
  so_privado: number;
  agendados: number;
}

export interface MetricasPost {
  coletado_em: number;
  views: number | null;
  likes: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
  salvos: number | null;
  alcance: number | null;
}

export interface Post {
  id: number;
  conta_id: number;
  rede: NomeRede;
  conta_nome: string;
  conta_status: string;
  so_privado: number;
  exportacao_id: number | null;
  arquivo: string;
  corte_nome: string | null;
  projeto_nome: string | null;
  titulo: string;
  descricao: string;
  privacidade: Privacidade;
  agendado_para: number;
  status: "agendado" | "enviando" | "publicado" | "falhou" | "cancelado";
  tentativas: number;
  proxima_tentativa: number | null;
  url: string | null;
  erro: string | null;
  publicado_em: number | null;
  envio_progresso: number | null;
  envio_mensagem: string | null;
  metricas: MetricasPost | null;
}

export interface LiveDetalhe extends Live {
  disco_livre_gb: number;
  cortes: CorteLive[];
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
    enquadramento?: "fixo" | "auto";
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
  /** null enquanto o servidor ainda gera a tira de quadros */
  miniaturas: async (id: number): Promise<Miniaturas | null> => {
    const r = await fetch(`/api/projetos/${id}/miniaturas`);
    if (r.status === 202) return null;
    if (!r.ok) throw new Error("Falha ao carregar as miniaturas");
    return r.json();
  },
  urlMiniaturas: (id: number, versao: number) => `/api/projetos/${id}/miniaturas.jpg?v=${versao}`,
  editarProjeto: (id: number, dados: { nome?: string; idioma?: Idioma; formatos?: string[]; layout?: Layout }) =>
    req<Projeto>(`/api/projetos/${id}`, "PATCH", dados),
  transcrever: (id: number) => req<Projeto>(`/api/projetos/${id}/transcrever`, "POST"),
  transcricao: (id: number) => req<Transcricao>(`/api/projetos/${id}/transcricao`),
  ajustes: () => req<Ajustes>("/api/ajustes"),
  salvarAjustes: (dados: Partial<Omit<Ajustes, "opcoes" | "gemini_tem_chave" | "gemini_chave_final">> & {
    gemini_chave?: string;
    youtube_cliente_segredo?: string;
    tiktok_cliente_segredo?: string;
    instagram_app_segredo?: string;
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
    dados: Partial<Pick<Corte, "inicio" | "fim" | "nome" | "estilo" | "crop_x" | "enquadramento" | "gancho_midia_id">> & {
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
  enquadrarCorte: (id: number) => req<Corte>(`/api/cortes/${id}/enquadrar`, "POST"),
  salvarTrilha: (id: number, pontos: [number, number][]) => req<Corte>(`/api/cortes/${id}/trilha`, "PUT", pontos),
  apagarCorte: (id: number) => req<{ ok: boolean }>(`/api/cortes/${id}`, "DELETE"),
  exportarCorte: (id: number, formatos?: string[], idioma?: string) =>
    req<Job[]>(`/api/cortes/${id}/exportar`, "POST", { ...(formatos ? { formatos } : {}), ...(idioma ? { idioma } : {}) }),
  idiomas: () => req<IdiomaOpcao[]>("/api/idiomas"),
  vozes: (idioma: string) => req<Voz[]>(`/api/vozes?idioma=${idioma}`),
  idiomasDoCorte: (id: number) => req<EstadoIdiomas>(`/api/cortes/${id}/idiomas`),
  traduzirCorte: (id: number, idioma: string) => req<Job>(`/api/cortes/${id}/traducoes`, "POST", { idioma }),
  salvarTraducao: (id: number, idioma: string, segmentos: SegmentoTraducao[]) =>
    req<unknown>(`/api/cortes/${id}/traducoes/${idioma}`, "PUT", segmentos),
  dublarCorte: (id: number, dados: { idioma: string; voz: string; audio_original: "abaixar" | "silenciar" }) =>
    req<Job>(`/api/cortes/${id}/dublagens`, "POST", dados),
  urlDublagem: (id: number, idioma: string) => `/api/cortes/${id}/dublagens/${idioma}/audio`,

  fila: () => req<Job[]>("/api/fila"),
  cancelarJob: (id: number) => req<{ ok: boolean }>(`/api/fila/${id}/cancelar`, "POST"),
  limparFila: () => req<{ ok: boolean }>("/api/fila/finalizados", "DELETE"),
  abrirSaida: (id: number) => req<{ ok: boolean }>(`/api/fila/${id}/abrir`, "POST"),
  abrirExportados: () => req<{ ok: boolean }>("/api/abrir-exportados", "POST"),
  abrirLink: (nome: "gemini_chave" | "google_cloud" | "tiktok_dev" | "meta_dev") => req<{ ok: boolean; url: string }>(`/api/abrir-link/${nome}`, "POST"),

  biblioteca: (f: { busca?: string; formato?: string; projeto?: number }) => {
    const q = new URLSearchParams();
    if (f.busca?.trim()) q.set("busca", f.busca.trim());
    if (f.formato) q.set("formato", f.formato);
    if (f.projeto !== undefined) q.set("projeto", String(f.projeto));
    return req<ItemBiblioteca[]>(`/api/biblioteca?${q}`);
  },
  urlVideoBiblioteca: (id: number) => `/api/biblioteca/${id}/video`,
  abrirNaBiblioteca: (id: number) => req<{ ok: boolean }>(`/api/biblioteca/${id}/abrir`, "POST"),
  tirarDaBiblioteca: (id: number) => req<{ ok: boolean }>(`/api/biblioteca/${id}`, "DELETE"),
  midias: (tipo?: TipoMidia) => req<Midia[]>(`/api/midias${tipo ? `?tipo=${tipo}` : ""}`),
  adicionarMidias: (tipo: TipoMidia, caminhos: string[]) =>
    req<{ criadas: Midia[]; erros: string[] }>("/api/midias", "POST", { tipo, caminhos }),
  editarMidia: (id: number, dados: { nome?: string; tags?: string[] }) => req<Midia>(`/api/midias/${id}`, "PATCH", dados),
  removerMidia: (id: number) => req<{ ok: boolean }>(`/api/midias/${id}`, "DELETE"),
  urlQuadroMidia: (id: number) => `/api/midias/${id}/quadro`,
  brolls: (corteId: number) => req<BrollItem[]>(`/api/cortes/${corteId}/brolls`),
  salvarBrolls: (corteId: number, lista: BrollItem[]) =>
    req<BrollItem[]>(`/api/cortes/${corteId}/brolls`, "PUT",
      lista.map(({ midia_id, inicio_s, fim_s, modo, origem }) => ({ midia_id, inicio_s, fim_s, modo, origem }))),
  sugerirBrolls: (corteId: number) => req<BrollItem[]>(`/api/cortes/${corteId}/brolls/sugerir`, "POST"),
  lives: () => req<Live[]>("/api/lives"),
  live: (id: number) => req<LiveDetalhe>(`/api/lives/${id}`),
  criarLive: (entrada: string, idioma: Idioma) => req<Live>("/api/lives", "POST", { entrada, idioma }),
  pararLive: (id: number) => req<Live>(`/api/lives/${id}/parar`, "POST"),
  removerLive: (id: number) => req<{ ok: boolean }>(`/api/lives/${id}`, "DELETE"),

  redes: () => req<InfoRede[]>("/api/redes"),
  conectarRede: (rede: NomeRede) => req<{ state: string; url_login: string; retorno: string }>(`/api/redes/${rede}/conectar`, "POST"),
  estadoLogin: (state: string) =>
    req<{ status: "aguardando" | "ok" | "erro" | "expirado"; msg: string; conta_id: number | null }>(`/api/redes/login/${state}`),
  colarRetorno: (endereco: string) => req<{ ok: boolean }>("/api/redes/login/colar", "POST", { endereco }),
  contas: () => req<ContaSocial[]>("/api/contas"),
  desconectarConta: (id: number) => req<{ ok: boolean }>(`/api/contas/${id}`, "DELETE"),
  posts: () => req<Post[]>("/api/posts"),
  criarPosts: (dados: { exportacao_id: number; conta_ids: number[]; titulo: string; descricao: string;
    privacidade: Privacidade; agendado_para: number | null }) => req<Post[]>("/api/posts", "POST", dados),
  mudarPost: (id: number, dados: { titulo?: string; descricao?: string; privacidade?: Privacidade; agendado_para?: number }) =>
    req<Post>(`/api/posts/${id}`, "PATCH", dados),
  cancelarPost: (id: number) => req<Post>(`/api/posts/${id}/cancelar`, "POST"),
  tentarPost: (id: number) => req<Post>(`/api/posts/${id}/tentar`, "POST"),
  removerPost: (id: number) => req<{ ok: boolean }>(`/api/posts/${id}`, "DELETE"),
  abrirPost: (id: number) => req<{ ok: boolean; url: string }>(`/api/posts/${id}/abrir`, "POST"),
  atualizarMetricas: () => req<{ job_id: number | null }>("/api/posts/metricas", "POST"),
};

/** Trilha do enquadramento automático, se ainda vale para o trecho atual do corte. */
export function trilhaDoCorte(c: Corte): [number, number][] | null {
  if (!c.trilha_foco) return null;
  try {
    const d = JSON.parse(c.trilha_foco) as { inicio: number; fim: number; pontos: [number, number][] };
    if (Math.abs(d.inicio - c.inicio) > 0.05 || Math.abs(d.fim - c.fim) > 0.05) return null;
    return d.pontos?.length ? d.pontos : null;
  } catch {
    return null;
  }
}

/** Centro do recorte no instante t (relativo ao corte), interpolando a trilha. */
export function focoEm(pontos: [number, number][], t: number): number {
  if (t <= pontos[0][0]) return pontos[0][1];
  for (let i = 1; i < pontos.length; i++) {
    const [t0, x0] = pontos[i - 1];
    const [t1, x1] = pontos[i];
    if (t <= t1) return t1 > t0 ? x0 + ((x1 - x0) * (t - t0)) / (t1 - t0) : x1;
  }
  return pontos[pontos.length - 1][1];
}

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
