# Deploying — free, two services

The project splits across two hosts, both with genuinely free tiers (no
credit card needed for either as of writing):

| Piece | Host | Why |
|---|---|---|
| `frontend/` (React + Vite) | **Vercel** | Static build + CDN, zero config, built for exactly this. |
| `backend/` (FastAPI) | **Render** | A real persistent server — needed because the anti-Sybil face registry is a local SQLite file, which needs a machine that stays running. Vercel's serverless functions don't guarantee that. |

The smart contract is already deployed to Polygon Amoy (that doesn't change —
it's not something you "host").

Do the backend first — the frontend needs its live URL.

---

## 1. Backend → Render

A `render.yaml` blueprint is already in the repo root, so Render can read it
automatically:

1. Push this repo to GitHub (if you haven't): `git push origin main`
2. Go to [render.com](https://render.com) → sign up/log in (GitHub login is easiest)
3. **New +** → **Blueprint** → connect this GitHub repo → Render detects
   `render.yaml` and proposes a `proof-of-personhood-backend` web service on
   the free plan, rooted at `backend/`
4. Before the first deploy, fill in the env vars Render will prompt for
   (anything marked `sync: false` in `render.yaml`):
   - `PINATA_API_KEY`, `PINATA_SECRET_API_KEY`
   - `MINTER_PRIVATE_KEY`
   - `CONTRACT_ADDRESS`
   - `ALLOWED_ORIGINS` — leave blank for now, you'll set it after step 2 below
5. Deploy. Render gives you a URL like
   `https://proof-of-personhood-backend.onrender.com` — copy it.

**Free-tier caveat, be upfront about this if asked:** Render's free web
service spins down after ~15 minutes of no traffic, and spins back up
(~30–50s cold start) on the next request. The face-duplicate registry
(`pop_registry.db`) lives on that instance's disk, which is not guaranteed to
survive a spin-down/spin-up cycle on the free plan — so across a long gap
between demo sessions, previously-registered faces may be forgotten. Within
one continuous session (which is what a live demo actually is), it persists
fine. For permanent persistence you'd attach Render's paid persistent disk,
or move the registry to a hosted database (e.g. a free Postgres on Render or
Neon) — not done here to keep the stack simple.

## 2. Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → sign up/log in (GitHub login is easiest)
2. **Add New** → **Project** → import this GitHub repo
3. Set **Root Directory** to `frontend` (Vercel auto-detects the Vite preset)
4. Add environment variables:
   - `VITE_CONTRACT_ADDRESS` — same address as `backend/.env`
   - `VITE_BACKEND_URL` — the Render URL from step 1 (e.g.
     `https://proof-of-personhood-backend.onrender.com`)
5. Deploy. Vercel gives you a URL like `https://your-app.vercel.app`.

## 3. Close the loop: tell the backend about the frontend's URL

CORS will otherwise block the deployed frontend from calling the backend.
Go back to the Render service → Environment → set:

```
ALLOWED_ORIGINS=https://your-app.vercel.app
```

Save — Render redeploys automatically. Local `http://localhost:5173` keeps
working too; `ALLOWED_ORIGINS` only *adds* origins, it doesn't replace the
built-in local-dev ones (see `backend/main.py`).

---

## Updating after this

Both Vercel and Render redeploy automatically on every `git push` to `main`
— that's the point of connecting them to GitHub instead of deploying
one-off from the CLI.

## Rolling back to local-only

Nothing about this changes local development — `uvicorn main:app --reload`
(backend) and `npm run dev` (frontend) still work exactly as before. The
hosted version is additive.
