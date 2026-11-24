// F04 idiomas (sem chave do Gemini) e Mídias (replica/test-plan.md)
import { expect, test } from "@playwright/test";
import { NAO_VIDEO, projetoPronto, semViolacoes, VIDEO, vigiar } from "./comum";

test.describe("F04 idiomas e mídias", () => {
  let erros: string[];
  test.beforeEach(({ page }) => {
    erros = vigiar(page);
  });
  test.afterEach(() => expect(erros).toEqual([]));

  test("F04-N1 traduzir para o idioma da fala recusa e F04-N2 exportar sem tradução recusa", async ({ page, request }) => {
    const p = await projetoPronto(request);
    const c = await (await request.post(`/api/projetos/${p.id}/cortes`, { data: { inicio: 1, fim: 6, nome: "idioma" } })).json();
    const r = await request.post(`/api/cortes/${c.id}/exportar`, { data: { idioma: "es" } });
    expect(r.status()).toBe(400);
    expect((await r.json()).detail).toMatch(/Traduza/);

    await page.goto(`/#/projeto/${p.id}`);
    await page.getByRole("button", { name: /^Cortes \(1\)/ }).click();
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByRole("tab", { name: /Idiomas/ }).click();
    // sem chave a tradução é local; para o mesmo idioma da fala recusa na hora (sem entrar na fila nem baixar nada)
    await page.getByLabel("Idioma da versão").selectOption("pt");
    await page.getByRole("button", { name: "Traduzir a legenda" }).click();
    await expect(page.getByText(/já está em Português/).first()).toBeVisible({ timeout: 5_000 });
    expect((await (await request.get("/api/fila")).json()).some((j: { tipo: string }) => j.tipo === "traduzir")).toBeFalsy();
    await expect(page.getByRole("button", { name: /Exportar em/ })).toBeDisabled();
    await semViolacoes(page, "Idiomas do corte");
  });

  test("M-N1 arquivo que não é vídeo e M-E1 palavras-chave normalizadas", async ({ page, request }) => {
    const ruim = await request.post("/api/midias", { data: { tipo: "broll", caminhos: [NAO_VIDEO] } });
    expect(ruim.status()).toBe(400);
    expect((await ruim.json()).detail).toMatch(/não é um vídeo/);

    const ok = await (await request.post("/api/midias", { data: { tipo: "broll", caminhos: [VIDEO] } })).json();
    const m = ok.criadas[0];
    const ed = await (await request.patch(`/api/midias/${m.id}`, { data: { tags: ["Ação", "  CARRO ", "", "ação"] } })).json();
    expect(ed.tags).toEqual(["acao", "carro"]);

    await page.goto("/#/ajustes/midias");
    await expect(page.getByText("vídeo de teste ção")).toBeVisible();
    await expect(page.getByLabel(/Palavras-chave/)).toHaveValue("acao, carro");
    await semViolacoes(page, "Ajustes → Mídias");
  });
});
