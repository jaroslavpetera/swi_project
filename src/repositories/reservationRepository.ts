import { PrismaClient, Reservation as PrismaReservation } from "@prisma/client";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";

export class ReservationConflictError extends Error {
  constructor(id: string) {
    super(`Reservation ${id} changed concurrently or its slot is no longer available; reload and retry`);
  }
}

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

  async transition(reservation: ReservationRecord, state: ReservationState): Promise<ReservationRecord> {
    // SQLite serializes writers. The state guard AND overlap predicate belong
    // to this single UPDATE, not to an earlier read that another writer can stale.
    // Reassess isolation/constraints before moving this implementation to Postgres.
    const result = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        state: reservation.state,
        ...(state === ReservationState.CONFIRMED ? {
          resource: { reservations: { none: {
            id: { not: reservation.id },
            state: ReservationState.CONFIRMED,
            startsAt: { lt: reservation.endsAt },
            endsAt: { gt: reservation.startsAt },
          } } },
        } : {}),
      },
      data: { state },
    });
    if (result.count === 0) {
      const current = await this.findById(reservation.id);
      // Two concurrent cancellations still have the same idempotent result.
      if (state === ReservationState.CANCELLED && current?.state === state) return current;
      throw new ReservationConflictError(reservation.id);
    }
    // Return this transition's result, even if another operation has since run.
    return { ...reservation, state };
  }

  async findResourceById(resourceId: string): Promise<{ id: string; requiresApproval: boolean } | null> {
    const row = await this.prisma.resource.findUnique({ where: { id: resourceId } });
    return row ? { id: row.id, requiresApproval: row.requiresApproval } : null;
  }
}
