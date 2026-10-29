import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '../src/database.js';
import { createApp } from '../src/http/app.js';
import { rangesOverlap } from '../src/domain/rules.js';

assert.match(process.env.DATABASE_URL ?? '', /^postgres(ql)?:/, 'Load verification requires PostgreSQL');
const output = process.argv[2];
assert.ok(output, 'Supply an output JSON file');
const db = new PrismaClient();
const server = createApp(db).listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const resources: string[] = [];
let userId: string | undefined;
const evidence = {
  startedAt: new Date().toISOString(),
  baselineConcurrency: 5, scaledConcurrency: 50, multiplier: 10, repetitions: 3,
  scope: 'Local HTTP requests through Express, Reservation Lifecycle and PostgreSQL; not a production SLA benchmark.',
  results: [] as { scenario: string; concurrency: number; p95Ms: number }[],
  // C06 F1: rozhodnutelné kritérium pro „úzké hrdlo“ z ADR-03 (podmínka znovuotevření).
  latencyCriterion: {
    rule: 'Hot table (hot-confirm, hot-mixed) at concurrency 50: p95 <= 500 ms in at least 2 of 3 repetitions per scenario; otherwise the Resource lock is a bottleneck and ADR-03 is reopened.',
    p95BudgetMs: 500,
  },
};

function percentile(values: number[], fraction: number) {
  return Number(values[Math.max(0, Math.ceil(values.length * fraction) - 1)].toFixed(2));
}

async function sample(scenario: 'hot-confirm' | 'hot-mixed' | 'distributed-mixed', count: number, repetition: number) {
  const distributed = scenario === 'distributed-mixed';
  const tables = await Promise.all(Array.from({ length: distributed ? count : 1 }, () =>
    db.resource.create({ data: { name: 'Load fixture', capacity: 4 } })));
  resources.push(...tables.map((table) => table.id));
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  // Pending fixtures represent requests retained after a resource configuration
  // change, like V-04R.7. Confirm and Approve must share the same lock.
  const reservations = await Promise.all(Array.from({ length: count }, (_, i) => db.reservation.create({ data: {
    userId: userId!, resourceId: tables[distributed ? i : 0].id, startsAt, endsAt,
    state: scenario !== 'hot-confirm' && i % 2 ? 'PENDING_APPROVAL' : 'DRAFT',
  } })));
  const batchStarted = performance.now();
  const outcomes = await Promise.all(reservations.map(async (reservation) => {
    const started = performance.now();
    const action = reservation.state === 'PENDING_APPROVAL' ? 'approve' : 'confirm';
    const response = await fetch(`${base}/reservations/${reservation.id}/${action}`, { method: 'POST' });
    await response.json();
    return { status: response.status, durationMs: performance.now() - started };
  }));
  const elapsedMs = performance.now() - batchStarted;
  const successes = outcomes.filter((result) => result.status === 200).length;
  const conflicts = outcomes.filter((result) => result.status === 409).length;
  assert.equal(successes, distributed ? count : 1, `${scenario}: unexpected successes`);
  assert.equal(conflicts, distributed ? 0 : count - 1, `${scenario}: unexpected conflicts`);
  assert.equal(successes + conflicts, count, `${scenario}: transport/server error`);
  const confirmed = await db.reservation.findMany({ where: { resourceId: { in: tables.map((table) => table.id) }, state: 'CONFIRMED' } });
  assert.equal(confirmed.length, successes);
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      assert.ok(confirmed[i].resourceId !== confirmed[j].resourceId || !rangesOverlap(confirmed[i], confirmed[j]), 'BR-02 violated');
    }
  }
  const timings = outcomes.map((result) => result.durationMs).sort((a, b) => a - b);
  const result = { scenario, concurrency: count, repetition, successes, conflicts, unexpectedErrors: 0,
    p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95), maxMs: percentile(timings, 1),
    batchMs: Number(elapsedMs.toFixed(2)), requestsPerSecond: Number((count * 1000 / elapsedMs).toFixed(2)),
    overlapViolations: 0 };
  evidence.results.push(result);
  console.log(JSON.stringify(result));
}

try {
  userId = (await db.user.create({ data: { name: 'Load fixture', email: `${randomUUID()}@test.local` } })).id;
  // Warm up the API and database before the measured batches.
  await fetch(`${base}/menu-items`).then((response) => response.json());
  for (const scenario of ['hot-confirm', 'hot-mixed', 'distributed-mixed'] as const) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      await sample(scenario, 5, repetition);
      await sample(scenario, 50, repetition);
    }
  }
  // Verdikt je rozhodnutí o ADR-03, ne selhání ověření: build kvůli latenci nepadá.
  const latencyVerdicts = (['hot-confirm', 'hot-mixed'] as const).map((scenario) => {
    const p95Ms = evidence.results.filter((r) => r.scenario === scenario && r.concurrency === 50).map((r) => r.p95Ms);
    const withinBudget = p95Ms.filter((value) => value <= evidence.latencyCriterion.p95BudgetMs).length;
    return { scenario, p95Ms, withinBudget, passed: withinBudget >= 2 };
  });
  const latencyDecision = latencyVerdicts.every((v) => v.passed)
    ? 'ADR-03 kept: Resource lock is not a bottleneck'
    : 'ADR-03 reopen: Resource lock is a bottleneck';
  console.log(JSON.stringify({ latencyVerdicts, latencyDecision }));
  writeFileSync(output, `${JSON.stringify({ ...evidence, latencyVerdicts, latencyDecision,
    completedAt: new Date().toISOString(), status: 'passed' }, null, 2)}\n`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.reservation.deleteMany({ where: { resourceId: { in: resources } } });
  await db.resource.deleteMany({ where: { id: { in: resources } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
}
