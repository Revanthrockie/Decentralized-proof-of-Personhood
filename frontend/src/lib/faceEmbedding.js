// Lightweight, explainable face descriptor computed from MediaPipe's 478
// on-device face landmarks — NOT a deep-learning face-recognition embedding.
//
// We pick a handful of stable landmark points (eye corners, nose tip, mouth
// corners, chin, forehead, cheeks, brow-bridge) and encode the face as every
// pairwise distance between them, normalized by inter-ocular distance so the
// vector doesn't change just because the person moved closer to the camera.
//
// This is good enough to answer "is this roughly the same face as before?"
// for a classroom prototype's anti-Sybil check — it is intentionally simple
// and auditable rather than a black box. A production system would swap
// this for a proper deep embedding model (e.g. FaceNet/ArcFace) run
// on-device; see the README for that trade-off.

const KEY_LANDMARKS = [33, 263, 1, 61, 291, 152, 10, 234, 454, 168];

function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {Array<{x:number,y:number,z?:number}>} landmarks - MediaPipe FaceLandmarker output (468/478 points)
 * @returns {number[]|null} a fixed-length (45-dim) normalized descriptor, or null if landmarks are missing
 */
export function computeFaceEmbedding(landmarks) {
  if (!landmarks || landmarks.length < 468) return null;

  const pts = KEY_LANDMARKS.map((i) => landmarks[i]).filter(Boolean);
  if (pts.length !== KEY_LANDMARKS.length) return null;

  const interOcular = dist3(pts[0], pts[1]) || 1e-6; // right-eye-outer <-> left-eye-outer

  const vec = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      vec.push(dist3(pts[i], pts[j]) / interOcular);
    }
  }
  return vec;
}
