import { OrderRepository } from "../repositories/orderRepository.js";
import { ReservationRepository } from "../repositories/reservationRepository.js";
import { OrderLineInput, OrderRecord, OrderState } from "../domain/types.js";
import { isOrderingWindowOpen } from "../domain/rules.js";
import { NotFoundError } from "./reservationService.js";

export class OrderingWindowClosedError extends Error {
  constructor(public readonly reason: "NOT_CONFIRMED" | "BEFORE_START" | "AFTER_END") {
    super(`Ordering is not open for this reservation: ${reason}`);
  }
}

export class UnknownMenuItemError extends Error {
  constructor(public readonly menuItemIds: string[]) {
    super(`Unknown or unavailable menu items: ${menuItemIds.join(", ")}`);
  }
}

export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Order ${id} not found`);
  }
}

export class InvalidOrderStateError extends Error {
  constructor(
    public readonly currentState: OrderState,
    public readonly expectedState: OrderState
  ) {
    super(`Order is in state ${currentState}, expected ${expectedState}`);
  }
}

export interface TabSummary {
  reservationId: string;
  orders: OrderRecord[];
  unpaidCents: number;
  paidCents: number;
  totalCents: number;
}

export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly reservations: ReservationRepository
  ) {}

  async placeOrder(
    reservationId: string,
    lines: OrderLineInput[],
    now: Date = new Date()
  ): Promise<OrderRecord> {
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) throw new NotFoundError(reservationId);

    // BR-07: objednávat jde jen k potvrzené rezervaci a jen v jejím čase.
    if (!isOrderingWindowOpen(reservation, now)) {
      throw new OrderingWindowClosedError(reasonFor(reservation, now));
    }

    const menuItems = await this.orders.findMenuItems(lines.map((line) => line.menuItemId));
    const availableById = new Map(
      menuItems.filter((item) => item.available).map((item) => [item.id, item])
    );
    const unknown = lines
      .map((line) => line.menuItemId)
      .filter((id) => !availableById.has(id));
    if (unknown.length > 0) throw new UnknownMenuItemError([...new Set(unknown)]);

    // Cena se zafixuje teď — pozdější změna ceníku už s touto objednávkou nehne.
    const pricedLines = lines.map((line) => ({
      ...line,
      unitPriceCents: availableById.get(line.menuItemId)!.priceCents,
    }));

    return this.orders.create(reservationId, pricedLines);
  }

  async listOrders(reservationId: string): Promise<OrderRecord[]> {
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) throw new NotFoundError(reservationId);
    return this.orders.findForReservation(reservationId);
  }

  async serveOrder(id: string): Promise<OrderRecord> {
    return this.transition(id, OrderState.PLACED, OrderState.SERVED);
  }

  async payOrder(id: string): Promise<OrderRecord> {
    return this.transition(id, OrderState.SERVED, OrderState.PAID);
  }

  // Účet hosta: co je objednané, co už je zaplacené a kolik zbývá doplatit.
  async getTab(reservationId: string): Promise<TabSummary> {
    const orders = await this.listOrders(reservationId);
    const paidCents = sum(orders.filter((o) => o.state === OrderState.PAID));
    const unpaidCents = sum(orders.filter((o) => o.state !== OrderState.PAID));
    return {
      reservationId,
      orders,
      unpaidCents,
      paidCents,
      totalCents: paidCents + unpaidCents,
    };
  }

  private async transition(
    id: string,
    from: OrderState,
    to: OrderState
  ): Promise<OrderRecord> {
    const order = await this.orders.findById(id);
    if (!order) throw new OrderNotFoundError(id);
    if (order.state !== from) throw new InvalidOrderStateError(order.state, from);
    return this.orders.updateState(id, to);
  }
}

function sum(orders: OrderRecord[]): number {
  return orders.reduce((total, order) => total + order.totalCents, 0);
}

function reasonFor(
  reservation: { state: string; startsAt: Date; endsAt: Date },
  now: Date
): "NOT_CONFIRMED" | "BEFORE_START" | "AFTER_END" {
  if (reservation.state !== "CONFIRMED") return "NOT_CONFIRMED";
  return now < reservation.startsAt ? "BEFORE_START" : "AFTER_END";
}
