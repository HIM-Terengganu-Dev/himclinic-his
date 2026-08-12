import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

// Parse .env safely (handling passwords with special characters)
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnv();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('Error: DATABASE_URL is missing in environment or .env file');
  process.exit(1);
}

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const timestamp = now.toISOString().replace(/[-T:]/g, '').split('.')[0];

// Check if pg_dump CLI exists in system or common Mac Homebrew paths
function findPgDump() {
  const possiblePaths = [
    'pg_dump',
    '/opt/homebrew/bin/pg_dump',
    '/opt/homebrew/opt/libpq/bin/pg_dump',
    '/usr/local/bin/pg_dump',
    '/usr/local/opt/libpq/bin/pg_dump',
  ];

  for (const p of possiblePaths) {
    const test = spawnSync(p, ['--version']);
    if (test.status === 0) return p;
  }
  return null;
}

async function runJsFallbackBackup(backupFileSql) {
  console.log('Using Node.js pure driver fallback (pg)...');
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const stream = fs.createWriteStream(backupFileSql);
    stream.write(`-- Neon Database SQL Dump\n-- Generated: ${new Date().toISOString()}\n\n`);

    // Fetch tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    for (const row of tablesRes.rows) {
      const tableName = row.table_name;
      console.log(`Dumping table: ${tableName}`);

      stream.write(`-- Table: ${tableName}\n`);
      const rowsRes = await client.query(`SELECT * FROM "${tableName}"`);

      if (rowsRes.rows.length > 0) {
        const columns = Object.keys(rowsRes.rows[0]);
        const colList = columns.map(c => `"${c}"`).join(', ');

        for (const r of rowsRes.rows) {
          const values = columns.map(c => {
            const val = r[c];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'boolean' || typeof val === 'number') return val;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          stream.write(`INSERT INTO "${tableName}" (${colList}) VALUES (${values.join(', ')});\n`);
        }
      }
      stream.write('\n');
    }

    stream.end();
    console.log(`Backup completed successfully! Saved to: ${backupFileSql}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const pgDumpPath = findPgDump();

  if (pgDumpPath) {
    const backupFile = path.join(backupDir, `neon_backup_${timestamp}.dump`);
    console.log(`Starting Neon PostgreSQL backup using ${pgDumpPath}...`);
    const result = spawnSync(pgDumpPath, [dbUrl, '-Fc', '--schema=public', '-f', backupFile], {
      stdio: 'inherit',
      shell: false,
    });

    if (result.status === 0) {
      console.log(`Backup completed successfully! Saved to: ${backupFile}`);
      cleanOldBackups();
      return;
    }
  }

  // Fallback to JS backup
  console.log('Notice: pg_dump CLI not found. (Optional: run "brew install libpq" to enable pg_dump)');
  const backupFileSql = path.join(backupDir, `neon_backup_${timestamp}.sql`);
  await runJsFallbackBackup(backupFileSql);
  cleanOldBackups();
}

function cleanOldBackups() {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  fs.readdirSync(backupDir).forEach(file => {
    if (file.endsWith('.dump') || file.endsWith('.sql')) {
      const filePath = path.join(backupDir, file);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > sevenDaysMs) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old backup: ${file}`);
      }
    }
  });
}

main().catch(err => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
