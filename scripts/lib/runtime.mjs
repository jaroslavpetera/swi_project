import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const postgresSchema = 'prisma/schema.prisma';
export const sqliteSchema = 'prisma/sqlite/schema.prisma';

export function localEnvironment() {
  const environment = { ...process.env };
  if (existsSync(path.join(root, '.env'))) {
    for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^(DATABASE_URL|PORT)\s*=\s*(.*)$/);
      if (match && environment[match[1]] === undefined) {
        environment[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  }
  return environment;
}

export function run(executable, args, { env = process.env, allowFailure = false, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const result = { code, signal, output };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${path.basename(executable)} ${args[0]} failed (${code ?? signal})\n${output}`));
    });
  });
}

export function node(relative, args = [], options = {}) {
  return run(process.execPath, [path.join(root, relative), ...args], options);
}

export function prisma(args, options = {}) {
  return node('node_modules/prisma/build/index.js', args, options);
}

export async function generateClients(env = localEnvironment()) {
  await prisma(['generate', '--schema', postgresSchema], { env });
  await prisma(['generate', '--schema', sqliteSchema], { env });
}

export function snapshot() {
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (!/\.(db|db-journal|db-wal|db-shm)$/.test(file)) files.push(file);
    }
  }
  for (const dir of ['src', 'tests', 'scripts', 'public', 'prisma']) walk(dir);
  files.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.verify.json', 'vitest.config.ts', 'docker-compose.yml');
  const inputs = files.sort().map((file) => ({
    file, sha256: createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'),
  }));
  return { sha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'), inputs };
}

export function report(relative, value) {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Evidence: ${relative}`);
}
