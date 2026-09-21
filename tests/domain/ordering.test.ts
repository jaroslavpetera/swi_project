import { describe, it, expect } from "vitest";
import { isOrderingWindowOpen, orderTotalCents } from "../../src/domain/rules.js";
import { ReservationState } from "../../src/domain/types.js";

const slot = {
  startsAt: new Date("2027-03-01T18:00:00Z"),
  endsAt: new Date("2027-03-01T20:00:00Z"),
};

describe("BR-05 ordering window", () => {
  it("is open for a CONFIRMED reservation during its slot", () => {
    const now = new Date("2027-03-01T19:00:00Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.CONFIRMED }, now)).toBe(true);
  });

  it("opens exactly at the start of the slot", () => {
    const now = new Date("2027-03-01T18:00:00Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.CONFIRMED }, now)).toBe(true);
  });

  it("closes exactly at the end of the slot — [start,end) per BR-01", () => {
    const now = new Date("2027-03-01T20:00:00Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.CONFIRMED }, now)).toBe(false);
  });

  it("is closed before the slot starts", () => {
    const now = new Date("2027-03-01T17:59:59Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.CONFIRMED }, now)).toBe(false);
  });

  it("is closed for a DRAFT reservation even during its slot", () => {
    const now = new Date("2027-03-01T19:00:00Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.DRAFT }, now)).toBe(false);
  });

  it("is closed for a CANCELLED reservation even during its slot", () => {
    const now = new Date("2027-03-01T19:00:00Z");
    expect(isOrderingWindowOpen({ ...slot, state: ReservationState.CANCELLED }, now)).toBe(false);
  });
});

describe("order total", () => {
  it("sums quantity times the price captured at ordering time", () => {
    expect(
      orderTotalCents([
        { quantity: 2, unitPriceCents: 5900 },
        { quantity: 1, unitPriceCents: 21900 },
      ])
    ).toBe(33700);
  });

  it("is zero for no lines", () => {
    expect(orderTotalCents([])).toBe(0);
  });
});
