import Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, avisar, Corte, erroTexto, Fonte } from "../api";
import { formatar } from "../tempo";
import {
  Camada,
  deTemplate,
  Design,
  Ingredientes,
  novaForma,
  novaImagem,
  novoId,
  novoTexto,
  paraTemplate,
  PESOS,
  pessoa as camadaPessoa,
  quadroCobrindo,
  TamanhoThumb,
  TAMANHOS,
  Template,
  TEMPLATES,
} from "./modelo";
import Palco, { carregarImagem } from "./Palco";

interface Candidato {
  t: number;
  arquivo: string;
  url: string;
  nota: number;
  rosto: number[] | null;
}

interface Pessoa {
  url: string;
  caixa: number[];
  largura: number;
  altura: number;
}

interface Props {
  corte: Corte;
  onFechar: () => void;
}

const EMOJIS = ["😱", "🔥", "😂", "💀", "🤯", "👀", "💰", "🏆", "❤️", "⚠️", "✅", "❌", "😡", "😭", "🎮", "👉"];
const MAX_HISTORICO = 60;

let fontesRegistradas: Promise<void> | null = null;

/** Registra no navegador as fontes da pasta fontes/ (as mesmas das legendas). */
function registrarFontes(fontes: Fonte[]): Promise<void> {
  if (!fontesRegistradas) {
    fontesRegistradas = Promise.all(
      fontes
        .filter((f) => !f.id.startsWith("sistema:"))
        .map(async (f) => {
          const ff = new FontFace(f.nome, `url(/fontes/${encodeURIComponent(f.id)})`,
            f.variacoes.length ? { weight: "100 900" } : {});
          try {
            document.fonts.add(await ff.load());
          } catch {
            /* fonte com problema: o navegador usa outra */
          }
        }),
    ).then(() => undefined);
  }
  return fontesRegistradas;
}

