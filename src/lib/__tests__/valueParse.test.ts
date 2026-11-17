import { describe, expect, it } from "vitest";
import { excelSerial, inferColumnType, parseValue } from "../valueParse";

describe("parseValue", () => {
  it("parses plain and grouped numbers", () => {
    expect(parseValue("1,234.50")).toMatchObject({ kind: "number", value: 1234.5, format: "#,##0.00" });
    expect(parseValue("42")).toMatchObject({ kind: "number", value: 42, format: "0" });
    expect(parseValue("1.234,56")).toMatchObject({ kind: "number", value: 1234.56 });
  });

  it("handles negative numbers in all common notations", () => {
    expect(parseValue("-5.2").value).toBe(-5.2);
    expect(parseValue("−0.4").value).toBe(-0.4); // unicode minus
    expect(parseValue("(3.1)").value).toBe(-3.1);
    expect(parseValue("12-").value).toBe(-12);
  });

  it("parses currency and keeps the symbol in the number format", () => {
    const usd = parseValue("$1,234.50");
    expect(usd.kind).toBe("currency");
    expect(usd.value).toBe(1234.5);
    expect(usd.format).toContain('"$"');
    expect(parseValue("-$45.10")).toMatchObject({ kind: "currency", value: -45.1 });
    expect(parseValue("($300.00)")).toMatchObject({ kind: "currency", value: -300 });
    expect(parseValue("¥8,000")).toMatchObject({ kind: "currency", value: 8000 });
    expect(parseValue("￥1,000.5").kind).toBe("currency"); // full-width yen
  });

  it("parses percentages as fractions", () => {
    expect(parseValue("12.5%")).toMatchObject({ kind: "percent", value: 0.125, format: "0.0%" });
    expect(parseValue("８％").value).toBeCloseTo(0.08); // full-width digits and sign
  });

  it("parses dates in several formats", () => {
    const serial = excelSerial(2024, 3, 5);
    expect(parseValue("2024-03-05")).toMatchObject({ kind: "date", value: serial });
    expect(parseValue("2024年3月5日")).toMatchObject({ kind: "date", value: serial });
    expect(parseValue("Mar 5, 2024")).toMatchObject({ kind: "date", value: serial });
    expect(parseValue("5 March 2024")).toMatchObject({ kind: "date", value: serial });
    expect(parseValue("03/15/2024")).toMatchObject({ kind: "date", ambiguous: false });
    expect(parseValue("15/03/2024")).toMatchObject({ kind: "date", ambiguous: false });
  });

  it("flags ambiguous day/month order", () => {
    expect(parseValue("03/04/2024").ambiguous).toBe(true);
    expect(parseValue("03/04/2024", { dateOrder: "DMY" }).value).toBe(excelSerial(2024, 4, 3));
    expect(parseValue("03/04/2024", { dateOrder: "MDY" }).value).toBe(excelSerial(2024, 3, 4));
  });

  it("keeps identifiers as text", () => {
    expect(parseValue("00123").kind).toBe("text");
    expect(parseValue("1234567890123456789").kind).toBe("text");
    expect(parseValue("N/A").kind).toBe("text");
    expect(parseValue("").kind).toBe("empty");
  });
});

describe("inferColumnType", () => {
  it("detects the dominant type", () => {
    expect(inferColumnType(["1", "2.5", "3,000"])).toBe("number");
    expect(inferColumnType(["$1", "$2", "3"])).toBe("currency");
    expect(inferColumnType(["1%", "2%", "3.5%"])).toBe("percent");
    expect(inferColumnType(["2024-01-01", "2024-02-01"])).toBe("date");
    expect(inferColumnType(["apple", "pear", "3"])).toBe("text");
    expect(inferColumnType([])).toBe("text");
  });

  it("tolerates a few outliers", () => {
    expect(inferColumnType(["1", "2", "3", "4", "n/a"])).toBe("number");
  });
});
