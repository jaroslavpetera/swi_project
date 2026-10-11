import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateClients, localEnvironment, prisma, postgresSchema, sqliteSchema, root, report } from './lib/runtime.mjs';
import { startPostgres } from './lib/postgres.mjs';
import { readRows, importRows } from './lib/data-transfer.mjs';

const env = localEnvironment();
assert.ok(env.DATABASE_URL?.startsWith('file:'), 'This command imports the existing local SQLite .env into the default local PostgreSQL.');
const sourceFile = path.resolve(root, 'prisma/sqlite', env.DATABASE_URL.slice(5).split('?')[0]);
// Old file:./dev.db was resolved relative to prisma/schema.prisma, before the
// historical schema moved into prisma/sqlite. Keep that location explicitly.
const originalFile = path.resolve(root, 'prisma', env.DATABASE_URL.slice(5).split('?')[0]);
const sqliteFile = existsSync(originalFile) ? originalFile : sourceFile;
assert.ok(existsSync(sqliteFile), 'Existing SQLite database not found');
const sourceUrl = `file:${sqliteFile.replaceAll('\\', '/')}`;
const sourceEnv = { ...env, DATABASE_URL: sourceUrl };
const localDir = path.join(root, '.local');
mkdirSync(localDir, { recursive: true });
await generateClients(sourceEnv);
await prisma(['migrate', 'deploy', '--schema', sqliteSchema], { env: sourceEnv });
const { PrismaClient: SQLiteClient } = await import('../node_modules/.prisma/sqlite/index.js');
const { PrismaClient } = await import('@prisma/client');
const source = new SQLiteClient({ datasourceUrl: sourceUrl });
let database;
let target;
try {
  const data = await source.$transaction((tx) => readRows(tx));
  await source.$disconnect();
  const backup = path.join(localDir, `sqlite-before-postgres-${Date.now()}.db`);
  copyFileSync(sqliteFile, backup);
  database = await startPostgres(path.join(localDir, 'postgres'), { port: 55432, password: 'reservation' });
  const destinationUrl = await database.createDatabase('reservation');
  const targetEnv = { ...env, DATABASE_URL: destinationUrl };
  await prisma(['migrate', 'deploy', '--schema', postgresSchema], { env: targetEnv });
  target = new PrismaClient({ datasourceUrl: destinationUrl });
  const transfer = await importRows(data, target);
  const envFile = path.join(root, '.env');
  const backupEnv = path.join(root, '.env.sqlite.backup');
  if (!existsSync(backupEnv)) copyFileSync(envFile, backupEnv);
  const text = readFileSync(envFile, 'utf8').replace(/^DATABASE_URL\s*=.*$/m, `DATABASE_URL="${destinationUrl}"`);
  writeFileSync(envFile, text);
  report('docs/evidence/c03-local-database-migration.json', {
    completedAt: new Date().toISOString(), status: 'passed', sourceProvider: 'sqlite', targetProvider: 'postgresql',
    targetVersion: database.version, ...transfer,
    sourcePreserved: true, backupCreated: true, environmentSwitchedAfterVerification: true,
  });
} finally {
  await source.$disconnect();
  if (target) await target.$disconnect();
  if (database) await database.stop();
}