export default function EditorThumb({ corte, onFechar }: Props) {
  const [tamanho, setTamanho] = useState<TamanhoThumb>("youtube");
  const [designs, setDesigns] = useState<Partial<Record<TamanhoThumb, Design>>>({});
  const [historico, setHistorico] = useState<Partial<Record<TamanhoThumb, Design[]>>>({});
  const [sujo, setSujo] = useState<Partial<Record<TamanhoThumb, boolean>>>({});
  const [exportadas, setExportadas] = useState<Partial<Record<TamanhoThumb, boolean>>>({});
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [quadro, setQuadro] = useState<Candidato | null>(null);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [recortando, setRecortando] = useState(false);
  const [modeloBaixado, setModeloBaixado] = useState(true);
  const [textos, setTextos] = useState<string[]>([]);
  const [buscandoTextos, setBuscandoTextos] = useState(false);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [versaoFontes, setVersaoFontes] = useState(0);
  const [salvos, setSalvos] = useState<Template[]>([]);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [larguraArea, setLarguraArea] = useState(700);
  const [salvando, setSalvando] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const carregados = useRef<Set<TamanhoThumb>>(new Set());

  const dims = TAMANHOS[tamanho];
  const design = designs[tamanho] ?? null;
  const fontePadrao = fontes.find((f) => f.id.startsWith("Montserrat"))?.nome ?? "Impact";

  // ---------------------------------------------------------------- carregamento inicial

  useEffect(() => {
    api.fontes().then((f) => {
      setFontes(f);
      registrarFontes(f).then(() => setVersaoFontes((v) => v + 1));
    });
    fetch("/api/thumb/templates").then((r) => r.json()).then((l) => setSalvos(Array.isArray(l) ? l : [])).catch(() => {});
    fetch("/api/thumb/modelo-recorte").then((r) => r.json()).then((r) => setModeloBaixado(!!r.baixado)).catch(() => {});
    buscarCandidatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLarguraArea(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // design salvo de cada tamanho (carrega uma vez)
  useEffect(() => {
    if (carregados.current.has(tamanho)) return;
    carregados.current.add(tamanho);
    fetch(`/api/cortes/${corte.id}/thumb/design/${tamanho}`)
      .then((r) => r.json())
      .then((r) => {
        setExportadas((e) => ({ ...e, [tamanho]: !!r.exportada }));
        if (r.design) setDesigns((d) => ({ ...d, [tamanho]: r.design }));
      })
      .catch(() => {});
  }, [tamanho, corte.id]);

  async function buscarCandidatos() {
    setBuscando(true);
    try {
      const r = await fetch(`/api/cortes/${corte.id}/thumb/candidatos`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).detail ?? `Erro ${r.status}`);
      const lista: Candidato[] = await r.json();
      setCandidatos(lista);
      if (!quadro && lista.length) setQuadro([...lista].sort((a, b) => b.nota - a.nota)[0]);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setBuscando(false);
    }
  }

  // ---------------------------------------------------------------- ingredientes e templates

  const ingredientes = useCallback(
    async (textoAtual?: string): Promise<Ingredientes> => {
      let q: Ingredientes["quadro"] = null;
      if (quadro) {
        const img = await carregarImagem(quadro.url);
        q = { url: quadro.url, rosto: quadro.rosto, largura: img.naturalWidth, altura: img.naturalHeight };
      }
      return {
        w: dims.w,
        h: dims.h,
        quadro: q,
        pessoa,
        texto: textoAtual ?? textos[0] ?? corte.gancho ?? corte.nome.toUpperCase(),
        fonte: fontePadrao,
      };
    },
    [quadro, pessoa, dims, textos, corte, fontePadrao],
  );

  const textoPrincipal = () => design?.camadas.find((c) => c.tipo === "texto" && !/\p{Extended_Pictographic}/u.test(c.texto));

  async function aplicarTemplate(t: Template) {
    if (design && design.camadas.length && !confirm(`Trocar o design atual pelo template "${t.nome}"?`)) return;
    const atual = textoPrincipal();
    const ing = await ingredientes(atual?.tipo === "texto" ? atual.texto : undefined);
    const camadas = t.montar ? t.montar(ing) : t.salvo ? deTemplate(t.salvo, ing) : [];
    trocarDesign({ largura: dims.w, altura: dims.h, camadas });
    setSelecionada(null);
  }

  // Primeiro design automático: melhor quadro + template "Reação"
  useEffect(() => {
    if (design || !quadro || !carregados.current.has(tamanho) || versaoFontes === 0) return;
    const id = setTimeout(async () => {
      if (designs[tamanho]) return;
      const ing = await ingredientes();
      trocarDesign({ largura: dims.w, altura: dims.h, camadas: TEMPLATES[0].montar!(ing) }, false);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadro, tamanho, design, versaoFontes]);

  // ---------------------------------------------------------------- edição

  function trocarDesign(novo: Design, marcarSujo = true) {
    setHistorico((h) => {
      const lista = [...(h[tamanho] ?? [])];
      if (design) lista.push(design);
      return { ...h, [tamanho]: lista.slice(-MAX_HISTORICO) };
    });
    setDesigns((d) => ({ ...d, [tamanho]: novo }));
    if (marcarSujo) setSujo((s) => ({ ...s, [tamanho]: true }));
  }

  function alterar(id: string, patch: Partial<Camada>) {
    if (!design) return;
    trocarDesign({ ...design, camadas: design.camadas.map((c) => (c.id === id ? ({ ...c, ...patch } as Camada) : c)) });
  }

  function adicionar(c: Camada) {
    const d = design ?? { largura: dims.w, altura: dims.h, camadas: [] };
    trocarDesign({ ...d, camadas: [...d.camadas, c] });
    setSelecionada(c.id);
  }

  function remover(id: string) {
    if (!design) return;
    trocarDesign({ ...design, camadas: design.camadas.filter((c) => c.id !== id) });
    if (selecionada === id) setSelecionada(null);
  }

  function mover(id: string, delta: number) {
    if (!design) return;
    const l = [...design.camadas];
    const i = l.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    trocarDesign({ ...design, camadas: l });
  }

  function duplicar(id: string) {
    const c = design?.camadas.find((x) => x.id === id);
    if (!c) return;
    adicionar({ ...c, id: novoId(), nome: `${c.nome} (cópia)`, x: c.x + 30, y: c.y + 30 } as Camada);
  }

  function desfazer() {
    const lista = historico[tamanho] ?? [];
    if (!lista.length) return;
    const anterior = lista[lista.length - 1];
    setHistorico((h) => ({ ...h, [tamanho]: lista.slice(0, -1) }));
    setDesigns((d) => ({ ...d, [tamanho]: anterior }));
    setSujo((s) => ({ ...s, [tamanho]: true }));
  }

  // teclado: Delete apaga, Ctrl+Z desfaz, setas movem
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        desfazer();
        return;
      }
      if (!selecionada) return;
      const c = design?.camadas.find((x) => x.id === selecionada);
      if (!c || c.travada) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remover(selecionada);
      }
      const passo = e.shiftKey ? 20 : 2;
      const mov: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
      if (mov[e.key]) {
        e.preventDefault();
        alterar(c.id, { x: c.x + mov[e.key][0], y: c.y + mov[e.key][1] });
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  });

  // ---------------------------------------------------------------- quadro, recorte e textos

  async function escolherQuadro(q: Candidato) {
    setQuadro(q);
    setPessoa(null);
    if (!design) return;
    const img = await carregarImagem(q.url);
    const ing: Ingredientes = { w: dims.w, h: dims.h, quadro: { url: q.url, rosto: q.rosto, largura: img.naturalWidth,
      altura: img.naturalHeight }, pessoa: null, texto: "", fonte: fontePadrao };
    // troca o quadro e tira o recorte antigo (ele era do quadro anterior)
    const camadas = design.camadas.flatMap((c): Camada[] => {
      if (c.tipo === "imagem" && c.papel === "quadro") {
        const novo = quadroCobrindo(ing, c.brilho);
        return novo ? [{ ...novo, id: c.id, contraste: c.contraste, saturacao: c.saturacao }] : [];
      }
      if (c.tipo === "imagem" && c.papel === "pessoa") return [];
      return [c];
    });
    trocarDesign({ ...design, camadas });
  }

  async function recortarPessoa() {
    if (!quadro) return;
    setRecortando(true);
    try {
      const r = await fetch(`/api/cortes/${corte.id}/thumb/recorte`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivo: quadro.arquivo }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? `Erro ${r.status}`);
      const dados = await r.json();
      const img = await carregarImagem(dados.url);
      const p: Pessoa = { url: dados.url, caixa: dados.caixa, largura: img.naturalWidth, altura: img.naturalHeight };
      setPessoa(p);
      setModeloBaixado(true);
      const ing = { ...(await ingredientes()), pessoa: p };
      const existente = design?.camadas.find((c) => c.tipo === "imagem" && c.papel === "pessoa");
      if (existente && existente.tipo === "imagem") {
        alterar(existente.id, { src: p.url, largura: (p.largura / p.altura) * existente.altura });
      } else {
        const nova = camadaPessoa(ing, dims.h > dims.w ? 0.6 : 0.95, dims.h > dims.w ? 0.5 : 0.75, "#FFFFFF");
        if (nova) adicionar(nova);
      }
      avisar("Pessoa recortada. Arraste e redimensione como quiser.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setRecortando(false);
    }
  }

  async function sugerirTextos() {
    setBuscandoTextos(true);
    try {
      const r = await fetch(`/api/cortes/${corte.id}/thumb/textos`, { method: "POST" });
      const dados = await r.json();
      setTextos(dados.opcoes ?? []);
      if (dados.aviso) avisar(`Gemini indisponível: ${dados.aviso}`, "erro");
      else if (dados.origem !== "gemini") avisar("Sem chave do Gemini: opções tiradas do gancho e da fala.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setBuscandoTextos(false);
    }
  }

  function usarTexto(t: string) {
    const c = textoPrincipal();
    if (c) alterar(c.id, { texto: t });
    else adicionar(novoTexto({ w: dims.w, h: dims.h, fonte: fontePadrao }, t));
  }

  async function enviarImagem(arquivo: File) {
    const dataurl = await new Promise<string>((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => erro(fr.error);
      fr.readAsDataURL(arquivo);
    });
    try {
      const r = await fetch("/api/thumb/imagens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataurl }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? `Erro ${r.status}`);
      const { url } = await r.json();
      const img = await carregarImagem(url);
      adicionar(novaImagem(url, img.naturalWidth, img.naturalHeight, dims.w, dims.h));
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  // ---------------------------------------------------------------- salvar

  async function salvar(exportar: boolean) {
    if (!design) return;
    setSalvando(true);
    try {
      let png: string | undefined;
      if (exportar && stageRef.current) {
        setSelecionada(null);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        png = stageRef.current.toDataURL({ pixelRatio: 1 / escala, mimeType: "image/png" });
      }
      const r = await fetch(`/api/cortes/${corte.id}/thumb/design/${tamanho}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, png }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? `Erro ${r.status}`);
      setSujo((s) => ({ ...s, [tamanho]: false }));
      if (exportar) setExportadas((e) => ({ ...e, [tamanho]: true }));
      avisar(exportar ? "Thumbnail exportada na pasta do projeto." : "Design salvo.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarComoTemplate() {
    if (!design) return;
    const nome = prompt("Nome do template:", "Meu template");
    if (!nome?.trim()) return;
    const novo: Template = { id: `meu-${Date.now().toString(36)}`, nome: nome.trim().slice(0, 40), salvo: paraTemplate(design) };
    const lista = [...salvos, novo];
    try {
      await fetch("/api/thumb/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lista.map(({ id, nome, salvo }) => ({ id, nome, salvo }))),
      });
      setSalvos(lista);
      avisar("Template salvo. Ele funciona nos três tamanhos.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function apagarTemplate(t: Template) {
    if (!confirm(`Apagar o template "${t.nome}"?`)) return;
    const lista = salvos.filter((x) => x.id !== t.id);
    await fetch("/api/thumb/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lista),
    });
    setSalvos(lista);
  }

  function fechar() {
    if (Object.values(sujo).some(Boolean) && !confirm("Há alterações não salvas. Fechar mesmo assim?")) return;
    onFechar();
  }

  // ---------------------------------------------------------------- tela

  const escala = Math.min((larguraArea - 4) / dims.w, (window.innerHeight * 0.62) / dims.h);
  const sel = design?.camadas.find((c) => c.id === selecionada) ?? null;
  const fonteSel = sel?.tipo === "texto" ? fontes.find((f) => f.nome === sel.fonte) : undefined;
  const pesos = fonteSel?.variacoes.length
    ? fonteSel.variacoes.map((v) => ({ v: PESOS[v] ?? v, n: v }))
    : [{ v: "normal", n: "Normal" }, { v: "bold", n: "Negrito" }];

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="modal modal-thumb" role="dialog" aria-label={`Thumbnail de ${corte.nome}`}>
        <div className="modal-topo">
          <h2>Thumbnail · {corte.nome}</h2>
          <div className="acoes">
            {(Object.keys(TAMANHOS) as TamanhoThumb[]).map((t) => (
              <button key={t} className={`btn btn-peq ${t === tamanho ? "btn-primario" : ""}`}
                onClick={() => (setTamanho(t), setSelecionada(null))}>
                {TAMANHOS[t].nome}
                {exportadas[t] ? " ✓" : ""}
                {sujo[t] ? " •" : ""}
              </button>
            ))}
            <button className="btn-icone" onClick={fechar} aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>

        <div className="modal-corpo thumb-grade">
          {/* coluna esquerda: quadro, recorte, templates, textos */}
          <div className="thumb-lado">
            <h3>Quadro</h3>
            {buscando && <p className="sutil">Procurando os melhores quadros…</p>}
            <div className="grade-quadros">
              {candidatos?.map((q) => (
                <button key={q.arquivo} className={`quadro-cand ${quadro?.arquivo === q.arquivo ? "ativo" : ""}`}
                  onClick={() => escolherQuadro(q)} title={`${formatar(q.t)} · nota ${q.nota}${q.rosto ? " · rosto" : ""}`}>
                  <img src={q.url} alt={`Quadro em ${formatar(q.t)}`} />
                  <span>{q.nota}{q.rosto ? " ☺" : ""}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-peq" onClick={buscarCandidatos} disabled={buscando}>
              Buscar quadros de novo
            </button>
            <button className="btn" onClick={recortarPessoa} disabled={!quadro || recortando}>
              {recortando ? (modeloBaixado ? "Recortando…" : "Baixando modelo (~178 MB, só na 1ª vez)…") : "✂ Recortar pessoa do fundo"}
            </button>

            <h3>Templates</h3>
            <div className="lista-templates">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="btn btn-peq" onClick={() => aplicarTemplate(t)}>
                  {t.nome}
                </button>
              ))}
              {salvos.map((t) => (
                <span key={t.id} className="template-salvo">
                  <button className="btn btn-peq" onClick={() => aplicarTemplate(t)}>
                    ★ {t.nome}
                  </button>
                  <button className="btn btn-peq btn-perigo" onClick={() => apagarTemplate(t)} aria-label={`Apagar ${t.nome}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button className="btn btn-peq" onClick={salvarComoTemplate} disabled={!design}>
              Salvar design como template
            </button>

            <h3>Texto</h3>
            <button className="btn btn-peq" onClick={sugerirTextos} disabled={buscandoTextos}>
              {buscandoTextos ? "Pensando…" : "✨ Sugerir textos (IA)"}
            </button>
            {textos.map((t) => (
              <button key={t} className="opcao-texto" onClick={() => usarTexto(t)}>
                {t}
              </button>
            ))}
          </div>

          {/* centro: palco */}
          <div className="thumb-centro" ref={area}>
            <div className="acoes barra-thumb">
              <button className="btn btn-peq" onClick={() => adicionar(novoTexto({ w: dims.w, h: dims.h, fonte: fontePadrao }))}>
                + Texto
              </button>
              <select
                className="btn btn-peq"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const t = novoTexto({ w: dims.w, h: dims.h, fonte: "Segoe UI Emoji" }, e.target.value);
                  adicionar({ ...t, nome: `Emoji ${e.target.value}`, maiusculas: false, contornoLargura: 0, peso: "normal",
                    tamanho: Math.round(Math.min(dims.w, dims.h) * 0.22), largura: Math.min(dims.w, dims.h) * 0.3 });
                }}
                aria-label="Adicionar emoji"
              >
                <option value="">+ Emoji</option>
                {EMOJIS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <label className="btn btn-peq">
                + Imagem
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                  onChange={(e) => e.target.files?.[0] && enviarImagem(e.target.files[0]).finally(() => (e.target.value = ""))} />
              </label>
              <button className="btn btn-peq" onClick={() => adicionar(novaForma("seta", dims.w, dims.h))}>+ Seta</button>
              <button className="btn btn-peq" onClick={() => adicionar(novaForma("circulo", dims.w, dims.h))}>+ Círculo</button>
              <button className="btn btn-peq" onClick={() => adicionar(novaForma("retangulo", dims.w, dims.h))}>+ Retângulo</button>
              <button className="btn btn-peq" onClick={desfazer} disabled={!(historico[tamanho]?.length)} title="Ctrl+Z">
                ↶ Desfazer
              </button>
            </div>
            {design ? (
              <div className="palco-moldura">
                <Palco design={design} escala={escala} selecionada={selecionada} versaoFontes={versaoFontes}
                  onSelecionar={setSelecionada} onAlterar={alterar} stageRef={stageRef} />
              </div>
            ) : (
              <p className="sutil">Escolha um quadro ou um template para começar.</p>
            )}
          </div>

          {/* direita: camadas e propriedades */}
          <div className="thumb-lado">
            <h3>Camadas</h3>
            <div className="lista-camadas">
              {[...(design?.camadas ?? [])].reverse().map((c) => (
                <div key={c.id} className={`camada ${c.id === selecionada ? "camada-sel" : ""}`} onClick={() => setSelecionada(c.id)}>
                  <span className="camada-nome">{c.tipo === "texto" ? c.texto.slice(0, 18) || "Texto" : c.nome}</span>
                  <button title={c.visivel ? "Esconder" : "Mostrar"} onClick={(e) => (e.stopPropagation(), alterar(c.id, { visivel: !c.visivel }))}>
                    {c.visivel ? "👁" : "◌"}
                  </button>
                  <button title={c.travada ? "Destravar" : "Travar"} onClick={(e) => (e.stopPropagation(), alterar(c.id, { travada: !c.travada }))}>
                    {c.travada ? "🔒" : "🔓"}
                  </button>
                  <button title="Subir" onClick={(e) => (e.stopPropagation(), mover(c.id, 1))}>▲</button>
                  <button title="Descer" onClick={(e) => (e.stopPropagation(), mover(c.id, -1))}>▼</button>
                  <button title="Duplicar" onClick={(e) => (e.stopPropagation(), duplicar(c.id))}>⧉</button>
                  <button title="Apagar" onClick={(e) => (e.stopPropagation(), remover(c.id))}>✕</button>
                </div>
              ))}
            </div>

            {sel && (
              <div className="propriedades">
                <h3>Propriedades</h3>
                {sel.tipo === "texto" && (
                  <>
                    <textarea rows={3} value={sel.texto} onChange={(e) => alterar(sel.id, { texto: e.target.value })} />
                    <label className="campo-linha">
                      Fonte
                      <select value={sel.fonte} onChange={(e) => {
                        const f = fontes.find((x) => x.nome === e.target.value);
                        alterar(sel.id, { fonte: e.target.value, peso: f?.variacoes.includes("Black") ? "900" : "normal" });
                      }}>
                        {[...fontes.map((f) => f.nome), "Segoe UI Emoji"].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <select value={sel.peso} onChange={(e) => alterar(sel.id, { peso: e.target.value })} aria-label="Peso">
                        {pesos.map((p) => (
                          <option key={p.v} value={p.v}>{p.n}</option>
                        ))}
                      </select>
                    </label>
                    <Faixa rotulo="Tamanho" min={10} max={500} passo={1} v={sel.tamanho} onChange={(v) => alterar(sel.id, { tamanho: v })} />
                    <div className="grupo-cores">
                      <Cor rotulo="Cor" v={sel.cor} onChange={(v) => alterar(sel.id, { cor: v })} />
                      <Cor rotulo="Contorno" v={sel.contornoCor} onChange={(v) => alterar(sel.id, { contornoCor: v })} />
                    </div>
                    <Faixa rotulo="Espessura do contorno" min={0} max={60} passo={1} v={sel.contornoLargura}
                      onChange={(v) => alterar(sel.id, { contornoLargura: v })} />
                    <Faixa rotulo="Entrelinha" min={0.7} max={1.6} passo={0.05} v={sel.entrelinha}
                      onChange={(v) => alterar(sel.id, { entrelinha: v })} />
                    <div className="grupo-opcoes">
                      <label className="corte-check"><input type="checkbox" checked={sel.maiusculas}
                        onChange={(e) => alterar(sel.id, { maiusculas: e.target.checked })} />MAIÚSCULAS</label>
                      <label className="corte-check"><input type="checkbox" checked={sel.sombra}
                        onChange={(e) => alterar(sel.id, { sombra: e.target.checked })} />Sombra</label>
                      <label className="corte-check"><input type="checkbox" checked={!!sel.fundo}
                        onChange={(e) => alterar(sel.id, { fundo: e.target.checked ? "#FFFFFF" : null })} />Caixa</label>
                      {sel.fundo && <Cor rotulo="" v={sel.fundo} onChange={(v) => alterar(sel.id, { fundo: v })} />}
                    </div>
                    <div className="acoes">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button key={a} className={`btn btn-peq ${sel.alinhamento === a ? "btn-primario" : ""}`}
                          onClick={() => alterar(sel.id, { alinhamento: a })}>
                          {{ left: "Esquerda", center: "Centro", right: "Direita" }[a]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {sel.tipo === "imagem" && (
                  <>
                    <Faixa rotulo="Brilho" min={-0.5} max={0.5} passo={0.01} v={sel.brilho} onChange={(v) => alterar(sel.id, { brilho: v })} />
                    <Faixa rotulo="Contraste" min={-50} max={80} passo={1} v={sel.contraste} onChange={(v) => alterar(sel.id, { contraste: v })} />
                    <Faixa rotulo="Saturação" min={-1} max={3} passo={0.05} v={sel.saturacao} onChange={(v) => alterar(sel.id, { saturacao: v })} />
                    <div className="grupo-opcoes">
                      <label className="corte-check"><input type="checkbox" checked={!!sel.contornoCor}
                        onChange={(e) => alterar(sel.id, { contornoCor: e.target.checked ? "#FFFFFF" : null,
                          contornoLargura: e.target.checked ? Math.round(dims.h * 0.012) : 0 })} />Contorno</label>
                      {sel.contornoCor && <Cor rotulo="" v={sel.contornoCor} onChange={(v) => alterar(sel.id, { contornoCor: v })} />}
                    </div>
                    {sel.contornoCor && (
                      <Faixa rotulo="Espessura do contorno" min={1} max={60} passo={1} v={sel.contornoLargura}
                        onChange={(v) => alterar(sel.id, { contornoLargura: v })} />
                    )}
                  </>
                )}
                {sel.tipo === "forma" && (
                  <>
                    <Cor rotulo="Cor" v={sel.cor} onChange={(v) => alterar(sel.id, { cor: v })} />
                    <Faixa rotulo="Espessura" min={0} max={80} passo={1} v={sel.espessura} onChange={(v) => alterar(sel.id, { espessura: v })} />
                    {sel.forma !== "seta" && (
                      <div className="grupo-opcoes">
                        <label className="corte-check"><input type="checkbox" checked={!!sel.preenchimento}
                          onChange={(e) => alterar(sel.id, { preenchimento: e.target.checked ? sel.cor : null })} />Preencher</label>
                        {sel.preenchimento && <Cor rotulo="" v={sel.preenchimento} onChange={(v) => alterar(sel.id, { preenchimento: v })} />}
                      </div>
                    )}
                  </>
                )}
                {sel.tipo === "fundo" && (
                  <div className="grupo-cores">
                    <Cor rotulo="Cor 1" v={sel.cor1} onChange={(v) => alterar(sel.id, { cor1: v })} />
                    <Cor rotulo="Cor 2" v={sel.cor2} onChange={(v) => alterar(sel.id, { cor2: v })} />
                  </div>
                )}
                <Faixa rotulo="Opacidade" min={0.05} max={1} passo={0.05} v={sel.opacidade} onChange={(v) => alterar(sel.id, { opacidade: v })} />
              </div>
            )}
          </div>
        </div>

        <div className="modal-rodape">
          <span className="sutil">Delete apaga · setas movem (Shift = 20px) · Ctrl+Z desfaz</span>
          <div className="acoes">
            {exportadas[tamanho] && (
              <button className="btn" onClick={() => fetch(`/api/cortes/${corte.id}/thumb/abrir/${tamanho}`, { method: "POST" })}>
                Abrir pasta
              </button>
            )}
            <button className="btn" onClick={() => salvar(false)} disabled={!design || salvando}>
              Salvar design
            </button>
            <button className="btn btn-primario" onClick={() => salvar(true)} disabled={!design || salvando}>
              {salvando ? "Salvando…" : `Exportar PNG ${dims.w}×${dims.h}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Faixa(p: { rotulo: string; min: number; max: number; passo: number; v: number; onChange: (v: number) => void }) {
  return (
    <label className="campo-deslizante">
      <span>
        {p.rotulo} <strong>{Math.round(p.v * 100) / 100}</strong>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.passo} value={p.v} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

function Cor(p: { rotulo: string; v: string; onChange: (v: string) => void }) {
  return (
    <label className="campo-cor">
      <input type="color" value={p.v} onChange={(e) => p.onChange(e.target.value.toUpperCase())} />
      {p.rotulo}
    </label>
  );
}
