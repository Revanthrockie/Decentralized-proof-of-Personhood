"""
Tests for the Proof of Personhood backend.

Run with:  pytest

These tests force CONTRACT_ADDRESS / PRIVATE_KEY off so /verify exercises the
mock-IPFS, no-mint code path (no real network or blockchain calls), and they
point the face registry at a temp SQLite file per test so runs never touch
the real pop_registry.db used by a locally running server.
"""

import json
import os
import sys

import pytest
from eth_account import Account
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import main as app_module  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Force every external dependency off so tests are hermetic: no real
    # Pinata/IPFS call, no real blockchain call, regardless of what's in
    # backend/.env on this machine.
    monkeypatch.setattr(app_module, "CONTRACT_ADDRESS", None)
    monkeypatch.setattr(app_module, "PRIVATE_KEY", None)
    monkeypatch.setattr(app_module, "PINATA_API_KEY", None)
    monkeypatch.setattr(app_module, "PINATA_SECRET", None)
    monkeypatch.setattr(app_module, "REGISTRY_DB_PATH", tmp_path / "test_registry.db")
    monkeypatch.setattr(app_module, "ENABLE_FACE_DEDUP", True)
    monkeypatch.setattr(app_module, "ALLOW_DEMO_RESET", False)
    return TestClient(app_module.app)


def new_wallet():
    return Account.create().address


def make_embedding(seed):
    """A deterministic pseudo-embedding so two calls with the same seed are
    'the same face' and different seeds are clearly different faces."""
    import random
    rng = random.Random(seed)
    return [rng.uniform(0, 2) for _ in range(45)]


# --------------------------------------------------------------------------
# Basic endpoints
# --------------------------------------------------------------------------

def test_root(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_visual_challenge(client):
    resp = client.get("/challenge")
    assert resp.status_code == 200
    body = resp.json()
    assert "id" in body and "text" in body


def test_audio_challenge(client):
    resp = client.get("/challenge/audio")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"].startswith("s")
    assert len(body["text"].split()) > 3


# --------------------------------------------------------------------------
# Pure scoring functions
# --------------------------------------------------------------------------

def test_text_similarity_exact_match():
    score = app_module._text_similarity(
        "The quick brown fox jumps over the lazy dog near the river.",
        "The quick brown fox jumps over the lazy dog near the river.",
    )
    assert score == 1.0


def test_text_similarity_is_case_and_punctuation_tolerant():
    score = app_module._text_similarity(
        "the QUICK brown fox jumps over the lazy dog near the river",
        "The quick brown fox jumps over the lazy dog near the river.",
    )
    assert score > 0.95


def test_text_similarity_garbage_is_low():
    score = app_module._text_similarity(
        "completely unrelated words about pizza and rockets",
        "The quick brown fox jumps over the lazy dog near the river.",
    )
    assert score < app_module.AUDIO_MATCH_THRESHOLD


def test_cosine_similarity_identical_vectors():
    v = [1.0, 2.0, 3.0, 4.0]
    assert app_module._cosine_similarity(v, v) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors():
    assert app_module._cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)


def test_cosine_similarity_mismatched_length():
    assert app_module._cosine_similarity([1, 2], [1, 2, 3]) == 0.0


# --------------------------------------------------------------------------
# /verify — baseline (no audio, no embedding) still works
# --------------------------------------------------------------------------

