function contiguousRanges(values) {
  if (!values.length) return [];
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push({ startFrame: start, endFrame: end });
    start = value;
    end = value;
  }
  ranges.push({ startFrame: start, endFrame: end });
  return ranges;
}

export function buildRetryPlan(evaluation, candidates, options = {}) {
  if (!evaluation || !Array.isArray(evaluation.failedFrames)) {
    throw new TypeError("evaluation.failedFrames must be an array");
  }
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");

  const pad = Math.max(0, Number.isInteger(options.padFrames) ? options.padFrames : 2);
  const maxAnchorDistance = Math.max(1, Number.isInteger(options.maxAnchorDistance) ? options.maxAnchorDistance : 90);
  const ranges = contiguousRanges(evaluation.failedFrames);

  return ranges.map((range) => {
    const center = (range.startFrame + range.endFrame) / 2;
    const eligible = candidates
      .filter((candidate) => Number.isInteger(candidate.frame) && candidate.score >= (options.minCandidateScore ?? 0.6))
      .map((candidate) => ({ ...candidate, distance: Math.abs(candidate.frame - center) }))
      .filter((candidate) => candidate.distance <= maxAnchorDistance)
      .sort((a, b) => a.distance - b.distance || b.score - a.score);

    const anchor = eligible[0] || null;
    return {
      startFrame: Math.max(0, range.startFrame - pad),
      endFrame: range.endFrame + pad,
      anchorFrame: anchor ? anchor.frame : null,
      anchorScore: anchor ? anchor.score : null,
      strategy: anchor ? "reinitialize" : "manual-review",
    };
  });
}
