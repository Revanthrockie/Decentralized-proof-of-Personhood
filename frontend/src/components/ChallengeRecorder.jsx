import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

function bsScore(blendshapes, name) {
  return blendshapes[0]?.categories?.find((c) => c.categoryName === name)?.score ?? 0;
}

function extractAngles(matrices) {
  if (!matrices?.length) return { pitch: 0, yaw: 0 };
  const m = matrices[0].data;
  const sy = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
  if (sy < 1e-6) return { pitch: 0, yaw: 0 };
  return {
    pitch: Math.atan2(-m[2], sy) * (180 / Math.PI),
    yaw: Math.atan2(m[1], m[0]) * (180 / Math.PI),
  };
}

function makeDetector(challengeId) {
  switch (challengeId) {
    case "blink": {
      let count = 0, wasOpen = true;
      return {
        total: 2,
        getProgress: () => count,
        hint: () => `Blinks: ${count} / 2`,
        update(bs) {
          const eye = (bsScore(bs, "eyeBlinkLeft") + bsScore(bs, "eyeBlinkRight")) / 2;
          const closed = eye > 0.55;
          if (closed && wasOpen) count++;
          wasOpen = !closed;
          return count >= 2;
        },
      };
    }
    case "smile": {
      let holdStart = null;
      const holdMs = 2000;
      return {
        total: holdMs,
        getProgress: () => Math.min(holdStart ? Date.now() - holdStart : 0, holdMs),
        hint: () => (holdStart ? "Hold that smile!" : "Smile wider!"),
        update(bs) {
          const smile = (bsScore(bs, "mouthSmileLeft") + bsScore(bs, "mouthSmileRight")) / 2;
          if (smile > 0.35) { if (!holdStart) holdStart = Date.now(); }
          else holdStart = null;
          return holdStart !== null && Date.now() - holdStart >= holdMs;
        },
      };
    }
    case "mouth": {
      let phase = "waiting";
      return {
        total: 1,
        getProgress: () => (phase === "done" ? 1 : 0),
        hint: () => (phase === "open" ? "Now close it!" : "Open wide!"),
        update(bs) {
          const open = bsScore(bs, "jawOpen") > 0.5;
          if (phase === "waiting" && open) phase = "open";
          if (phase === "open" && !open) phase = "done";
          return phase === "done";
        },
      };
    }
    case "eyebrow": {
      let phase = "waiting";
      return {
        total: 1,
        getProgress: () => (phase === "done" ? 1 : 0),
        hint: () => (phase === "raised" ? "Now lower them!" : "Raise your eyebrows!"),
        update(bs) {
          const raised =
            bsScore(bs, "browInnerUp") > 0.45 &&
            (bsScore(bs, "browOuterUpLeft") + bsScore(bs, "browOuterUpRight")) / 2 > 0.2;
          if (phase === "waiting" && raised) phase = "raised";
          if (phase === "raised" && !raised) phase = "done";
          return phase === "done";
        },
      };
    }
    case "nod": {
      let count = 0, state = "neutral";
      return {
        total: 2,
        getProgress: () => count,
        hint: () => `Nods: ${count} / 2`,
        update(_bs, angles) {
          const tilted = Math.abs(angles.pitch) > 12;
          if (state === "neutral" && tilted) state = "tilted";
          if (state === "tilted" && !tilted) { count++; state = "neutral"; }
          return count >= 2;
        },
      };
    }
    case "turn": {
      let leftDone = false, rightDone = false, wasNeutral = true;
      return {
        total: 2,
        getProgress: () => (leftDone ? 1 : 0) + (rightDone ? 1 : 0),
        hint: () =>
          leftDone && rightDone
            ? "Done!"
            : leftDone || rightDone
            ? "Now turn the other way!"
            : "Turn your head side to side",
        update(_bs, angles) {
          const neutral = Math.abs(angles.yaw) < 8;
          if (wasNeutral) {
            if (angles.yaw < -15) leftDone = true;
            if (angles.yaw > 15) rightDone = true;
          }
          wasNeutral = neutral;
          return leftDone && rightDone;
        },
      };
    }
    case "lookup": {
      let phase = "waiting";
      return {
        total: 1,
        getProgress: () => (phase === "done" ? 1 : 0),
        hint: () => (phase === "up" ? "Now look down!" : "Look up!"),
        update(_bs, angles) {
          if (phase === "waiting" && angles.pitch > 15) phase = "up";
          if (phase === "up" && angles.pitch < -10) phase = "done";
          return phase === "done";
        },
      };
    }
    default:
      return null;
  }
}

