import { ReservationState, TimeRange, ReservationRecord, OrderLine } from "./types.js";

export const NO_SHOW_GRACE_MINUTES = 30;

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

// Common rule: two CONFIRMED reservations of the same resource must not overlap.
export function findOverlappingConfirmed(
  candidate: TimeRange,
  confirmedReservations: ReservationRecord[]
): ReservationRecord | undefined {
  return confirmedReservations.find(
    (r) => r.state === ReservationState.CONFIRMED && rangesOverlap(candidate, r)
  );
}

// Domain-specific rule: a DRAFT reservation not confirmed before the no-show
// grace deadline (relative to its own start time) can no longer be confirmed.
export function isExpiredDraft(
  reservation: Pick<ReservationRecord, "state" | "startsAt">,
  now: Date,
  graceMinutes: number = NO_SHOW_GRACE_MINUTES
): boolean {
  if (reservation.state !== ReservationState.DRAFT) return false;
  const graceDeadline = new Date(reservation.startsAt.getTime() - graceMinutes * 60_000);
  return now >= graceDeadline;
}

// BR-05 (ordering window): objednávat k rezervaci lze jen tehdy, když je
// rezervace CONFIRMED a právě probíhá — tedy start <= now < end (BR-01).
export function isOrderingWindowOpen(
  reservation: Pick<ReservationRecord, "state" | "startsAt" | "endsAt">,
  now: Date
): boolean {
  if (reservation.state !== ReservationState.CONFIRMED) return false;
  return now >= reservation.startsAt && now < reservation.endsAt;
}

export function orderTotalCents(lines: Pick<OrderLine, "quantity" | "unitPriceCents">[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
}
