import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/database.js';
import { ReservationRepository, ReservationTx } from '../../src/repositories/reservationRepository.js';
import { ReservationService, OverlapError } from '../../src/services/reservationService.js';
import { ReservationState as S } from '../../src/domain/types.js';

const postgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!postgres)('ADR-03 — PostgreSQL lock mechanism (READ COMMITTED)', () => {
  const firstDb = new PrismaClient();
  const secondDb = new PrismaClient();
  const resources: string[] = [];
  let userId: string;
  const now = new Date('2027-06-01T10:00:00Z');

  beforeAll(async () => {
    userId = (await firstDb.user.create({ data: { name: 'Lock mechanism', email: `${randomUUID()}@test.local` } })).id;
    const isolation = await firstDb.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
    expect(isolation[0].transaction_isolation).toBe('read committed');
  });

  afterAll(async () => {
    await firstDb.reservation.deleteMany({ where: { resourceId: { in: resources } } });
    await firstDb.resource.deleteMany({ where: { id: { in: resources } } });
    if (userId) await firstDb.user.delete({ where: { id: userId } });
    await Promise.all([firstDb.$disconnect(), secondDb.$disconnect()]);
  });

  async function race(omitLock: boolean) {
    const table = await firstDb.resource.create({ data: { name: 'Mechanism table', capacity: 4 } });
    resources.push(table.id);
    const rows = await Promise.all([0, 1].map(() => firstDb.reservation.create({ data: {
      userId, resourceId: table.id, startsAt: new Date('2027-06-01T18:00:00Z'),
      endsAt: new Date('2027-06-01T20:00:00Z'), state: S.DRAFT,
    } })));
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    async function meetAfterRead() {
      if (++arrivals === 2) release();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([gate, new Promise<void>((resolve) => { timer = setTimeout(resolve, 400); })]);
      if (timer) clearTimeout(timer);
    }
    class MeasuredRepository extends ReservationRepository {
      protected override async acquireResourceLock(db: Prisma.TransactionClient, resourceId: string) {
        if (!omitLock) await super.acquireResourceLock(db, resourceId);
      }
      override inResourceTransaction<T>(resourceId: string, work: (tx: ReservationTx) => Promise<T>): Promise<T> {
        return super.inResourceTransaction(resourceId, (tx) => work({
          findById: (id) => tx.findById(id),
          findResource: (id) => tx.findResource(id),
          findConfirmedForResource: async (id) => {
            const result = await tx.findConfirmedForResource(id);
            await meetAfterRead();
            return result;
          },
          transition: (row, state) => tx.transition(row, state),
        }));
      }
    }
    const services = [firstDb, secondDb].map((db) => new ReservationService(new MeasuredRepository(db)));
    const results = await Promise.allSettled(rows.map((row, i) => services[i].confirmReservation(row.id, now)));
    const confirmed = await firstDb.reservation.count({ where: { resourceId: table.id, state: S.CONFIRMED } });
    return { results, confirmed };
  }

  it('with the Resource lock, the second decision sees the committed winner', async () => {
    const { results, confirmed } = await race(false);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(OverlapError);
    expect(confirmed).toBe(1);
  });

  it('removing only the lock reproduces two overlapping confirmations', async () => {
    const { results, confirmed } = await race(true);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(confirmed).toBe(2);
  });
});
