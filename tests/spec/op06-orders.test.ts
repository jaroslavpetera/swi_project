// Příklady ověření pro OP-06 Place Order (BR-07) z docs/specification.md.
//
// Pozn. k přípravě dat: rezervaci, která právě probíhá, nelze potvrdit přes API,
// protože BR-04 (no-show) potvrzení 30 minut před začátkem zakazuje. Stav
// CONFIRMED se proto pro probíhající slot připraví přímo v DB a testovaná
// operace (objednání) už jde přes HTTP.
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
let beerId: string;
let goulashId: string;
const MINUTE = 60_000;

async function reservationInState(
  state: string,
  startsAt: Date,
  endsAt: Date
): Promise<string> {
  const row = await prisma.reservation.create({
    data: { resourceId, userId, startsAt, endsAt, state },
  });
  return row.id;
}

async function ongoingConfirmed(): Promise<string> {
  const now = Date.now();
  return reservationInState("CONFIRMED", new Date(now - 30 * MINUTE), new Date(now + 90 * MINUTE));
}

async function placeOrder(reservationId: string, items: unknown) {
  const res = await fetch(`${baseUrl}/reservations/${reservationId}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "Order Tester", email: `order-${Date.now()}@test.local` },
  });
  const resource = await prisma.resource.create({ data: { name: "Table orders", capacity: 4 } });
  userId = user.id;
  resourceId = resource.id;

  const beer = await prisma.menuItem.create({
    data: { name: `Pivo 12° test ${Date.now()}`, category: "DRINK", priceCents: 5900 },
  });
  const goulash = await prisma.menuItem.create({
    data: { name: `Guláš test ${Date.now()}`, category: "FOOD", priceCents: 21900 },
  });
  beerId = beer.id;
  goulashId = goulash.id;

  server = createApp(prisma).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const reservations = await prisma.reservation.findMany({ where: { resourceId } });
  const ids = reservations.map((r) => r.id);
  await prisma.orderItem.deleteMany({ where: { order: { reservationId: { in: ids } } } });
  await prisma.order.deleteMany({ where: { reservationId: { in: ids } } });
  await prisma.reservation.deleteMany({ where: { resourceId } });
  await prisma.menuItem.deleteMany({ where: { id: { in: [beerId, goulashId] } } });
  await prisma.resource.delete({ where: { id: resourceId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("OP-06 Place Order (REQ-07, BR-07)", () => {
  it("V-06.1: CONFIRMED reservation during its slot → order is placed with a total", async () => {
    const reservationId = await ongoingConfirmed();

    const { status, body } = await placeOrder(reservationId, [
      { menuItemId: beerId, quantity: 2 },
      { menuItemId: goulashId, quantity: 1 },
    ]);

    expect(status).toBe(201);
    expect(body.state).toBe("PLACED");
    expect(body.totalCents).toBe(2 * 5900 + 21900);
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ quantity: 2, unitPriceCents: 5900 });
  });

  it("V-06.2: DRAFT reservation during its slot → rejected (NOT_CONFIRMED)", async () => {
    const now = Date.now();
    const reservationId = await reservationInState(
      "DRAFT",
      new Date(now - 10 * MINUTE),
      new Date(now + 50 * MINUTE)
    );

    const { status, body } = await placeOrder(reservationId, [{ menuItemId: beerId, quantity: 1 }]);

    expect(status).toBe(409);
    expect(body.reason).toBe("NOT_CONFIRMED");
    expect(await prisma.order.count({ where: { reservationId } })).toBe(0);
  });

  it("V-06.3: CONFIRMED reservation that has not started yet → rejected (BEFORE_START)", async () => {
    const now = Date.now();
    const reservationId = await reservationInState(
      "CONFIRMED",
      new Date(now + 120 * MINUTE),
      new Date(now + 240 * MINUTE)
    );

    const { status, body } = await placeOrder(reservationId, [{ menuItemId: beerId, quantity: 1 }]);

    expect(status).toBe(409);
    expect(body.reason).toBe("BEFORE_START");
  });

  it("V-06.4: CONFIRMED reservation that already ended → rejected (AFTER_END)", async () => {
    const now = Date.now();
    const reservationId = await reservationInState(
      "CONFIRMED",
      new Date(now - 240 * MINUTE),
      new Date(now - 120 * MINUTE)
    );

    const { status, body } = await placeOrder(reservationId, [{ menuItemId: beerId, quantity: 1 }]);

    expect(status).toBe(409);
    expect(body.reason).toBe("AFTER_END");
  });

  it("V-06.5: unknown menu item → rejected, nothing ordered", async () => {
    const reservationId = await ongoingConfirmed();

    const { status } = await placeOrder(reservationId, [
      { menuItemId: "neexistujici-polozka", quantity: 1 },
    ]);

    expect(status).toBe(400);
    expect(await prisma.order.count({ where: { reservationId } })).toBe(0);
  });

  it("V-06.6: an order without items → rejected", async () => {
    const reservationId = await ongoingConfirmed();

    const { status } = await placeOrder(reservationId, []);

    expect(status).toBe(400);
    expect(await prisma.order.count({ where: { reservationId } })).toBe(0);
  });

  it("V-06.7: item marked as unavailable → rejected", async () => {
    const reservationId = await ongoingConfirmed();
    const soldOut = await prisma.menuItem.create({
      data: {
        name: `Utopenec došel ${Date.now()}`,
        category: "FOOD",
        priceCents: 8900,
        available: false,
      },
    });

    const { status } = await placeOrder(reservationId, [{ menuItemId: soldOut.id, quantity: 1 }]);

    expect(status).toBe(400);
    await prisma.menuItem.delete({ where: { id: soldOut.id } });
  });

  it("V-06.8: unknown reservation → 404", async () => {
    const { status } = await placeOrder("neexistujici-rezervace", [
      { menuItemId: beerId, quantity: 1 },
    ]);

    expect(status).toBe(404);
  });

  it("V-06.9: a later price change does not alter an order already placed", async () => {
    const reservationId = await ongoingConfirmed();
    const item = await prisma.menuItem.create({
      data: { name: `Pivo akce ${Date.now()}`, category: "DRINK", priceCents: 4000 },
    });

    const placed = await placeOrder(reservationId, [{ menuItemId: item.id, quantity: 3 }]);
    expect(placed.body.totalCents).toBe(12000);

    await prisma.menuItem.update({ where: { id: item.id }, data: { priceCents: 9900 } });

    const reloaded = await fetch(`${baseUrl}/reservations/${reservationId}/orders`);
    const orders = await reloaded.json();
    expect(orders[0].totalCents).toBe(12000);

    await prisma.orderItem.deleteMany({ where: { menuItemId: item.id } });
    await prisma.order.deleteMany({ where: { reservationId } });
    await prisma.menuItem.delete({ where: { id: item.id } });
  });
});

describe("Tab (účet hosta) and order lifecycle", () => {
  it("V-06.10: placed order is unpaid, serving and paying move it to paid", async () => {
    const reservationId = await ongoingConfirmed();
    const placed = await placeOrder(reservationId, [{ menuItemId: beerId, quantity: 2 }]);
    const orderId = placed.body.id;

    const openTab = await (await fetch(`${baseUrl}/reservations/${reservationId}/tab`)).json();
    expect(openTab.unpaidCents).toBe(11800);
    expect(openTab.paidCents).toBe(0);

    const served = await fetch(`${baseUrl}/orders/${orderId}/serve`, { method: "POST" });
    expect(served.status).toBe(200);
    expect((await served.json()).state).toBe("SERVED");

    const paid = await fetch(`${baseUrl}/orders/${orderId}/pay`, { method: "POST" });
    expect(paid.status).toBe(200);
    expect((await paid.json()).state).toBe("PAID");

    const settledTab = await (await fetch(`${baseUrl}/reservations/${reservationId}/tab`)).json();
    expect(settledTab.unpaidCents).toBe(0);
    expect(settledTab.paidCents).toBe(11800);
    expect(settledTab.totalCents).toBe(11800);
  });

  it("V-06.11: an order cannot be paid before it is served", async () => {
    const reservationId = await ongoingConfirmed();
    const placed = await placeOrder(reservationId, [{ menuItemId: beerId, quantity: 1 }]);

    const paid = await fetch(`${baseUrl}/orders/${placed.body.id}/pay`, { method: "POST" });

    expect(paid.status).toBe(409);
    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    expect(reloaded.state).toBe("PLACED");
  });
});
