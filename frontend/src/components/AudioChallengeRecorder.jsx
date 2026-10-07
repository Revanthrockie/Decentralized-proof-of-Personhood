import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { textSimilarity } from "../lib/textSimilarity.js";

const SpeechRecognitionAPI =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const MAX_LISTEN_MS = 15000;
const PASS_THRESHOLD = 0.6; // client-side UX hint only — backend re-scores authoritatively

export default function AudioChallengeRecorder({
  account,
  backendUrl,
  visualChallengeId,
  faceEmbedding,
  onComplete,
  onError,
  onProcessing,
}) {
  const [sentence, setSentence] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | listening | review | submitting
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [manualMode, setManualMode] = useState(!SpeechRecognitionAPI);
  const [manualText, setManualText] = useState("");

  const recognitionRef = useRef(null);
  const stopTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${backendUrl}/challenge/audio`)
      .then((res) => { if (!cancelled) { setSentence(res.data); setStatus("ready"); } })
      .catch(() => { if (!cancelled) onError("Could not load the voice challenge. Check your connection and refresh."); });
    return () => { cancelled = true; };
  }, [backendUrl, onError]);

  const stopListening = useCallback(() => {
    clearTimeout(stopTimerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) { setManualMode(true); return; }

    setTranscript("");
    setInterim("");
    setStatus("listening");

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalPiece = "";
      let interimPiece = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalPiece += piece;
        else interimPiece += piece;
      }
      if (finalPiece) setTranscript((prev) => `${prev} ${finalPiece}`.trim());
      setInterim(interimPiece);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") return; // keep listening, user just paused
      setManualMode(true);
      setStatus("ready");
    };

    recognition.onend = () => {
      setStatus((s) => (s === "listening" ? "review" : s));
    };

    recognitionRef.current = recognition;
    recognition.start();

    stopTimerRef.current = setTimeout(stopListening, MAX_LISTEN_MS);
  }, [stopListening]);

  const finalTranscript = manualMode ? manualText : transcript;
  const liveScore = sentence ? textSimilarity(finalTranscript, sentence.text) : 0;

  const handleSubmit = useCallback(async () => {
    stopListening();
    onProcessing();
    setStatus("submitting");
    try {
      const form = new FormData();
      form.append("wallet_address", account);
      form.append("challenge", visualChallengeId ?? "unknown");
      form.append("audio_sentence_id", sentence.id);
      form.append("audio_transcript", finalTranscript);
      if (faceEmbedding) form.append("face_embedding", JSON.stringify(faceEmbedding));
      const res = await axios.post(`${backendUrl}/verify`, form);
      onComplete(res.data);
    } catch (err) {
      onError(err.response?.data?.detail || "Verification failed. Please try again.");
      setStatus("ready");
      setTranscript("");
      setManualText("");
    }
  }, [account, backendUrl, visualChallengeId, sentence, finalTranscript, faceEmbedding, onComplete, onError, onProcessing, stopListening]);

  const scorePct = Math.round(liveScore * 100);
  const scoreColor = liveScore >= PASS_THRESHOLD ? "text-green-400" : liveScore > 0.25 ? "text-yellow-400" : "text-gray-500";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
      <h2 className="text-xl font-bold text-white mb-1">Voice Verification</h2>
      <p className="text-gray-500 text-sm mb-6">Read the sentence below out loud — transcription runs live in your browser.</p>

      {sentence && (
        <div className="bg-indigo-950 border border-indigo-800 rounded-xl p-4 mb-6 flex items-start gap-3">
          <span className="text-2xl mt-0.5">🗣️</span>
          <div>
            <div className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Read this aloud</div>
            <div className="text-white font-medium">{sentence.text}</div>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center py-10 text-gray-500">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <span className="text-sm">Loading voice challenge…</span>
        </div>
      )}

      {!manualMode && status === "ready" && (
        <button
          onClick={startListening}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          🎙️ Start Recording
        </button>
      )}

      {!manualMode && (status === "listening" || status === "review") && (
        <div>
          <div className="bg-gray-950 rounded-xl p-4 mb-4 min-h-[72px] text-sm">
            <span className="text-white">{transcript}</span>{" "}
            <span className="text-gray-500 italic">{interim}</span>
            {!transcript && !interim && <span className="text-gray-600">Listening…</span>}
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-500">Transcript match</span>
            <span className={`font-semibold ${scoreColor}`}>{scorePct}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 mb-5">
            <div
              className={`h-2 rounded-full transition-all duration-150 ${liveScore >= PASS_THRESHOLD ? "bg-green-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(scorePct, 100)}%` }}
            />
          </div>

          <div className="flex gap-3">
            {status === "listening" && (
              <button
                onClick={stopListening}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-xl transition-colors border border-white/20"
              >
                Stop
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!finalTranscript}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Submit &amp; Mint
            </button>
          </div>
          <button
            onClick={() => { stopListening(); setTranscript(""); setInterim(""); setStatus("ready"); }}
            className="w-full text-gray-500 hover:text-gray-300 text-xs mt-3"
          >
            Retry
          </button>
        </div>
      )}

      {manualMode && (
        <div>
          <p className="text-xs text-yellow-500/80 mb-3">
            Live speech recognition isn't available in this browser (try Chrome). Type what the sentence says instead —
            this is a lower-assurance fallback, used only so the demo doesn't get stuck.
          </p>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={3}
            placeholder="Type the sentence you read aloud…"
            className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white text-sm mb-4 focus:outline-none focus:border-indigo-600"
          />
          <div className="flex items-center justify-between text-xs mb-4">
            <span className="text-gray-500">Match</span>
            <span className={`font-semibold ${scoreColor}`}>{scorePct}%</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!manualText.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3.5 rounded-xl transition-colors"
          >
            Submit &amp; Mint
          </button>
        </div>
      )}

      {status === "submitting" && (
        <div className="text-center py-6">
          <div className="text-5xl mb-3">✅</div>
          <div className="text-white font-semibold">Voice challenge submitted — minting…</div>
        </div>
      )}

      <p className="text-xs text-gray-600 text-center mt-4">
        Audio is transcribed live and never stored — only the match result is sent to the server.
      </p>
    </div>
  );
}
