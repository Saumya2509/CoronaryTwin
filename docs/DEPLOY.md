# Deploy: API on Hugging Face Spaces, website on Vercel

Both are free. The API (FastAPI + models) runs on a Hugging Face Space; the website (React + 3D) runs on Vercel and calls
the API directly. Order: **API first** (you need its URL), then the website, then allow the website on the API.

## 1. API on Hugging Face Spaces

1. Sign in at [huggingface.co](https://huggingface.co) and open **New Space** (top-right menu → *New Space*).
2. Fill in: a **Space name** (e.g. `coronarytwin-api`), **License** (any), **SDK: Docker**, template **Blank**,
   hardware **CPU basic (free)**, visibility **Public**. Click **Create Space**.
3. In the Space, open **Files** → **+ Add file** → **Create a new file**:
   - name it `Dockerfile` and paste the contents of [deploy/huggingface/Dockerfile](../deploy/huggingface/Dockerfile) → **Commit**.
   - open the existing `README.md` → **Edit**, replace everything with [deploy/huggingface/README.md](../deploy/huggingface/README.md) → **Commit**.
4. The Space starts building (**Logs** tab). The first build takes about 10–15 minutes. When it shows **Running**, check:
   - `https://<your-username>-coronarytwin-api.hf.space/health` → `{"status":"ok","mode":"models"}`
   - `https://<your-username>-coronarytwin-api.hf.space/docs` → the API documentation

   The direct URL is shown under the Space's **⋮ menu → Embed this Space** ("Direct URL"). It is all lowercase.

## 2. Website on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New… → Project**.
2. **Import** the `CoronaryTwin` repository.
3. Set **Root Directory** to `web` (click *Edit* next to it). Vercel detects **Vite**; leave the build settings as they are
   (`web/vercel.json` sets them).
4. Under **Environment Variables** add:

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | your Space's direct URL, e.g. `https://<your-username>-coronarytwin-api.hf.space` (no trailing `/`) |

5. Click **Deploy**. You get a URL like `https://coronarytwin.vercel.app`.

## 3. Connect them (allow the website on the API)

The API only answers websites it knows. In the Hugging Face Space: **Settings → Variables and secrets → New variable**:

| Name | Value |
|---|---|
| `CORONARYTWIN_CORS_ORIGINS` | your Vercel URL, e.g. `https://coronarytwin.vercel.app` (comma-separate several; no trailing `/`) |

Saving restarts the Space. Optional: to also allow Vercel preview deployments, add
`CORONARYTWIN_CORS_REGEX` = `https://coronarytwin.*\.vercel\.app`.

Open the Vercel URL: the landing page should show the live patient, and **▶ Try demo** should load the samples.

## Updating

- **Website:** every push to `main` on GitHub redeploys Vercel automatically.
- **API:** the Space builds from GitHub, so after pushing, open the Space **Settings → Factory rebuild**.
- Changing `VITE_API_BASE` needs a Vercel **Redeploy** (it is built into the website).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Website says the API is offline | The free Space sleeps after ~48 h without visitors: open the `/health` URL and wait 1–2 minutes. Check the `VITE_API_BASE` value has no trailing `/`, then redeploy on Vercel. |
| Browser console shows a CORS error | `CORONARYTWIN_CORS_ORIGINS` must match the Vercel URL exactly (`https://`, no trailing `/`). |
| Space build fails | Open **Logs**, copy the last lines, and fix or report them. |

Other hosts: the repository's own `Dockerfile` runs the API on any Docker host and honors `$PORT` (Render, Cloud Run,
Railway); `Dockerfile.single` serves the website and API together from one container (port 7860).
