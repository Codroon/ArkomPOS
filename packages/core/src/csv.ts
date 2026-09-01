/**
 * CSV for the accountant's Excel, not for a parser — ADR-0016 §6.
 *
 * Semicolon separator · decimal comma · dd/mm/yyyy · UTF-8 with a BOM · CRLF.
 *
 * Every one of those choices exists for the same reason: the file has to open
 * correctly when somebody double-clicks it on a Spanish Windows. A comma
 * separator puts the whole row in column A; a decimal point makes Excel read
 * 1234,56 as text and refuse to sum it; no BOM mangles every accent in the
 * shop's own product names. This is not what RFC 4180 describes, and RFC 4180 is
 * not what the recipient's software reads.
 */

/** Excel on Windows wants CRLF, and is the only reader this file has. */
const EOL = "\r\n";
const SEP = ";";
/** U+FEFF. Without it Excel guesses the codepage and guesses wrong. */
export const CSV_BOM = "﻿";

export type CsvValue = string | number | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  /** money in cents, a count, a date in ms, or plain text — pick the cell fn */
  cell: (row: Row) => CsvValue;
}

/** Cents → "1.234,56". No currency symbol: Excel should see a number. */
export function csvMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** A ratio like 24.6 → "24,6". Same reason as the money: it must be a number. */
export function csvNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(".", ",");
}

/** Epoch ms → "dd/mm/yyyy", the only date spelling this app uses anywhere. */
export function csvDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Epoch ms → "dd/mm/yyyy hh:mm". */
export function csvDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${csvDate(ms)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Quote a cell only when it needs it.
 *
 * A field containing the separator, a quote or a newline is wrapped and its
 * quotes doubled — the one part of RFC 4180 every reader agrees on. Everything
 * else is left bare, because a file full of unnecessary quotes is one somebody
 * eventually "fixes" with a find-and-replace.
 */
function escape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export interface CsvDocument<Row> {
  columns: ReadonlyArray<CsvColumn<Row>>;
  rows: ReadonlyArray<Row>;
  /**
   * Lines placed ABOVE the header — the report's title, its filters, and the
   * estimated-cost warning when one applies. The warning belongs in the file
   * rather than only on screen, so it cannot be lost by exporting (handoff §8).
   */
  preamble?: ReadonlyArray<string>;
}

/** The whole file as a string, BOM included. Callers write it as UTF-8. */
export function renderCsv<Row>(doc: CsvDocument<Row>): string {
  const lines: string[] = [];
  for (const line of doc.preamble ?? []) lines.push(escape(line));
  lines.push(doc.columns.map((c) => escape(c.header)).join(SEP));
  for (const row of doc.rows) {
    lines.push(doc.columns.map((c) => escape(c.cell(row))).join(SEP));
  }
  return CSV_BOM + lines.join(EOL) + EOL;
}

/** `informe-ventas-2026-09-02.csv` — sorts by name, which is how they pile up. */
export function csvFileName(slug: string, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug}-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.csv`;
}
