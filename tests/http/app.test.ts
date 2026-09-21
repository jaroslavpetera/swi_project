// Regresní testy pro tři chyby nalezené ručním probingem běžícího serveru:
// 1) chybný FK shodil celý proces, 2) šlo potvrdit zrušenou rezervaci,
// 3) availability bez validace vracela "volno" i pro nesmyslné datum.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../../src/http/app.js";

const prisma = new PrismaClient();
let server: Server;
let baseUrl: string;
let userId: string;
let resourceId: string;
let approvalResourceId: string;

async function createReservation(startsAt: string, endsAt: string, targetResourceId = resourceId) {
  const res = await fetch(`${baseUrl}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId: targetResourceId, userId, startsAt, endsAt }),
  });
  return { status: res.status, body: (await res.json()) as { id: string; state: string } };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "HTTP Tester", email: `http-${Date.now()}@test.local` },
  });
  const resource = await prisma.resource.create({ data: { name: "Table HTTP", capacity: 4 } });
  const approvalResource = await prisma.resource.create({
    data: { name: "VIP room HTTP", capacity: 8, requiresApproval: true },
  });
  userId = user.id;
  resourceId = resource.id;
  approvalResourceId = approvalResource.id;

  server = createApp(prisma).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.reservation.deleteMany({ where: { resourceId: { in: [resourceId, approvalResourceId] } } });
  await prisma.resource.deleteMany({ where: { id: { in: [resourceId, approvalResourceId] } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("POST /reservations", () => {
  it("validates, persists and returns the reservation ID", async () => {
    const { status, body } = await createReservation(
      "2027-03-01T18:00:00Z",
      "2027-03-01T20:00:00Z"
    );
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.state).toBe("DRAFT");
  });

  it("rejects an unknown resourceId with 400 and keeps the server alive", async () => {
    const res = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceId: "neexistuje",
        userId,
        startsAt: "2027-03-02T18:00:00Z",
        endsAt: "2027-03-02T20:00:00Z",
      }),
    });
    expect(res.status).toBe(400);

    // Server musí dál obsluhovat požadavky — dřív ho tahle chyba shodila.
    const after = await fetch(`${baseUrl}/users`);
    expect(after.status).toBe(200);
  });
});

describe("POST /reservations/:id/confirm", () => {
  it("cannot confirm a cancelled reservation", async () => {
    const { body } = await createReservation("2027-03-03T18:00:00Z", "2027-03-03T20:00:00Z");
    const cancelled = await fetch(`${baseUrl}/reservations/${body.id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);

    const confirmed = await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(409);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: body.id } });
    expect(reloaded.state).toBe("CANCELLED");
  });

  it("returns 404 for an unknown reservation", async () => {
    const res = await fetch(`${baseUrl}/reservations/neexistuje/confirm`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  // C02 OP-03 example (B10): success case.
  it("confirms a DRAFT reservation with no conflict", async () => {
    const { body } = await createReservation("2027-04-01T18:00:00Z", "2027-04-01T19:00:00Z");
    const res = await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("CONFIRMED");
  });

  // C02 OP-03 example (B10): negative/boundary case — overlap rejected, DRAFT stays DRAFT.
  it("rejects confirm when a CONFIRMED reservation already overlaps the same resource", async () => {
    const first = await createReservation("2027-04-02T18:00:00Z", "2027-04-02T20:00:00Z");
    await fetch(`${baseUrl}/reservations/${first.body.id}/confirm`, { method: "POST" });

    const second = await createReservation("2027-04-02T19:00:00Z", "2027-04-02T21:00:00Z");
    const res = await fetch(`${baseUrl}/reservations/${second.body.id}/confirm`, { method: "POST" });
    expect(res.status).toBe(409);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: second.body.id } });
    expect(reloaded.state).toBe("DRAFT");
  });
});

