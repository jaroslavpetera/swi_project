import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient as SQLiteClient } from '../node_modules/.prisma/sqlite/index.js';
import { PrismaClient } from '@prisma/client';
import { prisma, report, sqliteSchema } from './lib/runtime.mjs';
import { importRows, readRows } from './lib/data-transfer.mjs';

const file = process.argv[2];
assert.ok(file, 'Supply a dedicated temporary SQLite file');
writeFileSync(file, '');
const sourceUrl = `file:${path.resolve(file).replaceAll('\\', '/')}`;
await prisma(['migrate', 'deploy', '--schema', sqliteSchema], { env: { ...process.env, DATABASE_URL: sourceUrl } });
const source = new SQLiteClient({ datasourceUrl: sourceUrl });
const target = new PrismaClient();
try {
  const user = await source.user.create({ data: { name: 'Transfer test', email: `${randomUUID()}@test.local` } });
  const table = await source.resource.create({ data: { name: 'Transfer table', capacity: 4, requiresApproval: true } });
  const menu = await source.menuItem.create({ data: { name: 'Transfer item', category: 'FOOD', priceCents: 12345, available: true } });
  const reservation = await source.reservation.create({ data: { userId: user.id, resourceId: table.id,
    startsAt: new Date('2027-06-01T18:00:00.123Z'), endsAt: new Date('2027-06-01T20:00:00.456Z'), state: 'CONFIRMED' } });
  const order = await source.order.create({ data: { reservationId: reservation.id, state: 'SERVED' } });
  await source.orderItem.create({ data: { orderId: order.id, menuItemId: menu.id, quantity: 2, unitPriceCents: 12345 } });
  const data = await source.$transaction((tx) => readRows(tx));
  const result = await importRows(data, target);
  assert.ok(Object.values(result.rowCounts).every((count) => count === 1));
  assert.equal((await importRows(data, target)).reused, true, 'Retry must preserve identical data');
  const changed = structuredClone(data);
  changed.menuItem[0].priceCents++;
  await assert.rejects(importRows(changed, target), /refusing to overwrite/);
  assert.deepEqual(await readRows(target), data, 'Refused import must leave target untouched');
  report('docs/evidence/c03-data-transfer-verification.json', {
    completedAt: new Date().toISOString(), status: 'passed', ...result,
    preservesIdsTimestampsMoneyAndRelations: true, identicalRetryAccepted: true, differingTargetRefused: true,
  });
} finally {
  await Promise.all([source.$disconnect(), target.$disconnect()]);
}
