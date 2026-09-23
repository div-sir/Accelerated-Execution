export function scoreCandidate(metrics, weights = {}) {
  const w = {
    sharpness: 0.25,
    stability: 0.20,
    visibility: 0.20,
    trackability: 0.25,
    occlusion: 0.10,
    ...weights,
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  return (
    w.sharpness * clamp01(metrics.sharpness) +
    w.stability * clamp01(metrics.stability) +
    w.visibility * clamp01(metrics.visibility) +
    w.trackability * clamp01(metrics.trackability) -
    w.occlusion * clamp01(metrics.occlusion)
  );
}

export function rankCandidates(candidates, weights) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate.metrics || {}, weights),
    }))
    .sort((a, b) => b.score - a.score);
}
