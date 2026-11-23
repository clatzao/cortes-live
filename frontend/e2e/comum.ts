import { expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = path.resolve(__dirname, ".dados", "fixtures");
export const VIDEO = path.join(FIXTURES, "vídeo de teste ção.mp4");
export const NAO_VIDEO = path.join(FIXTURES, "nao_e_video.txt");

/** T-ERR: falha o teste em erro de console ou resposta 5xx (4xx esperados de casos negativos passam). */
export function vigiar(page: Page): string[] {
  const erros: string[] = [];
  page.on("console", (m) => {
    // o navegador também registra no console as respostas 4xx que o teste provocou de propósito
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) erros.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) erros.push(`${r.status()} em ${r.url()}`);
  });
  return erros;
}

/** T-A11Y: sem violações sérias ou críticas do axe na tela atual. */
export async function semViolacoes(page: Page, tela: string) {
  const r = await new AxeBuilder({ page }).analyze();
  const graves = r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length}x — ${v.nodes[0]?.target.join(" ")}`);
  expect(graves, `acessibilidade em ${tela}`).toEqual([]);
}

/** Importa um vídeo pela API e espera o projeto ficar pronto. */
export async function projetoPronto(api: APIRequestContext, entrada = VIDEO): Promise<{ id: number; nome: string }> {
  const r = await api.post("/api/projetos", { data: { entrada } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const p = await r.json();
  await expect
    .poll(async () => (await (await api.get(`/api/projetos/${p.id}`)).json()).status, { timeout: 90_000 })
    .toBe("pronto");
  return p;
}

export async function esperarJob(api: APIRequestContext, id: number, limite = 120_000) {
  let job: { status: string; saida: string | null; mensagem: string | null } | undefined;
  await expect
    .poll(
      async () => {
        job = (await (await api.get("/api/fila")).json()).find((j: { id: number }) => j.id === id);
        return job?.status;
      },
      { timeout: limite },
    )
    .toMatch(/concluido|erro/);
  return job!;
}
