import { defineConfig } from "@playwright/test";

// Testes de ponta a ponta do Cortes Live (replica/test-plan.md).
// Sobe um motor só para os testes (dados em e2e/.dados, apagados a cada rodada) e o Vite apontando para ele.
const API = 8799;
const WEB = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // um motor e um banco para todos: os testes rodam em ordem
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "..\\backend\\.venv\\Scripts\\python.exe e2e/motor.py",
      url: `http://127.0.0.1:${API}/api/ajustes`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { PORTA_TESTE: String(API) },
    },
    {
      command: `npx vite --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { CORTES_API: `http://127.0.0.1:${API}` },
    },
  ],
});
