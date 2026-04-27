import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '没有上传文件' },
        { status: 400 }
      );
    }

    // 检查文件类型
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
      return NextResponse.json(
        { error: '只支持 Excel (.xlsx, .xls) 或 CSV (.csv) 文件' },
        { status: 400 }
      );
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    // 获取第一个工作表
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // 转换为 JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    if (data.length < 2) {
      return NextResponse.json(
        { error: '文件数据不足，至少需要一行表头和一行数据' },
        { status: 400 }
      );
    }

    // 第一行作为表头
    const headers = (data[0] as string[]).map(h => String(h).trim());
    
    // 数据行
    const rows = data.slice(1);

    // 转换为对象数组
    const result = rows.map((row, idx) => {
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
      { error: '文件解析失败' },
      { status: 500 }
    );
  }
}
