// Antes de compilar: copia o uv.exe (que instala o Python e as bibliotecas no PC do usuário)
// e limpa caches do Python que não devem ir no instalador.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");

const uv = execSync("where uv", { encoding: "utf8" }).split(/\r?\n/)[0].trim();
mkdirSync(join(aqui, "src-tauri", "bin"), { recursive: true });
copyFileSync(uv, join(aqui, "src-tauri", "bin", "uv.exe"));
console.log("uv copiado de", uv);

function limpar(pasta) {
  for (const nome of readdirSync(pasta)) {
    const p = join(pasta, nome);
    if (!statSync(p).isDirectory()) continue;
    if (nome === "__pycache__") rmSync(p, { recursive: true, force: true });
    else limpar(p);
  }
}
limpar(join(raiz, "backend", "app"));
if (!statSync(join(raiz, "frontend", "dist", "index.html"), { throwIfNoEntry: false })) {
  throw new Error("Falta frontend/dist: rode 'npm run build' na pasta frontend antes.");
}
