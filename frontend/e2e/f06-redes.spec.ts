// Marco 6: contas das redes (S23), publicar/agendar (S24) e posts (S25), contra o servidor falso (e2e/redes_falsas.py)
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { esperarJob, projetoPronto, semViolacoes, vigiar } from "./comum";

const FALSA = "http://127.0.0.1:8798";

/** Um arquivo exportado na Biblioteca (projeto + corte de 4 s + exportação). */
async function arquivoExportado(api: APIRequestContext): Promise<{ id: number; corte_nome: string }> {
  const p = await projetoPronto(api);
  const c = await (await api.post(`/api/projetos/${p.id}/cortes`, { data: { inicio: 1, fim: 5, nome: "Corte para as redes" } })).json();
  await api.patch(`/api/cortes/${c.id}`, { data: { com_legenda: false, formatos: ["vertical_crop"] } });
  const criados: { id: number }[] = await (await api.post(`/api/cortes/${c.id}/exportar`, { data: {} })).json();
  const fim = await esperarJob(api, criados[0].id);
  expect(fim.status, fim.mensagem ?? "").toBe("concluido");
  const itens = await (await api.get("/api/biblioteca")).json();
  return itens.find((i: { corte_nome: string }) => i.corte_nome === "Corte para as redes");
}

test.describe.serial("F03/F09 redes sociais", () => {
  let erros: string[];
  test.beforeEach(({ page }) => {
    erros = vigiar(page);
  });
  test.afterEach(() => expect(erros).toEqual([]));

  test("S23 contas: configurar o app, conectar YouTube (retorno automático) e Instagram (colar o endereço)", async ({ page, request, context }) => {
    await page.goto("/#/ajustes/contas");
    await expect(page.getByRole("heading", { name: "Contas das redes" })).toBeVisible();
    await expect(page.getByText("Abrir o Cortes Live na bandeja ao ligar o PC")).toBeVisible();
    await semViolacoes(page, "Contas");

    // YouTube: salvar o app e conectar; o "navegador" aprova e volta ao 127.0.0.1:53682
    const yt = page.getByRole("region", { name: "YouTube" });
    await expect(yt.getByText("falta configurar")).toBeVisible();
    await yt.getByLabel("ID do app").fill("id-teste.apps.googleusercontent.com");
    await yt.getByLabel("Chave secreta do app").fill("segredo-teste");
    await yt.getByRole("button", { name: "Salvar app" }).click();
    await expect(yt.getByText("· configurado")).toBeVisible();
    const ajustes = await (await request.get("/api/ajustes")).json();
    expect(ajustes.youtube_cliente_segredo).toBeUndefined(); // o segredo nunca volta para o site
    expect(ajustes.youtube_cliente_segredo_tem).toBe(true);

    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/redes/youtube/conectar")),
      yt.getByRole("button", { name: "Conectar" }).click(),
    ]);
    await expect(yt.getByText("Termine o login no navegador")).toBeVisible();
    const navegador = await context.newPage();
    await navegador.goto((await resposta.json()).url_login);
    await expect(navegador.getByText("Conta conectada!")).toBeVisible();
    await navegador.close();
    await expect(yt.getByText("Canal de Teste")).toBeVisible({ timeout: 10_000 });

    // Instagram: a Meta exige retorno https, então a pessoa cola o endereço da barra do navegador
    const ig = page.getByRole("region", { name: "Instagram" });
    await ig.getByLabel("ID do app").fill("ig-app");
    await ig.getByLabel("Chave secreta do app").fill("ig-segredo");
    await ig.getByRole("button", { name: "Salvar app" }).click();
    const [r2] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/redes/instagram/conectar")),
      ig.getByRole("button", { name: "Conectar" }).click(),
    ]);
    const volta = await request.get((await r2.json()).url_login, { maxRedirects: 0 });
    const endereco = volta.headers()["location"];
    expect(endereco).toMatch(/^https:\/\/localhost:53682\/\?code=/);
    await ig.getByLabel("Endereço de retorno do Instagram").fill("https://localhost:53682/?code=errado&state=outro");
    await ig.getByRole("button", { name: "Concluir" }).click();
    await expect(ig.getByRole("alert")).toHaveText(/não é deste programa ou expirou/);
    await ig.getByLabel("Endereço de retorno do Instagram").fill(endereco);
    await ig.getByRole("button", { name: "Concluir" }).click();
    await expect(ig.getByText("@perfil_teste")).toBeVisible();

    // TikTok pela API (mesmo caminho do YouTube): conta sem auditoria fica "só privado"
    await request.put("/api/ajustes", { data: { tiktok_cliente_chave: "tt", tiktok_cliente_segredo: "tt-s" } });
    const login = await (await request.post("/api/redes/tiktok/conectar")).json();
    await (await context.newPage()).goto(login.url_login);
    await expect.poll(async () => (await (await request.get(`/api/redes/login/${login.state}`)).json()).status).toBe("ok");
    await page.reload();
    const tt = page.getByRole("region", { name: "TikTok" });
    await expect(tt.getByText("TikTok de Teste")).toBeVisible();
    await expect(tt.getByText(/saem como privados/)).toBeVisible();
    await semViolacoes(page, "Contas conectadas");
  });

  test("S24/S25 agendar pela Biblioteca, mudar para agora, publicar e ver as métricas", async ({ page, request }) => {
    const item = await arquivoExportado(request);
    await page.goto("/#/biblioteca");
    await page.getByRole("button", { name: `Publicar ${item.corte_nome}` }).click();
    const janela = page.getByRole("dialog", { name: "Publicar nas redes" });
    await expect(janela).toBeVisible();
    await janela.getByRole("checkbox", { name: /Canal de Teste/ }).check();
    await janela.getByRole("checkbox", { name: /@perfil_teste/ }).check();
    // com Instagram marcado só existe "Público"
    await expect(janela.getByRole("radio", { name: "Não listado" })).toHaveCount(0);
    await janela.getByLabel("Descrição e hashtags").fill("#cortes #teste");
    await janela.getByRole("radio", { name: "Agendar" }).click();
    await janela.getByRole("button", { name: "Amanhã 18:00" }).click();
    await semViolacoes(page, "Publicar");
    await janela.getByRole("button", { name: "Agendar" }).last().click();
    await expect(janela).toHaveCount(0);

    await page.goto("/#/posts");
    const proximos = page.getByRole("region", { name: "Próximos" });
    await expect(proximos.getByRole("listitem")).toHaveCount(2);
    await expect(proximos.getByText("Agendado").first()).toBeVisible();
    await semViolacoes(page, "Posts");

    // o mesmo arquivo não vai duas vezes para a mesma conta
    const contas = await (await request.get("/api/contas")).json();
    const yt = contas.find((c: { rede: string }) => c.rede === "youtube");
    const dup = await request.post("/api/posts", { data: { exportacao_id: item.id, conta_ids: [yt.id] } });
    expect(dup.status()).toBe(409);

    // mudar o horário para agora: o agendador publica
    for (const p of await (await request.get("/api/posts")).json()) {
      await request.patch(`/api/posts/${p.id}`, { data: { agendado_para: Date.now() / 1000 } });
    }
    const feitos = page.getByRole("region", { name: "Publicados e outros" });
    await expect(feitos.getByText("Publicado", { exact: true })).toHaveCount(2, { timeout: 30_000 });
    await feitos.getByRole("button", { name: `Abrir ${item.corte_nome} no navegador` }).first().click();

    await page.getByRole("button", { name: "Atualizar métricas" }).click();
    await expect(feitos.getByText("1.234 views")).toBeVisible({ timeout: 20_000 });
    await expect(feitos.getByText("900 views")).toBeVisible();
  });

  test("F03-E falha na rede: mostra o motivo e tenta de novo", async ({ page, request }) => {
    const itens = await (await request.get("/api/biblioteca")).json();
    const item = itens.find((i: { corte_nome: string }) => i.corte_nome === "Corte para as redes");
    const contas = await (await request.get("/api/contas")).json();
    const tt = contas.find((c: { rede: string }) => c.rede === "tiktok");
    // passado é recusado
    const passado = await request.post("/api/posts", { data: { exportacao_id: item.id, conta_ids: [tt.id], agendado_para: Date.now() / 1000 - 3600 } });
    expect(passado.status()).toBe(400);

    // a rede recusa o próximo envio do YouTube: o post falha com o motivo
    const yt = contas.find((c: { rede: string }) => c.rede === "youtube");
    for (const p of await (await request.get("/api/posts")).json()) await request.delete(`/api/posts/${p.id}`);
    await request.post(`${FALSA}/_controle`, { data: { falhar: "youtube" } });
    await request.post("/api/posts", { data: { exportacao_id: item.id, conta_ids: [yt.id], titulo: "Vai falhar" } });
    await page.goto("/#/posts");
    await expect(page.getByText(/Vídeo recusado \(teste\)/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Tentar de novo Vai falhar" }).click();
    await expect(page.getByText("Publicado", { exact: true })).toBeVisible({ timeout: 20_000 });

    // cancelar um agendado e desconectar a conta
    const fut = await (await request.post("/api/posts", { data: { exportacao_id: item.id, conta_ids: [tt.id], titulo: "Para cancelar",
      agendado_para: Date.now() / 1000 + 7200 } })).json();
    await page.reload();
    await page.getByRole("button", { name: "Cancelar Para cancelar" }).click();
    await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
    expect((await (await request.get(`/api/posts`)).json()).find((p: { id: number }) => p.id === fut[0].id).status).toBe("cancelado");

    await page.goto("/#/ajustes/contas");
    const regiao = page.getByRole("region", { name: "TikTok" });
    await regiao.getByRole("button", { name: "Desconectar" }).click();
    await regiao.getByRole("button", { name: "Desconectar" }).click();
    await expect(regiao.getByText("TikTok de Teste")).toHaveCount(0);
  });
});
