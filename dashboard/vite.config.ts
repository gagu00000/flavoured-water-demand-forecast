import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, searchForWorkspaceRoot } from "vite";

/**
 * Local development only: serves POST /api/interpret with the same handler the
 * Netlify Function uses, reading NVIDIA_API_KEY from the project's git-ignored
 * .env file. Nothing here is part of the production build, and the key is never
 * exposed to the browser (Vite only exposes variables prefixed with VITE_).
 */
function localApi(): Plugin {
  return {
    name: "local-api",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", resolve(import.meta.dirname, ".."), "");
      server.middlewares.use("/api/interpret", async (req, res) => {
        try {
          const { handleInterpret } = await server.ssrLoadModule("/server/handler.ts");
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const request = new Request("http://localhost/api/interpret", {
            method: req.method,
            headers: { "content-type": "application/json" },
            body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
          });
          const response: Response = await handleInterpret(request, { env: (k: string) => env[k] ?? process.env[k] });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch (err) {
          server.config.logger.error(`local-api: ${err instanceof Error ? err.message : String(err)}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, reason: "Local API error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi()],
  // Pyodide is loaded as-is; its runtime and Python packages come from the jsDelivr CDN
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
  server: {
    fs: {
      // node_modules may be a junction to a folder outside the project (kept out of OneDrive)
      allow: [searchForWorkspaceRoot(process.cwd()), realpathSync("node_modules")],
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
