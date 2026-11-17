/**
 * Value parsing & column type inference.
 *
 * Turns the strings found in a PDF ("(1,234.50)", "12.5%", "¥3,000", "2024年3月5日")
 * into typed values with an Excel number format, so that the exported .xlsx has
 * real numbers/dates instead of text. Anything uncertain falls back to text and
 * is reported through `ambiguous` / kind === "text" so the UI can flag it.
 */
import type { ColumnType } from "./types";
import { normalizeText } from "./text";

export type ValueKind = "empty" | "text" | "number" | "currency" | "percent" | "date";

export interface ParsedValue {
  kind: ValueKind;
  /** number (numbers, currency, percent as fraction, dates as Excel serial) */
  value?: number;
  /** Excel number format code */
  format?: string;
  currency?: string;
  negative?: boolean;
  /** day/month order could not be determined */
  ambiguous?: boolean;
}

const CURRENCY_SYMBOLS = ["US$", "USD", "EUR", "GBP", "CNY", "RMB", "JPY", "HK$", "$", "€", "£", "¥", "￥", "₩", "₹", "元"];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Excel serial number (1900 date system) for a calendar date. */
export function excelSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseDate(raw: string, order: "auto" | "MDY" | "DMY" = "auto"): ParsedValue | null {
  const s = normalizeText(raw).trim();
  let m: RegExpMatchArray | null;
  const mk = (y: number, mo: number, d: number, ambiguous = false): ParsedValue | null =>
    validDate(y, mo, d) ? { kind: "date", value: excelSerial(y, mo, d), format: "yyyy-mm-dd", ambiguous } : null;

  // 2024-03-05, 2024/3/5, 2024.03.05
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return mk(+m[1], +m[2], +m[3]);
  // 2024年3月5日 / 2024年3月5号
  if ((m = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?$/))) return mk(+m[1], +m[2], +m[3]);
  // 03/05/2024 or 5/3/24
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (order === "MDY") return mk(y, a, b);
    if (order === "DMY") return mk(y, b, a);
    if (a > 12) return mk(y, b, a);
    if (b > 12) return mk(y, a, b);
    return mk(y, a, b, a !== b); // both ≤ 12: ambiguous unless identical
  }
  // Jan 5, 2024 / January 5 2024
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return mk(+m[3], mi + 1, +m[2]);
  }
  // 5 Jan 2024
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return mk(+m[3], mi + 1, +m[1]);
  }
  return null;
}

