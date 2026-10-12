// C05 krok 5: unit testy Reservation Lifecycle odvozené z Detailed Design
// (architecture-and-decisions.md → C05 Detailed Design). Bez databáze — port
// ReservationStore / ReservationTx nahrazuje in-memory fake (N3). ID testů
// odpovídají řádkům tabulky „Tests derived from DD“ v evidence-and-evolution.md.
import { beforeEach, describe, expect, it } from "vitest";
import {
  ApprovalExpiredError,
  InvalidStateError,
  NoShowExpiredError,
  MissingResourceError,
  OverlapError,
  ReservationService,
} from "../../src/services/reservationService.js";
import { ReservationState as S } from "../../src/domain/types.js";
import { InMemoryReservationStore } from "../support/inMemoryReservationStore.js";
import { TestClock } from "../support/clock.js";

const TABLE = "table-1";
const VIP = "vip-room";
const startsAt = new Date("2027-06-01T18:00:00Z");
const endsAt = new Date("2027-06-01T20:00:00Z");
// BR-04 / BR-06: lhůta = startsAt − 30 min.
const cutoff = new Date("2027-06-01T17:30:00Z");
const beforeCutoff = new Date(cutoff.getTime() - 1);
const earlier = new Date("2027-06-01T12:00:00Z");

let store: InMemoryReservationStore;
let clock: TestClock;
let service: ReservationService;

beforeEach(() => {
  store = new InMemoryReservationStore();
  store.addResource(TABLE, false);
  store.addResource(VIP, true);
  clock = new TestClock(earlier);
  service = new ReservationService(store, clock);
});

describe("DD-T1 algorithm branch — BR-05 routing (DR5)", () => {
  it("DD-T1: DRAFT on a Resource requiring approval → PENDING_APPROVAL without evaluating BR-02", async () => {
    // Překrývající se CONFIRMED by při alokaci znamenala konflikt — pending nealokuje.
    store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.CONFIRMED });
    const draft = store.addReservation({ resourceId: VIP, startsAt, endsAt });

    const result = await service.confirmReservation(draft.id);

    expect(result.state).toBe(S.PENDING_APPROVAL);
    expect(store.stateOf(draft.id)).toBe(S.PENDING_APPROVAL);
    expect(store.calls).not.toContain("tx.findConfirmedForResource");
  });

  it("DD-T1b: DRAFT on a Resource without approval → allocation decides → CONFIRMED", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });

    const result = await service.confirmReservation(draft.id);

    expect(result.state).toBe(S.CONFIRMED);
    expect(store.calls).toContain("tx.findConfirmedForResource");
  });
});

describe("DD-T2 state transition — close on deadline, then report (DR4)", () => {
  it("DD-T2: Confirm at the BR-04 cutoff commits CANCELLED and only then throws NoShowExpiredError", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });
    clock.set(cutoff);

    await expect(service.confirmReservation(draft.id)).rejects.toBeInstanceOf(NoShowExpiredError);

    // Zápis přežil chybovou odpověď: transakce commitnula, ne rollback.
    expect(store.stateOf(draft.id)).toBe(S.CANCELLED);
    expect(store.calls).toContain("commit");
    expect(store.calls).not.toContain("rollback");
  });

  it("DD-T2b: Approve at the BR-06 deadline commits EXPIRED and only then throws ApprovalExpiredError", async () => {
    const pending = store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.PENDING_APPROVAL });
    clock.set(cutoff);

    await expect(service.approveReservation(pending.id)).rejects.toBeInstanceOf(ApprovalExpiredError);

    expect(store.stateOf(pending.id)).toBe(S.EXPIRED);
    expect(store.calls).not.toContain("rollback");
  });

  it("DD-T2c: 1 ms before the cutoff the deadline branch is not taken (half-open boundary)", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });
    clock.set(beforeCutoff);

    const result = await service.confirmReservation(draft.id);

    expect(result.state).toBe(S.CONFIRMED);
  });
});

describe("DD-T3 failure behavior — BR-02 conflict writes nothing (DR6, DR7)", () => {
  it("DD-T3: Confirm overlapping a CONFIRMED reservation → OverlapError(conflicting id), stays DRAFT, rollback", async () => {
    const winner = store.addReservation({ resourceId: TABLE, startsAt, endsAt, state: S.CONFIRMED });
    const draft = store.addReservation({
      resourceId: TABLE,
      startsAt: new Date("2027-06-01T19:00:00Z"),
      endsAt: new Date("2027-06-01T21:00:00Z"),
    });

    const error = await service.confirmReservation(draft.id).catch((e) => e);

    expect(error).toBeInstanceOf(OverlapError);
    expect((error as OverlapError).conflictingReservationId).toBe(winner.id);
    expect(store.stateOf(draft.id)).toBe(S.DRAFT);
    expect(store.calls.some((c) => c.startsWith("tx.transition"))).toBe(false);
    expect(store.calls).toContain("rollback");
  });

  it("DD-T3b: Approve re-evaluates BR-02 at decision time → OverlapError, stays PENDING_APPROVAL", async () => {
    store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.CONFIRMED });
    const pending = store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.PENDING_APPROVAL });

    await expect(service.approveReservation(pending.id)).rejects.toBeInstanceOf(OverlapError);

    expect(store.stateOf(pending.id)).toBe(S.PENDING_APPROVAL);
  });

  it("DD-T3c (H2 A-F4): Approve before the deadline without conflict → CONFIRMED, exactly one write", async () => {
    const pending = store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.PENDING_APPROVAL });

    const result = await service.approveReservation(pending.id);

    expect(result.state).toBe(S.CONFIRMED);
    expect(store.stateOf(pending.id)).toBe(S.CONFIRMED);
    expect(store.calls.filter((c) => c.startsWith("tx.transition"))).toEqual([`tx.transition:${S.CONFIRMED}`]);
  });
});

