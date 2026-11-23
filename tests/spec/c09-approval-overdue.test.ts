// C09 — implementace CR-C08-01 (varianta A): přehled stolu vrací u čekající žádosti
// odvozený příznak `approvalOverdue` (BR-06, příklad V-05.10). Oracle je převzatý z karty
// změny C08 (AC-01…AC-05) a byl napsán před změnou kódu, ne podle toho, co kód vrací.
// Hodiny jsou pevné (Clock), aby šla přesně zkoušet hranice −30:01 / −30:00.
// Uložený stav se vždy čte samostatným spojením (oracle), ne z HTTP odpovědi.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { PrismaClient } from "../../src/database.js";
import { createApp } from "../../src/http/app.js";
import type { Clock } from "../../src/domain/clock.js";

const prisma = new PrismaClient();
const oracle = new PrismaClient();
let server: Server;
let baseUrl: string;
let userId: string;
const createdResourceIds: string[] = [];

// Nastavitelné serverové hodiny: stejný zdroj času pro čtení i pro Approve (R-6).
let currentTime = new Date("2027-05-01T08:00:00Z");
const testClock: Clock = { now: () => new Date(currentTime) };

const STARTS_AT = new Date("2027-05-10T18:00:00Z");
const ENDS_AT = new Date("2027-05-10T20:00:00Z");
const DEADLINE = new Date(STARTS_AT.getTime() - 30 * 60_000); // BR-06: startsAt − 30 min

function at(offsetMs: number) {
  return new Date(DEADLINE.getTime() + offsetMs);
}

async function fixture(state: "PENDING_APPROVAL" | "DRAFT" | "CONFIRMED" = "PENDING_APPROVAL") {
  const resource = await prisma.resource.create({ data: { name: "C09 R1", capacity: 4, requiresApproval: true } });
  createdResourceIds.push(resource.id);
  const reservation = await prisma.reservation.create({
    data: { userId, resourceId: resource.id, startsAt: STARTS_AT, endsAt: ENDS_AT, state },
  });
  return { resourceId: resource.id, id: reservation.id };
}

async function overview(resourceId: string) {
  const res = await fetch(`${baseUrl}/resources/${resourceId}/reservations`);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; state: string; approvalOverdue: boolean }[];
}

async function approve(id: string) {
  const res = await fetch(`${baseUrl}/reservations/${id}/approve`, { method: "POST" });
  return res.status;
}

async function storedState(id: string) {
  return (await oracle.reservation.findUniqueOrThrow({ where: { id } })).state;
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { name: "C09 Tester", email: `c09-${Date.now()}@test.local` } });
  userId = user.id;
  server = createApp(prisma, testClock).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.reservation.deleteMany({ where: { resourceId: { in: createdResourceIds } } });
  await prisma.resource.deleteMany({ where: { id: { in: createdResourceIds } } });
  await prisma.user.delete({ where: { id: userId } });
  await Promise.all([prisma.$disconnect(), oracle.$disconnect()]);
});

describe("V-05.10 / CR-C08-01 — příznak approvalOverdue v přehledu stolu", () => {
  it("AC-01: v startsAt − 30:01 není po termínu a Approve uspěje (200, uloženo CONFIRMED)", async () => {
    const { resourceId, id } = await fixture();
    currentTime = at(-60_000);

    const rows = await overview(resourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, state: "PENDING_APPROVAL", approvalOverdue: false });

    expect(await approve(id)).toBe(200);
    expect(await storedState(id)).toBe("CONFIRMED");
  });

  it("AC-03 + AC-05: přesně v startsAt − 30:00 je po termínu; čtení uložený stav nemění", async () => {
    const { resourceId, id } = await fixture();
    currentTime = at(0);

    const rows = await overview(resourceId);
    expect(rows[0]).toMatchObject({ id, state: "PENDING_APPROVAL", approvalOverdue: true });
    // R-16: po GET je v DB stále PENDING_APPROVAL (čtení nezapisuje).
    expect(await storedState(id)).toBe("PENDING_APPROVAL");
  });

  it("AC-02: po termínu přímý Approve dál vrací 410 a uloží EXPIRED (BR-06 beze změny)", async () => {
    const { resourceId, id } = await fixture();
    currentTime = at(60_000); // startsAt − 29:00

    expect((await overview(resourceId))[0].approvalOverdue).toBe(true);
    expect(await approve(id)).toBe(410);
    expect(await storedState(id)).toBe("EXPIRED");
    // Uložený EXPIRED už příznak nenese — není to čekající žádost.
    expect((await overview(resourceId))[0]).toMatchObject({ state: "EXPIRED", approvalOverdue: false });
  });

  it("po začátku rezervace je čekající žádost také po termínu", async () => {
    const { resourceId } = await fixture();
    currentTime = new Date(STARTS_AT.getTime() + 5 * 60_000);
    expect((await overview(resourceId))[0].approvalOverdue).toBe(true);
  });

  it.each(["DRAFT", "CONFIRMED"] as const)("stav %s nikdy není po termínu schválení (příznak false)", async (state) => {
    const { resourceId, id } = await fixture(state);
    currentTime = new Date(STARTS_AT.getTime() + 5 * 60_000);
    expect((await overview(resourceId))[0]).toMatchObject({ id, state, approvalOverdue: false });
    expect(await storedState(id)).toBe(state);
  });
});
