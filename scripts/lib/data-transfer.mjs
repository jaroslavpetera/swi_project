import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const models = ['user', 'resource', 'menuItem', 'reservation', 'order', 'orderItem'];

export async function readRows(client) {
  const data = {};
  for (const model of models) data[model] = await client[model].findMany({ orderBy: { id: 'asc' } });
  return data;
}

// Source values (including IDs, timestamps, prices and relations) are preserved.
// Empty target or an identical prior import is accepted; differing data is never overwritten.
export async function importRows(data, target) {
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
