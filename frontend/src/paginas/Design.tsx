import { useState } from "react";
import { Crosshair, Lock, Move } from "lucide-react";
import StatusPill, { Estado } from "../componentes/ui/StatusPill";
import SeletorSegmentado from "../componentes/ui/SeletorSegmentado";
import Medidor from "../componentes/ui/Medidor";
import CartaoLive, { DadosLive } from "../componentes/ui/CartaoLive";
import ItemFeed, { Feed } from "../componentes/ui/ItemFeed";
import CampoDataHora from "../componentes/ui/CampoDataHora";
import CartaoConta from "../componentes/ui/CartaoConta";

/** Amostra das peças novas, com dados de exemplo. Só existe no modo dev (#/design). */
const ESTADOS: Estado[] = ["ao_vivo", "gravando", "aguardando", "reconectando", "finalizando", "encerrada",
  "agendado", "enviando", "publicado", "falhou", "privado", "expirada"];

const LIVES: DadosLive[] = [
  { plataforma: "twitch", canal: "canal_exemplo", status: "gravando", gravado_s: 5025, cortes: 14, disco_livre_gb: 84 },
  { plataforma: "kick", canal: "outro_canal", status: "aguardando", gravado_s: 0, cortes: 0 },
  { plataforma: "youtube", canal: "Canal de Teste", status: "reconectando", gravado_s: 2210, cortes: 5, disco_livre_gb: 7 },
  { plataforma: "twitch", canal: "canal_com_erro", status: "erro", gravado_s: 0, cortes: 0, erro: "O canal não existe ou o link está errado." },
];

export default function Design() {
  const [enq, setEnq] = useState<"fixo" | "auto">("auto");
  const [priv, setPriv] = useState<"publico" | "nao_listado" | "privado">("publico");
  const [quando, setQuando] = useState<number | null>(null);
  const [lives, setLives] = useState(LIVES);

  return (
    <div className="design-pagina">
      <h1>Peças da rodada 3</h1>
      <p className="sutil">Amostra isolada (replica/design/components.md). Troque o tema no topo para ver os dois.</p>

      <section className="design-secao">
        <h2>StatusPill</h2>
        <div className="design-linha">{ESTADOS.map((e) => <StatusPill key={e} estado={e} />)}</div>
        <div className="design-linha">{ESTADOS.slice(0, 6).map((e) => <StatusPill key={e} estado={e} tamanho="sm" />)}</div>
      </section>

      <section className="design-secao">
        <h2>SeletorSegmentado</h2>
        <div className="design-linha">
          <SeletorSegmentado rotulo="Enquadramento" valor={enq} aoMudar={setEnq}
            opcoes={[{ valor: "fixo", rotulo: "Fixo", icone: <Lock size={14} /> }, { valor: "auto", rotulo: "Segue quem fala", icone: <Crosshair size={14} /> }]} />
          <SeletorSegmentado rotulo="Privacidade" tamanho="sm" valor={priv} aoMudar={setPriv}
            opcoes={[{ valor: "publico", rotulo: "Público" }, { valor: "nao_listado", rotulo: "Não listado" }, { valor: "privado", rotulo: "Privado" }]} />
          <SeletorSegmentado rotulo="Desabilitado" valor="a" aoMudar={() => {}} desabilitado
            opcoes={[{ valor: "a", rotulo: "Opção A", icone: <Move size={14} /> }, { valor: "b", rotulo: "Opção B" }]} />
        </div>
      </section>

      <section className="design-secao">
        <h2>Medidor</h2>
        <div className="design-grade">
          <Medidor rotulo="Disco livre" valor={84} max={100} texto="84 GB" aviso={10} critico={2} />
          <Medidor rotulo="Disco livre" valor={7} max={100} texto="7 GB" aviso={10} critico={2} />
          <Medidor rotulo="Disco livre" valor={1.5} max={100} texto="1,5 GB" aviso={10} critico={2} />
          <Medidor rotulo="Envios no YouTube hoje" valor={5} max={6} texto="5 de 6" aviso={4} critico={6} crescente />
        </div>
      </section>

      <section className="design-secao">
        <h2>CartaoLive</h2>
        <CartaoLive live={lives[0]} aoParar={() => setLives((l) => l.map((x, i) => (i === 0 ? { ...x, status: "finalizando" } : x)))} />
        <div className="design-grade">
          {lives.slice(1).map((l) => <CartaoLive key={l.canal} live={l} compacto aoParar={() => {}} aoTentar={() => {}} />)}
        </div>
      </section>

      <section className="design-secao">
        <h2>ItemFeed</h2>
        <Feed rotulo="Cortes desta live">
          <ItemFeed novo item={{ id: 1, nome: "A reação depois do gol no último minuto", posicao_s: 4980, nota: 91, motivo: "Grito alto + risadas + o chat dizendo 'clipa'", estado: "pronto" }} />
          <ItemFeed item={{ id: 2, nome: "Explicação da build nova", posicao_s: 3302, nota: 64, estado: "criando", progresso: 0.42 }} />
          <ItemFeed item={{ id: 3, nome: "Trecho sem áudio", posicao_s: 1210, nota: 55, estado: "erro", erro: "A gravação deste trecho falhou." }} />
        </Feed>
      </section>

      <section className="design-secao">
        <h2>CampoDataHora</h2>
        <CampoDataHora valor={quando} aoMudar={setQuando} />
        <CampoDataHora valor={Date.now() - 3_600_000} aoMudar={() => {}} />
      </section>

      <section className="design-secao">
        <h2>CartaoConta</h2>
        <div className="design-grade">
          <CartaoConta conta={{ rede: "youtube", estado: "ativa", nome: "Meu canal" }} />
          <CartaoConta conta={{ rede: "tiktok", estado: "ativa", nome: "@meu_perfil", so_privado: true }} />
          <CartaoConta conta={{ rede: "instagram", estado: "expirada", nome: "@meu_perfil" }} />
          <CartaoConta conta={{ rede: "instagram", estado: "desconectada" }} />
          <CartaoConta conta={{ rede: "tiktok", estado: "conectando" }} />
        </div>
      </section>
    </div>
  );
}