/** Parse the numeric core ("1,234.50", "1.234,50", "1234") – returns number + decimals + whether grouping was used. */
function parseNumberCore(core: string): { n: number; decimals: number; grouped: boolean } | null {
  if (!/^\d[\d.,\s']*$|^[.,]\d+$/.test(core)) return null;
  let t = core.replace(/[\s']/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let grouped = false;
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
    grouped = true;
  } else if (lastComma >= 0) {
    // "1,234" thousands vs "1,5" decimal comma
    const after = t.length - lastComma - 1;
    const commas = (t.match(/,/g) || []).length;
    if (commas === 1 && after !== 3) decimalSep = ",";
    else grouped = true;
  } else if (lastDot >= 0) {
    const dots = (t.match(/\./g) || []).length;
    const after = t.length - lastDot - 1;
    if (dots > 1 && after === 3) grouped = true; // 1.234.567
    else decimalSep = ".";
  }
  let intPart = t;
  let frac = "";
  if (decimalSep) {
    const idx = t.lastIndexOf(decimalSep);
    intPart = t.slice(0, idx);
    frac = t.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const n = Number(`${intPart || "0"}${frac ? "." + frac : ""}`);
  if (!Number.isFinite(n)) return null;
  return { n, decimals: frac.length, grouped };
}

function numberFormat(decimals: number, grouped: boolean): string {
  const base = grouped ? "#,##0" : "0";
  return decimals > 0 ? `${base}.${"0".repeat(decimals)}` : base;
}

export function parseValue(raw: string, opts: { dateOrder?: "auto" | "MDY" | "DMY" } = {}): ParsedValue {
  const original = normalizeText(raw ?? "").trim();
  if (!original) return { kind: "empty" };

  const date = parseDate(original, opts.dateOrder ?? "auto");
  if (date) return date;

  let s = original;
  let negative = false;

  // accounting negative: (1,234.50)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // trailing minus / CR-DR style:  123-
  if (/^[\d.,\s]+-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  // leading sign (ASCII hyphen, Unicode minus, en dash)
  const lead = s.match(/^([-−–—+])\s*/);
  if (lead) {
    if (lead[1] !== "+") negative = true;
    s = s.slice(lead[0].length);
  }

  // currency symbol (prefix or suffix) — may also appear after the sign, e.g. -$5 / $-5
  let currency: string | undefined;
  for (const sym of CURRENCY_SYMBOLS) {
    if (s.toUpperCase().startsWith(sym.toUpperCase())) {
      currency = sym;
      s = s.slice(sym.length).trim();
      break;
    }
    if (s.toUpperCase().endsWith(sym.toUpperCase())) {
      currency = sym;
      s = s.slice(0, s.length - sym.length).trim();
      break;
    }
  }
  const lead2 = s.match(/^([-−–])\s*/);
  if (lead2) {
    negative = true;
    s = s.slice(lead2[0].length);
  }

  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }

  // identifiers with leading zeros (00123) or very long digit strings are text, not numbers
  if (!currency && !percent && /^0\d+$/.test(s)) return { kind: "text" };
  if (/^\d{16,}$/.test(s)) return { kind: "text" };

  const core = parseNumberCore(s);
  if (!core) return { kind: "text" };

  const sign = negative ? -1 : 1;
  const parenNeg = /^\(.*\)$/.test(original);

  if (percent) {
    return {
      kind: "percent",
      value: (sign * core.n) / 100,
      format: core.decimals > 0 ? `0.${"0".repeat(core.decimals)}%` : "0%",
      negative,
    };
  }
  if (currency) {
    const sym = currency.length <= 2 && !/^[A-Za-z]/.test(currency) ? `"${currency}"` : `"${currency} "`;
    const num = numberFormat(Math.max(core.decimals, 0), true);
    const pos = `${sym}${num}`;
    const format = parenNeg ? `${pos}_);(${pos})` : `${pos};-${pos}`;
    return { kind: "currency", value: sign * core.n, format, currency, negative };
  }
  return {
    kind: "number",
    value: sign * core.n,
    format: numberFormat(core.decimals, core.grouped) + (parenNeg ? "_);(" + numberFormat(core.decimals, core.grouped) + ")" : ""),
    negative,
  };
}

/** Infer the dominant type of a column from its (non-empty) values. */
export function inferColumnType(values: string[], dateOrder: "auto" | "MDY" | "DMY" = "auto"): Exclude<ColumnType, "auto"> {
  const counts: Record<ValueKind, number> = { empty: 0, text: 0, number: 0, currency: 0, percent: 0, date: 0 };
  for (const v of values) counts[parseValue(v, { dateOrder }).kind] += 1;
  const total = values.length - counts.empty;
  if (total === 0) return "text";
  const frac = (n: number) => n / total;
  if (frac(counts.date) >= 0.7) return "date";
  if (frac(counts.percent) >= 0.6) return "percent";
  if (frac(counts.currency) >= 0.5 && frac(counts.currency + counts.number) >= 0.7) return "currency";
  if (frac(counts.number + counts.currency) >= 0.7) return "number";
  return "text";
}

/** Does a parsed value satisfy the declared column type? Used for "Needs review". */
export function matchesType(parsed: ParsedValue, type: Exclude<ColumnType, "auto">): boolean {
  if (parsed.kind === "empty") return true;
  switch (type) {
    case "text":
      return true;
    case "number":
      return parsed.kind === "number" || parsed.kind === "currency" || parsed.kind === "percent";
    case "currency":
      return parsed.kind === "currency" || parsed.kind === "number";
    case "percent":
      return parsed.kind === "percent" || parsed.kind === "number";
    case "date":
      return parsed.kind === "date";
  }
}
