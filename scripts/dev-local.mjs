import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateClients, localEnvironment, node, prisma, postgresSchema, root, sqliteSchema, report } from './lib/runtime.mjs';
import { startPostgres, freePort } from './lib/postgres.mjs';

const env = localEnvironment();
const smoke = process.argv.includes('--smoke');
if (smoke) env.PORT = String(await freePort());
let database;
let server;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (database) await database.stop();
}
try {
  env.DATABASE_URL ??= 'postgresql://reservation:reservation@127.0.0.1:55432/reservation?connection_limit=30&pool_timeout=30';
  const sqlite = env.DATABASE_URL.startsWith('file:');
  if (sqlite && !path.isAbsolute(env.DATABASE_URL.slice(5))) {
    env.DATABASE_URL = `file:${path.resolve(root, 'prisma', env.DATABASE_URL.slice(5)).replaceAll('\\', '/')}`;
  }
  if (!sqlite && !process.argv.includes('--external')) {
    const url = new URL(env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.username !== 'reservation' || url.password !== 'reservation') {
      throw new Error('npm run dev manages only the default local database. For a configured external PostgreSQL use npm run dev:external.');
    }
    database = await startPostgres(path.join(root, '.local/postgres'), { port: 55432, password: 'reservation' });
    env.DATABASE_URL = await database.createDatabase('reservation');
  }
  await generateClients(env);
  await prisma(['migrate', 'deploy', '--schema', sqlite ? sqliteSchema : postgresSchema], { env });
  await node('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'], { env });
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
  const exited = new Promise((resolve, reject) => { server.once('exit', resolve); server.once('error', reject); });
  if (smoke) {
    const base = `http://127.0.0.1:${env.PORT}`;
    let response;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error('Development server exited before becoming ready');
      try { response = await fetch(`${base}/menu-items`); break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200, 'Development server did not start');
    assert.equal((await response.json()).length, 9, 'Demo menu seed differs');
    assert.equal((await fetch(`${base}/resources/unknown/availability?start=2027-06-01T18:00:00Z&end=2027-06-01T20:00:00Z`)).status, 404);
    assert.equal((await fetch(`${base}/resources/unknown/availability?start=invalid&end=invalid`)).status, 400);
    report('docs/evidence/c03-local-startup.json', {
      completedAt: new Date().toISOString(), status: 'passed', provider: sqlite ? 'sqlite' : 'postgresql',
      version: database?.version, migrationDeployPassed: true, demoMenuItems: 9,
      unknownResourceStatus: 404, invalidIntervalStatus: 400,
    });
    await shutdown();
  }
  const code = await exited;
  if (!closing && code) process.exitCode = code;
} finally {
  await shutdown();
}
