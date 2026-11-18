import { useEffect, useState } from "react";
import { api, avisar, Corte, erroTexto, Estilo, formatoDoJob, Job, NOME_CURTO_FORMATO } from "../api";
import { duracaoCurta, formatar, ler } from "../tempo";

interface Props {
  corte: Corte;
  ativo: boolean;
  /** jobs de exportação deste corte, do mais novo para o mais antigo */
  jobs: Job[];
  tempoAtual: number;
  estilos: Estilo[];
  onEditarLegenda: () => void;
  onOpcoes: () => void;
  onThumb: () => void;
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

  return (
    <div className={`corte ${p.ativo ? "corte-ativo" : ""}`} onClick={p.onSelecionar}>
      <div className="corte-topo">
        <input
          className="corte-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome.trim() && nome !== corte.nome && salvar({ nome })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Nome do corte"
        />
        <span className="sutil">{duracaoCurta(corte.fim - corte.inicio)}</span>
      </div>

      {(["inicio", "fim"] as const).map((campo) => (
        <div className="corte-tempo" key={campo} onClick={(e) => e.stopPropagation()}>
          <span className="corte-rotulo">{campo === "inicio" ? "Início" : "Fim"}</span>
          <button className="btn btn-peq" onClick={() => ajustar(campo, -0.1)} title="-0,1 s">
            −
          </button>
          <input
            value={campo === "inicio" ? ini : fim}
            onChange={(e) => (campo === "inicio" ? setIni : setFim)(e.target.value)}
            onBlur={(e) => confirmarTempo(campo, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label={campo === "inicio" ? "Início do corte" : "Fim do corte"}
          />
          <button className="btn btn-peq" onClick={() => ajustar(campo, 0.1)} title="+0,1 s">
            +
          </button>
          <button
            className="btn btn-peq"
            onClick={() => salvar({ [campo]: Math.round(p.tempoAtual * 100) / 100 })}
            title="Usar a posição atual do vídeo"
          >
            ⌖ Atual
          </button>
        </div>
      ))}

      <div className="corte-legenda" onClick={(e) => e.stopPropagation()}>
        <label className="corte-check">
          <input
            type="checkbox"
            checked={!!corte.com_legenda}
            onChange={(e) => salvar({ com_legenda: e.target.checked })}
          />
          Legenda
        </label>
        <select
          value={corte.estilo}
          disabled={!corte.com_legenda}
          onChange={(e) => salvar({ estilo: e.target.value })}
          aria-label="Estilo da legenda"
        >
          {p.estilos.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
        <button className="btn btn-peq" onClick={p.onEditarLegenda} disabled={!corte.com_legenda}>
          ✎ Editar legenda{corte.legenda ? " •" : ""}
        </button>
      </div>

      <div className="corte-formatos" onClick={(e) => e.stopPropagation()}>
        {corte.formatos_efetivos.map((f) => (
          <span key={f} className="chip-formato">
            {NOME_CURTO_FORMATO[f] ?? f}
          </span>
        ))}
        {corte.gancho && <span className="chip-formato" title={corte.gancho}>gancho</span>}
        <button className="btn btn-peq" onClick={p.onOpcoes}>
          ⚙ Formatos e extras
        </button>
        <button className="btn btn-peq" onClick={p.onThumb}>
          🖼 Thumbnail
        </button>
      </div>

      <div className="acoes" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-peq" onClick={p.onPrevia}>
          ▶ Prévia
        </button>
        <button className="btn btn-peq btn-primario" onClick={p.onExportar} disabled={ativos.length > 0}>
          {ativos.length > 0
            ? `Exportando ${ativos.length} · ${Math.round(progresso * 100)}%`
            : `Exportar${corte.formatos_efetivos.length > 1 ? ` (${corte.formatos_efetivos.length})` : ""}`}
        </button>
        {concluido && (
          <button
            className="btn btn-peq"
            onClick={() => api.abrirSaida(concluido.id).catch((e) => avisar(erroTexto(e), "erro"))}
          >
            ✓ Abrir pasta
          </button>
        )}
        {falhas.length > 0 && (
          <span className="status status-erro" title={falhas.map((j) => j.mensagem).join("\n")}>
            Falhou ({falhas.length})
          </span>
        )}
        <button className="btn btn-peq btn-perigo" onClick={p.onRemover}>
          Excluir
        </button>
      </div>
    </div>
  );
}
