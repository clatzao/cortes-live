import { useEffect, useState } from "react";
import { Ajustes, api, avisar, erroTexto, Hardware } from "../api";

const NOMES_MODELO: Record<string, string> = {
  auto: "Automático (recomendado)",
  "large-v3": "large-v3 — o mais preciso, mais lento",
  "large-v3-turbo": "large-v3-turbo — quase tão preciso, bem mais rápido",
  medium: "medium",
  small: "small — leve",
  base: "base — muito leve, menos preciso",
};
const NOMES_DISP: Record<string, string> = {
  auto: "Automático (recomendado)",
  cuda: "Placa de vídeo NVIDIA",
  cpu: "Processador",
};

export default function Configuracoes({ hw, onHw }: { hw: Hardware | null; onHw: (h: Hardware) => void }) {
  const [detectando, setDetectando] = useState(false);
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [chave, setChave] = useState("");
  const [teste, setTeste] = useState<{ modelo: string; modelos: string[] } | null>(null);
  const [testando, setTestando] = useState(false);

  async function salvarChave(valor: string) {
    try {
      setAjustes(await api.salvarAjustes({ gemini_chave: valor }));
      setChave("");
      setTeste(null);
      avisar(valor ? "Chave salva neste PC." : "Chave removida.");
      if (valor) testar();
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function testar() {
    setTestando(true);
    try {
      const r = await api.testarGemini();
      setTeste({ modelo: r.modelo_escolhido, modelos: r.modelos });
      avisar(`Chave funcionando. Modelo: ${r.modelo_escolhido}`);
    } catch (e) {
      setTeste(null);
      avisar(erroTexto(e), "erro");
    } finally {
      setTestando(false);
    }
  }

  useEffect(() => {
    api.ajustes().then(setAjustes).catch(() => {});
  }, []);

  async function salvar(dados: Parameters<typeof api.salvarAjustes>[0]) {
    try {
      setAjustes(await api.salvarAjustes(dados));
      avisar("Ajuste salvo. Vale para as próximas transcrições.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    }
  }

  async function detectar() {
    setDetectando(true);
    try {
      onHw(await api.detectarHardware());
      avisar("Hardware detectado novamente.");
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setDetectando(false);
    }
  }

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <h1>Configurações</h1>
        <button className="btn" onClick={detectar} disabled={detectando}>
          {detectando ? "Detectando…" : "Detectar hardware novamente"}
        </button>
      </div>

      {!hw && <p className="sutil">Detectando hardware…</p>}
      {hw && (
        <div className="grade-config">
          <section className="cartao">
            <h2>Hardware</h2>
            <dl className="lista-dados">
              <dt>Placas de vídeo</dt>
              <dd>{hw.placas.length ? hw.placas.join(", ") : "Não identificadas"}</dd>
              <dt>NVIDIA</dt>
              <dd>
                {hw.nvidia.length
                  ? hw.nvidia.map((g) => (
                      <div key={g.nome}>
                        {g.nome} · {g.vram_gb} GB · driver {g.driver}
                        {g.compute_cap ? ` · CUDA ${g.compute_cap}` : ""}
                      </div>
                    ))
                  : "Nenhuma"}
              </dd>
              <dt>Memória RAM</dt>
              <dd>{hw.ram_gb} GB</dd>
              <dt>Processador</dt>
              <dd>{hw.cpus} núcleos lógicos</dd>
              <dt>FFmpeg</dt>
              <dd className="caminho">{hw.ffmpeg ?? "NÃO ENCONTRADO — rode o instalar.bat"}</dd>
            </dl>
          </section>

          <section className="cartao">
            <h2>Exportação de vídeo</h2>
            <dl className="lista-dados">
              <dt>Codificador em uso</dt>
              <dd>
                <strong>{hw.encoder_nome}</strong>
              </dd>
              <dt>Testados e funcionando</dt>
              <dd>{hw.encoders_disponiveis.join(", ")}</dd>
            </dl>
            <p className="sutil">
              O programa testa de verdade NVIDIA (NVENC), Intel (Quick Sync) e AMD (AMF) e usa o primeiro que funcionar.
              Se nenhum funcionar, usa o processador.
            </p>
          </section>

          <section className="cartao">
            <h2>Transcrição (Whisper)</h2>
            <dl className="lista-dados">
              <dt>Dispositivo</dt>
              <dd>{hw.whisper.dispositivo === "cuda" ? `Placa de vídeo (${hw.whisper.gpu})` : "Processador"}</dd>
              <dt>Modelo recomendado</dt>
              <dd>{hw.whisper.modelo}</dd>
              <dt>Modo de cálculo</dt>
              <dd>
                {hw.whisper.compute_type}
                {hw.whisper.alternativas_compute.length > 0 &&
                  ` (reserva: ${hw.whisper.alternativas_compute.join(" → ")} → processador)`}
              </dd>
            </dl>
            <p className="sutil">{hw.whisper.motivo}</p>
            {ajustes && (
              <div className="campos">
                <label>
                  Modelo
                  <select value={ajustes.whisper_modelo} onChange={(e) => salvar({ whisper_modelo: e.target.value })}>
                    {ajustes.opcoes.whisper_modelo.map((m) => (
                      <option key={m} value={m}>
                        {NOMES_MODELO[m] ?? m}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Dispositivo
                  <select
                    value={ajustes.whisper_dispositivo}
                    onChange={(e) => salvar({ whisper_dispositivo: e.target.value })}
                  >
                    {ajustes.opcoes.whisper_dispositivo.map((m) => (
                      <option key={m} value={m}>
                        {NOMES_DISP[m] ?? m}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="sutil">
                  Se o modo escolhido não funcionar neste PC, o programa usa o processador automaticamente.
                </p>
                <label>
                  Qualidade do download por link
                  <select
                    value={ajustes.download_qualidade}
                    onChange={(e) => salvar({ download_qualidade: e.target.value })}
                  >
                    {ajustes.opcoes.download_qualidade.map((q) => (
                      <option key={q} value={q}>
                        {q === "melhor" ? "Melhor disponível (4K pode demorar muito)" : `Até ${q}p`}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="sutil">
                  Até 1080p é o recomendado: os cortes saem em 1080p e o download fica bem mais rápido.
                </p>
              </div>
            )}
          </section>

          {ajustes && (
            <section className="cartao campos">
              <h2>Momentos virais (Gemini)</h2>
              <p className="sutil">
                Crie uma chave grátis em aistudio.google.com/apikey (conta Google) e cole aqui. Ela fica salva só
                neste PC. No plano gratuito, o Google pode usar os textos enviados para melhorar os produtos dele.
                Sem chave, as sugestões usam só volume e palavras-chave.
              </p>
              <div className="campo-arquivo">
                <input
                  type="password"
                  autoComplete="off"
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder={
                    ajustes.gemini_tem_chave ? `Chave salva (termina em ${ajustes.gemini_chave_final})` : "Cole a chave da API"
                  }
                  aria-label="Chave da API do Gemini"
                />
                <button className="btn btn-peq btn-primario" disabled={!chave.trim()} onClick={() => salvarChave(chave.trim())}>
                  Salvar chave
                </button>
                {ajustes.gemini_tem_chave && (
                  <>
                    <button className="btn btn-peq" onClick={testar} disabled={testando}>
                      {testando ? "Testando…" : "Testar"}
                    </button>
                    <button
                      className="btn btn-peq btn-perigo"
                      onClick={() => confirm("Remover a chave do Gemini deste PC?") && salvarChave("")}
                    >
                      Remover
                    </button>
                  </>
                )}
              </div>
              <label>
                Modelo
                <select value={ajustes.gemini_modelo} onChange={(e) => salvar({ gemini_modelo: e.target.value })}>
                  <option value="auto">Automático (o Flash estável mais novo){teste ? ` — ${teste.modelo}` : ""}</option>
                  {ajustes.gemini_modelo !== "auto" && !teste?.modelos.includes(ajustes.gemini_modelo) && (
                    <option value={ajustes.gemini_modelo}>{ajustes.gemini_modelo}</option>
                  )}
                  {teste?.modelos.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {!teste && ajustes.gemini_tem_chave && <span className="sutil">Clique em "Testar" para ver a lista de modelos.</span>}
              <p className="sutil">
                Duração e quantidade dos momentos ficam em <a href="#/ajustes/padrao">Padrão dos cortes</a>.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
