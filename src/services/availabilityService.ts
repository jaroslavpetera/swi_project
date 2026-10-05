import { ReservationRepository } from "../repositories/reservationRepository.js";
import { findOverlappingConfirmed } from "../domain/rules.js";

export class ResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Resource ${id} not found`);
  }
}

// Availability (C03 G2): read-only answer for OP-02. Uses the same BR-02
// definition as the Reservation Lifecycle and never changes state.
export class AvailabilityService {
  constructor(
    private readonly repository: Pick<ReservationRepository, "findForResource" | "findResourceById">
  ) {}

  async checkAvailability(resourceId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    // OP-02 předpoklad: Resource existuje. Na neexistující stůl se neodpovídá
    // „available“ — nezodpověditelná otázka nemá odpověď.
    if (!(await this.repository.findResourceById(resourceId))) {
      throw new ResourceNotFoundError(resourceId);
    }
    const existing = await this.repository.findForResource(resourceId);
    const conflict = findOverlappingConfirmed({ startsAt, endsAt }, existing);
    return !conflict;
  }
}
