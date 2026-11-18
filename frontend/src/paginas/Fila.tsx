import { api, avisar, erroTexto, formatoDoJob, Job, NOME_CURTO_FORMATO } from "../api";
import Progresso from "../componentes/Progresso";

const ROTULO: Record<Job["status"], string> = {
  na_fila: "Na fila",
  executando: "Executando",
  concluido: "Concluído",
  erro: "Erro",
  cancelado: "Cancelado",
};

const TIPO: Record<string, string> = {
  importar: "Importar live",
  exportar: "Exportar corte",
  transcrever: "Transcrever",
};

export default function Fila({ fila }: { fila: Job[] }) {
  const acao = (f: () => Promise<unknown>) => f().catch((e) => avisar(erroTexto(e), "erro"));

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <h1>Fila de processamento</h1>
        <div className="acoes">
          <button className="btn" onClick={() => acao(api.abrirExportados)}>
            Abrir pasta de exportados
          </button>
          <button className="btn" onClick={() => acao(api.limparFila)}>
            Limpar finalizados
          </button>
        </div>
      </div>
      {fila.length === 0 && <p className="sutil">Nada na fila.</p>}
      <div className="lista-fila">
        {fila.map((j) => (
          <div key={j.id} className="cartao item-fila">
            <div className="item-fila-topo">
              <div>
                <strong>{TIPO[j.tipo] ?? j.tipo}</strong>
                <span className="sutil">
                  {" "}
                  · {j.projeto_nome ?? "projeto removido"}
                  {j.tipo === "exportar" && ` · ${j.corte_nome ?? "corte removido"}`}
                  {j.tipo === "exportar" && formatoDoJob(j) && ` · ${NOME_CURTO_FORMATO[formatoDoJob(j)!] ?? ""}`}
                </span>
              </div>
              <span className={`status status-${j.status}`}>{ROTULO[j.status]}</span>
            </div>
            {(j.status === "executando" || j.status === "na_fila") && (
              <Progresso valor={j.progresso} texto={j.mensagem} />
            )}
            {j.status === "erro" && <pre className="erro-texto">{j.mensagem}</pre>}
            {j.status === "concluido" && j.saida && <div className="sutil caminho">{j.saida}</div>}
            <div className="acoes">
              {(j.status === "executando" || j.status === "na_fila") && (
                <button className="btn btn-peq btn-perigo" onClick={() => acao(() => api.cancelarJob(j.id))}>
                  Cancelar
                </button>
              )}
              {j.status === "concluido" && j.saida && (
                <button className="btn btn-peq" onClick={() => acao(() => api.abrirSaida(j.id))}>
                  Mostrar na pasta
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
