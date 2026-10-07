import difflib
import json
import math
import os
import random
import sqlite3
import requests
from datetime import datetime, timezone
from pathlib import Path

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

# --- Anti-Sybil / multi-modal liveness config -------------------------------
# One human = one Soulbound Token is the entire point of this project, so
# instead of letting a wallet mint more than once, we detect "is this the
# same human who already holds a token, just connecting a new wallet?" via a
# lightweight on-device face descriptor, and refuse a second mint if so.
# This can be switched off for local rehearsal; keep it on for the real demo.
ENABLE_FACE_DEDUP = os.getenv("ENABLE_FACE_DEDUP", "true").lower() == "true"
# Lets the team wipe the local face registry between rehearsal runs. Off by
# default — flip it on only on your own dev machine, never in a real deploy.
ALLOW_DEMO_RESET = os.getenv("ALLOW_DEMO_RESET", "false").lower() == "true"
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.93"))
AUDIO_MATCH_THRESHOLD = float(os.getenv("AUDIO_MATCH_THRESHOLD", "0.65"))

REGISTRY_DB_PATH = Path(__file__).parent / "pop_registry.db"

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

# Random sentences for the voice-liveness challenge. Kept short (under ~12
# words) so reading them aloud takes a few seconds, and varied in wording so
# a pre-recorded clip from a different challenge won't pass by accident.
AUDIO_SENTENCES = [
    {"id": "s1", "text": "The quick brown fox jumps over the lazy dog near the river."},
    {"id": "s2", "text": "Blockchain technology enables secure and transparent digital identity."},
    {"id": "s3", "text": "Please verify that I am a real human being right now."},
    {"id": "s4", "text": "Sunlight filtered gently through the tall green trees today."},
    {"id": "s5", "text": "Proof of personhood protects online systems from fake accounts."},
    {"id": "s6", "text": "A gentle breeze moved softly across the quiet morning field."},
    {"id": "s7", "text": "My voice and my face together confirm that I am unique."},
    {"id": "s8", "text": "Honesty and curiosity are the foundation of good engineering."},
]


# --- Local registry (SQLite) -------------------------------------------------
# Stores only a geometric face descriptor (a vector of normalized distances
# between facial landmarks) per wallet — never a photo, video, or audio
# recording. Used solely to answer "has this face already claimed a token?".

