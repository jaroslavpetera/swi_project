import { ReservationRepository } from "../repositories/reservationRepository.js";
import { findOverlappingConfirmed } from "../domain/rules.js";

// Availability (C03 G2): read-only answer for OP-02. Uses the same BR-02
// definition as the Reservation Lifecycle and never changes state.
export class AvailabilityService {
  constructor(private readonly repository: Pick<ReservationRepository, "findForResource">) {}

  async checkAvailability(resourceId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    const existing = await this.repository.findForResource(resourceId);
    const conflict = findOverlappingConfirmed({ startsAt, endsAt }, existing);
    return !conflict;
  }
}
