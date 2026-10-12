// C05 N3: in-memory realizace portu ReservationStore / ReservationTx pro unit
// testy Reservation Lifecycle bez databáze. Modeluje jen to, co slibuje kontrakt
// z C05 DD (Key interfaces 1 a 2): commit při vrácení hodnoty, rollback při
// výjimce, pojistku očekávaného stavu v transition() a čtení pod zámkem.
import {
  ReservationConflictError,
  ReservationStore,
  ReservationTx,
  ResourceRecord,
} from "../../src/repositories/reservationRepository.js";
import { ReservationInput, ReservationRecord, ReservationState } from "../../src/domain/types.js";

type Snapshot = Map<string, ReservationRecord>;

export class InMemoryReservationStore implements ReservationStore {
  readonly reservations = new Map<string, ReservationRecord>();
  readonly resources = new Map<string, ResourceRecord>();
  // Záznam spolupráce: kdo co volal a v jakém pořadí (ověřuje sekvenci z DD).
  readonly calls: string[] = [];
  // Simulace transakce jiného požadavku, která commitne během čekání na zámek.
  private beforeLock: (() => void) | undefined;
  private nextId = 1;

  addResource(id: string, requiresApproval = false): void {
    this.resources.set(id, { id, requiresApproval });
  }

  addReservation(values: Partial<ReservationRecord> & Pick<ReservationRecord, "resourceId" | "startsAt" | "endsAt">): ReservationRecord {
    const record: ReservationRecord = {
      id: values.id ?? `r${this.nextId++}`,
      userId: values.userId ?? "u1",
      state: values.state ?? ReservationState.DRAFT,
      createdAt: values.createdAt ?? new Date("2027-01-01T00:00:00Z"),
      resourceId: values.resourceId,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
    };
    this.reservations.set(record.id, { ...record });
    return record;
  }

  stateOf(id: string): ReservationState | undefined {
    return this.reservations.get(id)?.state;
  }

  whileWaitingForLock(change: () => void): void {
    this.beforeLock = change;
  }

  async create(input: ReservationInput): Promise<ReservationRecord> {
    return this.addReservation(input);
  }

  async findById(id: string): Promise<ReservationRecord | null> {
    this.calls.push("store.findById");
    const row = this.reservations.get(id);
    return row ? { ...row } : null;
  }

  async inResourceTransaction<T>(resourceId: string, work: (tx: ReservationTx) => Promise<T>): Promise<T> {
    this.beforeLock?.();
    this.beforeLock = undefined;
    this.calls.push(`lock:${resourceId}`);
    const snapshot: Snapshot = new Map([...this.reservations].map(([id, r]) => [id, { ...r }]));
    try {
      const result = await work(new InMemoryTx(this));
      this.calls.push("commit");
      return result;
    } catch (error) {
      this.reservations.clear();
      for (const [id, r] of snapshot) this.reservations.set(id, r);
      this.calls.push("rollback");
      throw error;
    }
  }
}

class InMemoryTx implements ReservationTx {
  constructor(private readonly store: InMemoryReservationStore) {}

  async findById(id: string): Promise<ReservationRecord | null> {
    this.store.calls.push("tx.findById");
    const row = this.store.reservations.get(id);
    return row ? { ...row } : null;
  }

  async findResource(resourceId: string): Promise<ResourceRecord | null> {
    this.store.calls.push("tx.findResource");
    return this.store.resources.get(resourceId) ?? null;
  }

  async findConfirmedForResource(resourceId: string): Promise<ReservationRecord[]> {
    this.store.calls.push("tx.findConfirmedForResource");
    return [...this.store.reservations.values()]
      .filter((r) => r.resourceId === resourceId && r.state === ReservationState.CONFIRMED)
      .map((r) => ({ ...r }));
  }

  async transition(reservation: ReservationRecord, state: ReservationState): Promise<ReservationRecord> {
    this.store.calls.push(`tx.transition:${state}`);
    const stored = this.store.reservations.get(reservation.id);
    if (!stored || stored.state !== reservation.state) throw new ReservationConflictError(reservation.id);
    stored.state = state;
    return { ...reservation, state };
  }
}