def get_registry_db():
    conn = sqlite3.connect(REGISTRY_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS face_registry (
            wallet_address TEXT PRIMARY KEY,
            embedding      TEXT NOT NULL,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    return conn


def _normalize_text(text: str) -> str:
    return "".join(ch.lower() for ch in text if ch.isalnum() or ch.isspace()).strip()


def _text_similarity(spoken: str, expected: str) -> float:
    """Fuzzy match ratio (0-1) between what was transcribed and the prompted
    sentence. Tolerant of small ASR mistakes but not a blank/garbage answer."""
    return difflib.SequenceMatcher(None, _normalize_text(spoken), _normalize_text(expected)).ratio()


def _cosine_similarity(a, b):
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _find_face_match(embedding):
    """Returns (wallet_address, similarity) for the closest registered face
    at/above FACE_MATCH_THRESHOLD, or None if nobody matches closely enough."""
    conn = get_registry_db()
    rows = conn.execute("SELECT wallet_address, embedding FROM face_registry").fetchall()
    conn.close()
    best = None
    for wallet, embedding_json in rows:
        try:
            stored = json.loads(embedding_json)
        except json.JSONDecodeError:
            continue
        similarity = _cosine_similarity(embedding, stored)
        if similarity >= FACE_MATCH_THRESHOLD and (best is None or similarity > best[1]):
            best = (wallet, similarity)
    return best


def _register_face(wallet_address: str, embedding) -> None:
    conn = get_registry_db()
    conn.execute(
        "INSERT INTO face_registry (wallet_address, embedding) VALUES (?, ?) "
        "ON CONFLICT(wallet_address) DO UPDATE SET embedding = excluded.embedding",
        (wallet_address, json.dumps(embedding)),
    )
    conn.commit()
    conn.close()


@app.get("/")
def root():
    return {"status": "ok", "service": "Proof of Personhood API"}


@app.get("/challenge")
def get_challenge():
    c = random.choice(CHALLENGES)
    return {"id": c["id"], "text": c["text"]}


@app.get("/challenge/audio")
def get_audio_challenge():
    s = random.choice(AUDIO_SENTENCES)
    return {"id": s["id"], "text": s["text"]}


@app.post("/verify")
async def verify(
    wallet_address: str = Form(...),
    challenge: str = Form(...),
    audio_sentence_id: str = Form(None),
    audio_transcript: str = Form(None),
    face_embedding: str = Form(None),  # JSON-encoded list of floats, see faceEmbedding.js
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

    # --- Voice liveness: re-check server-side, never trust the client's own
    # match score. The client sends back what it transcribed; we re-score it
    # against the sentence we actually issued.
    audio_score = None
    if audio_sentence_id:
        expected = next((s["text"] for s in AUDIO_SENTENCES if s["id"] == audio_sentence_id), None)
        if expected is None:
            raise HTTPException(status_code=400, detail="Unknown audio challenge id")
        audio_score = _text_similarity(audio_transcript or "", expected)
        if audio_score < AUDIO_MATCH_THRESHOLD:
            raise HTTPException(
                status_code=400,
                detail=f"Voice verification failed (transcript matched {audio_score:.0%} of the "
                       f"prompted sentence). Please read it clearly and try again.",
            )

    # --- Anti-Sybil face check: same human, different wallet? -------------
    embedding = None
    if face_embedding:
        try:
            embedding = json.loads(face_embedding)
        except json.JSONDecodeError:
            embedding = None

    face_match = _find_face_match(embedding) if (ENABLE_FACE_DEDUP and embedding) else None
    if face_match and face_match[0] != wallet_address:
        matched_wallet, similarity = face_match
        raise HTTPException(
            status_code=409,
            detail=f"A Soulbound Token already exists for this face "
                   f"({matched_wallet[:6]}…{matched_wallet[-4:]}, {similarity:.0%} match). "
                   f"Proof of Personhood issues one token per unique human — connect that "
                   f"wallet instead, or use the recovery flow if you've lost access to it.",
        )

    # Liveness verified client-side via MediaPipe on-device face detection
    # (+ voice sentence match above, re-verified server-side).
    ipfs_uri = _pin_metadata_to_ipfs(wallet_address, challenge)

    tx_hash = None
    if CONTRACT_ADDRESS and PRIVATE_KEY:
        tx_hash = _mint_sbt(wallet_address, ipfs_uri)

    if embedding and ENABLE_FACE_DEDUP:
        _register_face(wallet_address, embedding)

    explanation = f"Liveness verified on-device via MediaPipe face detection. Challenge completed: {challenge}."
    if audio_score is not None:
        explanation += f" Voice challenge passed ({audio_score:.0%} transcript match)."

    return {
        "success": True,
        "verified": True,
        "message": "Verification passed! Soulbound Token minted." if tx_hash else "Verification passed!",
        "ipfs_uri": ipfs_uri,
        "tx_hash": tx_hash,
        "ai_explanation": explanation,
    }


@app.post("/dev/reset-face-registry")
def reset_face_registry():
    """Rehearsal-only utility: wipes the local face-duplicate registry so the
    team can re-run the demo end-to-end without tripping their own earlier
    test mints. Disabled unless ALLOW_DEMO_RESET=true in backend/.env.
    Does NOT touch the blockchain — a wallet that already has an on-chain
    Soulbound Token still can't mint a second one; use a fresh test wallet
    for that part of a rehearsal."""
    if not ALLOW_DEMO_RESET:
        raise HTTPException(
            status_code=403,
            detail="Demo reset is disabled. Set ALLOW_DEMO_RESET=true in backend/.env "
                   "to enable it on your own rehearsal machine.",
        )
    conn = get_registry_db()
    conn.execute("DELETE FROM face_registry")
    conn.commit()
    conn.close()
    return {"success": True, "message": "Face registry cleared for rehearsal."}


@app.get("/dev/face-registry-status")
def face_registry_status():
    """Read-only: how many faces are registered, and the threshold in use —
    handy for calibrating FACE_MATCH_THRESHOLD before a demo."""
    conn = get_registry_db()
    count = conn.execute("SELECT COUNT(*) FROM face_registry").fetchone()[0]
    conn.close()
    return {
        "enabled": ENABLE_FACE_DEDUP,
        "registered_faces": count,
        "face_match_threshold": FACE_MATCH_THRESHOLD,
        "audio_match_threshold": AUDIO_MATCH_THRESHOLD,
        "demo_reset_allowed": ALLOW_DEMO_RESET,
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
