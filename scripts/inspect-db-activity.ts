import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
async function main() { const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); try { const r = await c.query(`select pid, state, wait_event_type, wait_event, now()-query_start as age, left(query,180) as query from pg_stat_activity where datname = current_database() and state <> 'idle' order by query_start`); console.log(JSON.stringify(r.rows,null,2)); } finally { await c.end(); } }
main().catch((e)=>{console.error(e);process.exitCode=1});
