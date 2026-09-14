/* ============================================================
   csv.js · 极简 RFC4180 CSV 解析 / 生成 / 下载
   数据集本身就是 CSV：解析后就是角色对象，导出也回流成 CSV。
   ============================================================ */

/** 解析 CSV 文本 → { columns: string[], rows: object[] } */
export function parseCSV(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let field = '';
  let record = [];
  let quoted = false;
  let i = 0;

  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => {
    if (record.length > 1 || record[0] !== '') rows.push(record);
    record = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { quoted = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushField(); pushRecord(); i += 1; continue; }
    field += ch; i += 1;
  }
  pushField();
  if (record.length > 1 || record[0] !== '') pushRecord();

  if (!rows.length) return { columns: [], rows: [] };
  const columns = rows.shift().map((c) => c.trim());
  const objects = rows.map((cells) => {
    const obj = {};
    for (let c = 0; c < columns.length; c += 1) obj[columns[c]] = cells[c] ?? '';
    return obj;
  });
  return { columns, rows: objects };
}

const escapeCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 对象数组 → CSV 文本（默认带 BOM，Excel 直接打开不乱码） */
export function toCSV(rows, columns, { bom = true } = {}) {
  const cols = columns || Object.keys(rows[0] || {});
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => escapeCell(row[c])).join(','));
  return (bom ? '\ufeff' : '') + lines.join('\r\n');
}

/** 触发浏览器下载 */
export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
