import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import {
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  parseSpreadsheet,
} from '@/lib/spreadsheet-parser';

function isAllowedSpreadsheetFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const contentType = file.type.split(';', 1)[0].toLowerCase();
  const genericType = !contentType || contentType === 'application/octet-stream';

  if (fileName.endsWith('.xlsx')) {
    return genericType || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (fileName.endsWith('.csv')) {
    return genericType || contentType === 'text/csv';
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
        { error: '只支持 Excel (.xlsx) 或 CSV (.csv) 文件' },
        { status: 400 }
      );
    }

    const data = await parseSpreadsheet(file.name, file);

    if (data.length < 2) {
      return NextResponse.json(
        { error: '文件数据不足，至少需要一行表头和一行数据' },
        { status: 400 }
      );
    }

    // 第一行作为表头
    const headers = data[0].map((h) => String(h).trim());
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
