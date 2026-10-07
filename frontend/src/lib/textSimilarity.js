// Client-side text match score, used only for live UI feedback while the
// user is speaking. The backend re-scores the transcript itself against the
// sentence it actually issued before minting — this copy is never trusted
// for the security decision, only for the on-screen "match: 82%" meter.

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Dice coefficient over word sets — fast, dependency-free, tolerant of
 * word-order/ASR hiccups while still penalizing an unrelated answer.
 */
export function textSimilarity(spoken, expected) {
  const a = normalize(spoken).split(/\s+/).filter(Boolean);
  const b = normalize(expected).split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;

  const bCounts = new Map();
  for (const w of b) bCounts.set(w, (bCounts.get(w) || 0) + 1);

  let overlap = 0;
  for (const w of a) {
    const remaining = bCounts.get(w) || 0;
    if (remaining > 0) {
      overlap++;
      bCounts.set(w, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}
