import { Prisma, PrismaClient, Reservation as PrismaReservation } from "@prisma/client";
import { ReservationInput, ReservationRecord, ReservationState } from "../domain/types.js";

export class ReservationConflictError extends Error {
  constructor(id: string) {
    super(`Reservation ${id} changed concurrently; reload and retry`);
  }
}

export interface ResourceRecord {
  id: string;
  requiresApproval: boolean;
}

// Reads and writes inside one resource-scoped transaction (ADR-03). Decisions
// are made by the Reservation Lifecycle on data read through this interface.
export interface ReservationTx {
  findById(id: string): Promise<ReservationRecord | null>;
  findResource(resourceId: string): Promise<ResourceRecord | null>;
  findConfirmedForResource(resourceId: string): Promise<ReservationRecord[]>;
  transition(reservation: ReservationRecord, state: ReservationState): Promise<ReservationRecord>;
}

// Reservation Persistence port used by the Reservation Lifecycle.
export interface ReservationStore {
  create(input: ReservationInput): Promise<ReservationRecord>;
  findById(id: string): Promise<ReservationRecord | null>;
  inResourceTransaction<T>(resourceId: string, work: (tx: ReservationTx) => Promise<T>): Promise<T>;
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

class PrismaReservationTx implements ReservationTx {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async findById(id: string): Promise<ReservationRecord | null> {
    const row = await this.db.reservation.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findResource(resourceId: string): Promise<ResourceRecord | null> {
    const row = await this.db.resource.findUnique({ where: { id: resourceId } });
    return row ? { id: row.id, requiresApproval: row.requiresApproval } : null;
  }

  async findConfirmedForResource(resourceId: string): Promise<ReservationRecord[]> {
    const rows = await this.db.reservation.findMany({
      where: { resourceId, state: ReservationState.CONFIRMED },
    });
    return rows.map(toRecord);
  }

  async transition(reservation: ReservationRecord, state: ReservationState): Promise<ReservationRecord> {
    // Second safeguard only: the expected-state guard refuses to overwrite a
    // newer state. The BR-02 decision itself is made by the Lifecycle under
    // the Resource lock, not here (ADR-03).
    const result = await this.db.reservation.updateMany({
      where: { id: reservation.id, state: reservation.state },
      data: { state },
    });
    if (result.count === 0) throw new ReservationConflictError(reservation.id);
    return { ...reservation, state };
  }
}

export class ReservationRepository implements ReservationStore {
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

  async findResourceById(resourceId: string): Promise<ResourceRecord | null> {
    const row = await this.prisma.resource.findUnique({ where: { id: resourceId } });
    return row ? { id: row.id, requiresApproval: row.requiresApproval } : null;
  }

  async inResourceTransaction<T>(resourceId: string, work: (tx: ReservationTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (db) => {
      // Lock first, read afterwards. On PostgreSQL this no-op UPDATE takes a row
      // lock on the Resource, so transitions on the same Resource run one after
      // another and each one reads the state committed by its predecessor.
      // On SQLite Prisma opens interactive transactions with BEGIN IMMEDIATE,
      // which already serializes all writers; the statement is then redundant
      // but harmless. The PostgreSQL behaviour is unverified until migration.
      await db.$executeRaw`UPDATE "Resource" SET "id" = "id" WHERE "id" = ${resourceId}`;
      return work(new PrismaReservationTx(db));
    });
  }
}
