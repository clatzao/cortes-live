import { memo, useEffect, useMemo, useRef, useState } from "react";
import { api, Segmento, Transcricao } from "../api";
import { formatar } from "../tempo";

interface Props {
  projetoId: number;
  duracao: number;
  tempo: number;
  /** status do job de transcrição mais recente (para recarregar enquanto transcreve) */
  statusJob: string | null;
  progresso: number;
  mensagem: string | null;
  onSeek: (t: number) => void;
  onCriarCorte: (inicio: number, fim: number, nome: string) => void;
  onTranscrever: () => void;
}

/** Índices na lista global de palavras (a busca atravessa os limites entre frases). */
interface Acerto {
  g1: number;
  g2: number;
  inicio: number;
  fim: number;
}

interface PalavraGlobal {
  inicio: number;
  fim: number;
  texto: string;
}

const CONTEXTO = 10; // palavras mostradas antes e depois do resultado

/** minúsculas, sem acentos e sem pontuação: "Não!" → "nao" */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lerNumero(chave: string, padrao: number): number {
  try {
    const v = Number(localStorage.getItem(chave));
    return isFinite(v) && v >= 0 && localStorage.getItem(chave) !== null ? v : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave: string, valor: number) {
  try {
    localStorage.setItem(chave, String(valor));
  } catch {
    /* armazenamento indisponível */
  }
}

export default function PainelTranscricao(p: Props) {
  const [dados, setDados] = useState<Transcricao | null>(null);
  const [carregou, setCarregou] = useState(false);
  const [busca, setBusca] = useState("");
  const [antes, setAntes] = useState(() => lerNumero("margem_antes", 10));
  const [depois, setDepois] = useState(() => lerNumero("margem_depois", 20));
  const [selecao, setSelecao] = useState<{ inicio: number; fim: number; texto: string } | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const ultimoScrollUsuario = useRef(0);

  const ativo = p.statusJob === "na_fila" || p.statusJob === "executando";

  // Carrega a transcrição; enquanto transcreve, recarrega a cada 5 s para mostrar o texto parcial.
  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      api
        .transcricao(p.projetoId)
        .then((t) => vivo && setDados(t))
        .catch(() => {})
        .finally(() => vivo && setCarregou(true));
    carregar();
    if (!ativo) return () => void (vivo = false);
    const t = setInterval(carregar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [p.projetoId, ativo, p.statusJob]);

  const segmentos = dados?.segmentos ?? [];

  // Índice de busca: todas as palavras da live num texto contínuo normalizado
  const indice = useMemo(() => {
    const palavras: PalavraGlobal[] = [];
    const inicios: number[] = [];
    let texto = "";
    for (const s of segmentos) {
      const lista: [number, number, string][] = s.palavras.length
        ? s.palavras.map((w) => [w[0], w[1], w[2]])
        : [[s.inicio, s.fim, s.texto]];
      for (const [ini, fim, txt] of lista) {
        const n = normalizar(txt);
        if (!n) continue;
        if (texto) texto += " ";
        inicios.push(texto.length);
        texto += n;
        palavras.push({ inicio: ini, fim, texto: txt });
      }
    }
    return { texto, inicios, palavras };
  }, [segmentos]);

  const acertos = useMemo<Acerto[]>(() => {
    const q = normalizar(busca);
    if (q.length < 2) return [];
    const { texto, inicios, palavras } = indice;
    // palavra que contém o caractere c (busca binária)
    const palavraEm = (c: number) => {
      let lo = 0;
      let hi = inicios.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (inicios[m] <= c) lo = m;
        else hi = m - 1;
      }
      return lo;
    };
    const res: Acerto[] = [];
    let pos = texto.indexOf(q);
    while (pos !== -1 && res.length < 300) {
      const g1 = palavraEm(pos);
      const g2 = palavraEm(pos + q.length - 1);
      res.push({ g1, g2, inicio: palavras[g1].inicio, fim: palavras[g2].fim });
      pos = texto.indexOf(q, pos + q.length);
    }
    return res;
  }, [busca, indice]);

  // Segmento atual (busca binária)
  const atual = useMemo(() => {
    let lo = 0;
    let hi = segmentos.length - 1;
    let r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (segmentos[m].inicio <= p.tempo) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r;
  }, [segmentos, p.tempo]);

  // Rola o texto junto com o vídeo, a menos que o usuário tenha rolado há pouco
  useEffect(() => {
    if (atual < 0 || !lista.current || Date.now() - ultimoScrollUsuario.current < 4000) return;
    const el = lista.current.querySelector<HTMLElement>(`[data-i="${atual}"]`);
    if (!el) return;
    const caixa = lista.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < caixa.top || r.bottom > caixa.bottom) {
      lista.current.scrollTop += r.top - caixa.top - caixa.height / 3;
    }
  }, [atual]);

  // Seleção de texto → corte
  function lerSelecao() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !lista.current) return setSelecao(null);
    const pegar = (n: Node | null) =>
      (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-w]") ?? null;
    const a = pegar(sel.anchorNode);
    const b = pegar(sel.focusNode);
    if (!a || !b || !lista.current.contains(a) || !lista.current.contains(b)) return setSelecao(null);
    const ler = (el: HTMLElement) => el.dataset.w!.split(":").map(Number) as [number, number];
    let [s1, w1] = ler(a);
    let [s2, w2] = ler(b);
    if (s2 < s1 || (s2 === s1 && w2 < w1)) [s1, w1, s2, w2] = [s2, w2, s1, w1];
    const inicio = segmentos[s1].palavras[w1][0];
    const fim = segmentos[s2].palavras[w2][1];
    setSelecao({ inicio, fim, texto: sel.toString().replace(/\s+/g, " ").trim() });
  }

  function criarDaSelecao() {
    if (!selecao) return;
    p.onCriarCorte(selecao.inicio, selecao.fim, selecao.texto.slice(0, 60));
    window.getSelection()?.removeAllRanges();
    setSelecao(null);
  }

  function corteDoAcerto(a: Acerto) {
    const inicio = Math.max(0, a.inicio - antes);
    const fim = Math.min(p.duracao, a.fim + depois);
    p.onCriarCorte(inicio, fim, busca.trim().slice(0, 60));
  }

  if (!carregou) return <p className="sutil painel-pad">Carregando…</p>;

  return (
    <div className="transcricao">
      <div className="transcricao-topo">
        {ativo && (
          <div className="transcricao-status">
            <div className="progresso-barra">
              <div className="progresso-cheio" style={{ width: `${Math.round(p.progresso * 100)}%` }} />
            </div>
            <span className="sutil">{p.mensagem ?? "Na fila para transcrever"}</span>
          </div>
        )}
        {p.statusJob === "erro" && (
          <div className="erro-texto">
            A transcrição falhou: {p.mensagem}
            <div>
              <button className="btn btn-peq" onClick={p.onTranscrever}>
                Tentar de novo
              </button>
            </div>
          </div>
        )}
        {!dados && !ativo && p.statusJob !== "erro" && (
          <div className="sutil">
            Sem transcrição.{" "}
            <button className="btn btn-peq" onClick={p.onTranscrever}>
              Transcrever agora
            </button>
          </div>
        )}
        {dados && (
          <>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar frase ou palavra…"
              aria-label="Buscar na transcrição"
            />
            <div className="margens">
              <label>
                Antes
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={antes}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0);
                    setAntes(v);
                    gravar("margem_antes", v);
                  }}
                />
                s
              </label>
              <label>
                Depois
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={depois}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0);
                    setDepois(v);
                    gravar("margem_depois", v);
                  }}
                />
                s
              </label>
              <span className="sutil">
                {dados.modelo} · {dados.dispositivo === "cuda" ? "GPU" : "CPU"}
                {dados.parcial ? " · parcial" : ""}
              </span>
            </div>
          </>
        )}
      </div>

      {busca.trim().length >= 2 && dados && (
        <div className="acertos">
          <div className="sutil">
            {acertos.length === 0 ? "Nada encontrado." : `${acertos.length}${acertos.length >= 300 ? "+" : ""} resultado(s)`}
          </div>
          {acertos.map((a, k) => (
            <div key={k} className="acerto">
              <button className="acerto-tempo" onClick={() => p.onSeek(a.inicio)} title="Ir para este ponto">
                {formatar(a.inicio, false)}
              </button>
              <span className="acerto-texto">
                {a.g1 > CONTEXTO && "… "}
                {indice.palavras.slice(Math.max(0, a.g1 - CONTEXTO), a.g2 + CONTEXTO + 1).map((w, i) => {
                  const g = Math.max(0, a.g1 - CONTEXTO) + i;
                  return <span key={g}>{g >= a.g1 && g <= a.g2 ? <mark>{w.texto}</mark> : w.texto} </span>;
                })}
                {a.g2 + CONTEXTO + 1 < indice.palavras.length && "…"}
              </span>
              <button className="btn btn-peq btn-primario" onClick={() => corteDoAcerto(a)}>
                Criar corte aqui
              </button>
            </div>
          ))}
        </div>
      )}

      {selecao && (
        <div className="barra-selecao">
          <span>
            {formatar(selecao.inicio)} → {formatar(selecao.fim)}
          </span>
          <button className="btn btn-peq btn-primario" onMouseDown={(e) => e.preventDefault()} onClick={criarDaSelecao}>
            Criar corte da seleção
          </button>
        </div>
      )}

      <div
        className="texto-transcricao"
        ref={lista}
        onMouseUp={lerSelecao}
        onKeyUp={lerSelecao}
        onWheel={() => (ultimoScrollUsuario.current = Date.now())}
        onTouchMove={() => (ultimoScrollUsuario.current = Date.now())}
      >
        {dados && segmentos.length === 0 && <p className="sutil">Nenhuma fala reconhecida até agora.</p>}
        {segmentos.map((s, i) => (
          <LinhaSegmento key={i} indice={i} seg={s} atual={i === atual} onSeek={p.onSeek} />
        ))}
        {dados?.parcial && <p className="sutil">Transcrevendo… o texto aparece aos poucos.</p>}
      </div>
      {dados && <p className="sutil dica-transcricao">Clique numa frase para ir até ela. Selecione um trecho do texto para criar um corte.</p>}
    </div>
  );
}

const LinhaSegmento = memo(function LinhaSegmento({
  indice,
  seg,
  atual,
  onSeek,
}: {
  indice: number;
  seg: Segmento;
  atual: boolean;
  onSeek: (t: number) => void;
}) {
  return (
    <p
      className={`segmento ${atual ? "segmento-atual" : ""}`}
      data-i={indice}
      onClick={() => {
        if (!window.getSelection()?.isCollapsed) return; // está selecionando texto
        onSeek(seg.inicio);
      }}
    >
      <span className="segmento-tempo">{formatar(seg.inicio, false)}</span>
      {seg.palavras.length
        ? seg.palavras.map((w, j) => (
            <span key={j} data-w={`${indice}:${j}`}>
              {w[2]}{" "}
            </span>
          ))
        : seg.texto}
    </p>
  );
});
