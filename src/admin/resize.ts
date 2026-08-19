/**
 * Resizing, which is the FIRST lever and the one that matters most.
 *
 * Not shipping 6000px into an 800px cell is worth megabytes; quality is the second lever and
 * worth kilobytes. Kept apart from the encoder because it is pure geometry — it decides how
 * many pixels there are, never how they are compressed.
 */

export function fit(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Progressive halving before the final draw.
 *
 * A single `drawImage` from 6000px to 400px is a 15x reduction, and the browser's filter
 * samples too sparsely at that ratio — fine detail aliases into shimmer, which on a
 * photography portfolio reads as a bad photograph rather than a bad resize. Halving until
 * within 2x keeps every step inside the filter's competence.
 */
export function downscale(
  source: ImageBitmap | OffscreenCanvas,
  targetWidth: number,
  targetHeight: number,
  colorSpace: PredefinedColorSpace,
): OffscreenCanvas {
  let currentWidth = source.width;
  let currentHeight = source.height;
  let current: ImageBitmap | OffscreenCanvas = source;

  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));
    const step = new OffscreenCanvas(nextWidth, nextHeight);
    const stepContext = step.getContext('2d', { colorSpace });
    if (!stepContext) throw new Error('2d context unavailable');
    stepContext.imageSmoothingEnabled = true;
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(current, 0, 0, nextWidth, nextHeight);
    current = step;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d', { colorSpace });
  if (!context) throw new Error('2d context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, 0, 0, targetWidth, targetHeight);
  return canvas;
}
