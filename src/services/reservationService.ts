import { ReservationStore, ReservationTx } from "../repositories/reservationRepository.js";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";
import {
  findOverlappingConfirmed,
  isExpiredDraft,
  isApprovalExpired,
  isCancellable,
  isPastCancellationWindow,
} from "../domain/rules.js";

export class OverlapError extends Error {
  constructor(public readonly conflictingReservationId: string) {
    super(`Reservation overlaps with confirmed reservation ${conflictingReservationId}`);
  }
}

export class NoShowExpiredError extends Error {
  constructor() {
    super("Reservation can no longer be confirmed: no-show grace period has passed");
  }
}

export class ApprovalExpiredError extends Error {
  constructor() {
    super("Reservation can no longer be approved: approval deadline has passed");
  }
}

export class InvalidStateError extends Error {
  constructor(
    public readonly currentState: ReservationState,
    public readonly expectedState: ReservationState
  ) {
    super(`Reservation is in state ${currentState}, expected ${expectedState}`);
  }
}

export class NotCancellableError extends Error {
  constructor(public readonly currentState: ReservationState) {
    super(`Reservation in state ${currentState} cannot be cancelled`);
  }
}

export class CancellationWindowError extends Error {
  constructor(id: string) {
    super(`Reservation ${id} can no longer be cancelled: it has already started`);
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Reservation ${id} not found`);
  }
}

// A terminal state written because a deadline passed must be committed before
// the error reaches the caller (BR-04, BR-06), so it leaves the transaction as a
// value and is thrown only after commit.
type Decision = { reservation: ReservationRecord } | { expired: Error };

// Reservation Lifecycle (C03 ADR-03): the only element that decides
// Reservation state transitions, including the BR-02 allocation decision.
// Every decision runs inside a transaction serialized per Resource, on state
// read under that lock.
export class ReservationService {
  constructor(private readonly repository: ReservationStore) {}

  async createReservation(input: ReservationInput): Promise<ReservationRecord> {
    return this.repository.create(input);
  }

  async confirmReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation) => {
      // Potvrdit lze jen DRAFT — bez této pojistky by šlo znovu potvrdit
      // i zrušenou rezervaci (CANCELLED → CONFIRMED).
      if (reservation.state !== ReservationState.DRAFT) {
        throw new InvalidStateError(reservation.state, ReservationState.DRAFT);
      }

      if (isExpiredDraft(reservation, now)) {
        await tx.transition(reservation, ReservationState.CANCELLED);
        return { expired: new NoShowExpiredError() };
      }

      // BR-05: a Resource that requires approval routes Confirm through the
      // approval workflow instead of going straight to CONFIRMED — the overlap
      // check (BR-02) is deferred to OP-05 approve, where it's re-checked
      // against the state at decision time, not at request time.
      const resource = await tx.findResource(reservation.resourceId);
      if (resource?.requiresApproval) {
        return { reservation: await tx.transition(reservation, ReservationState.PENDING_APPROVAL) };
      }

      return { reservation: await this.allocate(tx, reservation) };
    });
  }

  async approveReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation) => {
      if (reservation.state !== ReservationState.PENDING_APPROVAL) {
        throw new InvalidStateError(reservation.state, ReservationState.PENDING_APPROVAL);
      }

      if (isApprovalExpired(reservation, now)) {
        await tx.transition(reservation, ReservationState.EXPIRED);
        return { expired: new ApprovalExpiredError() };
      }

      // Re-checked here, not trusted from request time: another reservation
      // for the same slot may have been confirmed while this one was waiting.
      return { reservation: await this.allocate(tx, reservation) };
    });
  }

  async rejectReservation(id: string): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation) => {
      if (reservation.state !== ReservationState.PENDING_APPROVAL) {
        throw new InvalidStateError(reservation.state, ReservationState.PENDING_APPROVAL);
      }
      return { reservation: await tx.transition(reservation, ReservationState.REJECTED) };
    });
  }

  async cancelReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation) => {
      // R-5: cancelling an already-cancelled reservation is an idempotent
      // success — a client retrying after a timeout must not get an error.
      if (reservation.state === ReservationState.CANCELLED) {
        return { reservation };
      }

      if (!isCancellable(reservation.state)) {
        throw new NotCancellableError(reservation.state);
      }

      if (isPastCancellationWindow(reservation.startsAt, now)) {
        throw new CancellationWindowError(id);
      }

      return { reservation: await tx.transition(reservation, ReservationState.CANCELLED) };
    });
  }

  // BR-02, decided here only: the confirmed reservations are read under the
  // Resource lock, so a competing allocation has either committed already
  // (and is seen) or waits until this transaction ends.
  private async allocate(tx: ReservationTx, reservation: ReservationRecord): Promise<ReservationRecord> {
    const confirmed = await tx.findConfirmedForResource(reservation.resourceId);
    const conflict = findOverlappingConfirmed(
      reservation,
      confirmed.filter((r) => r.id !== reservation.id)
    );
    if (conflict) throw new OverlapError(conflict.id);
    return tx.transition(reservation, ReservationState.CONFIRMED);
  }

  private async decide(
    id: string,
    work: (tx: ReservationTx, current: ReservationRecord) => Promise<Decision>
  ): Promise<ReservationRecord> {
    // Read outside the lock only to learn which Resource to lock; the decision
    // itself uses the state reloaded inside the transaction.
    const located = await this.repository.findById(id);
    if (!located) throw new NotFoundError(id);

    const decision = await this.repository.inResourceTransaction(located.resourceId, async (tx) => {
      const current = await tx.findById(id);
      if (!current) throw new NotFoundError(id);
      return work(tx, current);
    });
    if ("expired" in decision) throw decision.expired;
    return decision.reservation;
  }
}
