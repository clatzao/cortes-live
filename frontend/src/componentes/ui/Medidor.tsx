import "./ui.css";

/**
 * Barra de nível (disco livre, cota do dia). `valor` vai de `min` a `max`.
 * `aviso`/`critico` são limites: abaixo deles (ou acima, se `crescente`) muda a cor.
 */
export default function Medidor({ rotulo, valor, max, min = 0, texto, aviso, critico, crescente = false }: {
  rotulo: string;
  valor: number;
  max: number;
  min?: number;
  texto: string;
  aviso?: number;
  critico?: number;
  /** true = valor alto é ruim (ex.: cota usada); false = valor baixo é ruim (ex.: disco livre) */
  crescente?: boolean;
}) {
  const pct = max > min ? Math.max(0, Math.min(1, (valor - min) / (max - min))) * 100 : 0;
  const passou = (lim?: number) => lim !== undefined && (crescente ? valor >= lim : valor <= lim);
  const nivel = passou(critico) ? "critico" : passou(aviso) ? "aviso" : "normal";
  return (
    <div
      className={`medidor medidor-${nivel}`}
      role="meter"
      aria-label={rotulo}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={valor}
      aria-valuetext={texto}
    >
      <div className="medidor-topo">
        <span>{rotulo}</span>
        <strong>{texto}</strong>
      </div>
      <div className="medidor-trilho">
        <div className="medidor-cheio" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
