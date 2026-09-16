import { PrismaClient, Reservation as PrismaReservation } from "@prisma/client";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";

function toRecord(row: PrismaReservation): ReservationRecord {
  return {
    id: row.id,
    resourceId: row.resourceId,
    userId: row.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    state: row.state as ReservationState,
    createdAt: row.createdAt,
  };
}

export class ReservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: ReservationInput): Promise<ReservationRecord> {
    const row = await this.prisma.reservation.create({
      data: {
        resourceId: input.resourceId,
        userId: input.userId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        state: ReservationState.DRAFT,
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<ReservationRecord | null> {
    const row = await this.prisma.reservation.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findForResource(resourceId: string): Promise<ReservationRecord[]> {
    const rows = await this.prisma.reservation.findMany({ where: { resourceId } });
    return rows.map(toRecord);
  }

  async updateState(id: string, state: ReservationState): Promise<ReservationRecord> {
    const row = await this.prisma.reservation.update({ where: { id }, data: { state } });
    return toRecord(row);
  }
}
