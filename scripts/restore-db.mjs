import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

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

// Get file from command line arg or pick latest in ./backups/
let targetFile = process.argv[2];

if (!targetFile) {
  if (!fs.existsSync(backupDir)) {
    console.error('Error: No backups directory found.');
    process.exit(1);
  }

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.dump') || f.endsWith('.sql'))
    .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.error('Error: No backup files found in ./backups/');
    process.exit(1);
  }

  targetFile = files[0].path;
  console.log(`No backup file specified. Auto-selected latest backup: ${targetFile}`);
}

function findBin(name) {
  const possiblePaths = [
    name,
    `/opt/homebrew/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/local/opt/libpq/bin/${name}`,
  ];

  for (const p of possiblePaths) {
    const test = spawnSync(p, ['--version']);
    if (test.status === 0) return p;
  }
  return null;
}

async function restoreSqlPureJs(filePath) {
  console.log(`Restoring SQL file using Node pg driver...`);
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);
    console.log('Restore completed successfully!');
  } finally {
    await client.end();
  }
}

async function main() {
  if (!fs.existsSync(targetFile)) {
    console.error(`Error: Backup file not found: ${targetFile}`);
    process.exit(1);
  }

  console.log(`Starting restore to database from: ${targetFile}`);

  if (targetFile.endsWith('.dump')) {
    const pgRestorePath = findBin('pg_restore');
    if (!pgRestorePath) {
      console.error('Error: pg_restore binary not found. Run "brew install libpq" to restore .dump files.');
      process.exit(1);
    }

    const result = spawnSync(pgRestorePath, [
      '--clean',
      '--no-owner',
      '--no-acl',
      '-d', dbUrl,
      targetFile
    ], { stdio: 'inherit', shell: false });

    if (result.status === 0 || result.status === 1) {
      // Exit status 1 in pg_restore often just indicates non-critical warnings (e.g. relation does not exist when dropping)
      console.log('Restore from .dump completed!');
    } else {
      console.error(`pg_restore failed with exit code ${result.status}`);
      process.exit(result.status || 1);
    }
  } else if (targetFile.endsWith('.sql')) {
    const psqlPath = findBin('psql');
    if (psqlPath) {
      const result = spawnSync(psqlPath, [dbUrl, '-f', targetFile], { stdio: 'inherit', shell: false });
      if (result.status === 0) {
        console.log('Restore from .sql completed!');
        return;
      }
    }
    await restoreSqlPureJs(targetFile);
  }
}

main().catch(err => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});
