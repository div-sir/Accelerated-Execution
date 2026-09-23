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

export function frameMetrics(gray, previous, next) {
  if (!(gray instanceof Uint8Array) || gray.length < 9) {
    throw new TypeError("gray must be a non-empty Uint8Array frame");
  }

  const pixelCount = gray.length;
  const width = 160;
  const height = Math.floor(pixelCount / width);
  if (width * height !== pixelCount || height < 3) {
    throw new RangeError("frame must contain a 160-pixel-wide grayscale image");
  }

  let sum = 0;
  let sumSquares = 0;
  let laplacianEnergy = 0;
  let gradientPixels = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    sum += gray[i];
    sumSquares += gray[i] * gray[i];
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian =
        4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width];
      laplacianEnergy += laplacian * laplacian;

      const gradient = Math.abs(gray[index + 1] - gray[index - 1]) +
        Math.abs(gray[index + width] - gray[index - width]);
      if (gradient > 48) gradientPixels += 1;
    }
  }

  const mean = sum / pixelCount;
  const variance = Math.max(0, sumSquares / pixelCount - mean * mean);
  const interiorCount = (width - 2) * (height - 2);
  const sharpness = Math.min(1, laplacianEnergy / interiorCount / 2500);
  const contrast = Math.min(1, Math.sqrt(variance) / 64);
  const exposure = Math.max(0, 1 - Math.abs(mean - 127.5) / 127.5);
  const visibility = 0.55 * exposure + 0.45 * contrast;
  const trackability = Math.min(1, (gradientPixels / interiorCount) / 0.22);

  const neighbors = [previous, next].filter(
    (frame) => frame instanceof Uint8Array && frame.length === pixelCount,
  );
  let motion = 0;
  for (const neighbor of neighbors) {
    let difference = 0;
    for (let i = 0; i < pixelCount; i += 1) difference += Math.abs(gray[i] - neighbor[i]);
    motion += difference / pixelCount / 255;
  }
  if (neighbors.length) motion /= neighbors.length;

  return {
    sharpness,
    stability: Math.max(0, 1 - motion / 0.20),
    visibility,
    trackability,
    occlusion: 0,
  };
}

export function rankCandidates(candidates, weights) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate.metrics || {}, weights),
    }))
    .sort((a, b) => b.score - a.score);
}
