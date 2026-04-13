import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { loadStorageSkill } from '@/lib/storage-utils';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('company_logos')
      .select('*')
      .order('company_name');
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ logos: data });
  } catch (error) {
    console.error('Error fetching logos:', error);
    return NextResponse.json({ error: '获取 logo 列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const formData = await request.formData();
    
    const companyName = formData.get('company_name') as string;
    const logoFile = formData.get('logo') as File;
    
    if (!companyName) {
      return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
    }
    
    if (!logoFile) {
      return NextResponse.json({ error: '请选择 logo 文件' }, { status: 400 });
    }
    
    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(logoFile.type)) {
      return NextResponse.json({ error: '只支持 JPG、PNG、GIF、WebP 格式' }, { status: 400 });
    }
    
    // 验证文件大小（最大 500KB）
    if (logoFile.size > 500 * 1024) {
      return NextResponse.json({ error: 'Logo 文件不能超过 500KB' }, { status: 400 });
    }
    
    // 上传到存储
    const storageUtils = await loadStorageSkill();
    const fileName = `logos/${companyName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.${logoFile.name.split('.').pop()}`;
    const logoUrl = await storageUtils.uploadFile(logoFile, fileName);
    
    if (!logoUrl) {
      return NextResponse.json({ error: '上传失败' }, { status: 500 });
    }
    
    // 保存到数据库
    const { data, error } = await supabase
      .from('company_logos')
      .upsert({
        company_name: companyName,
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error uploading logo:', error);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const companyName = searchParams.get('company_name');
    
    if (!companyName) {
      return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
    }
    
    const { error } = await supabase
      .from('company_logos')
      .delete()
      .eq('company_name', companyName);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting logo:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
