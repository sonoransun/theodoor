/**
 * export/csv.ts — RFC-4180 CSV building blocks shared by all CSV exporters.
 *
 * Pure string helpers: no I/O, no locale, no Date. Records are joined with
 * CRLF per RFC 4180 so emitted files are byte-stable across platforms.
 */

/** RFC-4180 record separator. */
export const CSV_EOL = '\r\n'

/** True if the field must be quoted under RFC 4180. */
const NEEDS_QUOTING = /[",\r\n]/

/**
 * Escape a single field per RFC 4180: wrap in double quotes iff it contains
 * a quote, comma, CR, or LF; embedded quotes are doubled.
 */
export function csvEscape(field: string): string {
  if (!NEEDS_QUOTING.test(field)) return field
  return `"${field.replaceAll('"', '""')}"`
}

/**
 * Spreadsheet-injection guard: fields beginning with `=`, `+`, `-`, or `@`
 * are prefixed with a single quote so spreadsheet apps treat them as text,
 * never as formulas. Apply to free-text columns only (names, notes) — never
 * to numeric columns, where a leading `-` is a legitimate sign.
 */
export function guardSpreadsheetInjection(field: string): string {
  const c = field.charAt(0)
  return c === '=' || c === '+' || c === '-' || c === '@' ? `'${field}` : field
}

export type CsvField = string | number | boolean | null | undefined

function fieldToString(f: CsvField): string {
  if (f === null || f === undefined) return ''
  if (typeof f === 'string') return f
  return String(f)
}

/** Render one CSV record (no trailing EOL). */
export function csvRow(fields: readonly CsvField[]): string {
  return fields.map((f) => csvEscape(fieldToString(f))).join(',')
}

/** Render a full CSV document: records joined by CRLF, with a trailing CRLF. */
export function csvDocument(rows: readonly (readonly CsvField[])[]): string {
  return rows.map(csvRow).join(CSV_EOL) + CSV_EOL
}
