import ExcelJS from 'exceljs';

export const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_SHEET_ROWS = 10_000;
export const MAX_SHEET_COLUMNS = 100;

type CellValue = unknown;

function cellToText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : ''))
        .join('');
    }
    if (typeof record.text === 'string') return record.text;
    if ('result' in record) return cellToText(record.result);
    if (typeof record.hyperlink === 'string') return record.hyperlink;
  }
  return String(value);
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ',') {
      pushCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV 文件引号未闭合');
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function normalizeRows(rows: string[][]): string[][] {
  if (rows.length > MAX_SHEET_ROWS + 1) {
    throw new Error(`单个文件最多支持 ${MAX_SHEET_ROWS} 行数据`);
  }
  return rows.map((row) => {
    if (row.length > MAX_SHEET_COLUMNS) {
      throw new Error(`表格列数必须在 1 到 ${MAX_SHEET_COLUMNS} 之间`);
    }
    return row;
  });
}

export async function parseSpreadsheet(fileName: string, file: File): Promise<string[][]> {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.csv')) return normalizeRows(parseCsv(await file.text()));
  if (!lowerName.endsWith('.xlsx')) throw new Error('只支持 Excel (.xlsx) 或 CSV (.csv) 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('文件中没有可读取的工作表');

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    if (rows.length > MAX_SHEET_ROWS) return;
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (values.length > MAX_SHEET_COLUMNS) {
      throw new Error(`表格列数必须在 1 到 ${MAX_SHEET_COLUMNS} 之间`);
    }
    rows.push(values.map(cellToText));
  });
  return normalizeRows(rows);
}
