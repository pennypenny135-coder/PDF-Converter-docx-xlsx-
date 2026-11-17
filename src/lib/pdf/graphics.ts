/**
 * Extract drawn rule lines and image placements from a PDF.js operator list.
 *
 * Pure function (no pdfjs import) so it can be unit-tested with synthetic
 * operator lists.
 *
 * Coordinate handling:
 *   Path coordinates are in the *current user space*, i.e. they must be multiplied
 *   by the CTM (current transformation matrix, maintained with save/restore/
 *   transform/paintFormXObjectBegin operators) and then by the viewport
 *   transform (which flips y so that the origin is top-left).
 *
 * Path buffer format (PDF.js ≥ 4): a flat Float32Array of
 *   [0, x, y]                 moveTo
 *   [1, x, y]                 lineTo
 *   [2, x1,y1, x2,y2, x,y]    curveTo
 *   [3, x1,y1, x,y]           quadraticCurveTo
 *   [4]                       closePath
 * `re` (rectangle) is emitted as moveTo + 3×lineTo + closePath (or a 2-point line when
 * width or height is 0).
 */
import { applyMatrix, multiply, type Matrix } from "../coords";
import type { Rect, RuleLine } from "../types";

export interface OpsTable {
  save: number;
  restore: number;
  transform: number;
  setLineWidth: number;
  constructPath: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
}

export interface GraphicsResult {
  rules: RuleLine[];
  images: Rect[];
}

type Pt = [number, number];
interface SubPath {
  pts: Pt[];
  closed: boolean;
  curved: boolean;
}

const MAX_FILL_RULE_THICKNESS = 2.6; // filled rectangles thinner than this are treated as lines
const MIN_RULE_LENGTH = 4;
const AXIS_TOLERANCE = 0.6;

function parsePath(buf: ArrayLike<number>, m: Matrix): SubPath[] {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let i = 0;
  while (i < buf.length) {
    const cmd = buf[i++];
    if (cmd === 0) {
      cur = { pts: [applyMatrix(m, buf[i], buf[i + 1])], closed: false, curved: false };
      subs.push(cur);
      i += 2;
    } else if (cmd === 1) {
      if (!cur) {
        cur = { pts: [], closed: false, curved: false };
        subs.push(cur);
      }
      cur.pts.push(applyMatrix(m, buf[i], buf[i + 1]));
      i += 2;
    } else if (cmd === 2) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(applyMatrix(m, buf[i + 4], buf[i + 5]));
      }
      i += 6;
    } else if (cmd === 3) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(applyMatrix(m, buf[i + 2], buf[i + 3]));
      }
      i += 4;
    } else if (cmd === 4) {
      if (cur) cur.closed = true;
    } else {
      break; // unknown command — stop rather than mis-parse
    }
  }
  return subs;
}

function makeRule(a: Pt, b: Pt, thickness: number): RuleLine | null {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  if (dy <= AXIS_TOLERANCE && dx >= MIN_RULE_LENGTH) {
    const y = (a[1] + b[1]) / 2;
    return { orientation: "h", x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: y, y1: y, thickness };
  }
  if (dx <= AXIS_TOLERANCE && dy >= MIN_RULE_LENGTH) {
    const x = (a[0] + b[0]) / 2;
    return { orientation: "v", x0: x, x1: x, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), thickness };
  }
  return null;
}

function bboxOf(pts: Pt[]): Rect {
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
}

export function extractGraphics(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<any>,
  ops: OpsTable,
  viewportTransform: Matrix,
): GraphicsResult {
  const rules: RuleLine[] = [];
  const images: Rect[] = [];

  let ctm: Matrix = viewportTransform; // user space -> page points (top-left origin)
  const stack: Matrix[] = [];
  let lineWidth = 1;

  const strokeOps = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const fillOps = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);

  // average scale of the CTM → effective stroke width in page points
  const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  for (let k = 0; k < fnArray.length; k++) {
    const fn = fnArray[k];
    const args = argsArray[k];

    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      ctm = multiply(ctm, args as Matrix);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args && args[0]) ctm = multiply(ctm, args[0] as Matrix);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.setLineWidth) {
      lineWidth = Number(args?.[0]) || 1;
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      // images are painted into the unit square transformed by the CTM
      const corners = [applyMatrix(ctm, 0, 0), applyMatrix(ctm, 1, 0), applyMatrix(ctm, 0, 1), applyMatrix(ctm, 1, 1)];
      images.push(bboxOf(corners));
    } else if (fn === ops.constructPath) {
      const paintOp: number = args?.[0];
      const buf = args?.[1]?.[0];
      if (!buf || !(strokeOps.has(paintOp) || fillOps.has(paintOp))) continue;
      const subs = parsePath(buf, ctm);
      const thickness = lineWidth * scaleOf(ctm);

      for (const sp of subs) {
        if (sp.curved || sp.pts.length < 2) continue;
        const pts = sp.pts;

        if (strokeOps.has(paintOp)) {
          for (let i = 0; i < pts.length - 1; i++) {
            const r = makeRule(pts[i], pts[i + 1], thickness);
            if (r) rules.push(r);
          }
          if (sp.closed || paintOp === ops.closeStroke || paintOp === ops.closeFillStroke || paintOp === ops.closeEOFillStroke) {
            const r = makeRule(pts[pts.length - 1], pts[0], thickness);
            if (r) rules.push(r);
          }
        } else if (fillOps.has(paintOp) && pts.length >= 4) {
          // A thin filled rectangle is how many generators draw table borders.
          const bb = bboxOf(pts);
          const w = bb.x1 - bb.x0;
          const h = bb.y1 - bb.y0;
          if (h <= MAX_FILL_RULE_THICKNESS && w >= MIN_RULE_LENGTH * 2) {
            const y = (bb.y0 + bb.y1) / 2;
            rules.push({ orientation: "h", x0: bb.x0, x1: bb.x1, y0: y, y1: y, thickness: Math.max(h, 0.25) });
          } else if (w <= MAX_FILL_RULE_THICKNESS && h >= MIN_RULE_LENGTH * 2) {
            const x = (bb.x0 + bb.x1) / 2;
            rules.push({ orientation: "v", x0: x, x1: x, y0: bb.y0, y1: bb.y1, thickness: Math.max(w, 0.25) });
          }
        }
      }
    }
  }
  return { rules, images };
}
