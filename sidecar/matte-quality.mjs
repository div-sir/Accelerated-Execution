const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function scoreMatteFrame(metrics, thresholds = {}) {
  const t = {
    minCoverage: 0.002,
    maxCoverage: 0.92,
    maxAreaDrift: 0.35,
    maxCentroidJump: 0.18,
    minTemporalIoU: 0.55,
    ...thresholds,
  };

  const coverage = clamp01(metrics.coverage);
  const temporalIoU = metrics.temporalIoU == null ? 1 : clamp01(metrics.temporalIoU);
  const areaDrift = Math.max(0, Number(metrics.areaDrift) || 0);
  const centroidJump = Math.max(0, Number(metrics.centroidJump) || 0);

  const coverageScore = coverage < t.minCoverage
    ? coverage / Math.max(t.minCoverage, 1e-9)
    : coverage > t.maxCoverage
      ? Math.max(0, 1 - (coverage - t.maxCoverage) / Math.max(1 - t.maxCoverage, 1e-9))
      : 1;

  const areaScore = Math.max(0, 1 - areaDrift / Math.max(t.maxAreaDrift, 1e-9));
  const motionScore = Math.max(0, 1 - centroidJump / Math.max(t.maxCentroidJump, 1e-9));
  const overlapScore = temporalIoU >= t.minTemporalIoU
    ? 1
    : temporalIoU / Math.max(t.minTemporalIoU, 1e-9);

  const score =
    0.15 * coverageScore +
    0.30 * overlapScore +
    0.25 * areaScore +
    0.30 * motionScore;

  const reasons = [];
  if (coverage < t.minCoverage) reasons.push("coverage-too-small");
  if (coverage > t.maxCoverage) reasons.push("coverage-too-large");
  if (temporalIoU < t.minTemporalIoU) reasons.push("temporal-overlap-low");
  if (areaDrift > t.maxAreaDrift) reasons.push("area-drift-high");
  if (centroidJump > t.maxCentroidJump) reasons.push("centroid-jump-high");

  return {
    score: clamp01(score),
    pass: reasons.length === 0,
    reasons,
  };
}

export function evaluateMatteSequence(frames, options = {}) {
  if (!Array.isArray(frames)) throw new TypeError("frames must be an array");
  const passScore = options.passScore == null ? 0.72 : clamp01(options.passScore);

  const evaluated = frames.map((frame) => {
    const quality = scoreMatteFrame(frame.metrics || {}, options.thresholds);
    return {
      ...frame,
      quality: {
        ...quality,
        pass: quality.pass && quality.score >= passScore,
      },
    };
  });

  const failed = evaluated.filter((frame) => !frame.quality.pass);
  const meanScore = evaluated.length
    ? evaluated.reduce((sum, frame) => sum + frame.quality.score, 0) / evaluated.length
    : 0;

  return {
    pass: failed.length === 0,
    meanScore,
    failedFrames: failed.map((frame) => frame.frame),
    frames: evaluated,
  };
}
