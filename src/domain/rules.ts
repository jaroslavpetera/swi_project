import { ReservationState, TimeRange, ReservationRecord, OrderLine } from "./types.js";

export const NO_SHOW_GRACE_MINUTES = 30;

// C02 BR-06: kept equal to NO_SHOW_GRACE_MINUTES so "time to react" means the
// same thing whether or not a Resource requires approval; nothing requires
// the two to stay equal in the future.
export const APPROVAL_GRACE_MINUTES = NO_SHOW_GRACE_MINUTES;

// C02 BR-03: a reservation can only be cancelled while it is still one of
// these states — REJECTED/EXPIRED are terminal outcomes the system (or an
// approver) already closed, cancel does not apply to them.
const CANCELLABLE_STATES: ReadonlySet<ReservationState> = new Set([
  ReservationState.DRAFT,
  ReservationState.CONFIRMED,
  ReservationState.PENDING_APPROVAL,
]);

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

// BR-06: a PENDING_APPROVAL reservation for which no approve/reject decision
// was made by the deadline (relative to its own start) has expired.
export function isApprovalExpired(
  reservation: Pick<ReservationRecord, "state" | "startsAt">,
  now: Date,
  graceMinutes: number = APPROVAL_GRACE_MINUTES
): boolean {
  if (reservation.state !== ReservationState.PENDING_APPROVAL) return false;
  const deadline = new Date(reservation.startsAt.getTime() - graceMinutes * 60_000);
  return now >= deadline;
}

// BR-03: which states a reservation can be cancelled from.
export function isCancellable(state: ReservationState): boolean {
  return CANCELLABLE_STATES.has(state);
}

// R-4/BR-03: the cancellation window closes once the reservation starts.
export function isPastCancellationWindow(startsAt: Date, now: Date): boolean {
  return now >= startsAt;
}

// BR-07 (ordering window): objednávat k rezervaci lze jen tehdy, když je
// rezervace CONFIRMED a právě probíhá — tedy start <= now < end (BR-01).
export function isOrderingWindowOpen(
  reservation: Pick<ReservationRecord, "state" | "startsAt" | "endsAt">,
  now: Date
): boolean {
  if (reservation.state !== ReservationState.CONFIRMED) return false;
  return now >= reservation.startsAt && now < reservation.endsAt;
}

// BR-08: součet objednávky z cen zafixovaných při objednání.
export function orderTotalCents(lines: Pick<OrderLine, "quantity" | "unitPriceCents">[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
}
