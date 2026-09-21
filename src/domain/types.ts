export enum ReservationState {
  DRAFT = "DRAFT",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
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

export enum OrderState {
  PLACED = "PLACED",
  SERVED = "SERVED",
  PAID = "PAID",
}

export enum MenuCategory {
  FOOD = "FOOD",
  DRINK = "DRINK",
}

export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
}

export interface OrderLine extends OrderLineInput {
  name: string;
  unitPriceCents: number;
}

export interface OrderRecord {
  id: string;
  reservationId: string;
  state: OrderState;
  placedAt: Date;
  lines: OrderLine[];
  totalCents: number;
}
