import { useState } from "react";
import { Instagram, Loader2, Music2, Youtube } from "lucide-react";
import StatusPill from "./StatusPill";
import "./ui.css";

export type Rede = "youtube" | "tiktok" | "instagram";
export type EstadoConta = "desconectada" | "conectando" | "ativa" | "expirada";

export interface DadosConta {
  rede: Rede;
  estado: EstadoConta;
  nome?: string;
  avatar?: string | null;
  so_privado?: boolean;
}

const NOME: Record<Rede, string> = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels" };

function Icone({ rede }: { rede: Rede }) {
  if (rede === "youtube") return <Youtube size={18} aria-hidden="true" />;
  if (rede === "instagram") return <Instagram size={18} aria-hidden="true" />;
  return <Music2 size={18} aria-hidden="true" />;
}

export default function CartaoConta({ conta, aoConectar, aoDesconectar }: {
  conta: DadosConta;
  aoConectar?: () => void;
  aoDesconectar?: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const ligada = conta.estado === "ativa" || conta.estado === "expirada";
  return (
    <div className="cartao-conta">
      {conta.avatar ? <img className="cartao-conta-avatar" src={conta.avatar} alt="" /> : <div className="cartao-conta-avatar"><Icone rede={conta.rede} /></div>}
      <div className="cartao-conta-texto">
        <strong>{ligada && conta.nome ? conta.nome : NOME[conta.rede]}</strong>
        <small>{ligada ? NOME[conta.rede] : "Não conectada"}</small>
        {conta.estado === "ativa" && conta.so_privado && (
          <span className="cartao-conta-aviso">Os vídeos saem como privados até o TikTok aprovar o seu app.</span>
        )}
      </div>
      <div className="acoes-direita">
        {conta.estado === "ativa" && <StatusPill estado={conta.so_privado ? "privado" : "publicado"} texto={conta.so_privado ? undefined : "Conectada"} tamanho="sm" />}
        {conta.estado === "expirada" && <StatusPill estado="expirada" tamanho="sm" />}
        {conta.estado === "desconectada" && (
          <button type="button" className="btn btn-primario" onClick={aoConectar}>Conectar</button>
        )}
        {conta.estado === "conectando" && (
          <button type="button" className="btn" disabled aria-busy="true">
            <Loader2 size={14} aria-hidden="true" /> Termine o login no navegador
          </button>
        )}
        {conta.estado === "expirada" && (
          <button type="button" className="btn btn-primario" onClick={aoConectar}>Entrar de novo</button>
        )}
        {ligada && !confirmar && (
          <button type="button" className="btn" onClick={() => setConfirmar(true)}>Desconectar</button>
        )}
        {ligada && confirmar && (
          <>
            <button type="button" className="btn" onClick={() => setConfirmar(false)}>Manter</button>
            <button type="button" className="btn btn-perigo" autoFocus onClick={() => { setConfirmar(false); aoDesconectar?.(); }}>
              Desconectar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
