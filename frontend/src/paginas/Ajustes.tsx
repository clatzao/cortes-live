import { Captions, Cpu, Palette, SlidersHorizontal } from "lucide-react";
import { Hardware } from "../api";
import Configuracoes from "./Configuracoes";
import Legendas from "./Legendas";
import MarcaPagina from "./MarcaPagina";
import Predefinicao from "./Predefinicao";

export type AbaAjustes = "padrao" | "legendas" | "marca" | "sistema";

const ABAS: { id: AbaAjustes; nome: string; dica: string; Icone: typeof Captions }[] = [
  { id: "padrao", nome: "Padrão dos cortes", dica: "Como todo corte novo nasce: legenda, formatos, extras e momentos",
    Icone: SlidersHorizontal },
  { id: "legendas", nome: "Legendas", dica: "Estilos das legendas, emojis e palavras-chave", Icone: Captions },
  { id: "marca", nome: "Marca do canal", dica: "Logo, gancho, intro/outro e música", Icone: Palette },
  { id: "sistema", nome: "IA e hardware", dica: "Placa de vídeo, transcrição e Gemini", Icone: Cpu },
];

/** Todas as configurações num lugar só, separadas em abas. */
export default function Ajustes({ aba, hw, onHw }: { aba: AbaAjustes; hw: Hardware | null; onHw: (h: Hardware) => void }) {
  return (
    <div className="ajustes">
      <div className="abas-ajustes" role="tablist">
        {ABAS.map(({ id, nome, dica, Icone }) => (
          <a key={id} href={`#/ajustes/${id}`} role="tab" aria-selected={aba === id}
            className={aba === id ? "ativo" : ""} title={dica}>
            <Icone size={16} />
            {nome}
          </a>
        ))}
      </div>
      {aba === "padrao" && <Predefinicao />}
      {aba === "legendas" && <Legendas />}
      {aba === "marca" && <MarcaPagina />}
      {aba === "sistema" && <Configuracoes hw={hw} onHw={onHw} />}
    </div>
  );
}
