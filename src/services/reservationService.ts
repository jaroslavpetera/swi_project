import { ReservationRepository } from "../repositories/reservationRepository.js";
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

export class ReservationService {
  constructor(private readonly repository: ReservationRepository) {}

  async createReservation(input: ReservationInput): Promise<ReservationRecord> {
    return this.repository.create(input);
  }

  async confirmReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    const reservation = await this.repository.findById(id);
    if (!reservation) throw new NotFoundError(id);

    // Potvrdit lze jen DRAFT — bez této pojistky by šlo znovu potvrdit
    // i zrušenou rezervaci (CANCELLED → CONFIRMED).
    if (reservation.state !== ReservationState.DRAFT) {
      throw new InvalidStateError(reservation.state, ReservationState.DRAFT);
    }

    if (isExpiredDraft(reservation, now)) {
      await this.repository.transition(reservation, ReservationState.CANCELLED);
      throw new NoShowExpiredError();
    }

    // BR-05: a Resource that requires approval routes Confirm through the
    // approval workflow instead of going straight to CONFIRMED — the overlap
    // check (BR-02) is deferred to OP-05 approve, where it's re-checked
    // against the state at decision time, not at request time.
    const resource = await this.repository.findResourceById(reservation.resourceId);
    if (resource?.requiresApproval) {
      return this.repository.transition(reservation, ReservationState.PENDING_APPROVAL);
    }

    const existing = await this.repository.findForResource(reservation.resourceId);
    const conflict = findOverlappingConfirmed(
      reservation,
      existing.filter((r) => r.id !== id)
    );
    if (conflict) throw new OverlapError(conflict.id);

    return this.repository.transition(reservation, ReservationState.CONFIRMED);
  }

  async approveReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    const reservation = await this.repository.findById(id);
    if (!reservation) throw new NotFoundError(id);

    if (reservation.state !== ReservationState.PENDING_APPROVAL) {
      throw new InvalidStateError(reservation.state, ReservationState.PENDING_APPROVAL);
    }

    if (isApprovalExpired(reservation, now)) {
      await this.repository.transition(reservation, ReservationState.EXPIRED);
      throw new ApprovalExpiredError();
    }

    // Re-checked here, not trusted from request time: another reservation
    // for the same slot may have been confirmed while this one was waiting.
    const existing = await this.repository.findForResource(reservation.resourceId);
    const conflict = findOverlappingConfirmed(
      reservation,
      existing.filter((r) => r.id !== id)
    );
    if (conflict) throw new OverlapError(conflict.id);

    return this.repository.transition(reservation, ReservationState.CONFIRMED);
  }

  async rejectReservation(id: string): Promise<ReservationRecord> {
    const reservation = await this.repository.findById(id);
    if (!reservation) throw new NotFoundError(id);

    if (reservation.state !== ReservationState.PENDING_APPROVAL) {
      throw new InvalidStateError(reservation.state, ReservationState.PENDING_APPROVAL);
    }

    return this.repository.transition(reservation, ReservationState.REJECTED);
  }

  async cancelReservation(id: string, now: Date = new Date()): Promise<ReservationRecord> {
    const reservation = await this.repository.findById(id);
    if (!reservation) throw new NotFoundError(id);

    // R-5: cancelling an already-cancelled reservation is an idempotent
    // success — a client retrying after a timeout must not get an error.
    if (reservation.state === ReservationState.CANCELLED) {
      return reservation;
    }

    if (!isCancellable(reservation.state)) {
      throw new NotCancellableError(reservation.state);
    }

    if (isPastCancellationWindow(reservation.startsAt, now)) {
      throw new CancellationWindowError(id);
    }

    return this.repository.transition(reservation, ReservationState.CANCELLED);
  }

  async checkAvailability(resourceId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    const existing = await this.repository.findForResource(resourceId);
    const conflict = findOverlappingConfirmed({ startsAt, endsAt }, existing);
    return !conflict;
  }
}
