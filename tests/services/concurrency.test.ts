import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReservationRepository, ReservationConflictError } from "../../src/repositories/reservationRepository.js";
import { ReservationService } from "../../src/services/reservationService.js";
import { ReservationState as S } from "../../src/domain/types.js";

const db = new PrismaClient();
const otherDb = new PrismaClient();
const resources: string[] = [];
let userId: string;
const now = new Date("2027-06-01T10:00:00Z");
const startsAt = new Date("2027-06-01T18:00:00Z");
const endsAt = new Date("2027-06-01T20:00:00Z");

beforeAll(async () => {
  userId = (await db.user.create({ data: { name: "Race", email: `${randomUUID()}@test.local` } })).id;
});
afterAll(async () => {
  await db.reservation.deleteMany({ where: { resourceId: { in: resources } } });
  await db.resource.deleteMany({ where: { id: { in: resources } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
});

// Both independent DB clients must finish the relevant stale read before
// either service can proceed. Without atomic transition guards these fail.
function pair(coordinate: "state" | "overlap") {
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  async function meet() { if (++arrivals >= 2) release(); await gate; }
  class CoordinatedRepository extends ReservationRepository {
    async findById(id: string) {
      const result = await super.findById(id);
      if (coordinate === "state") await meet();
      return result;
    }
    async findForResource(id: string) {
      const result = await super.findForResource(id);
      if (coordinate === "overlap") await meet();
      return result;
    }
  }
  return [db, otherDb].map((client) => new ReservationService(new CoordinatedRepository(client)));
}
async function setup(approval = false) {
  const table = await db.resource.create({ data: { name: "Race table", capacity: 4, requiresApproval: approval } });
  resources.push(table.id);
  const create = (from = startsAt, to = endsAt) => db.reservation.create({ data: {
    resourceId: table.id, userId, startsAt: from, endsAt: to,
    state: approval ? S.PENDING_APPROVAL : S.DRAFT,
  } });
  return { table, create };
}
function oneWinner(results: PromiseSettledResult<unknown>[]) {
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(failure.reason).toBeInstanceOf(ReservationConflictError);
}

describe("REQ-04 — coordinated races across independent SQLite clients", () => {
  it.each([false, true])("V-04R.1: overlapping allocation has exactly one winner (approval=%s)", async (approval) => {
    const { table, create } = await setup(approval);
    const a = await create(); const b = await create();
    const [first, second] = pair("overlap");
    const action = approval ? "approveReservation" : "confirmReservation";
    oneWinner(await Promise.allSettled([first[action](a.id, now), second[action](b.id, now)]));
    const rows = await db.reservation.findMany({ where: { resourceId: table.id } });
    expect(rows.filter((r) => r.state === S.CONFIRMED)).toHaveLength(1);
    expect(rows.filter((r) => r.state === (approval ? S.PENDING_APPROVAL : S.DRAFT))).toHaveLength(1);
  });

  it("V-04R.2: duplicate approval has one winner", async () => {
    const { create } = await setup(true); const row = await create();
    const [first, second] = pair("overlap");
    oneWinner(await Promise.allSettled([first.approveReservation(row.id, now), second.approveReservation(row.id, now)]));
  });

  it.each([false, true])("V-04R.3: cancellation cannot be overwritten by a stale allocation (approval=%s)", async (approval) => {
    const { create } = await setup(approval); const row = await create();
    const [first, second] = pair("state");
    const action = approval ? "approveReservation" : "confirmReservation";
    oneWinner(await Promise.allSettled([first[action](row.id, now), second.cancelReservation(row.id, now)]));
    // If allocation won, cancellation may be retried against the new state.
    await new ReservationService(new ReservationRepository(db)).cancelReservation(row.id, now);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(S.CANCELLED);
  });

  it("V-04R.4: Approve and Reject cannot both succeed on the same pending request", async () => {
    const { create } = await setup(true); const row = await create();
    const [first, second] = pair("state");
    oneWinner(await Promise.allSettled([first.approveReservation(row.id, now), second.rejectReservation(row.id)]));
  });

  it("V-04R.5: simultaneous cancellations are idempotent", async () => {
    const { create } = await setup(); const row = await create();
    const [first, second] = pair("state");
    const results = await Promise.all([first.cancelReservation(row.id, now), second.cancelReservation(row.id, now)]);
    expect(results.map((r) => r.state)).toEqual([S.CANCELLED, S.CANCELLED]);
  });

  it("V-04R.6: touching intervals can both be confirmed concurrently", async () => {
    const { create } = await setup(); const a = await create();
    const b = await create(endsAt, new Date("2027-06-01T22:00:00Z"));
    const [first, second] = pair("overlap");
    const results = await Promise.all([first.confirmReservation(a.id, now), second.confirmReservation(b.id, now)]);
    expect(results.map((r) => r.state)).toEqual([S.CONFIRMED, S.CONFIRMED]);
  });

  it("V-04R.7: direct Confirm competes safely with a previously pending Approve", async () => {
    const { table, create } = await setup(false);
    const a = await create(); const b = await create();
    // Models a pending request retained after a resource configuration change.
    await db.reservation.update({ where: { id: b.id }, data: { state: S.PENDING_APPROVAL } });
    const [first, second] = pair("overlap");
    oneWinner(await Promise.allSettled([first.confirmReservation(a.id, now), second.approveReservation(b.id, now)]));
    expect(await db.reservation.count({ where: { resourceId: table.id, state: S.CONFIRMED } })).toBe(1);
  });
});
