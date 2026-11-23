/** Formata segundos como 00:00:00.0 */
export function formatar(seg: number, decimos = true): string {
  if (!isFinite(seg) || seg < 0) seg = 0;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const ss = decimos ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${ss}`;
}

/** Lê "1:23:10", "83:10", "4990.5" → segundos (NaN se inválido) */
export function ler(txt: string): number {
  const limpo = txt.trim().replace(",", ".");
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(limpo)) return NaN;
  return limpo.split(":").reduce((tot, p) => tot * 60 + parseFloat(p), 0);
}

/** "X min analisados · R$ 0": o Cortes Live roda no PC, sem cobrança por minuto (só a cota do Gemini, se usar). */
export function custoAnalise(seg: number): string {
  const min = Math.max(1, Math.round(seg / 60));
  const texto = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  return `${texto} analisados · R$ 0 por minuto (tudo roda no seu PC)`;
}

export function duracaoCurta(seg: number): string {
  if (seg < 60) return `${seg.toFixed(1)}s`;
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  if (m < 60) return `${m}min ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
