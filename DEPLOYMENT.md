# Deployment: GitHub → Netlify

**Live site:** https://flavoured-water-forecast.netlify.app
**Repository:** https://github.com/gagu00000/flavoured-water-demand-forecast (public)

The site is static: it runs the forecasting engine in the visitor's browser. Two Netlify Functions call the LLM with a key that never leaves the server: `/api/interpret` writes the Q1–Q3 interpretation, and `/api/chat` streams chat answers.

## 1. Netlify configuration (`netlify.toml`, repository root)

| Setting | Value | Why |
|---|---|---|
| `base` | `dashboard` | The build runs inside `dashboard/`. The build script also copies in `../forecasting_core` and `../prompts`. |
| `command` | `npm run build` | Copies the shared Python engine and prompt, type-checks, and builds with Vite. |
| `publish` | `dist` (that is, `dashboard/dist`) | Static output. |
| `functions` | `netlify/functions` | `interpret.mts` (`/api/interpret`, POST, 10 requests per minute per visitor) and `chat.mts` (`/api/chat`, POST, streamed, 15 messages per minute per visitor). |
| `NODE_VERSION` | `22` | Vite 8 needs Node 20.19 or later. |
| Headers | `nosniff`, `DENY` framing, referrer and permissions policies; one-year cache for `/assets/*` | Basic hardening and fast repeat visits. |

## 2. Environment variables

| Variable | Required | Value |
|---|---|---|
| `NVIDIA_API_KEY` | yes | Key from https://build.nvidia.com (NVIDIA API Catalog) |
| `LLM_MODEL` | no | Defaults to `nvidia/nemotron-3.5-bolt-e4b`. A comma-separated list is tried in order. |
| `LLM_BASE_URL` | no | Defaults to `https://integrate.api.nvidia.com/v1`, which is OpenAI-compatible. |

To set them, go to **Project configuration → Environment variables → Add a variable**, and redeploy after any change.

On the Free plan, Netlify refuses the "secret" flag and "Functions only" scope (HTTP 403), so the key is stored with all scopes. It is still never exposed: Vite only bundles variables prefixed with `VITE_`. A scan of the deployed JavaScript found neither the key nor its name.

## 3. Step-by-step: from GitHub to a live site

1. **Push the code.** `.gitignore` keeps the 789 MB CSV, `.env`, `node_modules`, `dist`, the generated `public/py/` copy and `server/prompt.generated.ts` out of Git.
   ```bash
   git push origin main
   ```
2. **Create the project.** In Netlify, choose **Add new project → Import an existing project → GitHub**. Authorise Netlify for **only** this repository, then select it and the branch `main`.
3. **Build settings.** Netlify reads them from `netlify.toml`: base directory `dashboard`, build command `npm run build`, publish `dashboard/dist`, functions `dashboard/netlify/functions`.
4. **Add `NVIDIA_API_KEY`** as in §2, then click **Deploy**.
5. **Save credits on the Free plan.** Under **Project configuration → Build & deploy → Branches and deploy contexts**, set *Branch deploys* to **Deploy only the production branch** and *Deploy Previews* to **Don't deploy pull requests**.
6. **Make it public.** New Netlify projects require team login by default. Under **Project configuration → Access & security**, require login only for non-production deploys, so the production site is public.
7. **Check the live site:**
   - the page loads and shows the launch-year results immediately;
   - the engine badge turns "Live engine ready";
   - "Next month arrives" re-runs the models;
   - the AI Analyst shows `nvidia/nemotron-3.5-bolt-e4b` with "N/N figures verified".

From then on, every push to `main` builds and publishes automatically.

## 4. Local development

```bash
cd dashboard && npm install
```
```bash
npm run dev
```

The dev server (http://localhost:5173) also serves `/api/interpret`, reading `NVIDIA_API_KEY` from the project's git-ignored `.env`. As an alternative, `netlify dev` runs the real function locally.

## 5. Operating notes

- **Credits:** the Free plan has a monthly credit allowance. Each production deploy and each AI request uses some. Answers are cached per results snapshot in the browser, so revisiting a view doesn't call the AI again.
- **If the AI is busy or out of quota:** the panel shows the engine's rule-based interpretation of the same numbers, labelled with the reason. The rest of the dashboard is unaffected.
- **Rotating the key:** create a new key on build.nvidia.com, update `NVIDIA_API_KEY` in Netlify and in `.env`, redeploy, then revoke the old key.
