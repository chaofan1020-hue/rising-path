import { createClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取存储客户端
function getStorageClient() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
  return createClient(supabaseUrl, supabaseKey);
}

// 上传文件到 Supabase Storage
export async function uploadFile(file: File | Blob, fileName: string): Promise<string | null> {
  try {
    const supabase = getStorageClient();
    
    const { data, error } = await supabase.storage
      .from('pathup-assets')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true,
      });
    
    if (error) {
      console.error('Storage upload error:', error);
      return null;
    }
    
    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('pathup-assets')
      .getPublicUrl(fileName);
    
    return urlData.publicUrl;
  } catch (error) {
    console.error('Upload error:', error);
    return null;
  }
}

// 加载存储技能（兼容旧接口）
export async function loadStorageSkill() {
  return {
    uploadFile,
  };
}
