import { describe, expect, it } from "vitest";
import { extractGraphics, type OpsTable } from "../pdf/graphics";
import { flipYMatrix } from "../coords";

const ops: OpsTable = {
  save: 10, restore: 11, transform: 12, setLineWidth: 2, constructPath: 91, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23,
  fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  paintImageXObject: 85, paintInlineImageXObject: 86,
};

// path buffer: moveTo(0) lineTo(1) closePath(4)
const rectPath = (x: number, y: number, w: number, h: number) => new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);

describe("extractGraphics", () => {
  const H = 800;
  const vt = flipYMatrix(H);

  it("converts a stroked rectangle into 4 rule lines with flipped y", () => {
    const g = extractGraphics([ops.constructPath], [[ops.stroke, [rectPath(100, 600, 200, 50)], null]], ops, vt);
    expect(g.rules).toHaveLength(4);
    const h = g.rules.filter((r) => r.orientation === "h").map((r) => r.y0).sort((a, b) => a - b);
    // PDF y 650 (top) → page y 150, PDF y 600 → page y 200
    expect(h).toEqual([150, 200]);
  });

  it("treats thin filled rectangles as lines and ignores big fills", () => {
    const g = extractGraphics(
      [ops.constructPath, ops.constructPath],
      [[ops.fill, [rectPath(50, 500, 300, 0.5)], null], [ops.fill, [rectPath(50, 300, 300, 80)], null]],
      ops,
      vt,
    );
    expect(g.rules).toHaveLength(1);
    expect(g.rules[0]).toMatchObject({ orientation: "h", x0: 50, x1: 350 });
  });

  it("applies the CTM from transform/save/restore", () => {
    const g = extractGraphics(
      [ops.save, ops.transform, ops.constructPath, ops.restore, ops.constructPath],
      [null, [1, 0, 0, 1, 100, 0], [ops.stroke, [new Float32Array([0, 0, 400, 1, 50, 400])], null], null, [ops.stroke, [new Float32Array([0, 0, 300, 1, 50, 300])], null]],
      ops,
      vt,
    );
    expect(g.rules[0].x0).toBe(100);
    expect(g.rules[1].x0).toBe(0); // restored
  });

  it("records image placements", () => {
    const g = extractGraphics([ops.save, ops.transform, ops.paintImageXObject, ops.restore], [null, [200, 0, 0, 100, 50, 600], ["img"], null], ops, vt);
    expect(g.images[0]).toMatchObject({ x0: 50, x1: 250, y0: 100, y1: 200 });
  });
});
