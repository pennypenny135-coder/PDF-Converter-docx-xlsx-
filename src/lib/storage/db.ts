/**
 * IndexedDB persistence (drafts + conversion history).
 *
 * Privacy: only the EXTRACTED data and settings are stored (tables, text blocks, settings).
 * The PDF file itself is never written to storage, and nothing is sent anywhere.
 * All functions fail soft (private mode / blocked storage → they simply do nothing).
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DetectionSettings, ExcelSettings, ExtractedTable, ImageBlock, TextBlock, WordSettings } from "../types";

export interface DraftRecord {
  key: string; // name|size|lastModified
  fileName: string;
  updatedAt: number;
  tables: ExtractedTable[];
  blocks: TextBlock[];
  images: ImageBlock[];
  selectedPages: number[];
  detection: DetectionSettings;
  excel: ExcelSettings;
  word: WordSettings;
}

export interface HistoryRecord {
  id: string;
  fileName: string;
  format: "xlsx" | "docx";
  at: number;
  detail: string;
}

interface Schema extends DBSchema {
  drafts: { key: string; value: DraftRecord };
  history: { key: string; value: HistoryRecord; indexes: { "by-time": number } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>("pdf-converter-toolkit", 1, {
      upgrade(d) {
        d.createObjectStore("drafts", { keyPath: "key" });
        const h = d.createObjectStore("history", { keyPath: "id" });
        h.createIndex("by-time", "at");
      },
    });
  }
  return dbPromise;
}

export const draftKey = (f: { name: string; size: number; lastModified: number }) => `${f.name}|${f.size}|${f.lastModified}`;

export async function saveDraft(d: DraftRecord): Promise<void> {
  try {
    await (await db()).put("drafts", d);
  } catch {
    /* ignore */
  }
}

export async function loadDraft(key: string): Promise<DraftRecord | undefined> {
  try {
    return await (await db()).get("drafts", key);
  } catch {
    return undefined;
  }
}

export async function deleteDraft(key: string): Promise<void> {
  try {
    await (await db()).delete("drafts", key);
  } catch {
    /* ignore */
  }
}

export async function addHistory(r: HistoryRecord): Promise<void> {
  try {
    await (await db()).put("history", r);
  } catch {
    /* ignore */
  }
}

export async function listHistory(limit = 20): Promise<HistoryRecord[]> {
  try {
    const all = await (await db()).getAllFromIndex("history", "by-time");
    return all.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await (await db()).clear("history");
  } catch {
    /* ignore */
  }
}

export async function clearAllLocalData(): Promise<void> {
  try {
    const d = await db();
    await d.clear("history");
    await d.clear("drafts");
  } catch {
    /* ignore */
  }
}
