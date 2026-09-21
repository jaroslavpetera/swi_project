export enum ReservationState {
  DRAFT = "DRAFT",
  CONFIRMED = "CONFIRMED",
  CANCELLED = "CANCELLED",
}

export interface TimeRange {
  startsAt: Date;
  endsAt: Date;
}

export interface ReservationInput extends TimeRange {
  resourceId: string;
  userId: string;
}

export interface ReservationRecord extends ReservationInput {
  id: string;
  state: ReservationState;
  createdAt: Date;
}
