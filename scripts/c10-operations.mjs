// C10 — provozní situace nad izolovanou testovací instancí (nikdy ne vývojová DB z .env).
// Spustí vlastní PostgreSQL cluster v temp adresáři a aplikaci jako samostatný proces
// (`node --import tsx src/index.ts`), zachytí její stdout/stderr s časem příjmu a projde:
//   S1 úspěšné potvrzení, S2 zamítnutá kolize, S3 výpadek DB a obnova, S4 restart aplikace.
// Správnost se ověřuje zvlášť čtením z DB (oracle, vlastní spojení), ne z logu ani odpovědi.
// Použití: node scripts/c10-operations.mjs [výstupní-název]   (výchozí "c10-operations")
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { generateClients, node, prisma, postgresSchema, report, root, run } from './lib/runtime.mjs';
import { startPostgres, freePort } from './lib/postgres.mjs';

const name = process.argv[2] ?? 'c10-operations';
const temporary = mkdtempSync(path.join(tmpdir(), 'swi-c10-'));
const cluster = path.join(temporary, 'cluster');
const appLog = [];
const situations = [];
let database;
let app;
let env;

const stamp = () => new Date().toISOString();
const note = (line) => { appLog.push(`${stamp()} [harness] ${line}`); console.log(line); };

function startApp() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: root, env, windowsHide: true });
  for (const [stream, tag] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) if (line.trim()) appLog.push(`${stamp()} [app ${tag}] ${line}`);
    });
  }
  return child;
}

