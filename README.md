# Decentralized Proof of Personhood

AI + Liveness Detection + Blockchain — VTU B.E. Project, SKIT 2025-26.

## How it works

1. User connects MetaMask wallet (Polygon Amoy Testnet)
2. Frontend fetches a random liveness challenge (e.g. "Blink twice slowly")
3. User records a short webcam video performing the challenge
4. FastAPI backend sends the video to **Gemini 1.5 Flash** for liveness analysis
5. If verified: metadata is pinned to **IPFS via Pinata**, and a **Soulbound Token (EIP-5192)** is minted to the wallet
6. Token is non-transferable — one per human

---

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

---

## API keys needed

| Key | Where to get |
|-----|-------------|
| `GEMINI_API_KEY` | https://aistudio.google.com/ |
| `PINATA_API_KEY` + `PINATA_SECRET_API_KEY` | https://pinata.cloud/ |
| `MINTER_PRIVATE_KEY` | MetaMask → export private key (use a fresh wallet) |
| `PRIVATE_KEY` (contracts) | Same wallet as MINTER |

---

## Project structure

```
proof-of-personhood/
├── contracts/          # Hardhat + Solidity
│   ├── SoulboundToken.sol
│   ├── scripts/deploy.js
│   └── hardhat.config.js
├── backend/            # FastAPI + Gemini + Web3
│   ├── main.py
│   └── requirements.txt
└── frontend/           # React + Vite + Tailwind + ethers.js
    └── src/
        ├── App.jsx
        └── components/
```
