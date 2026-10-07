/**
 * RFC 4180 cell: always quoted, inner quotes doubled, line breaks kept inside the quotes.
 * Cells starting with = + - @ tab or CR get a leading apostrophe so spreadsheets do not run them as formulas.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '""';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
