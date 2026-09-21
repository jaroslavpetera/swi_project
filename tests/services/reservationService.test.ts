// C02 (Osoba B): OP-03/OP-04/OP-05 service-level behaviour. Uses a real
// database (same pattern as the C01 persistence spike) and passes an
// explicit `now` where the rule under test depends on time, since the HTTP
// layer intentionally does not expose a way to fake the clock.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ReservationRepository } from "../../src/repositories/reservationRepository.js";
import {
  ReservationService,
  OverlapError,
  ApprovalExpiredError,
  NotCancellableError,
  CancellationWindowError,
  InvalidStateError,
} from "../../src/services/reservationService.js";
import { ReservationState } from "../../src/domain/types.js";

const prisma = new PrismaClient();
const service = new ReservationService(new ReservationRepository(prisma));

let userId: string;
let openResourceId: string;
let approvalResourceId: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { name: "Service Tester", email: `service-${Date.now()}-${Math.random()}@test.local` },
  });
  const openResource = await prisma.resource.create({
    data: { name: `Table ${Date.now()}`, capacity: 4 },
  });
  const approvalResource = await prisma.resource.create({
    data: { name: `VIP room ${Date.now()}`, capacity: 8, requiresApproval: true },
  });
  userId = user.id;
  openResourceId = openResource.id;
  approvalResourceId = approvalResource.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OP-03 Confirm — BR-05 requiresApproval routing", () => {
  it("confirms directly to CONFIRMED when the resource does not require approval", async () => {
    const reservation = await service.createReservation({
      resourceId: openResourceId,
      userId,
      startsAt: new Date("2027-05-01T18:00:00Z"),
      endsAt: new Date("2027-05-01T19:00:00Z"),
    });
    const confirmed = await service.confirmReservation(reservation.id, new Date("2027-05-01T10:00:00Z"));
    expect(confirmed.state).toBe(ReservationState.CONFIRMED);
  });

  it("routes to PENDING_APPROVAL when the resource requires approval", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-01T18:00:00Z"),
      endsAt: new Date("2027-05-01T19:00:00Z"),
    });
    const result = await service.confirmReservation(reservation.id, new Date("2027-05-01T10:00:00Z"));
    expect(result.state).toBe(ReservationState.PENDING_APPROVAL);
  });
});

describe("OP-05 Approve Reservation", () => {
  it("approves a PENDING_APPROVAL reservation with no conflict", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-02T18:00:00Z"),
      endsAt: new Date("2027-05-02T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-02T10:00:00Z"));

    const approved = await service.approveReservation(reservation.id, new Date("2027-05-02T10:05:00Z"));
    expect(approved.state).toBe(ReservationState.CONFIRMED);
  });

  it("re-checks BR-02 overlap at approve time, not just at request time", async () => {
    const pending = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-03T18:00:00Z"),
      endsAt: new Date("2027-05-03T19:00:00Z"),
    });
    await service.confirmReservation(pending.id, new Date("2027-05-03T10:00:00Z"));

    // A second, non-approval reservation on the SAME resource gets confirmed
    // in the meantime — approvalResourceId here is treated as an open slot
    // for this second booking to demonstrate the race the re-check guards.
    const other = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-03T18:30:00Z"),
      endsAt: new Date("2027-05-03T19:30:00Z"),
    });
    await prisma.reservation.update({
      where: { id: other.id },
      data: { state: ReservationState.CONFIRMED },
    });

    await expect(
      service.approveReservation(pending.id, new Date("2027-05-03T10:05:00Z"))
    ).rejects.toBeInstanceOf(OverlapError);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: pending.id } });
    expect(reloaded.state).toBe(ReservationState.PENDING_APPROVAL);
  });

  it("expires a PENDING_APPROVAL reservation once the approval deadline has passed", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-04T18:00:00Z"),
      endsAt: new Date("2027-05-04T19:00:00Z"),
    });
    // Well before the no-show deadline (start - 30min), so Confirm succeeds.
    await service.confirmReservation(reservation.id, new Date("2027-05-04T10:00:00Z"));

    // Past the approval deadline (start - 30min = 17:30).
    await expect(
      service.approveReservation(reservation.id, new Date("2027-05-04T17:45:00Z"))
    ).rejects.toBeInstanceOf(ApprovalExpiredError);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(reloaded.state).toBe(ReservationState.EXPIRED);
  });

  it("rejects approving a reservation that is not PENDING_APPROVAL", async () => {
    const reservation = await service.createReservation({
      resourceId: openResourceId,
      userId,
      startsAt: new Date("2027-05-05T18:00:00Z"),
      endsAt: new Date("2027-05-05T19:00:00Z"),
    });
    await expect(service.approveReservation(reservation.id)).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("OP-05 Reject Reservation", () => {
  it("moves a PENDING_APPROVAL reservation to REJECTED", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-06T18:00:00Z"),
      endsAt: new Date("2027-05-06T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-06T10:00:00Z"));

    const rejected = await service.rejectReservation(reservation.id);
    expect(rejected.state).toBe(ReservationState.REJECTED);
  });
});