async function waitForApp(base) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (app.exitCode !== null) throw new Error('Aplikace skončila před startem');
    try { const res = await fetch(`${base}/menu-items`); if (res.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Aplikace nenastartovala');
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  // Na Windows kill() proces ukončí okamžitě (bez SIGTERM handleru); na Linuxu pošle SIGTERM.
  app.kill('SIGTERM');
  await new Promise((resolve) => app.once('exit', resolve));
}

async function call(base, method, url, body) {
  const started = performance.now();
  try {
    const res = await fetch(`${base}${url}`, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { status: null, error: String(error), ms: Math.round(performance.now() - started) };
  }
}

// Nezávislé čtení uloženého stavu — nové spojení pro každý dotaz, jen commitnutá data.
async function oracle(query, params) {
  const client = new Client({ connectionString: env.DATABASE_URL.split('?')[0] });
  await client.connect();
  try { return (await client.query(query, params)).rows; } finally { await client.end(); }
}

// Stejný cluster, port i heslo → po startu platí stejná DATABASE_URL, kterou má aplikace.
const password = randomBytes(24).toString('hex');
let port;
async function startDatabase() { database = await startPostgres(cluster, { port, password }); }
async function stopDatabase() { await database.stop(); database = undefined; }

function record(situation) { situations.push(situation); console.log(JSON.stringify(situation)); }

try {
  port = await freePort();
  await startDatabase();
  env = { ...process.env, DATABASE_URL: await database.createDatabase('c10'), PORT: String(await freePort()) };
  await generateClients(env);
  await prisma(['migrate', 'deploy', '--schema', postgresSchema], { env, capture: true });
  await node('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'], { env, capture: true });
  const base = `http://127.0.0.1:${env.PORT}`;

  note('Start aplikace');
  app = startApp();
  await waitForApp(base);

  const user = (await call(base, 'POST', '/users', { name: 'C10 Host', email: 'c10-host@test.local' })).body;
  const table = (await call(base, 'POST', '/resources', { name: 'C10 Stůl 1', capacity: 4 })).body;
  const slot = { startsAt: '2027-06-01T18:00:00Z', endsAt: '2027-06-01T20:00:00Z' };

  // S1 — úspěšné potvrzení
  note('S1: create + confirm platné rezervace');
  const r1 = await call(base, 'POST', '/reservations', { resourceId: table.id, userId: user.id, ...slot });
  const c1 = await call(base, 'POST', `/reservations/${r1.body.id}/confirm`);
  const s1db = await oracle('SELECT id, state, "startsAt", "endsAt" FROM "Reservation" WHERE id = $1', [r1.body.id]);
  record({ id: 'S1', expected: 'create 201 DRAFT, confirm 200 CONFIRMED, v DB právě 1 řádek CONFIRMED',
    actual: { create: r1.status, confirm: c1.status, confirmState: c1.body.state, db: s1db.map((r) => r.state) },
    pass: r1.status === 201 && c1.status === 200 && s1db.length === 1 && s1db[0].state === 'CONFIRMED' });

  // S2 — zamítnutá kolize
  note('S2: confirm překrývající se rezervace [19:00, 21:00)');
  const r2 = await call(base, 'POST', '/reservations', { resourceId: table.id, userId: user.id, startsAt: '2027-06-01T19:00:00Z', endsAt: '2027-06-01T21:00:00Z' });
  const c2 = await call(base, 'POST', `/reservations/${r2.body.id}/confirm`);
  const s2db = await oracle('SELECT id, state FROM "Reservation" WHERE "resourceId" = $1 ORDER BY "startsAt"', [table.id]);
  const confirmed2 = s2db.filter((r) => r.state === 'CONFIRMED');
  record({ id: 'S2', expected: 'confirm 409 s odkazem na konfliktní rezervaci; R2 zůstává DRAFT; právě 1 CONFIRMED na stole',
    actual: { confirm: c2.status, body: c2.body, db: s2db.map((r) => [r.id === r1.body.id ? 'R1' : 'R2', r.state]) },
    pass: c2.status === 409 && confirmed2.length === 1 && confirmed2[0].id === r1.body.id && s2db.find((r) => r.id === r2.body.id)?.state === 'DRAFT' });

  // S3 — technická porucha: DB nedostupná, operace, obnova DB
  note('S3: zastavuji PostgreSQL (pg_ctl stop -m fast)');
  await stopDatabase();
  const during = await call(base, 'POST', '/reservations', { resourceId: table.id, userId: user.id, startsAt: '2027-06-02T18:00:00Z', endsAt: '2027-06-02T20:00:00Z' });
  note(`S3: odpověď během výpadku: ${during.status} za ${during.ms} ms`);
  note('S3: spouštím PostgreSQL znovu');
  await startDatabase();
  // Výsledek zápisu během výpadku je pro klienta neznámý → nejdřív ověřit stav, ne opakovat naslepo.
  const s3db = await oracle('SELECT count(*)::int AS n FROM "Reservation" WHERE "startsAt" = $1', ['2027-06-02T18:00:00Z']);
  const after = await call(base, 'POST', '/reservations', { resourceId: table.id, userId: user.id, startsAt: '2027-06-02T18:00:00Z', endsAt: '2027-06-02T20:00:00Z' });
  const afterConfirm = await call(base, 'POST', `/reservations/${after.body.id}/confirm`);
  record({ id: 'S3', expected: 'během výpadku 5xx bez pádu procesu a bez zápisu; po obnově DB další operace projde bez restartu aplikace',
    actual: { duringStatus: during.status, duringBody: during.body, duringMs: during.ms, rowsWrittenDuringOutage: s3db[0].n,
      appAlive: app.exitCode === null, afterCreate: after.status, afterConfirm: afterConfirm.status },
    pass: during.status >= 500 && s3db[0].n === 0 && app.exitCode === null && after.status === 201 && afterConfirm.status === 200 });

  // S4 — restart aplikace
  note('S4: zastavuji aplikaci');
  await stopApp();
  note(`S4: aplikace skončila, exit code ${app.exitCode}, signal ${app.signalCode}`);
  note('S4: start aplikace znovu');
  app = startApp();
  await waitForApp(base);
  const list = await call(base, 'GET', `/resources/${table.id}/reservations`);
  const r1After = list.body.find?.((r) => r.id === r1.body.id);
  const r4 = await call(base, 'POST', '/reservations', { resourceId: table.id, userId: user.id, startsAt: '2027-06-03T18:00:00Z', endsAt: '2027-06-03T20:00:00Z' });
  const c4 = await call(base, 'POST', `/reservations/${r4.body.id}/confirm`);
  const s4db = await oracle('SELECT id, state FROM "Reservation" WHERE id = ANY($1)', [[r1.body.id, r4.body.id]]);
  record({ id: 'S4', expected: 'po restartu R1 stále CONFIRMED (API i DB); nová rezervace se vytvoří a potvrdí',
    actual: { r1ViaApi: r1After?.state, db: s4db.map((r) => [r.id === r1.body.id ? 'R1' : 'R4', r.state]), create: r4.status, confirm: c4.status },
    pass: r1After?.state === 'CONFIRMED' && s4db.every((r) => r.state === 'CONFIRMED') && s4db.length === 2 && c4.status === 200 });
} catch (error) {
  process.exitCode = 1;
  note(`CHYBA harnessu: ${error}`);
} finally {
  await stopApp().catch(() => {});
  if (database) await database.stop().catch(() => {});
  const revision = await run('git', ['rev-parse', 'HEAD'], { capture: true, allowFailure: true });
  const dirty = await run('git', ['status', '--porcelain', '--', 'src', 'scripts', 'prisma', 'package-lock.json'], { capture: true, allowFailure: true });
  writeFileSync(path.join(root, 'docs/evidence', `${name}.log`), appLog.join('\n') + '\n');
  report(`docs/evidence/${name}.json`, {
    completedAt: stamp(), commit: revision.output.trim(), uncommittedSourceChanges: dirty.output.trim() || null,
    platform: `${process.platform}-${process.arch}`, node: process.version, situations,
    log: `docs/evidence/${name}.log`,
  });
}