def test_verify_without_audio_or_face_still_succeeds(client):
    wallet = new_wallet()
    resp = client.post("/verify", data={"wallet_address": wallet, "challenge": "blink"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["ipfs_uri"].startswith("ipfs://mock/")
    assert body["tx_hash"] is None


def test_verify_rejects_bad_wallet_address(client):
    resp = client.post("/verify", data={"wallet_address": "not-a-wallet", "challenge": "blink"})
    assert resp.status_code == 400


# --------------------------------------------------------------------------
# Voice liveness scoring inside /verify
# --------------------------------------------------------------------------

def test_verify_with_matching_audio_transcript_succeeds(client):
    sentence = app_module.AUDIO_SENTENCES[0]
    wallet = new_wallet()
    resp = client.post(
        "/verify",
        data={
            "wallet_address": wallet,
            "challenge": "blink",
            "audio_sentence_id": sentence["id"],
            "audio_transcript": sentence["text"],
        },
    )
    assert resp.status_code == 200
    assert "Voice challenge passed" in resp.json()["ai_explanation"]


def test_verify_with_wrong_audio_transcript_fails(client):
    sentence = app_module.AUDIO_SENTENCES[0]
    wallet = new_wallet()
    resp = client.post(
        "/verify",
        data={
            "wallet_address": wallet,
            "challenge": "blink",
            "audio_sentence_id": sentence["id"],
            "audio_transcript": "this has nothing to do with the prompt at all",
        },
    )
    assert resp.status_code == 400
    assert "Voice verification failed" in resp.json()["detail"]


def test_verify_with_unknown_audio_sentence_id(client):
    wallet = new_wallet()
    resp = client.post(
        "/verify",
        data={
            "wallet_address": wallet,
            "challenge": "blink",
            "audio_sentence_id": "does-not-exist",
            "audio_transcript": "anything",
        },
    )
    assert resp.status_code == 400


# --------------------------------------------------------------------------
# Face duplicate-detection (anti-Sybil)
# --------------------------------------------------------------------------

def test_second_wallet_same_face_is_blocked(client):
    embedding = make_embedding(seed="person-a")
    wallet_1 = new_wallet()
    wallet_2 = new_wallet()

    first = client.post(
        "/verify",
        data={
            "wallet_address": wallet_1,
            "challenge": "blink",
            "face_embedding": json.dumps(embedding),
        },
    )
    assert first.status_code == 200

    second = client.post(
        "/verify",
        data={
            "wallet_address": wallet_2,
            "challenge": "smile",
            "face_embedding": json.dumps(embedding),
        },
    )
    assert second.status_code == 409
    assert "already exists for this face" in second.json()["detail"]


def test_different_faces_both_succeed(client):
    wallet_1, wallet_2 = new_wallet(), new_wallet()

    r1 = client.post(
        "/verify",
        data={"wallet_address": wallet_1, "challenge": "blink",
              "face_embedding": json.dumps(make_embedding("person-a"))},
    )
    r2 = client.post(
        "/verify",
        data={"wallet_address": wallet_2, "challenge": "smile",
              "face_embedding": json.dumps(make_embedding("person-b"))},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200


def test_same_wallet_reverifying_same_face_is_not_blocked(client):
    wallet = new_wallet()
    embedding = make_embedding("person-a")
    for challenge in ("blink", "smile"):
        resp = client.post(
            "/verify",
            data={"wallet_address": wallet, "challenge": challenge,
                  "face_embedding": json.dumps(embedding)},
        )
        assert resp.status_code == 200


def test_face_dedup_can_be_disabled(client, monkeypatch):
    monkeypatch.setattr(app_module, "ENABLE_FACE_DEDUP", False)
    embedding = make_embedding("person-a")
    wallet_1, wallet_2 = new_wallet(), new_wallet()
    for wallet in (wallet_1, wallet_2):
        resp = client.post(
            "/verify",
            data={"wallet_address": wallet, "challenge": "blink",
                  "face_embedding": json.dumps(embedding)},
        )
        assert resp.status_code == 200  # dedup off -> both wallets allowed


# --------------------------------------------------------------------------
# Dev/rehearsal endpoints
# --------------------------------------------------------------------------

def test_dev_reset_disabled_by_default(client):
    resp = client.post("/dev/reset-face-registry")
    assert resp.status_code == 403


def test_dev_reset_when_enabled(client, monkeypatch):
    monkeypatch.setattr(app_module, "ALLOW_DEMO_RESET", True)
    embedding = make_embedding("person-a")
    client.post("/verify", data={"wallet_address": new_wallet(), "challenge": "blink",
                                  "face_embedding": json.dumps(embedding)})

    status_before = client.get("/dev/face-registry-status").json()
    assert status_before["registered_faces"] == 1

    resp = client.post("/dev/reset-face-registry")
    assert resp.status_code == 200

    status_after = client.get("/dev/face-registry-status").json()
    assert status_after["registered_faces"] == 0


def test_face_registry_status_shape(client):
    resp = client.get("/dev/face-registry-status")
    assert resp.status_code == 200
    body = resp.json()
    for key in ("enabled", "registered_faces", "face_match_threshold",
                "audio_match_threshold", "demo_reset_allowed"):
        assert key in body
