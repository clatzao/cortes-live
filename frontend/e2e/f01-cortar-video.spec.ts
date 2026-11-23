// F01 cortar um vídeo + F03 ajustar o corte + Biblioteca (replica/test-plan.md)
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { esperarJob, projetoPronto, semViolacoes, VIDEO, vigiar } from "./comum";

test.describe("F01 cortar vídeo", () => {
  let erros: string[];
  test.beforeEach(({ page }) => {
    erros = vigiar(page);
  });
  test.afterEach(() => expect(erros).toEqual([]));

  test("F01-N2 com o campo vazio o Importar fica desabilitado", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "Importar" })).toBeDisabled();
    await page.getByPlaceholder(/twitch\.tv\/videos/).fill("   ");
    await expect(page.getByRole("button", { name: "Importar" })).toBeDisabled();
  });

  test("F01-N1 arquivo que não existe avisa", async ({ page }) => {
    await page.goto("/#/");
    await page.getByPlaceholder(/twitch\.tv\/videos/).fill("C:\\nao\\existe\\nada.mp4");
    await page.getByRole("button", { name: "Importar" }).click();
    await expect(page.getByText(/Arquivo não encontrado/)).toBeVisible();
  });

  test("F01-H1/E1/E2 importar (nome com acento), cortar, nome longo, exportar, ver na Biblioteca", async ({ page, request }) => {
    await page.goto("/#/");
    await page.getByPlaceholder(/twitch\.tv\/videos/).fill(VIDEO);
    await page.getByRole("button", { name: "Importar" }).click();
    await expect(page.getByRole("heading", { name: "vídeo de teste ção" }).first()).toBeVisible();
    const projetos = await (await request.get("/api/projetos")).json();
    const p = projetos.find((x: { nome: string }) => x.nome === "vídeo de teste ção");
    await expect
      .poll(async () => (await (await request.get(`/api/projetos/${p.id}`)).json()).status, { timeout: 90_000 })
      .toBe("pronto");
    await semViolacoes(page, "Projetos");

    // F01-E2: nome com 70 caracteres e emoji
    const nome = "Corte com um nome bem comprido para ver se a tela aguenta sem quebrar 🔥🎮";
    const c = await (await request.post(`/api/projetos/${p.id}/cortes`, { data: { inicio: 2, fim: 8, nome } })).json();
    const editado = await (await request.patch(`/api/cortes/${c.id}`, { data: { com_legenda: false, formatos: ["vertical_crop"] } })).json();
    expect(editado.nome).toBe(nome);

    await page.goto(`/#/projeto/${p.id}`);
    await page.getByRole("button", { name: /^Cortes \(1\)/ }).click();
    await expect(page.getByTitle("Clique para renomear")).toHaveValue(nome);
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(largura, "sem rolagem lateral com nome longo").toBeLessThanOrEqual(0);
    await semViolacoes(page, "Editor");

    await page.getByRole("button", { name: /^Exportar$/ }).click();
    const job = (await (await request.get("/api/fila")).json()).find((j: { tipo: string; corte_id: number }) => j.tipo === "exportar" && j.corte_id === c.id);
    const fim = await esperarJob(request, job.id);
    expect(fim.status, fim.mensagem ?? "").toBe("concluido");
    expect(fs.existsSync(fim.saida!)).toBeTruthy();

    // B-H1: aparece na Biblioteca
    await page.goto("/#/biblioteca");
    await expect(page.getByText(nome).first()).toBeVisible();
    await expect(page.getByText(/9:16 recorte · 1080p/)).toBeVisible();
    await semViolacoes(page, "Biblioteca");

    // B-E1: busca sem resultado
    await page.getByLabel("Procurar por corte ou projeto").fill("zzzz nada");
    await expect(page.getByText("Nada encontrado com esse filtro.")).toBeVisible();
    await page.getByLabel("Procurar por corte ou projeto").fill("");

    // B-E2: arquivo apagado do disco
    fs.unlinkSync(fim.saida!);
    await page.reload();
    await expect(page.getByText("O arquivo foi movido ou apagado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mostrar na pasta" })).toBeDisabled();
  });

  test("F03-E2 fechar a janela do corte com alteração não salva pergunta antes", async ({ page, request }) => {
    const p = await projetoPronto(request);
    await request.post(`/api/projetos/${p.id}/cortes`, { data: { inicio: 1, fim: 5, nome: "janela" } });
    await page.goto(`/#/projeto/${p.id}`);
    await page.getByRole("button", { name: /^Cortes \(1\)/ }).click();
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByRole("tab", { name: /Formatos e extras/ }).click();
    await page.getByPlaceholder(/ELE NÃO ACREDITOU/).fill("gancho novo");
    let pergunta = "";
    page.once("dialog", async (d) => {
      pergunta = d.message();
      await d.dismiss();
    });
    await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).last().click();
    expect(pergunta).toMatch(/não salvas/);
    await expect(page.getByRole("dialog")).toBeVisible(); // continuou aberta
  });
});
