// F02 monitor de live: validações e estados sem depender de uma live no ar (replica/test-plan.md)
import { expect, test } from "@playwright/test";
import { semViolacoes, vigiar } from "./comum";

const CANAL = "cortes_live_e2e_sem_live"; // canal da Twitch que não existe

test.describe("F02 live", () => {
  let erros: string[];
  test.beforeEach(({ page }) => {
    erros = vigiar(page);
  });
  test.afterEach(() => expect(erros).toEqual([]));

  test("F02-N2 campo vazio e F02-N1 link inválido", async ({ page }) => {
    await page.goto("/#/lives");
    await page.getByRole("button", { name: "Monitorar" }).click();
    await expect(page.getByRole("alert")).toHaveText(/Cole o link ou o nome do canal/);
    await page.getByLabel("Canal ou link").fill("ftp://nada");
    await page.getByRole("button", { name: "Monitorar" }).click();
    await expect(page.getByRole("alert")).toHaveText(/Não reconheci esse canal/);
    await semViolacoes(page, "Lives");
  });

  test("F02-N3 canal que não existe: erro claro em português, sem gravar", async ({ page, request }) => {
    await page.goto("/#/lives");
    await page.getByLabel("Canal ou link").fill(CANAL);
    await page.getByRole("button", { name: "Monitorar" }).click();
    await expect(page).toHaveURL(/#\/live\/\d+/);
    const id = Number(page.url().split("/").pop());
    await expect(page.getByText("Esse canal não existe. Confira o nome ou o link.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/does not exist/)).toHaveCount(0);
    const v = await (await request.get(`/api/lives/${id}`)).json();
    expect(v.status).toBe("erro");
    expect(v.partes).toBe(0);
    await semViolacoes(page, "Live com erro");

    // F02-E5 390 px sem rolagem lateral
    await page.setViewportSize({ width: 390, height: 844 });
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(0);

    // a live com erro sai da lista "Agora" e pode ser tirada da lista
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/lives");
    await expect(page.getByRole("region", { name: "Lives anteriores" })).toBeVisible();
    expect((await request.delete(`/api/lives/${id}`)).ok()).toBeTruthy();
  });
});
