// C05 krok 5, DD-T9: rozhodovací tabulka LifecyclePolicy (C05 DD, Key interface 3)
// jako čistá funkce — bez úložiště, transakce i hodin. Ověřuje pořadí vyhodnocení
// stav → lhůta → routing a to, že neúspěch je hodnota, ne výjimka.
import { describe, expect, it } from "vitest";
import { decideAllocation, decideApprove, decideConfirm } from "../../src/domain/lifecyclePolicy.js";
import { ReservationRecord, ReservationState as S } from "../../src/domain/types.js";

const startsAt = new Date("2027-06-01T18:00:00Z");
const endsAt = new Date("2027-06-01T20:00:00Z");
const cutoff = new Date("2027-06-01T17:30:00Z");
const beforeCutoff = new Date(cutoff.getTime() - 1);

function reservation(values: Partial<ReservationRecord> = {}): ReservationRecord {
  return Object.freeze({
    id: "r1", userId: "u1", resourceId: "t1", startsAt, endsAt,
    state: S.DRAFT, createdAt: new Date("2027-01-01T00:00:00Z"), ...values,
  });
}
const open = Object.freeze({ id: "t1", requiresApproval: false });
const approval = Object.freeze({ id: "t1", requiresApproval: true });

describe("DD-T9 decideConfirm — decision table (state → deadline → routing)", () => {
  it.each([
    // stav, čas, Resource, očekávané rozhodnutí
    [S.DRAFT, beforeCutoff, open, { kind: "Allocate" }],
    [S.DRAFT, beforeCutoff, approval, { kind: "RouteToApproval" }],
    [S.DRAFT, cutoff, open, { kind: "Close", to: S.CANCELLED, cause: "NO_SHOW_CUTOFF" }],
    // lhůta má přednost před routingem: po cutoff se neposílá ke schválení
    [S.DRAFT, cutoff, approval, { kind: "Close", to: S.CANCELLED, cause: "NO_SHOW_CUTOFF" }],
    // stav má přednost před lhůtou: CONFIRMED po cutoff se nezavírá
    [S.CONFIRMED, cutoff, open, { kind: "InvalidState", expected: S.DRAFT }],
    [S.PENDING_APPROVAL, beforeCutoff, approval, { kind: "InvalidState", expected: S.DRAFT }],
    [S.CANCELLED, beforeCutoff, open, { kind: "InvalidState", expected: S.DRAFT }],
  ] as const)("DD-T9: state %s, now %s, resource %o", (state, now, resource, expected) => {
    expect(decideConfirm(reservation({ state }), resource, now)).toEqual(expected);
  });
});

describe("DD-T9 decideApprove — decision table (state → deadline)", () => {
  it.each([
    [S.PENDING_APPROVAL, beforeCutoff, { kind: "Allocate" }],
    [S.PENDING_APPROVAL, cutoff, { kind: "Close", to: S.EXPIRED, cause: "APPROVAL_DEADLINE" }],
    [S.DRAFT, beforeCutoff, { kind: "InvalidState", expected: S.PENDING_APPROVAL }],
    [S.CONFIRMED, cutoff, { kind: "InvalidState", expected: S.PENDING_APPROVAL }],
    [S.EXPIRED, cutoff, { kind: "InvalidState", expected: S.PENDING_APPROVAL }],
  ] as const)("DD-T9: %s at %s → %o", (state, now, expected) => {
    expect(decideApprove(reservation({ state }), now)).toEqual(expected);
  });
});

describe("DD-T9 decideAllocation — BR-02 scope (BR-01 half-open)", () => {
  const candidate = reservation({ id: "candidate" });

  it("DD-T9: overlapping CONFIRMED → Conflict with its id", () => {
    const other = reservation({ id: "winner", state: S.CONFIRMED, startsAt: new Date("2027-06-01T19:00:00Z"), endsAt: new Date("2027-06-01T21:00:00Z") });
    expect(decideAllocation(candidate, [other])).toEqual({ kind: "Conflict", conflictingReservationId: "winner" });
  });

  it("DD-T9: the candidate is never its own conflict", () => {
    expect(decideAllocation(candidate, [reservation({ id: "candidate", state: S.CONFIRMED })])).toEqual({ kind: "Free" });
  });

  it("DD-T9: touching interval and non-CONFIRMED rows → Free", () => {
    const touching = reservation({ id: "early", state: S.CONFIRMED, startsAt: new Date("2027-06-01T16:00:00Z"), endsAt: startsAt });
    const pending = reservation({ id: "pending", state: S.PENDING_APPROVAL });
    expect(decideAllocation(candidate, [touching, pending])).toEqual({ kind: "Free" });
  });

  it("DD-T9: policy is pure — frozen inputs, no exception, same input → same decision", () => {
    const confirmed = Object.freeze([reservation({ id: "x", state: S.CONFIRMED })]);
    const first = decideAllocation(candidate, [...confirmed]);
    expect(decideAllocation(candidate, [...confirmed])).toEqual(first);
    expect(() => decideConfirm(reservation({ state: S.EXPIRED }), open, cutoff)).not.toThrow();
  });
});
