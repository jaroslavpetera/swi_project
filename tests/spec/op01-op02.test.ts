// Příklady ověření z docs/specification.md, baseline v0.1 — část A.
// Každý test odpovídá jednomu očíslovanému příkladu (V-01.x, V-02.x), aby šlo
// z běžícího chování dohledat požadavek a naopak.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../../src/http/app.js";

const prisma = new PrismaClient();
let server: Server;
let baseUrl: string;
let userId: string;
const createdResourceIds: string[] = [];

// Každý příklad dostane vlastní stůl, aby se scénáře navzájem neovlivňovaly.
async function freshResource(): Promise<string> {
  const resource = await prisma.resource.create({ data: { name: "Table spec", capacity: 4 } });
  createdResourceIds.push(resource.id);
  return resource.id;
}

async function create(resourceId: string, startsAt: string, endsAt: string, user = userId) {
  const res = await fetch(`${baseUrl}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId, userId: user, startsAt, endsAt }),
  });
  return { status: res.status, body: (await res.json()) as { id?: string; state?: string } };
}

async function availability(resourceId: string, start: string, end: string) {
  const query = new URLSearchParams({ start, end });
  const res = await fetch(`${baseUrl}/resources/${resourceId}/availability?${query}`);
  return { status: res.status, body: await res.json() };
}

async function confirm(id: string) {
  const res = await fetch(`${baseUrl}/reservations/${id}/confirm`, { method: "POST" });
  return res.status;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "Spec Tester", email: `spec-${Date.now()}@test.local` },
  });
  userId = user.id;

  server = createApp(prisma).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.reservation.deleteMany({ where: { resourceId: { in: createdResourceIds } } });
  await prisma.resource.deleteMany({ where: { id: { in: createdResourceIds } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("OP-01 Create Reservation (REQ-01)", () => {
  it("V-01.1: valid Resource, User and interval → one DRAFT reservation with an identifier", async () => {
    const resourceId = await freshResource();
    const { status, body } = await create(
      resourceId,
      "2027-03-01T18:00:00Z",
      "2027-03-01T20:00:00Z"
    );

    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.state).toBe("DRAFT");

    const stored = await prisma.reservation.findMany({ where: { resourceId } });
    expect(stored).toHaveLength(1);
  });

  it("V-01.2: start == end → rejected, nothing created (BR-01)", async () => {
    const resourceId = await freshResource();
    const { status } = await create(resourceId, "2027-03-01T18:00:00Z", "2027-03-01T18:00:00Z");

    expect(status).toBe(400);
    expect(await prisma.reservation.count({ where: { resourceId } })).toBe(0);
  });

  it("V-01.3: unknown Resource → rejected, nothing created", async () => {
    const { status } = await create(
      "neexistujici-stul",
      "2027-03-01T18:00:00Z",
      "2027-03-01T20:00:00Z"
    );

    expect(status).toBe(400);
    expect(await prisma.reservation.count({ where: { resourceId: "neexistujici-stul" } })).toBe(0);
  });

  it("V-01.4: interval inside a CONFIRMED reservation → still accepted as DRAFT (D-02)", async () => {
    const resourceId = await freshResource();
    const first = await create(resourceId, "2027-03-05T18:00:00Z", "2027-03-05T22:00:00Z");
    expect(await confirm(first.body.id!)).toBe(200);

    const overlapping = await create(
      resourceId,
      "2027-03-05T19:00:00Z",
      "2027-03-05T20:00:00Z"
    );

    // Create nekontroluje kolize — ta se pozná až při potvrzení (OP-03).
    expect(overlapping.status).toBe(201);
    expect(overlapping.body.state).toBe("DRAFT");
  });
});

describe("OP-02 Check Availability (REQ-02)", () => {
  it("V-02.1 / V-02.2: free slot → available, overlapping slot → unavailable", async () => {
    const resourceId = await freshResource();
    const { body } = await create(resourceId, "2027-03-06T18:00:00Z", "2027-03-06T20:00:00Z");
    expect(await confirm(body.id!)).toBe(200);

    const free = await availability(resourceId, "2027-03-06T21:00:00Z", "2027-03-06T22:00:00Z");
    expect(free.body).toEqual({ available: true });

    const overlapping = await availability(
      resourceId,
      "2027-03-06T19:00:00Z",
      "2027-03-06T21:00:00Z"
    );
    expect(overlapping.body).toEqual({ available: false });
  });

  it("V-02.3 / V-02.4: touching intervals are available — [start,end) boundary (BR-01)", async () => {
    const resourceId = await freshResource();
    const { body } = await create(resourceId, "2027-03-07T18:00:00Z", "2027-03-07T20:00:00Z");
    expect(await confirm(body.id!)).toBe(200);

    const rightAfter = await availability(
      resourceId,
      "2027-03-07T20:00:00Z",
      "2027-03-07T21:00:00Z"
    );
    expect(rightAfter.body).toEqual({ available: true });

    const rightBefore = await availability(
      resourceId,
      "2027-03-07T17:00:00Z",
      "2027-03-07T18:00:00Z"
    );
    expect(rightBefore.body).toEqual({ available: true });
  });

  it("V-02.5: a DRAFT reservation does not block the slot (D-01)", async () => {
    const resourceId = await freshResource();
    await create(resourceId, "2027-03-08T18:00:00Z", "2027-03-08T20:00:00Z");

    const sameSlot = await availability(
      resourceId,
      "2027-03-08T18:00:00Z",
      "2027-03-08T20:00:00Z"
    );
    expect(sameSlot.body).toEqual({ available: true });
  });

  it("V-02.6: invalid interval → rejected, never answered with 'available'", async () => {
    const resourceId = await freshResource();

    const unparsable = await availability(resourceId, "blabla", "nic");
    expect(unparsable.status).toBe(400);
    expect(unparsable.body).not.toEqual({ available: true });

    const reversed = await availability(
      resourceId,
      "2027-03-09T20:00:00Z",
      "2027-03-09T18:00:00Z"
    );
    expect(reversed.status).toBe(400);
  });

  it("V-02.7: unknown Resource → rejected", async () => {
    const unknown = await availability(
      "neexistujici-stul",
      "2027-03-10T18:00:00Z",
      "2027-03-10T20:00:00Z"
    );

    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toEqual({ available: true });
  });

  it("availability is a pure query: no reservation is created or changed", async () => {
    const resourceId = await freshResource();
    const { body } = await create(resourceId, "2027-03-11T18:00:00Z", "2027-03-11T20:00:00Z");

    await availability(resourceId, "2027-03-11T18:00:00Z", "2027-03-11T20:00:00Z");

    expect(await prisma.reservation.count({ where: { resourceId } })).toBe(1);
    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: body.id! } });
    expect(reloaded.state).toBe("DRAFT");
  });
});
