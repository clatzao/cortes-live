import { useEffect, useState } from "react";
import { Cpu, ListChecks, Moon, Sun } from "lucide-react";
import { api, Hardware, Job } from "./api";
import Inicio from "./paginas/Inicio";
import Editor from "./paginas/Editor";
import Fila from "./paginas/Fila";
import Ajustes, { AbaAjustes } from "./paginas/Ajustes";
import Lives from "./paginas/Lives";
import Biblioteca from "./paginas/Biblioteca";
import Posts from "./paginas/Posts";
import LivePagina from "./paginas/LivePagina";
import { lazy, Suspense } from "react";

// Amostra das peças de interface: só no modo dev (não entra no programa instalado).
const Design = import.meta.env.DEV ? lazy(() => import("./paginas/Design")) : null;

type Rota =
  | { pagina: "inicio" }
  | { pagina: "projeto"; id: number }
  | { pagina: "fila" }
  | { pagina: "ajustes"; aba: AbaAjustes }
  | { pagina: "lives" }
  | { pagina: "biblioteca" }
  | { pagina: "posts" }
  | { pagina: "live"; id: number }
  | { pagina: "design" };

function lerRota(): Rota {
  const h = window.location.hash.replace(/^#\/?/, "");
  const m = h.match(/^projeto\/(\d+)/);
  if (m) return { pagina: "projeto", id: Number(m[1]) };
  const ml = h.match(/^live\/(\d+)/);
  if (ml) return { pagina: "live", id: Number(ml[1]) };
  if (h.startsWith("lives")) return { pagina: "lives" };
  if (h.startsWith("biblioteca")) return { pagina: "biblioteca" };
  if (h.startsWith("posts")) return { pagina: "posts" };
  if (h.startsWith("fila")) return { pagina: "fila" };
  if (import.meta.env.DEV && h.startsWith("design")) return { pagina: "design" };
  // endereços antigos continuam funcionando
  if (h.startsWith("ajustes/padrao")) return { pagina: "ajustes", aba: "padrao" };
  if (h.startsWith("legendas") || h.startsWith("ajustes/legendas")) return { pagina: "ajustes", aba: "legendas" };
  if (h.startsWith("marca") || h.startsWith("ajustes/marca")) return { pagina: "ajustes", aba: "marca" };
  if (h.startsWith("ajustes/midias")) return { pagina: "ajustes", aba: "midias" };
  if (h.startsWith("ajustes/contas")) return { pagina: "ajustes", aba: "contas" };
  if (h.startsWith("config") || h.startsWith("ajustes")) return { pagina: "ajustes", aba: "sistema" };
  return { pagina: "inicio" };
}

function temaAtual(): "light" | "dark" {
  const d = document.documentElement.dataset.theme;
  if (d === "light" || d === "dark") return d;
  return "dark";
}

interface Aviso {
  id: number;
  texto: string;
  tipo: "ok" | "erro";
}

export default function App() {
  const [rota, setRota] = useState<Rota>(lerRota);
  const [fila, setFila] = useState<Job[]>([]);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [tema, setTema] = useState(temaAtual);
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  useEffect(() => {
    const f = () => setRota(lerRota());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  // Fila atualizada a cada 1,5 s (servidor local, custo baixo).
  useEffect(() => {
    let vivo = true;
    let anterior = "";
    // só atualiza se algo mudou: cada atualização re-renderiza a página aberta (ex.: o editor)
    const tick = () =>
      api
        .fila()
        .then((f) => {
          const atual = JSON.stringify(f);
          if (vivo && atual !== anterior) {
            anterior = atual;
            setFila(f);
          }
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  // Hardware: repete até a detecção terminar.
  useEffect(() => {
    let vivo = true;
    let t: number | undefined;
    const tick = () =>
      api
        .hardware()
        .then((h) => {
          if (!vivo) return;
          if (h.detectando) t = window.setTimeout(tick, 1500);
          else setHw(h);
        })
        .catch(() => (t = window.setTimeout(tick, 3000)));
    tick();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent).detail as Omit<Aviso, "id">;
      const id = Date.now() + Math.random();
      setAvisos((a) => [...a, { ...d, id }]);
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), d.tipo === "erro" ? 7000 : 3500);
    };
    window.addEventListener("aviso", f);
    return () => window.removeEventListener("aviso", f);
  }, []);

  function trocarTema() {
    const novo = tema === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try {
      localStorage.setItem("tema", novo === "light" ? "claro" : "escuro");
    } catch {
      /* armazenamento indisponível */
    }
    setTema(novo);
  }

  const ativos = fila.filter((j) => j.status === "na_fila" || j.status === "executando").length;

  return (
    <div className="app">
      <header className="topo">
        <a className="marca" href="#/">
          <span className="marca-ponto" /> Cortes Live
        </a>
        <nav>
          <a href="#/" className={rota.pagina === "inicio" || rota.pagina === "projeto" ? "ativo" : ""}>
            Projetos
          </a>
          <a href="#/lives" className={rota.pagina === "lives" || rota.pagina === "live" ? "ativo" : ""}>
            Lives
          </a>
          <a href="#/biblioteca" className={rota.pagina === "biblioteca" ? "ativo" : ""}>
            Biblioteca
          </a>
          <a href="#/posts" className={rota.pagina === "posts" ? "ativo" : ""}>
            Posts
          </a>
          <a href="#/ajustes/padrao" className={rota.pagina === "ajustes" ? "ativo" : ""}>
            Ajustes
          </a>
        </nav>
        <div className="topo-dir">
          <a className="chip" href="#/ajustes/sistema" title="Hardware detectado (clique para ver detalhes)">
            <Cpu size={13} />
            {hw ? `${hw.whisper.dispositivo === "cuda" ? "GPU" : "CPU"} · ${hw.encoder_nome}` : "Detectando…"}
          </a>
          <a
            className={`btn-icone botao-fila ${rota.pagina === "fila" ? "ativo" : ""}`}
            href="#/fila"
            title={ativos ? `Fila: ${ativos} tarefa(s) em andamento` : "Fila de processamento"}
            aria-label="Fila de processamento"
          >
            <ListChecks size={18} />
            {ativos > 0 && <span className="badge badge-flutuante">{ativos}</span>}
          </a>
          <button className="btn-icone" onClick={trocarTema} title="Trocar tema claro/escuro" aria-label="Trocar tema">
            {tema === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="conteudo">
        {rota.pagina === "inicio" && <Inicio />}
        {rota.pagina === "projeto" && <Editor key={rota.id} id={rota.id} fila={fila} />}
        {rota.pagina === "fila" && <Fila fila={fila} />}
        {rota.pagina === "lives" && <Lives />}
        {rota.pagina === "biblioteca" && <Biblioteca />}
        {rota.pagina === "posts" && <Posts />}
        {rota.pagina === "live" && <LivePagina key={rota.id} id={rota.id} />}
        {rota.pagina === "ajustes" && <Ajustes aba={rota.aba} hw={hw} onHw={setHw} />}
        {rota.pagina === "design" && Design && (
          <Suspense fallback={null}>
            <Design />
          </Suspense>
        )}
      </main>

      <div className="avisos" role="status">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </div>
  );
}
