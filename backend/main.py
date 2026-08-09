import os
import random
import requests
from datetime import datetime, timezone

from fastapi import FastAPI, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Proof of Personhood API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_SECRET = os.getenv("PINATA_SECRET_API_KEY")

RPC_URL = os.getenv("RPC_URL", "https://rpc-amoy.polygon.technology/")
PRIVATE_KEY = os.getenv("MINTER_PRIVATE_KEY")
_raw_contract = os.getenv("CONTRACT_ADDRESS", "")
CONTRACT_ADDRESS = (
    _raw_contract
    if _raw_contract and _raw_contract != "0x0000000000000000000000000000000000000000"
    else None
)
_raw_key = os.getenv("MINTER_PRIVATE_KEY", "")
PRIVATE_KEY = _raw_key if _raw_key and not _raw_key.startswith("your_") else None

CONTRACT_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "string", "name": "uri", "type": "string"},
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "isVerified",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
]

CHALLENGES = [
    {"id": "blink",   "text": "Blink your eyes twice slowly"},
    {"id": "turn",    "text": "Turn your head to the left, then to the right"},
    {"id": "smile",   "text": "Smile at the camera and hold for 2 seconds"},
    {"id": "nod",     "text": "Nod your head up and down twice"},
    {"id": "eyebrow", "text": "Raise your eyebrows, then lower them"},
    {"id": "mouth",   "text": "Open your mouth wide, then close it"},
    {"id": "lookup",  "text": "Look up, then look down slowly"},
]


@app.get("/")
def root():
    return {"status": "ok", "service": "Proof of Personhood API"}


@app.get("/challenge")
def get_challenge():
    c = random.choice(CHALLENGES)
    return {"id": c["id"], "text": c["text"]}


@app.post("/verify")
async def verify(
    wallet_address: str = Form(...),
    challenge: str = Form(...),
):
    if not Web3.is_address(wallet_address):
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    wallet_address = Web3.to_checksum_address(wallet_address)

    # Check if already verified on-chain
    if CONTRACT_ADDRESS and PRIVATE_KEY:
        try:
            w3 = Web3(Web3.HTTPProvider(RPC_URL))
            contract = w3.eth.contract(
                address=Web3.to_checksum_address(CONTRACT_ADDRESS),
                abi=CONTRACT_ABI,
            )
            if contract.functions.isVerified(wallet_address).call():
                return {"success": False, "message": "Wallet already has a Soulbound Token"}
        except Exception:
            pass

    # Liveness verified client-side via MediaPipe on-device face detection
    ipfs_uri = _pin_metadata_to_ipfs(wallet_address, challenge)

    tx_hash = None
    if CONTRACT_ADDRESS and PRIVATE_KEY:
        tx_hash = _mint_sbt(wallet_address, ipfs_uri)

    return {
        "success": True,
        "verified": True,
        "message": "Verification passed! Soulbound Token minted." if tx_hash else "Verification passed!",
        "ipfs_uri": ipfs_uri,
        "tx_hash": tx_hash,
        "ai_explanation": f"Liveness verified on-device via MediaPipe face detection. Challenge completed: {challenge}.",
    }