describe("OP-04 Cancel — BR-03 cancellation policy", () => {
  it("cancels a CONFIRMED reservation before its start and frees the slot", async () => {
    const reservation = await service.createReservation({
      resourceId: openResourceId,
      userId,
      startsAt: new Date("2027-05-07T18:00:00Z"),
      endsAt: new Date("2027-05-07T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-07T10:00:00Z"));

    const cancelled = await service.cancelReservation(reservation.id, new Date("2027-05-07T10:05:00Z"));
    expect(cancelled.state).toBe(ReservationState.CANCELLED);

    const available = await service.checkAvailability(
      openResourceId,
      new Date("2027-05-07T18:00:00Z"),
      new Date("2027-05-07T19:00:00Z")
    );
    expect(available).toBe(true);
  });

  it("allows cancelling a PENDING_APPROVAL reservation (B13 decision)", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-08T18:00:00Z"),
      endsAt: new Date("2027-05-08T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-08T10:00:00Z"));

    const cancelled = await service.cancelReservation(reservation.id, new Date("2027-05-08T10:05:00Z"));
    expect(cancelled.state).toBe(ReservationState.CANCELLED);
  });

  it("rejects cancelling once the cancellation window has passed (R-4)", async () => {
    const reservation = await service.createReservation({
      resourceId: openResourceId,
      userId,
      startsAt: new Date("2027-05-09T18:00:00Z"),
      endsAt: new Date("2027-05-09T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-09T10:00:00Z"));

    await expect(
      service.cancelReservation(reservation.id, new Date("2027-05-09T18:00:01Z"))
    ).rejects.toBeInstanceOf(CancellationWindowError);

    const reloaded = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(reloaded.state).toBe(ReservationState.CONFIRMED);
  });

  it("is idempotent: cancelling an already-CANCELLED reservation succeeds without error (R-5)", async () => {
    const reservation = await service.createReservation({
      resourceId: openResourceId,
      userId,
      startsAt: new Date("2027-05-10T18:00:00Z"),
      endsAt: new Date("2027-05-10T19:00:00Z"),
    });
    const now = new Date("2027-05-10T10:00:00Z");
    await service.cancelReservation(reservation.id, now);
    const second = await service.cancelReservation(reservation.id, now);
    expect(second.state).toBe(ReservationState.CANCELLED);
  });

  it("rejects cancelling a REJECTED reservation — cancel does not apply to a closed decision", async () => {
    const reservation = await service.createReservation({
      resourceId: approvalResourceId,
      userId,
      startsAt: new Date("2027-05-11T18:00:00Z"),
      endsAt: new Date("2027-05-11T19:00:00Z"),
    });
    await service.confirmReservation(reservation.id, new Date("2027-05-11T10:00:00Z"));
    await service.rejectReservation(reservation.id);

    await expect(
      service.cancelReservation(reservation.id, new Date("2027-05-11T10:05:00Z"))
    ).rejects.toBeInstanceOf(NotCancellableError);
  });
});
