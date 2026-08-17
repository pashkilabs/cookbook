/**
 * The arithmetic of turning a photograph, separated from the canvas that does it.
 *
 * **Why this is its own file.** The web suite runs in node with no DOM, and a canvas cannot be
 * exercised there — the only libraries that would fake one are native modules, which have caused
 * two outages in this repo already (§37). So the drawing stays untested until a browser runs it,
 * and everything that is *arithmetic* moves here where it can be checked.
 *
 * That is not a technicality. The two ways this goes wrong are both arithmetic: forgetting that a
 * quarter turn **swaps the canvas dimensions**, so a portrait card is drawn into a landscape box
 * and the ends are clipped off; and getting the draw offset wrong, so the image rotates about the
 * wrong point and slides out of frame. Both produce a plausible-looking JPEG of the wrong pixels —
 * which is the failure mode this whole orientation effort exists to stop, arriving through our own
 * geometry rather than through a model.
 */
export type Turn = 0 | 90 | 180 | 270;

export interface CanvasPlan {
  /** the canvas to create — dimensions swap on a quarter turn */
  canvasWidth: number;
  canvasHeight: number;
  /** the size to draw the bitmap at, before rotation */
  drawWidth: number;
  drawHeight: number;
  /** drawImage's top-left, relative to a context translated to the canvas centre */
  offsetX: number;
  offsetY: number;
  radians: number;
}

/**
 * How to draw a `width` × `height` bitmap into a canvas, scaled to fit `edge` and turned
 * `rotate` degrees clockwise.
 *
 * The context is translated to the canvas centre and rotated, so the offset is half the drawn
 * size *negated* — the image is centred on the point it turns about, which is the only
 * arrangement where a quarter turn stays in frame.
 */
export function canvasPlan(options: {
  width: number;
  height: number;
  edge: number;
  rotate: Turn;
}): CanvasPlan {
  const { width, height, edge, rotate } = options;
  const scale = Math.min(1, edge / Math.max(width, height));
  const drawWidth = Math.round(width * scale);
  const drawHeight = Math.round(height * scale);
  const quarter = rotate === 90 || rotate === 270;

  return {
    canvasWidth: quarter ? drawHeight : drawWidth,
    canvasHeight: quarter ? drawWidth : drawHeight,
    drawWidth,
    drawHeight,
    offsetX: -drawWidth / 2,
    offsetY: -drawHeight / 2,
    radians: (rotate * Math.PI) / 180,
  };
}
