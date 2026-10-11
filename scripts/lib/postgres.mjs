import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { Client } from 'pg';
import { run } from './runtime.mjs';

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

// All processes are hidden on Windows; pg_ctl performs graceful fast shutdown.
// No service installation, OS user creation, or deletion of database directories.
export async function startPostgres(directory, { port, password = randomBytes(24).toString('hex') } = {}) {
  const supported = new Set(['win32-x64', 'linux-x64', 'linux-arm64', 'linux-arm', 'linux-ia32', 'linux-ppc64', 'darwin-x64', 'darwin-arm64']);
  const platform = `${process.platform}-${process.arch}`;
  if (!supported.has(platform)) throw new Error(`Unsupported embedded PostgreSQL platform: ${platform}`);
  const packagePlatform = platform.replace('win32-', 'windows-');
  const binaries = await import(`@embedded-postgres/${packagePlatform}`);
  const cluster = path.resolve(directory);
  mkdirSync(cluster, { recursive: true });
  if (!existsSync(path.join(cluster, 'PG_VERSION'))) {
    const passwordFile = `${cluster}.init-password`;
    writeFileSync(passwordFile, password, { mode: 0o600 });
    try {
      await run(binaries.initdb, ['-D', cluster, '-U', 'reservation', `--pwfile=${passwordFile}`, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], { capture: true });
    } finally {
      if (existsSync(passwordFile)) unlinkSync(passwordFile);
    }
  }
  const selectedPort = port ?? await freePort();
  let stopped = false;
  await run(binaries.pg_ctl, ['-D', cluster, '-l', path.join(cluster, 'server.log'), '-o', `-p ${selectedPort} -h 127.0.0.1 -c max_connections=100`, '-w', '-t', '30', 'start'], { capture: true });
  const url = (database) => `postgresql://reservation:${encodeURIComponent(password)}@127.0.0.1:${selectedPort}/${database}?connection_limit=30&pool_timeout=30`;
  const admin = new Client({ connectionString: url('postgres') });
  try {
    await admin.connect();
    const result = await admin.query('SELECT version() AS version, current_setting(\'transaction_isolation\') AS isolation');
    return {
      version: result.rows[0].version, isolation: result.rows[0].isolation,
      url,
      async createDatabase(name) {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid local database name');
        const present = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        if (present.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
        return url(name);
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        await admin.end();
        await run(binaries.pg_ctl, ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'], { capture: true });
      },
    };
  } catch (error) {
    await admin.end().catch(() => {});
    await run(binaries.pg_ctl, ['-D', cluster, '-m', 'fast', '-w', 'stop'], { capture: true });
    throw error;
  }
}
