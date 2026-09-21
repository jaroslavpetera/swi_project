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

async function createReservation(startsAt: string, endsAt: string) {
  const res = await fetch(`${baseUrl}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId, userId, startsAt, endsAt }),
  });
  return { status: res.status, body: (await res.json()) as { id: string; state: string } };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "HTTP Tester", email: `http-${Date.now()}@test.local` },
  });
  const resource = await prisma.resource.create({ data: { name: "Table HTTP", capacity: 4 } });
  userId = user.id;
  resourceId = resource.id;

  server = createApp(prisma).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.reservation.deleteMany({ where: { resourceId } });
  await prisma.resource.delete({ where: { id: resourceId } });
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
