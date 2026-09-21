// C01 Engineering Spike A: Reservation -> real database -> reload -> verify.
// See docs/evidence-and-evolution.md for the write-up of this run.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("C01 spike: persistence", () => {
  let userId: string;
  let resourceId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Spike Tester", email: `spike-${Date.now()}@test.local` },
    });
    const resource = await prisma.resource.create({
      data: { name: "Table 1", capacity: 4 },
    });
    userId = user.id;
    resourceId = resource.id;
  });

  it("persists a reservation and reloads the same data from the database", async () => {
    const startsAt = new Date("2026-01-10T18:00:00Z");
    const endsAt = new Date("2026-01-10T19:00:00Z");

    const created = await prisma.reservation.create({
      data: { resourceId, userId, startsAt, endsAt, state: "DRAFT" },
    });

    // Fresh query against the real database - not the in-memory object above.
    const reloaded = await prisma.reservation.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(reloaded.id).toBe(created.id);
    expect(reloaded.state).toBe("DRAFT");
    expect(reloaded.resourceId).toBe(resourceId);
    expect(reloaded.userId).toBe(userId);
    expect(reloaded.startsAt.toISOString()).toBe(startsAt.toISOString());
    expect(reloaded.endsAt.toISOString()).toBe(endsAt.toISOString());
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { resourceId } });
    await prisma.resource.delete({ where: { id: resourceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