describe("POST /reservations/:id/confirm, /approve, /reject — BR-05 approval workflow", () => {
  it("routes Confirm to PENDING_APPROVAL (202) for a resource that requires approval, then Approve confirms it", async () => {
    const { body } = await createReservation(
      "2027-04-03T18:00:00Z",
      "2027-04-03T19:00:00Z",
      approvalResourceId
    );
    const confirmRes = await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });
    expect(confirmRes.status).toBe(202);
    expect((await confirmRes.json()).state).toBe("PENDING_APPROVAL");

    const approveRes = await fetch(`${baseUrl}/reservations/${body.id}/approve`, { method: "POST" });
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).state).toBe("CONFIRMED");
  });

  it("rejects a PENDING_APPROVAL reservation via /reject", async () => {
    const { body } = await createReservation(
      "2027-04-04T18:00:00Z",
      "2027-04-04T19:00:00Z",
      approvalResourceId
    );
    await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });

    const rejectRes = await fetch(`${baseUrl}/reservations/${body.id}/reject`, { method: "POST" });
    expect(rejectRes.status).toBe(200);
    expect((await rejectRes.json()).state).toBe("REJECTED");

    // Rejected is a closed decision — a second decision on it is invalid.
    const approveAfterReject = await fetch(`${baseUrl}/reservations/${body.id}/approve`, { method: "POST" });
    expect(approveAfterReject.status).toBe(409);
  });
});

describe("POST /reservations/:id/cancel — BR-03 cancellation policy", () => {
  // C02 OP-04 example (B10): success case.
  it("cancels a CONFIRMED reservation before its start and frees the slot", async () => {
    const { body } = await createReservation("2027-04-05T18:00:00Z", "2027-04-05T19:00:00Z");
    await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });

    const cancelRes = await fetch(`${baseUrl}/reservations/${body.id}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).state).toBe("CANCELLED");

    const availability = await fetch(
      `${baseUrl}/resources/${resourceId}/availability?start=2027-04-05T18:00:00Z&end=2027-04-05T19:00:00Z`
    );
    expect(await availability.json()).toEqual({ available: true });
  });

  // C02 OP-04 example (B10): negative case — the cancellation window (R-4) has passed.
  it("rejects cancelling a reservation after its start time", async () => {
    // startsAt already in the past: isolates OP-04's own time guard from
    // OP-03's no-show check (which only fires on confirm, not on cancel).
    const { body } = await createReservation("2020-01-01T18:00:00Z", "2020-01-01T19:00:00Z");
    const res = await fetch(`${baseUrl}/reservations/${body.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: body.id } });
    expect(reloaded.state).toBe("DRAFT");
  });

  // R-5: repeating a cancel (e.g. after a client-side timeout) must not error.
  it("is idempotent when cancelling an already-cancelled reservation", async () => {
    const { body } = await createReservation("2027-04-06T18:00:00Z", "2027-04-06T19:00:00Z");
    const first = await fetch(`${baseUrl}/reservations/${body.id}/cancel`, { method: "POST" });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/reservations/${body.id}/cancel`, { method: "POST" });
    expect(second.status).toBe(200);
    expect((await second.json()).state).toBe("CANCELLED");
  });
});

describe("GET /resources/:id/availability", () => {
  it("rejects missing or unparsable query parameters with 400", async () => {
    const missing = await fetch(`${baseUrl}/resources/${resourceId}/availability`);
    expect(missing.status).toBe(400);

    const garbage = await fetch(
      `${baseUrl}/resources/${resourceId}/availability?start=blabla&end=nic`
    );
    expect(garbage.status).toBe(400);
  });

  it("reports a confirmed slot as unavailable and a free slot as available", async () => {
    const { body } = await createReservation("2027-03-04T18:00:00Z", "2027-03-04T20:00:00Z");
    const confirmed = await fetch(`${baseUrl}/reservations/${body.id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);

    const taken = await fetch(
      `${baseUrl}/resources/${resourceId}/availability?start=2027-03-04T19:00:00Z&end=2027-03-04T21:00:00Z`
    );
    expect(await taken.json()).toEqual({ available: false });

    const free = await fetch(
      `${baseUrl}/resources/${resourceId}/availability?start=2027-03-04T21:00:00Z&end=2027-03-04T22:00:00Z`
    );
    expect(await free.json()).toEqual({ available: true });
  });
});
