import "./ui.css";

export type Estado =
  | "ao_vivo" | "gravando" | "aguardando" | "reconectando" | "finalizando" | "encerrada"
  | "agendado" | "enviando" | "publicado" | "falhou" | "privado" | "expirada";

const TEXTO: Record<Estado, string> = {
  ao_vivo: "Ao vivo",
  gravando: "Gravando",
  aguardando: "Esperando a live",
  reconectando: "Reconectando",
  finalizando: "Finalizando",
  encerrada: "Encerrada",
  agendado: "Agendado",
  enviando: "Enviando",
  publicado: "Publicado",
  falhou: "Falhou",
  privado: "Só privado",
  expirada: "Login expirado",
};

const COM_PONTO = new Set<Estado>(["ao_vivo", "gravando", "reconectando", "enviando"]);

export default function StatusPill({ estado, tamanho = "md", texto, anunciar = false }: {
  estado: Estado;
  tamanho?: "sm" | "md";
  texto?: string;
  /** true quando o estado muda sozinho e deve ser lido pelo leitor de tela */
  anunciar?: boolean;
}) {
  return (
    <span className={`pill pill-${estado}${tamanho === "sm" ? " pill-sm" : ""}`} role={anunciar ? "status" : undefined}>
      {COM_PONTO.has(estado) && <span className="pill-ponto" aria-hidden="true" />}
      {texto ?? TEXTO[estado]}
    </span>
  );
}
