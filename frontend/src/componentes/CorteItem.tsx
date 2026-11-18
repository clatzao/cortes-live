import { useEffect, useState } from "react";
import {
  Captions, ChevronDown, ChevronRight, Crosshair, FolderOpen, Loader2, Pencil, Play, Smartphone, Trash2, Type, Upload,
} from "lucide-react";
import { api, avisar, Corte, erroTexto, Estilo, formatoDoJob, Job, NOME_CURTO_FORMATO } from "../api";
import { duracaoCurta, formatar, ler } from "../tempo";
import type { AbaCorte } from "./JanelaCorte";

interface Props {
  corte: Corte;
  ativo: boolean;
  /** jobs de exportação deste corte, do mais novo para o mais antigo */
  jobs: Job[];
  tempoAtual: number;
  estilos: Estilo[];
  /** abre a janela do corte (legenda, formatos e thumbnail) */
  onEditar: (aba: AbaCorte) => void;
  onSelecionar: () => void;
  onAlterado: (c: Corte) => void;
  onPrevia: () => void;
  onExportar: () => void;
  onRemover: () => void;
}

export default function CorteItem(p: Props) {
  const { corte } = p;
  const [nome, setNome] = useState(corte.nome);
  const [ini, setIni] = useState(formatar(corte.inicio));
  const [fim, setFim] = useState(formatar(corte.fim));
  const [aberto, setAberto] = useState(false);

  useEffect(() => setNome(corte.nome), [corte.nome]);
  useEffect(() => setIni(formatar(corte.inicio)), [corte.inicio]);
  useEffect(() => setFim(formatar(corte.fim)), [corte.fim]);

  async function salvar(dados: Parameters<typeof api.editarCorte>[1]) {
    try {
      p.onAlterado(await api.editarCorte(corte.id, dados));
    } catch (e) {
      avisar(erroTexto(e), "erro");
      setIni(formatar(corte.inicio));
      setFim(formatar(corte.fim));
      setNome(corte.nome);
    }
  }

  function confirmarTempo(campo: "inicio" | "fim", txt: string) {
    const v = ler(txt);
    if (isNaN(v)) {
      avisar("Horário inválido. Use 00:00:00.0", "erro");
      campo === "inicio" ? setIni(formatar(corte.inicio)) : setFim(formatar(corte.fim));
      return;
    }
    if (Math.abs(v - corte[campo]) > 0.001) salvar({ [campo]: v });
  }

  const ajustar = (campo: "inicio" | "fim", delta: number) =>
    salvar({ [campo]: Math.max(0, Math.round((corte[campo] + delta) * 100) / 100) });

  // situação da exportação: considera o job mais recente de cada formato
  const ultimoPorFormato = new Map<string, Job>();
  for (const j of p.jobs) {
    const f = formatoDoJob(j) ?? "original";
    if (!ultimoPorFormato.has(f)) ultimoPorFormato.set(f, j);
  }
  const recentes = [...ultimoPorFormato.values()];
  const ativos = recentes.filter((j) => j.status === "na_fila" || j.status === "executando");
  const falhas = recentes.filter((j) => j.status === "erro");
  const concluido = p.jobs.find((j) => j.status === "concluido");
  const progresso = ativos.length ? ativos.reduce((s, j) => s + j.progresso, 0) / ativos.length : 0;

  const estiloNome = p.estilos.find((e) => e.id === corte.estilo)?.nome ?? corte.estilo;
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={`corte ${p.ativo ? "corte-ativo" : ""}`} onClick={p.onSelecionar}>
      <div className="corte-topo">
        <button className="btn-mini" onClick={(e) => (parar(e), setAberto((a) => !a))}
          title={aberto ? "Recolher" : "Ajustar início e fim"} aria-label={aberto ? "Recolher" : "Expandir"}
          aria-expanded={aberto}>
          {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <input
          className="corte-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome.trim() && nome !== corte.nome && salvar({ nome })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onClick={parar}
          aria-label="Nome do corte"
          title="Clique para renomear"
        />
        <span className="corte-duracao">{duracaoCurta(corte.fim - corte.inicio)}</span>
      </div>

      <div className="corte-resumo">
        <span className="mono">{formatar(corte.inicio, false)} → {formatar(corte.fim, false)}</span>
        <span title={corte.com_legenda ? `Legenda: ${estiloNome}` : "Sem legenda"}>
          <Captions size={13} /> {corte.com_legenda ? estiloNome : "sem legenda"}
        </span>
        <span title="Formatos que serão exportados">
          <Smartphone size={13} /> {corte.formatos_efetivos.map((f) => NOME_CURTO_FORMATO[f] ?? f).join(", ")}
        </span>
        {corte.gancho && <span title={`Gancho: ${corte.gancho}`}><Type size={13} /> gancho</span>}
      </div>

      {aberto && (
        <div className="corte-ajustes" onClick={parar}>
          {(["inicio", "fim"] as const).map((campo) => (
            <div className="corte-tempo" key={campo}>
              <span className="corte-rotulo">{campo === "inicio" ? "Início" : "Fim"}</span>
              <button className="btn btn-peq" onClick={() => ajustar(campo, -0.1)} title="Voltar 0,1 s">−</button>
              <input
                value={campo === "inicio" ? ini : fim}
                onChange={(e) => (campo === "inicio" ? setIni : setFim)(e.target.value)}
                onBlur={(e) => confirmarTempo(campo, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                aria-label={campo === "inicio" ? "Início do corte" : "Fim do corte"}
              />
              <button className="btn btn-peq" onClick={() => ajustar(campo, 0.1)} title="Avançar 0,1 s">+</button>
              <button className="btn btn-peq" onClick={() => salvar({ [campo]: Math.round(p.tempoAtual * 100) / 100 })}
                title="Usar a posição atual do vídeo">
                <Crosshair size={13} /> Atual
              </button>
            </div>
          ))}
          <label className="corte-check" title="Liga ou desliga a legenda neste corte">
            <input type="checkbox" checked={!!corte.com_legenda} onChange={(e) => salvar({ com_legenda: e.target.checked })} />
            Legenda no vídeo
          </label>
        </div>
      )}

      <div className="corte-acoes" onClick={parar}>
        <button className="btn-icone" onClick={p.onPrevia} title="Assistir este corte" aria-label="Assistir">
          <Play size={16} />
        </button>
        <button className="btn btn-peq" onClick={() => p.onEditar("legenda")}
          title="Legenda, formatos, gancho, extras e thumbnail">
          <Pencil size={14} /> Editar
        </button>
        <button className="btn btn-peq btn-primario" onClick={p.onExportar} disabled={ativos.length > 0}
          title="Exportar nos formatos marcados">
          {ativos.length > 0 ? (
            <><Loader2 size={14} className="girando" /> {Math.round(progresso * 100)}%</>
          ) : (
            <><Upload size={14} /> Exportar{corte.formatos_efetivos.length > 1 ? ` (${corte.formatos_efetivos.length})` : ""}</>
          )}
        </button>
        {concluido && (
          <button className="btn-icone" title="Mostrar o arquivo exportado na pasta" aria-label="Abrir pasta"
            onClick={() => api.abrirSaida(concluido.id).catch((e) => avisar(erroTexto(e), "erro"))}>
            <FolderOpen size={16} />
          </button>
        )}
        {falhas.length > 0 && (
          <span className="status status-erro" title={falhas.map((j) => j.mensagem).join("\n")}>
            Falhou ({falhas.length})
          </span>
        )}
        <button className="btn-icone btn-perigo empurrar-direita" onClick={p.onRemover} title="Excluir corte" aria-label="Excluir corte">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
