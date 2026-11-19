import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, as chamadas /api vão para o servidor Python (CORTES_API troca o endereço, ex.: testes).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.CORTES_API || "http://127.0.0.1:8765" },
  },
});
