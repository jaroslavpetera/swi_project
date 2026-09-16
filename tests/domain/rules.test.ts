import { describe, it, expect } from "vitest";
import { rangesOverlap, findOverlappingConfirmed, isExpiredDraft } from "../../src/domain/rules.js";
import { ReservationState, ReservationRecord } from "../../src/domain/types.js";

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    const a = { startsAt: new Date("2026-01-10T18:00:00Z"), endsAt: new Date("2026-01-10T19:00:00Z") };
    const b = { startsAt: new Date("2026-01-10T18:30:00Z"), endsAt: new Date("2026-01-10T19:30:00Z") };
    expect(rangesOverlap(a, b)).toBe(true);
  });

  it("does not flag back-to-back ranges as overlapping", () => {
    const a = { startsAt: new Date("2026-01-10T18:00:00Z"), endsAt: new Date("2026-01-10T19:00:00Z") };
    const b = { startsAt: new Date("2026-01-10T19:00:00Z"), endsAt: new Date("2026-01-10T20:00:00Z") };
    expect(rangesOverlap(a, b)).toBe(false);
  });
});

describe("findOverlappingConfirmed", () => {
  const base: ReservationRecord = {
    id: "r1",
    resourceId: "table-1",
    userId: "user-1",
    startsAt: new Date("2026-01-10T18:00:00Z"),
    endsAt: new Date("2026-01-10T19:00:00Z"),
    state: ReservationState.CONFIRMED,
    createdAt: new Date(),
  };

  it("ignores non-confirmed reservations", () => {
    const draft = { ...base, id: "r2", state: ReservationState.DRAFT };
    const conflict = findOverlappingConfirmed(base, [draft]);
    expect(conflict).toBeUndefined();
  });

  it("flags overlap with another confirmed reservation", () => {
    const other = { ...base, id: "r2" };
    const conflict = findOverlappingConfirmed(base, [other]);
    expect(conflict?.id).toBe("r2");
  });
});

describe("isExpiredDraft", () => {
  it("expires a DRAFT reservation once inside the no-show grace window", () => {
    const reservation = { state: ReservationState.DRAFT, startsAt: new Date("2026-01-10T18:00:00Z") };
    const now = new Date("2026-01-10T17:45:00Z"); // 15 min before start, grace is 30 min
    expect(isExpiredDraft(reservation, now)).toBe(true);
  });

  it("does not expire a DRAFT reservation outside the grace window", () => {
    const reservation = { state: ReservationState.DRAFT, startsAt: new Date("2026-01-10T18:00:00Z") };
    const now = new Date("2026-01-10T17:00:00Z"); // 1h before start
    expect(isExpiredDraft(reservation, now)).toBe(false);
  });

  it("never expires a CONFIRMED reservation", () => {
    const reservation = { state: ReservationState.CONFIRMED, startsAt: new Date("2026-01-10T18:00:00Z") };
    const now = new Date("2026-01-10T18:30:00Z");
    expect(isExpiredDraft(reservation, now)).toBe(false);
  });
});
