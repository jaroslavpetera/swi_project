import { ReservationRepository } from "../repositories/reservationRepository.js";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";
import { findOverlappingConfirmed, isExpiredDraft } from "../domain/rules.js";

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

    if (isExpiredDraft(reservation, now)) {
      await this.repository.updateState(id, ReservationState.CANCELLED);
      throw new NoShowExpiredError();
    }

    const existing = await this.repository.findForResource(reservation.resourceId);
    const conflict = findOverlappingConfirmed(
      reservation,
      existing.filter((r) => r.id !== id)
    );
    if (conflict) throw new OverlapError(conflict.id);

    return this.repository.updateState(id, ReservationState.CONFIRMED);
  }

  async cancelReservation(id: string): Promise<ReservationRecord> {
    const reservation = await this.repository.findById(id);
    if (!reservation) throw new NotFoundError(id);
    return this.repository.updateState(id, ReservationState.CANCELLED);
  }

  async checkAvailability(resourceId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    const existing = await this.repository.findForResource(resourceId);
    const conflict = findOverlappingConfirmed({ startsAt, endsAt }, existing);
    return !conflict;
  }
}