export default function ChallengeRecorder({ account, backendUrl, onComplete, onError, onProcessing }) {
  const [challenge, setChallenge] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | detecting | submitting
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(1);
  const [hint, setHint] = useState("");
  const [faceVisible, setFaceVisible] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const FLRef = useRef(null); // FaceLandmarker class
  const DURef = useRef(null); // DrawingUtils class
  const drawingUtilsRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const submitRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const loadMP = async () => {
      const { FaceLandmarker, FilesetResolver, DrawingUtils } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO",
        numFaces: 1,
      });
      if (!cancelled) {
        landmarkerRef.current = landmarker;
        FLRef.current = FaceLandmarker;
        DURef.current = DrawingUtils;
      }
    };

    const fetchChallenge = async () => {
      const res = await axios.get(`${backendUrl}/challenge`);
      if (!cancelled) {
        setChallenge(res.data);
        const det = makeDetector(res.data.id);
        detectorRef.current = det;
        if (det) setTotal(det.total);
      }
    };

    Promise.all([loadMP(), fetchChallenge()])
      .then(() => { if (!cancelled) setStatus("ready"); })
      .catch(() => { if (!cancelled) onError("Setup failed. Check your connection and refresh."); });

    return () => { cancelled = true; };
  }, [backendUrl, onError]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    drawingUtilsRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Keep submitRef pointing at latest handleSubmit
  const handleSubmit = useCallback(async () => {
    onProcessing();
    try {
      const form = new FormData();
      form.append("wallet_address", account);
      form.append("challenge", challenge?.id ?? "unknown");
      const res = await axios.post(`${backendUrl}/verify`, form);
      onComplete(res.data);
    } catch (err) {
      onError(err.response?.data?.detail || "Verification failed. Please try again.");
      setStatus("ready");
      doneRef.current = false;
    }
  }, [account, backendUrl, challenge, onComplete, onError, onProcessing]);

  useEffect(() => { submitRef.current = handleSubmit; }, [handleSubmit]);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    const detector = detectorRef.current;

    if (!video || !canvas || !landmarker || doneRef.current) return;
    if (video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(runLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");

    // Draw raw video (CSS mirrors it)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Init DrawingUtils once per session
    if (!drawingUtilsRef.current && DURef.current) {
      drawingUtilsRef.current = new DURef.current(ctx);
    }

    const results = landmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks?.length > 0) {
      setFaceVisible(true);
      const lm = results.faceLandmarks[0];
      const bs = results.faceBlendshapes ?? [];
      const angles = extractAngles(results.facialTransformationMatrixes);
      const du = drawingUtilsRef.current;
      const FL = FLRef.current;

      if (du && FL) {
        du.drawConnectors(lm, FL.FACE_LANDMARKS_TESSELATION, { color: "#30304035", lineWidth: 1 });
        du.drawConnectors(lm, FL.FACE_LANDMARKS_LEFT_EYE, { color: "#818CF8", lineWidth: 2 });
        du.drawConnectors(lm, FL.FACE_LANDMARKS_RIGHT_EYE, { color: "#818CF8", lineWidth: 2 });
        du.drawConnectors(lm, FL.FACE_LANDMARKS_LIPS, { color: "#C4B5FD", lineWidth: 2 });
      }

      if (detector) {
        const done = detector.update(bs, angles);
        setProgress(detector.getProgress());
        setHint(detector.hint());

        if (done && !doneRef.current) {
          doneRef.current = true;
          setStatus("submitting");
          stopCamera();
          submitRef.current?.();
          return;
        }
      }
    } else {
      setFaceVisible(false);
      setHint("No face detected — look at the camera");
    }

    rafRef.current = requestAnimationFrame(runLoop);
  }, [stopCamera]);

  const startDetection = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      doneRef.current = false;
      setProgress(0);
      setHint("");
      setStatus("detecting");
      rafRef.current = requestAnimationFrame(runLoop);
    } catch {
      onError("Camera access denied. Please allow camera access.");
    }
  }, [runLoop, onError]);

  const progressPct = Math.min((progress / total) * 100, 100);
  const isFullscreen = status === "detecting" || status === "submitting";

  return (
    <>
      {/* Card — always in DOM */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
        <h2 className="text-xl font-bold text-white mb-1">Liveness Verification</h2>
        <p className="text-gray-500 text-sm mb-6">Perform the challenge — detection runs live on your device.</p>

        {challenge && (
          <div className="bg-indigo-950 border border-indigo-800 rounded-xl p-4 mb-6 flex items-start gap-3">
            <span className="text-2xl mt-0.5">🎯</span>
            <div>
              <div className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Your Challenge</div>
              <div className="text-white font-medium">{challenge.text}</div>
            </div>
          </div>
        )}

        <div className="relative bg-gray-950 rounded-xl overflow-hidden mb-4 aspect-video flex flex-col items-center justify-center text-gray-500">
          {status === "loading" ? (
            <>
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-sm">Loading face detection…</span>
            </>
          ) : (
            <>
              <span className="text-5xl mb-2">📷</span>
              <span className="text-sm">Camera opens fullscreen when you start</span>
            </>
          )}
        </div>

        {status === "ready" && (
          <button
            onClick={startDetection}
            disabled={!challenge}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors"
          >
            Start Verification
          </button>
        )}

        <p className="text-xs text-gray-600 text-center mt-4">
          Face detection runs entirely on your device. No video is sent anywhere.
        </p>
      </div>

      {/* Single video + canvas — always in DOM so refs are stable, positioned fullscreen when active */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas
        ref={canvasRef}
        className={isFullscreen ? "fixed inset-0 w-full h-full z-50 bg-black object-cover" : "hidden"}
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Fullscreen HUD overlay — on top of canvas */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col pointer-events-none">
          {/* Challenge label */}
          <div className="px-6 pt-10 pointer-events-auto">
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-3 inline-flex items-center gap-3">
              <span className="text-xl">🎯</span>
              <span className="text-white font-medium text-sm">{challenge?.text}</span>
            </div>
          </div>

          {/* Bottom HUD */}
          <div className="mt-auto px-6 pb-12 pointer-events-auto">
            {status === "detecting" && (
              <>
                <div className="flex justify-between text-sm mb-3">
                  <span className={faceVisible ? "text-green-400 font-semibold" : "text-yellow-400 font-semibold"}>
                    {faceVisible ? "✓ Face detected" : "⚠ Look at the camera"}
                  </span>
                  <span className="text-white/80">{hint}</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-2.5 mb-6">
                  <div
                    className="bg-indigo-400 h-2.5 rounded-full transition-all duration-150"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <button
                  onClick={() => { stopCamera(); setStatus("ready"); doneRef.current = false; }}
                  className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-4 rounded-xl transition-colors backdrop-blur-sm border border-white/20"
                >
                  Cancel
                </button>
              </>
            )}

            {status === "submitting" && (
              <div className="text-center">
                <div className="text-7xl mb-4">✅</div>
                <div className="text-white font-bold text-2xl mb-2">Challenge complete!</div>
                <div className="text-gray-300 text-sm">Minting your Soulbound Token…</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
