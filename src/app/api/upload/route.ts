import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';

const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_SHEET_ROWS = 10_000;
const MAX_SHEET_COLUMNS = 100;

function isAllowedSpreadsheetFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const contentType = file.type.split(';', 1)[0].toLowerCase();
  const genericType = !contentType || contentType === 'application/octet-stream';

  if (fileName.endsWith('.xlsx')) {
    return genericType || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (fileName.endsWith('.xls')) {
    return genericType || contentType === 'application/vnd.ms-excel';
  }
  if (fileName.endsWith('.csv')) {
    return genericType || contentType === 'text/csv' || contentType === 'application/vnd.ms-excel';
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: '没有上传文件' },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: '上传文件为空' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: '文件不能超过 5MB' }, { status: 413 });
    }
    if (!isAllowedSpreadsheetFile(file)) {
      return NextResponse.json(
        { error: '只支持 Excel (.xlsx, .xls) 或 CSV (.csv) 文件' },
        { status: 400 }
      );
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', sheetRows: MAX_SHEET_ROWS + 2 });

    // 获取第一个工作表
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!sheetName || !worksheet) {
      return NextResponse.json({ error: '文件中没有可读取的工作表' }, { status: 400 });
    }

    // 转换为 JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    if (data.length > MAX_SHEET_ROWS + 1) {
      return NextResponse.json({ error: `单个文件最多支持 ${MAX_SHEET_ROWS} 行数据` }, { status: 413 });
    }

    if (data.length < 2) {
      return NextResponse.json(
        { error: '文件数据不足，至少需要一行表头和一行数据' },
        { status: 400 }
      );
    }

    // 第一行作为表头
    const headers = (data[0] as string[]).map(h => String(h).trim());
    if (headers.length === 0 || headers.length > MAX_SHEET_COLUMNS) {
      return NextResponse.json({ error: `表格列数必须在 1 到 ${MAX_SHEET_COLUMNS} 之间` }, { status: 400 });
    }
    if (headers.some((header) => !header)) {
      return NextResponse.json({ error: '表头不能为空' }, { status: 400 });
    }
    
    // 数据行
    const rows = data.slice(1);

    // 转换为对象数组
    const result = rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, colIdx) => {
        const value = row[colIdx];
        if (value !== undefined && value !== null) {
          obj[header] = String(value).trim();
        } else {
          obj[header] = '';
        }
      });
      return obj;
    }).filter(row => Object.values(row).some(v => v && v.trim()));

    return NextResponse.json({
      success: true,
      fileName: file.name,
      rowCount: result.length,
      headers,
      data: result
    });

  } catch (error) {
    console.error('Error parsing file:', error);
    return NextResponse.json(
      { error: '文件解析失败，请确认文件没有损坏且格式正确' },
      { status: 500 }
    );
  }
}
