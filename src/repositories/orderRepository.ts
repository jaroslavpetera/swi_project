import { PrismaClient } from "@prisma/client";
import { OrderLineInput, OrderRecord, OrderState } from "../domain/types.js";
import { orderTotalCents } from "../domain/rules.js";

// Objednávka se vždy načítá i s položkami a jménem z lístku — samotné
// `orderId` nikomu nic neřekne, obsluha potřebuje vidět, co se má přinést.
const withItems = { items: { include: { menuItem: true } } } as const;

type OrderRow = {
  id: string;
  reservationId: string;
  state: string;
  placedAt: Date;
  items: { menuItemId: string; quantity: number; unitPriceCents: number; menuItem: { name: string } }[];
};

function toRecord(row: OrderRow): OrderRecord {
  const lines = row.items.map((item) => ({
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    name: item.menuItem.name,
  }));
  return {
    id: row.id,
    reservationId: row.reservationId,
    state: row.state as OrderState,
    placedAt: row.placedAt,
    lines,
    totalCents: orderTotalCents(lines),
  };
}

export class OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMenuItems(ids: string[]) {
    return this.prisma.menuItem.findMany({ where: { id: { in: ids } } });
  }

  async create(
    reservationId: string,
    lines: (OrderLineInput & { unitPriceCents: number })[]
  ): Promise<OrderRecord> {
    const row = await this.prisma.order.create({
      data: {
        reservationId,
        state: OrderState.PLACED,
        items: {
          create: lines.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
          })),
        },
      },
      include: withItems,
    });
    return toRecord(row as unknown as OrderRow);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: withItems });
    return row ? toRecord(row as unknown as OrderRow) : null;
  }

  async findForReservation(reservationId: string): Promise<OrderRecord[]> {
    const rows = await this.prisma.order.findMany({
      where: { reservationId },
      include: withItems,
      orderBy: { placedAt: "asc" },
    });
    return rows.map((row) => toRecord(row as unknown as OrderRow));
  }

  async updateState(id: string, state: OrderState): Promise<OrderRecord> {
    const row = await this.prisma.order.update({
      where: { id },
      data: { state },
      include: withItems,
    });
    return toRecord(row as unknown as OrderRow);
  }
}
