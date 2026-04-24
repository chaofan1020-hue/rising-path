import { getSupabaseClient } from '@/storage/database/supabase-client';
import crypto from 'crypto';

const DEFAULT_PASSWORD = 'risingpath2024';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'risingpath_salt').digest('hex');
}

function verifyPassword(inputPassword: string, hashedPassword: string): boolean {
  return hashPassword(inputPassword) === hashedPassword;
}

/**
 * 验证管理员密码
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!password) return false;
  
  const supabase = getSupabaseClient();
  
  try {
    // 查询数据库中的密码配置
    const { data, error } = await supabase
      .from('job_configs')
      .select('config_value')
      .eq('config_type', 'admin_password_hash')
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // 没有自定义密码，使用默认密码
        return password === DEFAULT_PASSWORD;
      }
      console.error('Error fetching password:', error);
      return false;
    }
    
    if (data?.config_value) {
      // 使用自定义密码验证（数据库中存储的是哈希值）
      return verifyPassword(password, data.config_value);
    } else {
      // 没有自定义密码，使用默认密码
      return password === DEFAULT_PASSWORD;
    }
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
