const DEFAULT_OPTIONS = {
  size: 256,
  frequency: 0.035,
  sigma: 52,
  contrast: 0.9,
  phase: 0,
  orientation: 0,
  aspectRatio: 1,
  background: 127,
  alphaEnvelope: true,
  alphaThreshold: 0.035,
};

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function createGaborPatchOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
  };
}

export function drawGaborPatch(canvas, options = {}) {
  if (!canvas) {
    return null;
  }

  const settings = createGaborPatchOptions(options);
  const {
    size,
    frequency,
    sigma,
    contrast,
    phase,
    orientation,
    aspectRatio,
    background,
    alphaEnvelope,
    alphaThreshold,
  } = settings;

  const width = size;
  const height = size;
  const radians = (orientation * Math.PI) / 180;
  const cosTheta = Math.cos(radians);
  const sinTheta = Math.sin(radians);
  const center = (size - 1) / 2;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('2D canvas context indisponibil.');
  }

  const imageData = context.createImageData(width, height);
  const { data } = imageData;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const translatedX = x - center;
      const translatedY = y - center;

      const rotatedX = translatedX * cosTheta + translatedY * sinTheta;
      const rotatedY = -translatedX * sinTheta + translatedY * cosTheta;

      const gaussianEnvelope = Math.exp(
        -(
          (rotatedX * rotatedX + (aspectRatio * aspectRatio) * rotatedY * rotatedY) /
          (2 * sigma * sigma)
        )
      );

      const sinusoidalCarrier = Math.cos(2 * Math.PI * frequency * rotatedX + phase);
      const luminance = background + 127 * contrast * gaussianEnvelope * sinusoidalCarrier;
      const channel = clampChannel(luminance);
      const envelopeAlpha =
        alphaEnvelope && gaussianEnvelope < alphaThreshold ? 0 : gaussianEnvelope;
      const alpha = alphaEnvelope ? clampChannel(255 * envelopeAlpha) : 255;

      const pixelIndex = (y * width + x) * 4;
      data[pixelIndex] = channel;
      data[pixelIndex + 1] = channel;
      data[pixelIndex + 2] = channel;
      data[pixelIndex + 3] = alpha;
    }
  }

  context.putImageData(imageData, 0, 0);
  return settings;
}