describe("DD-T4 collaboration — decide on state read under the lock (DR1)", () => {
  it("DD-T4: state changed while waiting for the lock → decision uses the reloaded state (InvalidStateError), nothing written", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });
    // Jiná transakce téhož Resource commitne CONFIRMED dřív, než tento příkaz získá zámek.
    store.whileWaitingForLock(() => {
      store.reservations.get(draft.id)!.state = S.CONFIRMED;
    });

    const error = await service.confirmReservation(draft.id).catch((e) => e);

    expect(error).toBeInstanceOf(InvalidStateError);
    expect((error as InvalidStateError).currentState).toBe(S.CONFIRMED);
    expect(store.calls.indexOf("store.findById")).toBeLessThan(store.calls.indexOf(`lock:${TABLE}`));
    expect(store.calls.indexOf(`lock:${TABLE}`)).toBeLessThan(store.calls.indexOf("tx.findById"));
  });

  it("DD-T4b: competing allocation committed while waiting → BR-02 sees it and refuses (OverlapError)", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });
    store.whileWaitingForLock(() => {
      store.addReservation({ resourceId: TABLE, startsAt, endsAt, state: S.CONFIRMED });
    });

    await expect(service.confirmReservation(draft.id)).rejects.toBeInstanceOf(OverlapError);
    expect(store.stateOf(draft.id)).toBe(S.DRAFT);
  });
});

describe("DD-T5 algorithm — decideAllocation scope (DR6, BR-01)", () => {
  it("DD-T5: touching CONFIRMED interval, overlapping non-CONFIRMED rows and other Resources do not block", async () => {
    // [16:00, 18:00) se dotýká [18:00, 20:00) — polouzavřený interval, bez překryvu.
    store.addReservation({ resourceId: TABLE, startsAt: new Date("2027-06-01T16:00:00Z"), endsAt: startsAt, state: S.CONFIRMED });
    for (const state of [S.DRAFT, S.PENDING_APPROVAL, S.CANCELLED, S.REJECTED, S.EXPIRED]) {
      store.addReservation({ resourceId: TABLE, startsAt, endsAt, state });
    }
    store.addReservation({ resourceId: VIP, startsAt, endsAt, state: S.CONFIRMED });
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });

    const result = await service.confirmReservation(draft.id);

    expect(result.state).toBe(S.CONFIRMED);
  });
});

describe("DD-T6 state transition — only allowed source states (DR3)", () => {
  it.each([S.CANCELLED, S.CONFIRMED, S.PENDING_APPROVAL, S.REJECTED, S.EXPIRED])(
    "DD-T6: Confirm from %s → InvalidStateError(expected DRAFT), state unchanged",
    async (state) => {
      const row = store.addReservation({ resourceId: TABLE, startsAt, endsAt, state });

      const error = await service.confirmReservation(row.id).catch((e) => e);

      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).expectedState).toBe(S.DRAFT);
      expect(store.stateOf(row.id)).toBe(state);
    }
  );

  it.each([S.DRAFT, S.CONFIRMED, S.CANCELLED, S.REJECTED, S.EXPIRED])(
    "DD-T6b: Approve from %s → InvalidStateError(expected PENDING_APPROVAL), state unchanged",
    async (state) => {
      const row = store.addReservation({ resourceId: VIP, startsAt, endsAt, state });

      const error = await service.approveReservation(row.id).catch((e) => e);

      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).expectedState).toBe(S.PENDING_APPROVAL);
      expect(store.stateOf(row.id)).toBe(state);
    }
  );
});

describe("DD-T7 interface contract — precondition: the Resource exists", () => {
  // DD (Key interface 3): chybějící Resource uvnitř transakce je porušený invariant,
  // ne vstup routingu BR-05 — jinak by se rezervace potvrdila bez ohledu na schvalování.
  it("DD-T7: Confirm whose Resource is missing inside the transaction → MissingResourceError, nothing written", async () => {
    const orphan = store.addReservation({ resourceId: "missing-resource", startsAt, endsAt });

    await expect(service.confirmReservation(orphan.id)).rejects.toBeInstanceOf(MissingResourceError);

    expect(store.stateOf(orphan.id)).toBe(S.DRAFT);
    expect(store.calls).toContain("rollback");
  });
});

describe("DD-T8 interface contract — Clock (N2)", () => {
  it("DD-T8: now() is read exactly once per command, inside the transaction, after the lock", async () => {
    const reads: number[] = [];
    const counting = { now: () => { reads.push(store.calls.length); store.calls.push("clock.now"); return earlier; } };
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });

    await new ReservationService(store, counting).confirmReservation(draft.id);

    expect(reads).toHaveLength(1);
    expect(store.calls.indexOf(`lock:${TABLE}`)).toBeLessThan(store.calls.indexOf("clock.now"));
    expect(store.calls.indexOf("clock.now")).toBeLessThan(store.calls.indexOf("commit"));
  });

  it("DD-T8b: a deadline crossed while waiting for the lock counts → CANCELLED + NoShowExpiredError", async () => {
    const draft = store.addReservation({ resourceId: TABLE, startsAt, endsAt });
    clock.set(beforeCutoff);
    // Požadavek přišel před lhůtou, ale zámek získá až po ní.
    store.whileWaitingForLock(() => clock.set(cutoff));

    await expect(service.confirmReservation(draft.id)).rejects.toBeInstanceOf(NoShowExpiredError);
    expect(store.stateOf(draft.id)).toBe(S.CANCELLED);
  });
});
