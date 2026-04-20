import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  // 1. 首先检查 Coze 平台直接注入的环境变量（无前缀）
  // Coze 平台会自动将环境变量注入到 process.env，使用用户在界面配置的名称
  const directUrl = process.env.SUPABASE_URL;
  const directKey = process.env.SUPABASE_ANON_KEY;
  
  if (directUrl && directKey) {
    console.log('[Supabase] Using direct environment variables from Coze platform');
    envLoaded = true;
    return;
  }

  // 2. 尝试 dotenv（仅开发环境）
  try {
    require('dotenv').config();
  } catch {
    // dotenv not available
  }

  // 3. 检查是否有 .env 文件中的 COZE_SUPABASE_* 变量，映射到标准名称
  if (process.env.COZE_SUPABASE_URL && !process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.COZE_SUPABASE_URL;
  }
  if (process.env.COZE_SUPABASE_ANON_KEY && !process.env.SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.COZE_SUPABASE_ANON_KEY;
  }
  if (process.env.COZE_SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
  }

  // 4. 如果还是没有，尝试 Python 获取（仅沙箱开发环境）
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    try {
      const pythonCode = `
import os
import sys
try:
    from coze_workload_identity import Client
    client = Client()
    env_vars = client.get_project_env_vars()
    client.close()
    for env_var in env_vars:
        print(f"{env_var.key}={env_var.value}")
except Exception as e:
    print(f"# Error: {e}", file=sys.stderr)
`;

      const output = execSync(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('#')) continue;
        const eqIndex = line.indexOf('=');
        if (eqIndex > 0) {
          const key = line.substring(0, eqIndex);
          let value = line.substring(eqIndex + 1);
          if ((value.startsWith("'") && value.endsWith("'")) ||
              (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
          }
          // 映射 COZE_SUPABASE_* 到 SUPABASE_*
          if (key.startsWith('COZE_SUPABASE_')) {
            const newKey = 'SUPABASE_' + key.substring(14);
            if (!process.env[newKey]) {
              process.env[newKey] = value;
            }
          } else if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    } catch (e) {
      console.error('[Supabase] Python env loading failed:', e);
    }
  }

  envLoaded = true;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // 调试日志
  console.log('[Supabase] URL present:', !!url, url ? `(${url.substring(0, 30)}...)` : '');
  console.log('[Supabase] Key present:', !!anonKey, anonKey ? '(present)' : '');

  if (!url) {
    throw new Error('SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  if (token) {
    return createClient(url, key, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      db: {
        timeout: 60000,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return createClient(url, key, {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export { loadEnv, getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient };
