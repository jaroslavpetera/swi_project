import { ReservationRecord, ReservationState, ResourceRecord } from "./types.js";
import { findOverlappingConfirmed, isApprovalExpired, isExpiredDraft } from "./rules.js";

// C05 DD (N1): LifecyclePolicy decides a Reservation transition without I/O.
// Every outcome, failures included, is a value: a Close must be persisted
// before its error reaches the caller, so only the orchestrator
// (ReservationService) may turn a decision into a thrown error.
// Evaluation order: state → deadline → routing; allocation is a separate step.

export type ConfirmDecision =
  | { kind: "InvalidState"; expected: ReservationState.DRAFT }
  | { kind: "Close"; to: ReservationState.CANCELLED; cause: "NO_SHOW_CUTOFF" }
  | { kind: "RouteToApproval" }
  | { kind: "Allocate" };

export type ApproveDecision =
  | { kind: "InvalidState"; expected: ReservationState.PENDING_APPROVAL }
  | { kind: "Close"; to: ReservationState.EXPIRED; cause: "APPROVAL_DEADLINE" }
  | { kind: "Allocate" };

export type AllocationDecision = { kind: "Free" } | { kind: "Conflict"; conflictingReservationId: string };

// OP-03: BR-04 cutoff, then BR-05 routing. A Resource that requires approval
// does not allocate here — BR-02 is evaluated when Approve allocates.
export function decideConfirm(
  current: ReservationRecord,
  resource: ResourceRecord,
  now: Date
): ConfirmDecision {
  if (current.state !== ReservationState.DRAFT) {
    return { kind: "InvalidState", expected: ReservationState.DRAFT };
  }
  if (isExpiredDraft(current, now)) {
    return { kind: "Close", to: ReservationState.CANCELLED, cause: "NO_SHOW_CUTOFF" };
  }
  if (resource.requiresApproval) return { kind: "RouteToApproval" };
  return { kind: "Allocate" };
}

// OP-05 Approve: BR-06 deadline, then allocation against the current state.
export function decideApprove(current: ReservationRecord, now: Date): ApproveDecision {
  if (current.state !== ReservationState.PENDING_APPROVAL) {
    return { kind: "InvalidState", expected: ReservationState.PENDING_APPROVAL };
  }
  if (isApprovalExpired(current, now)) {
    return { kind: "Close", to: ReservationState.EXPIRED, cause: "APPROVAL_DEADLINE" };
  }
  return { kind: "Allocate" };
}

// BR-02 against the CONFIRMED reservations of the same Resource read under its
// lock. The candidate itself is never its own conflict.
export function decideAllocation(
  candidate: ReservationRecord,
  confirmed: ReservationRecord[]
): AllocationDecision {
  const conflict = findOverlappingConfirmed(
    candidate,
    confirmed.filter((r) => r.id !== candidate.id)
  );
  return conflict ? { kind: "Conflict", conflictingReservationId: conflict.id } : { kind: "Free" };
}
