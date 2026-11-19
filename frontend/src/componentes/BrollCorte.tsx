import { useEffect, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { api, avisar, BrollItem, erroTexto, Midia } from "../api";

/** Seção "Hook e B-roll" da janela do corte. Os valores sobem para o pai, que salva junto com o resto. */
export default function BrollCorte({ corteId, duracao, hook, onHook, brolls, onBrolls }: {
  corteId: number;
  duracao: number;
  hook: number | null;
  onHook: (id: number | null) => void;
  brolls: BrollItem[];
  onBrolls: (b: BrollItem[]) => void;
}) {
  const [hooks, setHooks] = useState<Midia[]>([]);
  const [videos, setVideos] = useState<Midia[]>([]);
  const [sugerindo, setSugerindo] = useState(false);

  useEffect(() => {
    api.midias("gancho").then(setHooks).catch(() => {});
    api.midias("broll").then(setVideos).catch(() => {});
  }, []);

  function mudar(i: number, campo: Partial<BrollItem>) {
    onBrolls(brolls.map((b, k) => (k === i ? { ...b, ...campo, origem: "manual" } : b)));
  }

  function adicionar() {
    if (!videos.length) return;
    const ultimo = brolls.length ? brolls[brolls.length - 1].fim_s : 0;
    const a = Math.min(Math.max(0, duracao - 1), ultimo);
    onBrolls([...brolls, { midia_id: videos[0].id, inicio_s: a, fim_s: Math.min(duracao, a + 3), modo: "tela_cheia", origem: "manual" }]);
  }

  async function sugerir() {
    setSugerindo(true);
    try {
      const s = await api.sugerirBrolls(corteId);
      if (!s.length) {
        avisar("Nenhuma palavra-chave das suas mídias aparece na fala deste corte.");
        return;
      }
      const livres = s.filter((x) => brolls.every((b) => x.fim_s <= b.inicio_s || x.inicio_s >= b.fim_s));
      onBrolls([...brolls, ...livres].sort((a, b) => a.inicio_s - b.inicio_s));
      avisar(`${livres.length} B-roll(s) sugerido(s). Confira e salve.`);
    } catch (e) {
      avisar(erroTexto(e), "erro");
    } finally {
      setSugerindo(false);
    }
  }

  return (
    <div className="broll-corte">
      <h3>Hook em vídeo</h3>
      {hooks.length === 0 ? (
        <p className="sutil">Nenhum hook na biblioteca. Adicione em <a href="#/ajustes/midias">Ajustes → Mídias</a>.</p>
      ) : (
        <select value={hook ?? 0} onChange={(e) => onHook(Number(e.target.value) || null)} aria-label="Hook em vídeo">
          <option value={0}>Sem hook</option>
          {hooks.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      )}

      <h3>B-roll</h3>
      {videos.length === 0 ? (
        <p className="sutil">Nenhum B-roll na biblioteca. Adicione em <a href="#/ajustes/midias">Ajustes → Mídias</a>.</p>
      ) : (
        <>
          {brolls.length === 0 && <p className="sutil">Nenhum B-roll neste corte.</p>}
          <ul className="lista-broll">
            {brolls.map((b, i) => (
              <li key={i} className="broll-linha">
                <select value={b.midia_id} onChange={(e) => mudar(i, { midia_id: Number(e.target.value) })}
                  aria-label={`Vídeo do B-roll ${i + 1}`}>
                  {videos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
                <label>
                  <span className="sutil">de</span>
                  <input type="number" min={0} max={duracao} step={0.1} value={b.inicio_s}
                    onChange={(e) => mudar(i, { inicio_s: Number(e.target.value) })} aria-label={`Início do B-roll ${i + 1} (s)`} />
                </label>
                <label>
                  <span className="sutil">até</span>
                  <input type="number" min={0} max={duracao} step={0.1} value={b.fim_s}
                    onChange={(e) => mudar(i, { fim_s: Number(e.target.value) })} aria-label={`Fim do B-roll ${i + 1} (s)`} />
                </label>
                <select value={b.modo} onChange={(e) => mudar(i, { modo: e.target.value as BrollItem["modo"] })}
                  aria-label={`Como o B-roll ${i + 1} aparece`}>
                  <option value="tela_cheia">Tela cheia</option>
                  <option value="metade">Metade de cima</option>
                </select>
                {b.origem === "auto" && <span className="chip" title={b.palavra ? `Quando fala "${b.palavra}"` : undefined}>sugerido</span>}
                <button className="btn-icone" onClick={() => onBrolls(brolls.filter((_, k) => k !== i))}
                  aria-label={`Tirar o B-roll ${i + 1}`} title="Tirar">
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="acoes">
            <button className="btn btn-peq" onClick={adicionar}><Plus size={13} aria-hidden="true" /> Adicionar</button>
            <button className="btn btn-peq" onClick={sugerir} disabled={sugerindo}>
              <Sparkles size={13} aria-hidden="true" /> Sugerir pela fala
            </button>
          </div>
          <p className="sutil">Tempos em segundos a partir do início do corte (o corte tem {duracao.toFixed(1)} s).</p>
        </>
      )}
    </div>
  );
}
