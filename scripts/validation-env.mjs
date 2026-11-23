// C11/C12 — prostředí pro uživatelskou validaci, oddělené od vývojové DB i testů.
//   npm run validation:env       → reset: nová DB `validation`, migrace, menu, validační data, aplikace na :3001
//   npm run validation:readback  → interní read-only výpis stavu (oracle týmu, účastník ho nevidí)
// Cluster leží v ignorovaném `.local/validation` na portu 55433; Ctrl+C ukončí aplikaci i DB.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { node, prisma, postgresSchema, root } from './lib/runtime.mjs';
import { startPostgres } from './lib/postgres.mjs';

const readback = process.argv.includes('--readback');
// --smoke: připraví data, ověří, že aplikace odpovídá, a vše zase ukončí (kontrola před C12).
const smoke = process.argv.includes('--smoke');
const database = await startPostgres(path.join(root, '.local/validation'), { port: 55433, password: 'validation' });
const adminUrl = database.url('postgres');
const env = { ...process.env, PORT: process.env.VALIDATION_PORT ?? '3001' };
let app;

async function query(url, sql, params = []) {
  const client = new Client({ connectionString: url.split('?')[0] });
  await client.connect();
  try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
}

async function shutdown() {
  if (app && app.exitCode === null) { app.kill(); await new Promise((resolve) => app.once('exit', resolve)); }
  await database.stop();
}

try {
  if (readback) {
    env.DATABASE_URL = database.url('validation');
    const rows = await query(env.DATABASE_URL, `
      SELECT r.id, res.name AS stul, res.capacity AS kapacita, u.name AS host, r.state AS stav,
             to_char((r."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS od,
             to_char((r."endsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS "do",
             to_char((r."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague', 'HH24:MI:SS') AS zmeneno
      FROM "Reservation" r JOIN "Resource" res ON res.id = r."resourceId" JOIN "User" u ON u.id = r."userId"
      ORDER BY r."startsAt"`);
    console.table(rows);
    const orders = await query(env.DATABASE_URL, `
      SELECT o."reservationId" AS rezervace, o.state AS stav, string_agg(oi.quantity || '× ' || m.name, ', ') AS polozky
      FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id JOIN "MenuItem" m ON m.id = oi."menuItemId"
      GROUP BY o.id ORDER BY min(o."placedAt")`);
    console.table(orders);
  } else {
    // Reset: vždy čistá databáze se stejnými výchozími daty pro každého účastníka.
    await query(adminUrl, 'DROP DATABASE IF EXISTS "validation" WITH (FORCE)');
    env.DATABASE_URL = await database.createDatabase('validation');
    await prisma(['migrate', 'deploy', '--schema', postgresSchema], { env, capture: true });
    await node('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'], { env, capture: true });
    await node('node_modules/tsx/dist/cli.mjs', ['prisma/validation-seed.ts'], { env });
    app = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    console.log(`Validační instance: http://localhost:${env.PORT}/  (Ctrl+C ukončí aplikaci i DB)`);
    if (smoke) {
      let resources;
      for (let attempt = 0; attempt < 200 && !resources; attempt++) {
        try { resources = await (await fetch(`http://127.0.0.1:${env.PORT}/resources`)).json(); }
        catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      const reservations = await query(env.DATABASE_URL, 'SELECT id, state FROM "Reservation" ORDER BY id');
      console.log(JSON.stringify({ smoke: 'ok', resources: resources?.map((r) => r.name), reservations }));
      process.exitCode = resources?.length === 4 && reservations.length === 3 ? 0 : 1;
    } else {
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
      await new Promise((resolve) => app.once('exit', resolve));
    }
  }
} finally {
  await shutdown();
}
