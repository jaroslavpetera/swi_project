import { ReservationStore, ReservationTx } from "../repositories/reservationRepository.js";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";
import { isCancellable, isPastCancellationWindow } from "../domain/rules.js";
import { Clock, systemClock } from "../domain/clock.js";
import {
  ApproveDecision,
  ConfirmDecision,
  decideAllocation,
  decideApprove,
  decideConfirm,
} from "../domain/lifecyclePolicy.js";

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

// The foreign key guarantees a Reservation's Resource exists; missing it
// inside the transaction is a broken invariant, not a routing input (C05 DD).
export class MissingResourceError extends Error {
  constructor(resourceId: string) {
    super(`Resource ${resourceId} of the reservation does not exist`);
  }
}

// A terminal state written because a deadline passed must be committed before
// the error reaches the caller (BR-04, BR-06), so it leaves the transaction as a
// value and is thrown only after commit.
type Outcome = { reservation: ReservationRecord } | { expired: Error };

// Reservation Lifecycle (C03 ADR-03, C05 DD): the only element that decides
// Reservation state transitions, including the BR-02 allocation decision.
// LifecyclePolicy decides; this orchestrator runs every decision inside a
// transaction serialized per Resource, on state read under that lock, and
// turns the decision into a write and/or a domain error.
export class ReservationService {
  constructor(
    private readonly repository: ReservationStore,
    private readonly clock: Clock = systemClock
  ) {}

  async createReservation(input: ReservationInput): Promise<ReservationRecord> {
    return this.repository.create(input);
  }

  async confirmReservation(id: string): Promise<ReservationRecord> {
    return this.decide(id, async (tx, current, now) => {
      const resource = await tx.findResource(current.resourceId);
      if (!resource) throw new MissingResourceError(current.resourceId);
      return this.apply(tx, current, decideConfirm(current, resource, now));
    });
  }

  async approveReservation(id: string): Promise<ReservationRecord> {
    // Allocation is re-checked here, not trusted from request time: another
    // reservation for the same slot may have been confirmed while this one
    // was waiting.
    return this.decide(id, async (tx, current, now) => this.apply(tx, current, decideApprove(current, now)));
  }

  async rejectReservation(id: string): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation) => {
      if (reservation.state !== ReservationState.PENDING_APPROVAL) {
        throw new InvalidStateError(reservation.state, ReservationState.PENDING_APPROVAL);
      }
      return { reservation: await tx.transition(reservation, ReservationState.REJECTED) };
    });
  }

  async cancelReservation(id: string): Promise<ReservationRecord> {
    return this.decide(id, async (tx, reservation, now) => {
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

  private async apply(
    tx: ReservationTx,
    current: ReservationRecord,
    decision: ConfirmDecision | ApproveDecision
  ): Promise<Outcome> {
    switch (decision.kind) {
      case "InvalidState":
        throw new InvalidStateError(current.state, decision.expected);
      case "Close":
        await tx.transition(current, decision.to);
        return {
          expired: decision.cause === "NO_SHOW_CUTOFF" ? new NoShowExpiredError() : new ApprovalExpiredError(),
        };
      case "RouteToApproval":
        return { reservation: await tx.transition(current, ReservationState.PENDING_APPROVAL) };
      case "Allocate":
        return { reservation: await this.allocate(tx, current) };
    }
  }

  // BR-02, decided here only: the confirmed reservations are read under the
  // Resource lock, so a competing allocation has either committed already
  // (and is seen) or waits until this transaction ends.
  private async allocate(tx: ReservationTx, reservation: ReservationRecord): Promise<ReservationRecord> {
    const confirmed = await tx.findConfirmedForResource(reservation.resourceId);
    const allocation = decideAllocation(reservation, confirmed);
    if (allocation.kind === "Conflict") throw new OverlapError(allocation.conflictingReservationId);
    return tx.transition(reservation, ReservationState.CONFIRMED);
  }

  private async decide(
    id: string,
    work: (tx: ReservationTx, current: ReservationRecord, now: Date) => Promise<Outcome>
  ): Promise<ReservationRecord> {
    // Read outside the lock only to learn which Resource to lock; the decision
    // itself uses the state reloaded inside the transaction.
    const located = await this.repository.findById(id);
    if (!located) throw new NotFoundError(id);

    const outcome = await this.repository.inResourceTransaction(located.resourceId, async (tx) => {
      const current = await tx.findById(id);
      if (!current) throw new NotFoundError(id);
      // Decision time is read once, after the lock is held: waiting for the
      // lock may cross a BR-04/BR-06 deadline, and that must count.
      return work(tx, current, this.clock.now());
    });
    if ("expired" in outcome) throw outcome.expired;
    return outcome.reservation;
  }
}