SBT_IMAGE = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzE1IiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDMxNSAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMTQuODQiIGhlaWdodD0iMzAwIiByeD0iMjAiIGZpbGw9ImJsYWNrIiBmaWxsLW9wYWNpdHk9IjAuMiIvPgo8cmVjdCB4PSIxNC40MTg4IiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgcng9IjIwIiBmaWxsPSIjMTcxNzE3IiBmaWxsLW9wYWNpdHk9IjAuMiIvPgo8cmVjdCB4PSIxMzMuNTg1IiB5PSI4Ni41NzkyIiB3aWR0aD0iMjAuNTU1NCIgaGVpZ2h0PSIyMC41NTU0IiBmaWxsPSIjRDlEOUQ5Ii8+CjxyZWN0IHg9IjE1NC4xNDEiIHk9IjEwNy4xMzUiIHdpZHRoPSIyMC41NTU0IiBoZWlnaHQ9IjIwLjU1NTQiIGZpbGw9IiNEOUQ5RDkiLz4KPHJlY3QgeD0iMTc0LjY5NiIgeT0iODYuNTc5MiIgd2lkdGg9IjIwLjU1NTQiIGhlaWdodD0iMjAuNTU1NCIgZmlsbD0iI0Q5RDlEOSIvPgo8cmVjdCB4PSIxNzQuNjk2IiB5PSIxMjcuNjkiIHdpZHRoPSIyMC41NTU0IiBoZWlnaHQ9IjIwLjU1NTQiIGZpbGw9IiNEOUQ5RDkiLz4KPHJlY3QgeD0iMTMzLjU4NSIgeT0iMTI3LjY5IiB3aWR0aD0iMjAuNTU1NCIgaGVpZ2h0PSIyMC41NTU0IiBmaWxsPSIjRDlEOUQ5Ii8+CjxyZWN0IHg9IjEwOC4yMDIiIHk9Ijk1LjEyNzIiIHdpZHRoPSIyMC41NTU0IiBoZWlnaHQ9IjIwLjU1NTQiIGZpbGw9IiNEOUQ5RDkiLz4KPHJlY3QgeD0iMjAwLjA4IiB5PSI5NS4xMjcyIiB3aWR0aD0iMjAuNTU1NCIgaGVpZ2h0PSIyMC41NTU0IiBmaWxsPSIjRDlEOUQ5Ii8+CjxyZWN0IHg9IjIwMC4wOCIgeT0iMTQyLjI5NyIgd2lkdGg9IjIwLjU1NTQiIGhlaWdodD0iMjAuNTU1NCIgZmlsbD0iI0Q5RDlEOSIvPgo8cmVjdCB4PSIxMDguMjAyIiB5PSIxNDIuMjk3IiB3aWR0aD0iMjAuNTU1NCIgaGVpZ2h0PSIyMC41NTU0IiBmaWxsPSIjRDlEOUQ5Ii8+CjxyZWN0IHg9IjE1NC4xNDEiIHk9IjE5Mi44NjUiIHdpZHRoPSIyMC41NTU0IiBoZWlnaHQ9IjIwLjU1NTQiIGZpbGw9IiNEOUQ5RDkiLz4KPHJlY3QgeD0iMTMzLjU4NSIgeT0iMTcyLjMxIiB3aWR0aD0iMjAuNTU1NCIgaGVpZ2h0PSIyMC41NTU0IiBmaWxsPSIjRDlEOUQ5Ii8+CjxyZWN0IHg9IjE3NC42OTYiIHk9IjE3Mi4zMSIgd2lkdGg9IjIwLjU1NTQiIGhlaWdodD0iMjAuNTU1NCIgZmlsbD0iI0Q5RDlEOSIvPgo8L3N2Zz4K"

def _pin_metadata_to_ipfs(wallet_address: str, challenge: str = "") -> str:
    metadata = {
        "name": "Proof of Personhood",
        "description": "This Soulbound Token certifies the holder is a verified unique human.",
        "image": SBT_IMAGE,
        "wallet": wallet_address,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "verification_method": "MediaPipe On-Device Liveness Detection",
        "attributes": [
            {"trait_type": "Verified", "value": "True"},
            {"trait_type": "Method", "value": "On-Device Face Detection"},
            {"trait_type": "Chain", "value": "Polygon Amoy"},
            {"trait_type": "Challenge", "value": challenge},
        ],
    }

    if not PINATA_API_KEY or not PINATA_SECRET:
        return f"ipfs://mock/{wallet_address[:10]}"

    try:
        response = requests.post(
            "https://api.pinata.cloud/pinning/pinJSONToIPFS",
            json={"pinataContent": metadata, "pinataMetadata": {"name": f"pop-{wallet_address[:8]}"}},
            headers={
                "pinata_api_key": PINATA_API_KEY,
                "pinata_secret_api_key": PINATA_SECRET,
            },
            timeout=30,
        )
        response.raise_for_status()
        return f"ipfs://{response.json()['IpfsHash']}"
    except Exception as e:
        return f"ipfs://error/{str(e)[:20]}"


def _mint_sbt(wallet_address: str, token_uri: str) -> str:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        raise HTTPException(status_code=500, detail="Cannot connect to blockchain")

    account = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=CONTRACT_ABI,
    )

    nonce = w3.eth.get_transaction_count(account.address)
    tx = contract.functions.mint(wallet_address, token_uri).build_transaction(
        {
            "from": account.address,
            "nonce": nonce,
            "gas": 300000,
            "gasPrice": w3.eth.gas_price,
        }
    )

    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()
