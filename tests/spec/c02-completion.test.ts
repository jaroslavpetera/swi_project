import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.js";
import { ReservationRepository } from "../../src/repositories/reservationRepository.js";
import { ReservationState as S } from "../../src/domain/types.js";
import { ApprovalExpiredError, NoShowExpiredError, ReservationService } from "../../src/services/reservationService.js";

const db = new PrismaClient();
const service = new ReservationService(new ReservationRepository(db));
const resources: string[] = [];
let userId: string;
let server: Server;
let base: string;
const start = new Date("2027-06-01T18:00:00Z");
const end = new Date("2027-06-01T20:00:00Z");
const before = new Date("2027-06-01T17:29:59.999Z");
const deadline = new Date("2027-06-01T17:30:00Z");

beforeAll(async () => {
  userId = (await db.user.create({ data: { name: "C02", email: `${randomUUID()}@test.local` } })).id;
  server = createApp(db).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.reservation.deleteMany({ where: { resourceId: { in: resources } } });
  await db.resource.deleteMany({ where: { id: { in: resources } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

async function post(path: string, body: unknown = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function resource(approval = true) {
  const result = await post("/resources", { name: "C02 table", capacity: 4, requiresApproval: approval });
  expect(result.status).toBe(201);
  resources.push(result.body.id);
  return result.body.id as string;
}
async function create(resourceId: string) {
  const result = await post("/reservations", { resourceId, userId, startsAt: start, endsAt: end });
  expect(result.status).toBe(201);
  return result.body.id as string;
}
async function available(resourceId: string) {
  const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const response = await fetch(`${base}/resources/${resourceId}/availability?${query}`);
  expect(response.status).toBe(200);
  return (await response.json()).available;
}

describe("C02 v0.2 — requirement verification", () => {
  it("V-02.8: pending does not allocate; approval allocates; cancel releases (HTTP)", async () => {
    const table = await resource();
    const id = await create(table);
    expect((await post(`/reservations/${id}/confirm`)).status).toBe(202);
    expect(await available(table)).toBe(true);
    expect((await db.reservation.findUniqueOrThrow({ where: { id } })).state).toBe(S.PENDING_APPROVAL);
    expect((await post(`/reservations/${id}/approve`)).body.state).toBe(S.CONFIRMED);
    expect(await available(table)).toBe(false);
    expect((await post(`/reservations/${id}/cancel`)).body.state).toBe(S.CANCELLED);
    expect(await available(table)).toBe(true);
  });

  it("V-02.9: rejected and cancelled pending requests do not block (HTTP)", async () => {
    const table = await resource();
    for (const action of ["reject", "cancel"]) {
      const id = await create(table);
      expect((await post(`/reservations/${id}/confirm`)).status).toBe(202);
      expect((await post(`/reservations/${id}/${action}`)).status).toBe(200);
      expect(await available(table)).toBe(true);
      expect((await post(`/reservations/${id}/approve`)).status).toBe(409);
    }
  });

  it("V-05.5: new competing approval rejects the older pending request without changing it (HTTP)", async () => {
    const table = await resource();
    const first = await create(table);
    const second = await create(table);
    for (const id of [first, second]) expect((await post(`/reservations/${id}/confirm`)).status).toBe(202);
    expect((await post(`/reservations/${second}/approve`)).status).toBe(200);
    expect((await post(`/reservations/${first}/approve`)).status).toBe(409);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: first } })).state).toBe(S.PENDING_APPROVAL);
  });

  it("V-03.3: confirm one millisecond before deadline succeeds; at deadline cancels", async () => {
    const table = await resource(false);
    const good = await create(table);
    expect((await service.confirmReservation(good, before)).state).toBe(S.CONFIRMED);
    const late = await create(table);
    await expect(service.confirmReservation(late, deadline)).rejects.toBeInstanceOf(NoShowExpiredError);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: late } })).state).toBe(S.CANCELLED);
  });

  it("V-05.6: approve before deadline succeeds; at deadline persists EXPIRED and leaves slot free", async () => {
    const table = await resource();
    const good = await create(table);
    await service.confirmReservation(good, before);
    expect((await service.approveReservation(good, before)).state).toBe(S.CONFIRMED);
    await service.cancelReservation(good, before);
    const late = await create(table);
    await service.confirmReservation(late, before);
    await expect(service.approveReservation(late, deadline)).rejects.toBeInstanceOf(ApprovalExpiredError);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: late } })).state).toBe(S.EXPIRED);
    expect(await available(table)).toBe(true);
    expect((await post(`/reservations/${late}/cancel`)).status).toBe(409);
  });

  it("V-05.7: reads do not expire a pending request; reject after deadline still succeeds", async () => {
    const table = await resource();
    const id = await create(table);
    await service.confirmReservation(id, before);
    // Put the deadline in the real past, so the actual HTTP request tests overdue rejection.
    await db.reservation.update({ where: { id }, data: {
      startsAt: new Date("2020-01-01T18:00:00Z"), endsAt: new Date("2020-01-01T20:00:00Z"),
    } });
    const read = await fetch(`${base}/resources/${table}/reservations`);
    expect((await read.json())[0].state).toBe(S.PENDING_APPROVAL);
    expect((await post(`/reservations/${id}/reject`)).body.state).toBe(S.REJECTED);
  });

  it("V-04.3: repeat cancel succeeds after start; pending cancel between deadline and start succeeds", async () => {
    const table = await resource();
    const id = await create(table);
    await service.confirmReservation(id, before);
    expect((await service.cancelReservation(id, deadline)).state).toBe(S.CANCELLED);
    expect((await service.cancelReservation(id, end)).state).toBe(S.CANCELLED);
  });

  it("V-01.5: past interval can be created but never confirmed (HTTP)", async () => {
    const table = await resource(false);
    const result = await post("/reservations", {
      resourceId: table, userId, startsAt: "2020-01-01T18:00:00Z", endsAt: "2020-01-01T20:00:00Z",
    });
    expect(result.status).toBe(201);
    expect((await post(`/reservations/${result.body.id}/confirm`)).status).toBe(410);
  });

  it("V-05.8: HTTP expiry returns 410 with persisted EXPIRED, then 409 on retry", async () => {
    const table = await resource();
    const id = await create(table);
    await service.confirmReservation(id, before);
    await db.reservation.update({ where: { id }, data: {
      startsAt: new Date("2020-01-01T18:00:00Z"), endsAt: new Date("2020-01-01T20:00:00Z"),
    } });
    expect((await post(`/reservations/${id}/approve`)).status).toBe(410);
    expect((await db.reservation.findUniqueOrThrow({ where: { id } })).state).toBe(S.EXPIRED);
    expect((await post(`/reservations/${id}/approve`)).status).toBe(409);
  });

  it("V-05.9: requiresApproval must be a JSON boolean, not a truthy string", async () => {
    const result = await post("/resources", { name: "invalid flag", capacity: 4, requiresApproval: "false" });
    expect(result.status).toBe(400);
  });

  it("V-04R.8: concurrent HTTP confirmations return 200/409 and allocate once", async () => {
    const table = await resource(false);
    const a = await create(table); const b = await create(table);
    const results = await Promise.all([post(`/reservations/${a}/confirm`), post(`/reservations/${b}/confirm`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.reservation.count({ where: { resourceId: table, state: S.CONFIRMED } })).toBe(1);
  });
});
