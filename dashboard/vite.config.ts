import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, searchForWorkspaceRoot } from "vite";

/**
 * Local development only: serves POST /api/interpret and POST /api/chat with the
 * same handlers the Netlify Functions use (chat responses are streamed), reading
 * NVIDIA_API_KEY from the project's git-ignored .env file. Nothing here is part
 * of the production build, and the key is never exposed to the browser (Vite only
 * exposes variables prefixed with VITE_).
 */
function localApi(): Plugin {
  const routes: Record<string, { module: string; handler: string }> = {
    "/api/interpret": { module: "/server/handler.ts", handler: "handleInterpret" },
    "/api/chat": { module: "/server/chat.ts", handler: "handleChat" },
  };
  return {
    name: "local-api",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", resolve(import.meta.dirname, ".."), "");
      for (const [path, route] of Object.entries(routes)) {
        server.middlewares.use(path, async (req, res) => {
          try {
            const mod = await server.ssrLoadModule(route.module);
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const request = new Request(`http://localhost${path}`, {
              method: req.method,
              headers: { "content-type": "application/json" },
              body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
            });
            const response: Response = await mod[route.handler](request, { env: (k: string) => env[k] ?? process.env[k] });
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            if (!response.body) return res.end();
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value); // pass streamed chunks straight through
            }
            res.end();
          } catch (err) {
            server.config.logger.error(`local-api: ${err instanceof Error ? err.message : String(err)}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, reason: "Local API error" }));
          }
        });
      }
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
