// C05 krok 5: komponentový test kontraktu ReservationTx.transition (C05 DD,
// Key interface 2) nad skutečnou databází. Fake úložiště kontrakt jen napodobuje;
// tady se ověřuje, že ho splňuje Prisma adaptér, který běží v produkci.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/database.js";
import { ReservationConflictError, ReservationRepository } from "../../src/repositories/reservationRepository.js";
import { ReservationState as S } from "../../src/domain/types.js";

const prisma = new PrismaClient();
const repository = new ReservationRepository(prisma);
const resources: string[] = [];
let userId: string;
let resourceId: string;

beforeEach(async () => {
  userId = (await prisma.user.create({
    data: { name: "Tx contract", email: `tx-contract-${Date.now()}-${Math.random()}@test.local` },
  })).id;
  resourceId = (await prisma.resource.create({ data: { name: `Contract table ${Date.now()}`, capacity: 2 } })).id;
  resources.push(resourceId);
});

afterAll(async () => {
  await prisma.reservation.deleteMany({ where: { resourceId: { in: resources } } });
  await prisma.resource.deleteMany({ where: { id: { in: resources } } });
  await prisma.$disconnect();
});

async function draft() {
  return repository.create({
    userId,
    resourceId,
    startsAt: new Date("2027-06-01T18:00:00Z"),
    endsAt: new Date("2027-06-01T20:00:00Z"),
  });
}

describe("DD-T10 interface contract — ReservationTx.transition (REQ-04 second safeguard)", () => {
  it("DD-T10: transition from the stored state persists the new state and returns it", async () => {
    const reservation = await draft();

    const result = await repository.inResourceTransaction(resourceId, async (tx) => {
      const current = await tx.findById(reservation.id);
      return tx.transition(current!, S.CONFIRMED);
    });

    expect(result.state).toBe(S.CONFIRMED);
    expect((await repository.findById(reservation.id))?.state).toBe(S.CONFIRMED);
  });

  it("DD-T10b: transition from a stale state → ReservationConflictError, the newer state is not overwritten", async () => {
    const stale = await draft();
    await prisma.reservation.update({ where: { id: stale.id }, data: { state: S.CANCELLED } });

    await expect(
      repository.inResourceTransaction(resourceId, (tx) => tx.transition(stale, S.CONFIRMED))
    ).rejects.toBeInstanceOf(ReservationConflictError);

    expect((await repository.findById(stale.id))?.state).toBe(S.CANCELLED);
  });

  it("DD-T10c: findConfirmedForResource returns only CONFIRMED rows of that Resource", async () => {
    const confirmed = await draft();
    await prisma.reservation.update({ where: { id: confirmed.id }, data: { state: S.CONFIRMED } });
    await draft();

    const rows = await repository.inResourceTransaction(resourceId, (tx) => tx.findConfirmedForResource(resourceId));

    expect(rows.map((r) => r.id)).toEqual([confirmed.id]);
  });
});
