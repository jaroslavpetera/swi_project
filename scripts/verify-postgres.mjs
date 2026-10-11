import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateClients, node, prisma, postgresSchema, report, root, snapshot, run } from './lib/runtime.mjs';
import { startPostgres } from './lib/postgres.mjs';

const startedAt = new Date().toISOString();
const temporary = mkdtempSync(path.join(tmpdir(), 'swi-postgres-verify-'));
let database;
const evidence = { startedAt, provider: 'postgresql', steps: [] };
const revision = await run('git', ['rev-parse', 'HEAD'], { capture: true, allowFailure: true });
evidence.baseCommit = revision.code === 0 ? revision.output.trim() : null;
try {
  database = await startPostgres(path.join(temporary, 'cluster'));
  evidence.version = database.version;
  evidence.isolation = database.isolation;
  const env = { ...process.env, DATABASE_URL: await database.createDatabase('verification') };
  await generateClients(env);
  const transferEnv = { ...process.env, DATABASE_URL: await database.createDatabase('data_transfer') };
  await prisma(['migrate', 'deploy', '--schema', postgresSchema], { env: transferEnv });
  await node('scripts/verify-data-transfer.mjs', [path.join(temporary, 'transfer.db')], { env: transferEnv });
  evidence.steps.push('Non-empty SQLite transfer: all six models, identical retry, refusal of differing target');
  await prisma(['migrate', 'deploy', '--schema', postgresSchema], { env });
  evidence.steps.push('PostgreSQL migrations deployed to a new database');
  // A deployed migration history must agree with the schema, not just pass tests.
  const drift = await prisma(['migrate', 'diff', '--from-url', env.DATABASE_URL, '--to-schema-datamodel', postgresSchema, '--exit-code'], { env, capture: true });
  evidence.steps.push({ migrationDrift: drift.code });
  await node('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'], { env });
  await node('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json'], { env });
  await node('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.verify.json'], { env });
  // Browser code uses the DOM; validate syntax without executing it in Node.
  await node('scripts/check-browser-syntax.mjs', [], { env });
  const testReport = path.join(temporary, 'vitest.json');
  const tests = await node('node_modules/vitest/vitest.mjs', ['run', '--reporter=default', '--reporter=json', `--outputFile=${testReport}`], { env, allowFailure: true });
  const result = JSON.parse(readFileSync(testReport, 'utf8'));
  evidence.tests = { passed: result.numPassedTests, failed: result.numFailedTests, total: result.numTotalTests, skipped: result.numPendingTests };
  evidence.suites = result.testResults.map((suite) => ({ file: path.relative(root, suite.name).replaceAll('\\', '/'), status: suite.status,
    tests: suite.assertionResults.map((test) => ({ name: test.fullName, status: test.status })) }));
  if (tests.code !== 0) throw new Error('PostgreSQL test suite failed');
  if (!process.argv.includes('--tests-only')) {
    await node('node_modules/tsx/dist/cli.mjs', ['scripts/postgres-load.ts', path.join(temporary, 'load.json')], { env });
    evidence.load = JSON.parse(readFileSync(path.join(temporary, 'load.json'), 'utf8'));
  }
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  if (database) await database.stop();
  evidence.completedAt = new Date().toISOString();
  evidence.snapshot = snapshot();
  report(process.argv.includes('--tests-only') ? 'docs/evidence/c03-postgres-tests.json' : 'docs/evidence/c03-postgres-verification.json', evidence);
}
