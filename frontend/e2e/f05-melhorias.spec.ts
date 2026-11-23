// Melhorias do /replica-entrepreneur (replica/fixes.md): assistente do Gemini e custo zero por minuto
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { projetoPronto, semViolacoes, VIDEO_FALA, vigiar } from "./comum";

test.describe("melhorias", () => {
  let erros: string[];
  test.beforeEach(({ page }) => {
    erros = vigiar(page);
  });
  test.afterEach(() => expect(erros).toEqual([]));

  test("FIX-2 assistente do Gemini: aparece sem chave, chave errada não fica salva", async ({ page, request }) => {
    await page.goto("/#/lives");
    const aviso = page.getByRole("note").filter({ hasText: /Sem o Gemini/ });
    await expect(aviso).toBeVisible();
    await aviso.getByRole("button", { name: "Ligar o Gemini grátis" }).click();
    const janela = page.getByRole("dialog", { name: /Ligar o Gemini/ });
    await expect(janela).toBeVisible();
    await expect(janela.getByRole("button", { name: /aistudio\.google\.com\/apikey/ })).toBeVisible();
    await semViolacoes(page, "Assistente do Gemini");

    await janela.getByRole("button", { name: "Salvar e testar" }).click();
    await expect(janela.getByRole("alert")).toHaveText(/Cole a chave/);

    await janela.getByLabel(/Cole a chave aqui/).fill("chave-de-teste-que-nao-funciona");
    await janela.getByRole("button", { name: "Salvar e testar" }).click();
    await expect(janela.getByRole("alert")).toHaveText(/A chave não funcionou/, { timeout: 30_000 });
    expect((await (await request.get("/api/ajustes")).json()).gemini_tem_chave).toBe(false);

    await page.keyboard.press("Escape");
    await expect(janela).toHaveCount(0);
    await expect(aviso).toBeVisible(); // continua avisando
  });

  test("FIX-3 depois de achar os momentos mostra o custo zero por minuto", async ({ page, request }) => {
    test.skip(!fs.existsSync(VIDEO_FALA), "este PC não tem síntese de voz do Windows para criar o vídeo com fala");
    const p = await projetoPronto(request, VIDEO_FALA);
    await expect
      .poll(async () => (await (await request.get(`/api/projetos/${p.id}`)).json()).job_transcricao?.status, { timeout: 120_000 })
      .toBe("concluido");
    await page.goto(`/#/projeto/${p.id}`);
    await expect(page.getByRole("note").filter({ hasText: /Sem o Gemini/ })).toBeVisible();
    // a análise de momentos roda sozinha quando a transcrição termina (Ajustes: viral_auto)
    await expect(page.getByText(/analisados · R\$ 0 por minuto/)).toBeVisible({ timeout: 90_000 });
  });
});
