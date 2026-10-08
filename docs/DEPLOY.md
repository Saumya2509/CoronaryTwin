# Deploy: API on Render, website on Vercel

Both are free and need no credit card. The API (FastAPI + models) runs on Render; the website (React + 3D) runs on
Vercel and calls the API directly. Order: **API first** (you need its URL), then the website, then allow the website on
the API.

> Free-plan limits: the Render free plan has 512 MB of memory, so **reading photos/scans of reports is turned off**
> there (PDFs with text and text files still work), and the API **sleeps after 15 minutes** without visitors (the next
> visit takes about a minute to wake it).

## 1. API on Render

1. Sign in at [render.com](https://render.com) with GitHub (no card needed).
2. Click **New +** → **Blueprint**, connect GitHub if asked, and pick the **CoronaryTwin** repository.
   Render reads [render.yaml](../render.yaml) and proposes a free web service named `coronarytwin-api`.
3. It asks for **`CORONARYTWIN_CORS_ORIGINS`**: if you do not have the Vercel URL yet, enter `http://localhost:5173`
   for now (you will change it in step 3).
4. Click **Apply**. The first build takes about 10–15 minutes (**Logs** tab). When it shows **Live**, open:
   - `https://coronarytwin-api.onrender.com/health` → `{"status":"ok","mode":"models"}`
   - `https://coronarytwin-api.onrender.com/docs` → the API documentation

   Your exact URL is shown at the top of the service page (it may have a suffix if the name was taken).

## 2. Website on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New…** → **Project**.
2. **Import** the `CoronaryTwin` repository.
3. Set **Root Directory** to `web` (click *Edit* next to it). Vercel detects **Vite**; leave the build settings as they are
   (`web/vercel.json` sets them).
4. Under **Environment Variables** add:

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | your Render URL, e.g. `https://coronarytwin-api.onrender.com` (no trailing `/`) |

5. Click **Deploy**. You get a URL like `https://coronarytwin.vercel.app`.

## 3. Connect them (allow the website on the API)

On Render, open the `coronarytwin-api` service → **Environment** → edit **`CORONARYTWIN_CORS_ORIGINS`** and set it to your
Vercel URL, e.g. `https://coronarytwin.vercel.app` (comma-separate several; no trailing `/`) → **Save, rebuild and deploy**.

Open the Vercel URL: the landing page shows the live patient, and the **CSV** button lists the ten sample patients.

## Updating

- Every push to `main` on GitHub redeploys **both** (Vercel and Render auto-deploy).
- Changing `VITE_API_BASE` needs a Vercel **Redeploy** (it is built into the website).

## Before judging

Open `https://<your-api>.onrender.com/health` a couple of minutes before, so the free API is awake.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Website says the API is offline | The API is asleep: open its `/health` URL and wait about a minute. Check `VITE_API_BASE` has no trailing `/`, then redeploy on Vercel. |
| Browser console shows a CORS error | `CORONARYTWIN_CORS_ORIGINS` on Render must match the Vercel URL exactly (`https://`, no trailing `/`). |
| Render build or start fails | Open **Logs**, copy the last lines, and fix or report them. |
| "Reading photos and scans is off on this server" | Expected on the free plan. On a plan with 1 GB or more, delete `CORONARYTWIN_OCR` and `CORONARYTWIN_OCR_WARMUP` in Render's Environment. |

## Other hosts

- The repository's [Dockerfile](../Dockerfile) runs the API on any Docker host and honors `$PORT` (Google Cloud Run,
  Railway, Fly.io). With 1 GB of memory every feature works, including photo reading.
- [Dockerfile.single](../Dockerfile.single) serves the website and the API together from one container (port 7860).
- [deploy/huggingface/](../deploy/huggingface/) runs the API as a Hugging Face Docker Space (Docker Spaces now need a
  paid Hugging Face plan).
