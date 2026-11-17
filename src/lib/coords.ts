/**
 * Coordinate conversion + small geometry helpers.
 *
 * Three coordinate spaces are involved:
 *
 *  1. PDF USER SPACE   – origin bottom-left, y grows up. Raw operator-list and
 *                        text-item transforms live here (modified by the CTM).
 *  2. PAGE POINTS      – origin TOP-left, y grows down, 1 unit = 1/72". This is
 *                        what all of /lib uses. PDF.js' `viewport.transform` at
 *                        scale 1 maps (1) -> (2):  [1 0 0 -1 0 pageHeight] for an
 *                        unrotated page (it also handles /Rotate and CropBox).
 *  3. SCREEN PIXELS    – CSS pixels inside the on-screen page overlay. Equal to
 *                        page points multiplied by the current zoom factor.
 */
import type { Rect } from "./types";

/** 2D affine matrix in PDF notation [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Returns m1 × m2 (apply m2 first, then m1 — PDF "cm" semantics: new = m × ctm). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Viewport transform (scale 1) for an unrotated page: flips the y axis. */
export function flipYMatrix(pageHeight: number): Matrix {
  return [1, 0, 0, -1, 0, pageHeight];
}

/** Rect from two arbitrary corner points (drag in any direction). */
export function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

export const rectWidth = (r: Rect) => r.x1 - r.x0;
export const rectHeight = (r: Rect) => r.y1 - r.y0;
export const rectArea = (r: Rect) => Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r));
export const rectCenter = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

export function containsPoint(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function intersects(a: Rect, b: Rect): boolean {
  return intersection(a, b) !== null;
}

/** Fraction of `a`'s area that lies inside `b` (0..1). */
export function overlapRatio(a: Rect, b: Rect): number {
  const i = intersection(a, b);
  const area = rectArea(a);
  return i && area > 0 ? rectArea(i) / area : 0;
}

export function union(rects: Rect[]): Rect {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

export function inflate(r: Rect, pad: number): Rect {
  return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  return {
    x0: Math.max(0, Math.min(width, r.x0)),
    y0: Math.max(0, Math.min(height, r.y0)),
    x1: Math.max(0, Math.min(width, r.x1)),
    y1: Math.max(0, Math.min(height, r.y1)),
  };
}

/** Page points -> CSS pixels at a zoom factor. */
export function pageToScreen(r: Rect, zoom: number): { left: number; top: number; width: number; height: number } {
  return { left: r.x0 * zoom, top: r.y0 * zoom, width: (r.x1 - r.x0) * zoom, height: (r.y1 - r.y0) * zoom };
}

/** CSS pixels (relative to the page overlay's top-left) -> page points. */
export function screenToPage(px: number, py: number, zoom: number): [number, number] {
  return [px / zoom, py / zoom];
}

/** Points -> Word "twips" (1/20 pt). */
export const ptToTwip = (pt: number) => Math.round(pt * 20);
/** Points -> EMU (English Metric Units) used by DrawingML. */
export const ptToEmu = (pt: number) => Math.round(pt * 12700);
