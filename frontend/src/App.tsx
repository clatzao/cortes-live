import { useEffect, useState } from "react";
import { api, Hardware, Job } from "./api";
import Inicio from "./paginas/Inicio";
import Editor from "./paginas/Editor";
import Fila from "./paginas/Fila";
import Configuracoes from "./paginas/Configuracoes";
import Legendas from "./paginas/Legendas";
import MarcaPagina from "./paginas/MarcaPagina";

type Rota =
  | { pagina: "inicio" }
  | { pagina: "projeto"; id: number }
  | { pagina: "fila" }
  | { pagina: "config" }
  | { pagina: "legendas" }
  | { pagina: "marca" };

function lerRota(): Rota {
  const h = window.location.hash.replace(/^#\/?/, "");
  const m = h.match(/^projeto\/(\d+)/);
  if (m) return { pagina: "projeto", id: Number(m[1]) };
  if (h.startsWith("fila")) return { pagina: "fila" };
  if (h.startsWith("config")) return { pagina: "config" };
  if (h.startsWith("legendas")) return { pagina: "legendas" };
  if (h.startsWith("marca")) return { pagina: "marca" };
  return { pagina: "inicio" };
}

function temaAtual(): "light" | "dark" {
  const d = document.documentElement.dataset.theme;
  if (d === "light" || d === "dark") return d;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
    const tick = () => api.fila().then((f) => vivo && setFila(f)).catch(() => {});
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
          <a href="#/legendas" className={rota.pagina === "legendas" ? "ativo" : ""}>
            Legendas
          </a>
          <a href="#/marca" className={rota.pagina === "marca" ? "ativo" : ""}>
            Marca
          </a>
          <a href="#/fila" className={rota.pagina === "fila" ? "ativo" : ""}>
            Fila {ativos > 0 && <span className="badge">{ativos}</span>}
          </a>
          <a href="#/config" className={rota.pagina === "config" ? "ativo" : ""}>
            Configurações
          </a>
        </nav>
        <div className="topo-dir">
          <a className="chip" href="#/config" title="Hardware detectado">
            {hw ? `${hw.whisper.dispositivo === "cuda" ? "GPU" : "CPU"} · ${hw.encoder_nome}` : "Detectando hardware…"}
          </a>
          <button className="btn-icone" onClick={trocarTema} title="Trocar tema claro/escuro" aria-label="Trocar tema">
            {tema === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <main className="conteudo">
        {rota.pagina === "inicio" && <Inicio />}
        {rota.pagina === "projeto" && <Editor key={rota.id} id={rota.id} fila={fila} />}
        {rota.pagina === "fila" && <Fila fila={fila} />}
        {rota.pagina === "config" && <Configuracoes hw={hw} onHw={setHw} />}
        {rota.pagina === "legendas" && <Legendas />}
        {rota.pagina === "marca" && <MarcaPagina />}
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
