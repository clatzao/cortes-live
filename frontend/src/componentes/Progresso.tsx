export default function Progresso({ valor, texto }: { valor: number; texto?: string | null }) {
  const pct = Math.round(Math.max(0, Math.min(1, valor)) * 100);
  return (
    <div className="progresso">
      <div className="progresso-barra">
        <div className="progresso-cheio" style={{ width: `${pct}%` }} />
      </div>
      <div className="progresso-texto">
        <span>{texto}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
