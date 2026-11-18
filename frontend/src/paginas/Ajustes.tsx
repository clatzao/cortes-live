import { Captions, Cpu, Palette } from "lucide-react";
import { Hardware } from "../api";
import Configuracoes from "./Configuracoes";
import Legendas from "./Legendas";
import MarcaPagina from "./MarcaPagina";

export type AbaAjustes = "legendas" | "marca" | "sistema";

const ABAS: { id: AbaAjustes; nome: string; dica: string; Icone: typeof Captions }[] = [
  { id: "legendas", nome: "Legendas", dica: "Estilos das legendas, emojis e palavras-chave", Icone: Captions },
  { id: "marca", nome: "Marca do canal", dica: "Logo, gancho, intro/outro, música e formatos padrão", Icone: Palette },
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
      {aba === "legendas" && <Legendas />}
      {aba === "marca" && <MarcaPagina />}
      {aba === "sistema" && <Configuracoes hw={hw} onHw={onHw} />}
    </div>
  );
}
