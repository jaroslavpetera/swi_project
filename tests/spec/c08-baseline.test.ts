// C08 — krokované test cases nad výchozí baseline (Controlled Change, CR-C08-01).
// Expected je převzaté ze specifikace v0.2 (BR-01, BR-02, BR-05, BR-06, OP-05) před během,
// ne z chování kódu. Každý krok volá skutečné HTTP API nad PostgreSQL a stav ověřuje
// samostatným čtením z databáze (oracle = uložený stav, ne HTTP odpověď).
// Popis případů a záznam výsledků: docs/evidence-and-evolution.md › C08 Test cases.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { PrismaClient } from "../../src/database.js";
import { createApp } from "../../src/http/app.js";

const prisma = new PrismaClient();
// Nezávislý oracle: vlastní spojení, čte jen commitnutý stav.
const oracle = new PrismaClient();
let server: Server;
let baseUrl: string;
let userId: string;
const createdResourceIds: string[] = [];

async function post(path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { id?: string; state?: string } };
}

// Krok 1 (příprava): R1 vyžaduje schválení (BR-05), B1 je CONFIRMED, B2 čeká na schválení.
// Vše vzniká přes skutečné API: Create → Confirm (202 PENDING_APPROVAL) → Approve.
async function prepare(b2StartsAt: string, b2EndsAt: string) {
  const resource = await prisma.resource.create({
    data: { name: "C08 R1", capacity: 4, requiresApproval: true },
  });
  createdResourceIds.push(resource.id);

  const b1 = await post("/reservations", {
    resourceId: resource.id, userId, startsAt: "2027-04-01T10:00:00Z", endsAt: "2027-04-01T11:00:00Z",
  });
  expect((await post(`/reservations/${b1.body.id}/confirm`)).status).toBe(202);
  expect((await post(`/reservations/${b1.body.id}/approve`)).status).toBe(200);

  const b2 = await post("/reservations", { resourceId: resource.id, userId, startsAt: b2StartsAt, endsAt: b2EndsAt });
  expect((await post(`/reservations/${b2.body.id}/confirm`)).status).toBe(202);

  return { resourceId: resource.id, b1: b1.body.id!, b2: b2.body.id! };
}

async function storedState(resourceId: string) {
  const rows = await oracle.reservation.findMany({ where: { resourceId }, orderBy: { startsAt: "asc" } });
  return rows.map((r) => ({ id: r.id, state: r.state, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
}

function confirmedOverlaps(rows: { state: string; startsAt: string; endsAt: string }[]) {
  const confirmed = rows.filter((r) => r.state === "CONFIRMED");
  let count = 0;
  for (let i = 0; i < confirmed.length; i++)
    for (let j = i + 1; j < confirmed.length; j++)
      if (confirmed[i].startsAt < confirmed[j].endsAt && confirmed[j].startsAt < confirmed[i].endsAt) count++;
  return count;
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { name: "C08 Tester", email: `c08-${Date.now()}@test.local` } });
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
  await Promise.all([prisma.$disconnect(), oracle.$disconnect()]);
});

describe("C08 baseline — krokované test cases", () => {
  // Krok 5 = opakování na nově připravených datech; obě běhy musí dát stejný výsledek.
  it.each([1, 2])("TC-C08-01 (run %i): Approve sousedního intervalu [11:00,12:00) vedle CONFIRMED [10:00,11:00) uspěje", async () => {
    const { resourceId, b1, b2 } = await prepare("2027-04-01T11:00:00Z", "2027-04-01T12:00:00Z");

    // Krok 2: nezávisle přečíst výchozí uložený stav.
    const before = await storedState(resourceId);
    expect(before).toEqual([
      { id: b1, state: "CONFIRMED", startsAt: "2027-04-01T10:00:00.000Z", endsAt: "2027-04-01T11:00:00.000Z" },
      { id: b2, state: "PENDING_APPROVAL", startsAt: "2027-04-01T11:00:00.000Z", endsAt: "2027-04-01T12:00:00.000Z" },
    ]);

    // Krok 3: skutečná operace Approve(B2).
    const approve = await post(`/reservations/${b2}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body.state).toBe("CONFIRMED");

    // Krok 4: znovu načíst commitnutý stav — obě CONFIRMED, bez překryvu (BR-01 půlotevřené intervaly).
    const after = await storedState(resourceId);
    expect(after.map((r) => r.state)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(confirmedOverlaps(after)).toBe(0);
  });

  it.each([1, 2])("TC-C08-02 (run %i): Approve překrývajícího se [10:30,11:30) je odmítnut, B2 zůstává čekající", async () => {
    const { resourceId, b1, b2 } = await prepare("2027-04-01T10:30:00Z", "2027-04-01T11:30:00Z");

    // Krok 2: překryv v čase existuje, ale potvrzená je jen B1.
    const before = await storedState(resourceId);
    expect(before.map((r) => [r.id, r.state])).toEqual([[b1, "CONFIRMED"], [b2, "PENDING_APPROVAL"]]);

    // Krok 3: Approve(B2) → konflikt podle kontraktu OP-05 (409, žádná alokace).
    const approve = await post(`/reservations/${b2}/approve`);
    expect(approve.status).toBe(409);

    // Krok 4: B1 beze změny, B2 není CONFIRMED (zůstává PENDING_APPROVAL podle OP-05).
    const after = await storedState(resourceId);
    expect(after).toEqual(before);
    expect(confirmedOverlaps(after)).toBe(0);
  });

  // Pozorování výchozího chování pro CR-C08-01: čtení nerozliší propadlou čekající žádost.
  // Fixture se zakládá přímo v DB (stejně jako V-04R.7 a zátěžový test): žádost, která čekala
  // a mezitím jí uplynul termín schválení BR-06 (startsAt − 30 min).
  it("TC-C08-03: čekající žádost po termínu BR-06 se při čtení vrací jako PENDING_APPROVAL; až Approve uloží EXPIRED", async () => {
    const resource = await prisma.resource.create({ data: { name: "C08 overdue", capacity: 2, requiresApproval: true } });
    createdResourceIds.push(resource.id);
    const startsAt = new Date(Date.now() + 10 * 60_000); // termín schválení uplynul před 20 min
    const pending = await prisma.reservation.create({
      data: { userId, resourceId: resource.id, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), state: "PENDING_APPROVAL" },
    });

    // Čtení, které používá přehled obsluhy: stav je pořád PENDING_APPROVAL, nic nenaznačuje propadnutí.
    const list = await fetch(`${baseUrl}/resources/${resource.id}/reservations`);
    const rows = (await list.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("PENDING_APPROVAL");
    expect(Object.keys(rows[0]).sort()).toEqual(["createdAt", "endsAt", "id", "resourceId", "startsAt", "state", "updatedAt", "userId"].sort());
    // R-16: čtení je čisté — uložený stav se nezměnil.
    expect((await oracle.reservation.findUniqueOrThrow({ where: { id: pending.id } })).state).toBe("PENDING_APPROVAL");

    // Teprve pokus o Approve propadnutí detekuje (BR-06): 410 a uložený EXPIRED.
    const approve = await post(`/reservations/${pending.id}/approve`);
    expect(approve.status).toBe(410);
    expect((await oracle.reservation.findUniqueOrThrow({ where: { id: pending.id } })).state).toBe("EXPIRED");
  });
});
