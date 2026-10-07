# Decentralized Proof of Personhood

AI + Liveness Detection + Blockchain — VTU B.E. Project, SKIT 2025-26.

**Team 14** — Revanth, Shashank, Ajay, Chinmayee

A wallet holder proves they're a live, unique human and receives a non-transferable
NFT (Soulbound Token) as proof. **Raw video and audio never leave the device** —
only a derived face descriptor (a vector of landmark distances, used solely to
catch the same person registering twice) and a speech transcript are sent to
the backend; see [Anti-Sybil face check](#anti-sybil-face-check-one-human-one-token).

## How it works

1. User connects MetaMask wallet (Polygon Amoy Testnet)
2. Frontend fetches a random **visual** liveness challenge (e.g. "Blink twice
   slowly") — **MediaPipe Face Landmarker runs entirely on-device in the
   browser** (WASM + GPU) and confirms the action in real time. The video is
   never recorded or uploaded. While the face is tracked, the frontend also
   computes a lightweight geometric face descriptor (see
   [Anti-Sybil face check](#anti-sybil-face-check-one-human-one-token) below)
   — again, on-device.
3. The frontend then issues a random **voice** liveness challenge — a short
   sentence to read aloud. Speech is transcribed live in the browser (Web
   Speech API); the audio itself is never uploaded, only the transcript.
4. Wallet address, which visual challenge was completed, the voice transcript,
   and the face descriptor are sent to the backend. The backend **re-checks
   the voice match itself** (never trusts the client's own score) and checks
   the face descriptor against previously registered ones (see below).
5. If everything passes, FastAPI pins verification metadata to **IPFS via
   Pinata**, then mints a **Soulbound Token (EIP-5192)** to the wallet.
6. Token is non-transferable — one per wallet, enforced on-chain.

### Anti-Sybil face check: one human, one token

The entire point of a Proof-of-Personhood system is that **one human can't
hold two identities**. A wallet-only check doesn't actually guarantee that —
nothing stops the same person from connecting a second, fresh wallet and
minting again. So in addition to the on-chain per-wallet check, the backend
keeps a small local registry of face descriptors (not photos — just a vector
of normalized distances between facial landmarks) and compares a new
verification attempt against everyone already registered:

- **Same face, same wallet** → fine (idempotent; the on-chain check already
  covers this case).
- **Same face, a *different* wallet** → rejected with a clear 409 error. This
  is the system correctly catching someone trying to register twice.
- **Different face** → proceeds normally, registers the new descriptor.

This is a deliberately simple, explainable descriptor appropriate for a
prototype (see `frontend/src/lib/faceEmbedding.js`) — a production system
would use a proper deep face-recognition embedding (e.g. FaceNet/ArcFace).
Toggle it off (`ENABLE_FACE_DEDUP=false` in `backend/.env`) if you want the
old wallet-only behavior.

**"Can I just mint multiple times for testing?"** Intentionally, no — letting
one wallet mint repeatedly, or letting one face claim multiple tokens, is
exactly the Sybil attack this project exists to prevent, so we didn't wire up
a bypass for it. What you actually want for rehearsal is one of:

- **Different test wallet per run** (recommended, zero setup) — switch
  MetaMask accounts between runs. Each new wallet is a clean slate for the
  on-chain check. If `ENABLE_FACE_DEDUP=true`, use a different person's face
  too (or a mask/photo swap), otherwise the face check will correctly reject
  the second attempt — which is actually a great live demo moment to show
  off, not a bug to route around.
- **Reset the local face registry** between rehearsal runs — set
  `ALLOW_DEMO_RESET=true` in `backend/.env`, then
  `curl -X POST http://localhost:8000/dev/reset-face-registry`. This does
  **not** touch the blockchain, so a wallet that already minted on-chain
  still can't mint again through this alone — combine it with a fresh test
  wallet for a full reset. Leave `ALLOW_DEMO_RESET=false` for the real
  presentation.

Three independent services, each with one job:

| Service | Stack | Job |
|---|---|---|
| `contracts/` | Solidity + Hardhat + OpenZeppelin | Soulbound ERC-721 — blocks all transfers after mint |
| `backend/` | Python + FastAPI + web3.py | Only party allowed to mint; issues challenges, pins IPFS metadata, signs mint tx |
| `frontend/` | React + Vite + Tailwind + ethers.js | Wallet connect, on-device face + voice liveness UI, result screen |

---

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- **Google Chrome** (or another Chromium browser) — needed for live speech
  transcription in the voice challenge; other browsers fall back to a manual
  text-entry mode
- [MetaMask](https://metamask.io/) browser extension
- A webcam **and a microphone** (for the liveness steps)
- Test MATIC on Polygon Amoy — free from the faucet linked below

Run the three steps below **in order** — each one depends on the previous:
contract deploy gives you `CONTRACT_ADDRESS`, which both the backend and
frontend `.env` files need.

## Setup

### 1. Smart Contract

```bash
cd contracts
cp .env.example .env          # add PRIVATE_KEY
npm install
npm run compile
npm run deploy                # deploys to Polygon Amoy, prints CONTRACT_ADDRESS
```

Get test MATIC: https://faucet.polygon.technology/

### 2. Backend

```bash
cd backend
cp .env.example .env          # fill in all API keys
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at http://localhost:8000

### 3. Frontend

```bash
cd frontend
cp .env.example .env          # set VITE_CONTRACT_ADDRESS from step 1
npm install
npm run dev
```

Frontend runs at http://localhost:5173

Once all three are running, open http://localhost:5173, connect MetaMask, and
walk through the flow yourself.

**Note:** the backend and frontend will still run without any API keys set —
`/verify` falls back to a mock IPFS URI and skips minting so you can test the
UI end-to-end before you have real keys. Minting only actually happens once
`CONTRACT_ADDRESS` and `MINTER_PRIVATE_KEY` are set in `backend/.env`.

### Running the tests

```bash
cd backend
source venv/bin/activate      # Windows: venv\Scripts\activate
pytest -v
```

21 tests cover the voice-match scorer, the face-similarity scorer, the
anti-Sybil duplicate check, and the dev/rehearsal endpoints — all against a
temporary SQLite file and with real network calls (IPFS, blockchain) forced
off, so running them never touches your real `backend/pop_registry.db`,
Pinata account, or the actual Polygon Amoy contract.

---

## API keys needed

| Key | Where to get |
|-----|-------------|
| `PINATA_API_KEY` + `PINATA_SECRET_API_KEY` | https://pinata.cloud/ |
| `MINTER_PRIVATE_KEY` | MetaMask → export private key (use a fresh wallet) |
| `PRIVATE_KEY` (contracts) | Same wallet as MINTER |

---

## Hosting it publicly

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) — frontend on Vercel, backend on
Render, both free tiers, no code changes needed beyond what's already here.

---

## Project structure

```
proof-of-personhood/
├── contracts/              # Hardhat + Solidity
│   ├── SoulboundToken.sol
│   ├── scripts/deploy.js
│   └── hardhat.config.js
├── backend/                # FastAPI + Web3
│   ├── main.py              # challenges, /verify, anti-Sybil face check, dev endpoints
│   ├── requirements.txt
│   ├── tests/test_main.py   # pytest suite (hermetic — no real network/chain calls)
│   └── pop_registry.db      # created at runtime; git-ignored, never committed
└── frontend/                # React + Vite + Tailwind + ethers.js
    └── src/
        ├── App.jsx
        ├── lib/
        │   ├── faceEmbedding.js    # on-device geometric face descriptor
        │   └── textSimilarity.js  # live UX match-meter (backend re-scores authoritatively)
        └── components/
            ├── WalletConnect.jsx
            ├── ChallengeRecorder.jsx        # visual/gesture liveness
            ├── AudioChallengeRecorder.jsx   # voice liveness (read-aloud sentence)
            └── VerificationBadge.jsx
```
