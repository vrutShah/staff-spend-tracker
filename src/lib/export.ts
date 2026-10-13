export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCSV(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  downloadBlob(filename, new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
}

/** Excel-compatible export: HTML table saved with .xls extension. */
export function downloadExcel(filename: string, title: string, headers: string[], rows: unknown[][]) {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
<h3>${esc(title)}</h3>
<table border="1"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
  downloadBlob(filename, new Blob([html], { type: "application/vnd.ms-excel" }));
}

/** PDF/print: opens a formatted print window; user can save as PDF or print. */
export function printReport(title: string, subtitle: string, bodyHtml: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; font-weight: 500; color: #555; margin: 4px 0 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 24px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .summary td:first-child { font-weight: 500; }
  .in { color: #047857; } .out { color: #b91c1c; }
  @page { margin: 16mm; }
  .footer { font-size: 11px; color: #777; margin-top: 24px; }
</style></head><body>
<h1>${title}</h1><h2>${subtitle}</h2>
${bodyHtml}
<div class="footer">Generated on ${new Date().toLocaleString("en-IN")}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`);
  w.document.close();
}

export function tableHtml(headers: string[], rows: unknown[][], numericCols: number[] = []): string {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td class="${numericCols.includes(i) ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}
