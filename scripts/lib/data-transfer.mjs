import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const models = ['user', 'resource', 'menuItem', 'reservation', 'order', 'orderItem'];

export async function readRows(client) {
  const data = {};
  for (const model of models) data[model] = await client[model].findMany({ orderBy: { id: 'asc' } });
  return data;
}

// Import zapisuje mimo Reservation Lifecycle (ADR-03, riziko R-03 z C07), proto
// BR-02 ověří sám: dvě CONFIRMED téhož stolu se nesmí překrývat (BR-01 [start, end)).
export function assertExclusiveConfirmed(reservations) {
  const confirmed = reservations.filter((r) => r.state === 'CONFIRMED');
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      const [a, b] = [confirmed[i], confirmed[j]];
      assert.ok(a.resourceId !== b.resourceId || !(a.startsAt < b.endsAt && b.startsAt < a.endsAt),
        `BR-02 violated in source data (${a.id}, ${b.id}); refusing to import`);
    }
  }
}

// Source values (including IDs, timestamps, prices and relations) are preserved.
// Empty target or an identical prior import is accepted; differing data is never overwritten.
export async function importRows(data, target) {
  assertExclusiveConfirmed(data.reservation);
  const reused = await target.$transaction(async (tx) => {
    const existing = await readRows(tx);
    if (models.some((model) => existing[model].length)) {
      assert.deepEqual(existing, data, 'Target is not empty and differs from the source; refusing to overwrite data');
      return true;
    }
    for (const model of models) if (data[model].length) await tx[model].createMany({ data: data[model] });
    assert.deepEqual(await readRows(tx), data, 'Imported PostgreSQL data differs from SQLite');
    return false;
  }, { maxWait: 30_000, timeout: 60_000 });
  return {
    rowCounts: Object.fromEntries(models.map((model) => [model, data[model].length])),
    fullRowEquality: true, reused,
    dataSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}
