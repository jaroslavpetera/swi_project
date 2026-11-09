# Sekvenční diagramy — Create, Availability, Confirm a invariant BR-02

Vytvořeno 3. 11. 2026 podle [specifikace](../specification.md) (v0.2 baseline + C07 upřesnění BR-01),
[architektury a DD](../architecture-and-decisions.md) (ADR-03, C05 H1–H3) a aktuálního kódu na `main`
(`ff027e3`). Každá zpráva v diagramu odpovídá skutečnému volání v kódu; názvy účastníků odpovídají
prvkům z C03 G2 a třídám z C05 DD.

| Účastník | Prvek architektury | Kód |
|---|---|---|
| Reservation API | [G2](../architecture-and-decisions.md#g2-to-be-statická-architektura) HTTP vrstva, validace vstupu, mapování chyb | [`src/http/app.ts`](../../src/http/app.ts) |
| ReservationService | Reservation Lifecycle (jediný vlastník přechodů, [ADR-03](../architecture-and-decisions.md#f-adr-03--kde-se-rozhoduje-alokace-br-02-při-souběhu)) | [`src/services/reservationService.ts`](../../src/services/reservationService.ts) |
| AvailabilityService | Availability (read-only OP-02) | [`src/services/availabilityService.ts`](../../src/services/availabilityService.ts) |
| LifecyclePolicy | čisté rozhodnutí přechodu ([C05 N1](../architecture-and-decisions.md#design-elements-and-ownership)) | [`src/domain/lifecyclePolicy.ts`](../../src/domain/lifecyclePolicy.ts) |
| ReservationRules | BR-01 … BR-04 predikáty | [`src/domain/rules.ts`](../../src/domain/rules.ts) |
| Clock | jediný zdroj „now“ ([C05 N2](../architecture-and-decisions.md#design-elements-and-ownership)) | [`src/domain/clock.ts`](../../src/domain/clock.ts) |
| ReservationRepository / ReservationTx | Reservation Persistence (Prisma adaptér portu `ReservationStore`) | [`src/repositories/reservationRepository.ts`](../../src/repositories/reservationRepository.ts) |
| Reservation DB | PostgreSQL 16 (výchozí), SQLite (historický profil) | [`prisma/schema.prisma`](../../prisma/schema.prisma) |

---

## SD-1 — OP-01 Create Reservation (REQ-01)

Create jen zaznamená záměr: vytvoří DRAFT a **nekontroluje překryv** (R-2) ani čas (R-14).
Existenci Resource a User neověřuje služba dotazem, ale integrita DB (cizí klíče), jak říká
hlavní scénář OP-01 („verify references through persistence integrity“).

```mermaid
sequenceDiagram
    autonumber
    actor Guest
    participant API as Reservation API
    participant Svc as ReservationService
    participant Repo as ReservationRepository
    participant DB as Reservation DB

    Guest->>API: POST /reservations {resourceId, userId, startsAt, endsAt}
    API->>API: reservationInputSchema.safeParse(body)
    Note right of API: BR-01: ISO 8601 s offsetem (Z / ±hh:mm),<br/>startsAt < endsAt, uloženo jako UTC
    alt neplatný vstup (chybí pole, bez offsetu, startsAt >= endsAt)
        API-->>Guest: 400 {error} — nic se nevytvoří
    else platný vstup
        API->>Svc: createReservation(input)
        Svc->>Repo: create(input)
        Repo->>DB: INSERT Reservation (state = DRAFT)
        Note over Repo,DB: bez zámku a bez kontroly překryvu (R-1, R-2)
        alt neexistující Resource nebo User (FK, Prisma P2003)
            DB-->>Repo: foreign key violation
            Repo-->>Svc: výjimka
            Svc-->>API: výjimka
            API->>API: errorMiddleware → isForeignKeyViolation
            API-->>Guest: 400 Unknown resourceId or userId
        else reference existují
            DB-->>Repo: nový řádek
            Repo-->>Svc: ReservationRecord (DRAFT)
            Svc-->>API: ReservationRecord
            API-->>Guest: 201 {id, state: DRAFT}
        end
    end
```

Postcondition: `[none] → DRAFT`; dostupnost stolu se nemění (DRAFT neblokuje, BR-02).
Testy: V-01.1–V-01.7 (`tests/spec/op01-op02.test.ts`, `tests/http/app.test.ts`).

---

## SD-2 — OP-02 Check Availability (REQ-02)

Čistě čtecí dotaz: neotevírá transakci, nebere zámek, nemění stav a nedetekuje expiraci
(R-16, BR-06). Používá stejnou definici BR-02 (`findOverlappingConfirmed`) jako alokace v Lifecycle.

```mermaid
sequenceDiagram
    autonumber
    actor User as Guest / Staff
    participant API as Reservation API
    participant Av as AvailabilityService
    participant Repo as ReservationRepository
    participant Rules as ReservationRules
    participant DB as Reservation DB

    User->>API: GET /resources/{id}/availability?start=&end=
    API->>API: availabilityQuerySchema.safeParse(query)
    alt neplatný dotaz (BR-01)
        API-->>User: 400 {error} — nikdy neodpoví „available“
    else platný interval
        API->>Av: checkAvailability(resourceId, start, end)
        Av->>Repo: findResourceById(resourceId)
        Repo->>DB: SELECT Resource WHERE id
        DB-->>Repo: řádek / null
        Repo-->>Av: ResourceRecord / null
        alt Resource neexistuje
            Av-->>API: throw ResourceNotFoundError
            API-->>User: 404 {error}
        else Resource existuje
            Av->>Repo: findForResource(resourceId)
            Repo->>DB: SELECT Reservation WHERE resourceId (všechny stavy)
            DB-->>Repo: řádky
            Repo-->>Av: ReservationRecord[]
            Av->>Rules: findOverlappingConfirmed({start, end}, existing)
            Note right of Rules: BR-02: blokuje jen state = CONFIRMED<br/>BR-01: a.start < b.end && b.start < a.end
            alt překryv s CONFIRMED
                Rules-->>Av: konfliktní rezervace
                Av-->>API: false
                API-->>User: 200 {available: false}
            else bez překryvu
                Rules-->>Av: undefined
                Av-->>API: true
                API-->>User: 200 {available: true}
            end
        end
    end
```

Výsledek je snímek, ne držení slotu: `available: true` neslibuje, že pozdější Confirm projde.
DRAFT, PENDING_APPROVAL, CANCELLED, REJECTED a EXPIRED (V-02.5, V-02.8, V-02.9, V-05.6) neblokují.

---

## SD-3 — OP-03 Confirm Reservation (REQ-03)

Návrh: [C03 H1](../architecture-and-decisions.md#h1-návrhový-sekvenční-diagram--confirm-reservation) (historický),
[C05 Algorithm / decision logic](../architecture-and-decisions.md#algorithm--decision-logic), [C05 Detailed sequence](../architecture-and-decisions.md#detailed-sequence).

Kompletní tok včetně všech větví rozhodnutí `decideConfirm` (pořadí: stav → BR-04 → BR-05 → BR-02).
Rozhodnutí probíhá výhradně nad stavem načteným **pod zámkem Resource** a čas se čte až po zámku.

```mermaid
sequenceDiagram
    autonumber
    actor Staff
    participant API as Reservation API
    participant Svc as ReservationService
    participant Repo as ReservationRepository
    participant Tx as ReservationTx
    participant Clock
    participant Policy as LifecyclePolicy
    participant Rules as ReservationRules
    participant DB as Reservation DB

    Staff->>API: POST /reservations/{id}/confirm
    API->>Svc: confirmReservation(id)
    Svc->>Repo: findById(id)
    Repo->>DB: SELECT Reservation (mimo zámek, jen kvůli resourceId)
    Repo-->>Svc: located / null
    opt rezervace neexistuje
        Svc-->>API: throw NotFoundError
        API-->>Staff: 404
    end

    Svc->>Repo: inResourceTransaction(located.resourceId, work)
    Repo->>DB: BEGIN
    Repo->>DB: UPDATE Resource SET id = id WHERE id = resourceId
    Note over Repo,DB: řádkový zámek Resource (ADR-03)<br/>souběžný Confirm/Approve stejného stolu čeká tady
    Repo->>Svc: work(tx)
    Svc->>Tx: findById(id)
    Tx->>DB: SELECT Reservation
    Tx-->>Svc: current (aktuální stav pod zámkem)
    Svc->>Clock: now()
    Clock-->>Svc: čas rozhodnutí
    Svc->>Tx: findResource(current.resourceId)
    Tx-->>Svc: ResourceRecord {requiresApproval}
    Note over Svc,Tx: null = porušený invariant FK → MissingResourceError → ROLLBACK → 500
    Svc->>Policy: decideConfirm(current, resource, now)
    Policy->>Rules: isExpiredDraft(current, now) — jen pokud state = DRAFT
    Rules-->>Policy: true / false
    Policy-->>Svc: ConfirmDecision

    alt InvalidState (state ≠ DRAFT)
        Svc-->>Repo: throw InvalidStateError
        Repo->>DB: ROLLBACK
        Svc-->>API: InvalidStateError
        API-->>Staff: 409 — beze změny
    else Close (BR-04: now >= startsAt − 30 min)
        Svc->>Tx: transition(current, CANCELLED)
        Tx->>DB: UPDATE state = CANCELLED WHERE id AND state = DRAFT
        Svc-->>Repo: vrací {expired: NoShowExpiredError} jako hodnotu
        Repo->>DB: COMMIT
        Note over Svc,DB: CANCELLED je uložen dřív, než chyba opustí službu (C05 DR4)
        Svc-->>API: throw NoShowExpiredError
        API-->>Staff: 410 — stav CANCELLED
    else RouteToApproval (BR-05: requiresApproval = true)
        Svc->>Tx: transition(current, PENDING_APPROVAL)
        Tx->>DB: UPDATE state = PENDING_APPROVAL WHERE id AND state = DRAFT
        Repo->>DB: COMMIT
        Svc-->>API: ReservationRecord (PENDING_APPROVAL)
        API-->>Staff: 202 — žádost čeká na Approve, nic nealokuje
    else Allocate (requiresApproval = false)
        Svc->>Tx: findConfirmedForResource(resourceId)
        Tx->>DB: SELECT Reservation WHERE resourceId AND state = CONFIRMED
        Tx-->>Svc: confirmed[] (commitnutý stav pod zámkem)
        Svc->>Policy: decideAllocation(current, confirmed)
        Policy->>Rules: findOverlappingConfirmed(current, confirmed bez sebe sama)
        Rules-->>Policy: konflikt / undefined
        alt Conflict (BR-02)
            Policy-->>Svc: Conflict(conflictingReservationId)
            Svc-->>Repo: throw OverlapError
            Repo->>DB: ROLLBACK
            Svc-->>API: OverlapError
            API-->>Staff: 409 — rezervace zůstává DRAFT
        else Free
            Policy-->>Svc: Free
            Svc->>Tx: transition(current, CONFIRMED)
            Tx->>DB: UPDATE state = CONFIRMED WHERE id AND state = DRAFT
            Repo->>DB: COMMIT
            Svc-->>API: ReservationRecord (CONFIRMED)
            API-->>Staff: 200 CONFIRMED
        end
    end
```

Poznámky:

- `transition()` je druhá pojistka: `UPDATE … WHERE id AND state = <očekávaný>`. Pokud neovlivní
  žádný řádek, vyhodí `ReservationConflictError` → rollback → 409 a vítěze nepřepíše.
- HTTP kód 200 vs. 202 volí API podle výsledného stavu (`PENDING_APPROVAL` → 202).
- Chyby mapuje jediné místo, `errorMiddleware` v `app.ts`: `NotFoundError` 404, `InvalidStateError`
  a `OverlapError` 409, `NoShowExpiredError` 410, ostatní 500.
- Approve (OP-05) má stejný tvar; místo `decideConfirm` volá `decideApprove` (BR-06 → EXPIRED + 410),
  BR-05 se znovu nevyhodnocuje. Variantu s konfliktem ukazuje [C05 H3](../architecture-and-decisions.md#detailed-sequence).

Testy: V-03.x, DD-T1…T9 (`tests/services/reservationLifecycle.unit.test.ts`,
`tests/domain/lifecyclePolicy.test.ts`, `tests/services/reservationService.test.ts`).

---

## SD-4 — Business rule / invariant BR-02 při souběhu (REQ-04)

Návrh: [E3 průchod scénářem](../architecture-and-decisions.md#e3-průchod-scénářem--souběžný-confirm-dvou-překrývajících-se-rezervací),
[ADR-03](../architecture-and-decisions.md#f-adr-03--kde-se-rozhoduje-alokace-br-02-při-souběhu), [G4 runtime mapping](../architecture-and-decisions.md#g4-runtime--deployment-mapping).

**Invariant BR-02:** žádný commitnutý stav nesmí obsahovat dvě překrývající se CONFIRMED rezervace
téhož Resource. **REQ-04:** ze souběžných Confirm/Approve na překrývající se intervaly téhož stolu
vznikne nejvýše jedna CONFIRMED; poražený dostane 409 a nic nealokuje.

Scénář V-04R.1: rezervace A a B jsou DRAFT na stejný stůl, intervaly se překrývají
(18:00–20:00), dva pracovníci je potvrzují současně. Obě počáteční čtení ještě vidí
„nic CONFIRMED“ — rozhoduje až čtení pod zámkem.

```mermaid
sequenceDiagram
    autonumber
    actor S1 as Staff 1
    actor S2 as Staff 2
    participant API as Reservation API
    participant Svc as ReservationService
    participant Tx as ReservationRepository / Tx
    participant DB as Reservation DB

    par souběžné požadavky
        S1->>API: POST /reservations/A/confirm
        API->>Svc: confirmReservation(A)
        Svc->>Tx: findById(A) — mimo zámek
        Tx-->>Svc: A (DRAFT, resource T)
    and
        S2->>API: POST /reservations/B/confirm
        API->>Svc: confirmReservation(B)
        Svc->>Tx: findById(B) — mimo zámek
        Tx-->>Svc: B (DRAFT, resource T)
    end
    Note over Svc,DB: zastaralý pohled: z obou čtení to vypadá, že stůl T je volný

    Svc->>Tx: inResourceTransaction(T) pro A
    Tx->>DB: BEGIN + UPDATE Resource T (zámek získán)
    Svc->>Tx: inResourceTransaction(T) pro B
    Tx->>DB: BEGIN + UPDATE Resource T
    Note over Tx,DB: B čeká na řádkový zámek T, dokud transakce A neskončí

    rect rgba(40, 167, 69, 0.15)
        Note over Svc,DB: transakce A drží zámek T
        Svc->>Tx: tx.findById(A), Clock.now(), findResource(T)
        Svc->>Svc: decideConfirm → Allocate
        Svc->>Tx: findConfirmedForResource(T)
        Tx-->>Svc: [] — žádná CONFIRMED
        Svc->>Svc: decideAllocation → Free
        Svc->>Tx: transition(A, CONFIRMED)
        Tx->>DB: UPDATE A SET state = CONFIRMED WHERE state = DRAFT
        Tx->>DB: COMMIT — zámek T uvolněn
        Svc-->>API: A CONFIRMED
        API-->>S1: 200 CONFIRMED
    end

    rect rgba(220, 53, 69, 0.15)
        Note over Svc,DB: B získá zámek T a čte commitnutý stav po A
        Svc->>Tx: tx.findById(B), Clock.now(), findResource(T)
        Svc->>Svc: decideConfirm → Allocate
        Svc->>Tx: findConfirmedForResource(T)
        Tx-->>Svc: [A] — CONFIRMED 18:00–20:00
        Svc->>Svc: decideAllocation → Conflict(A)
        Svc-->>Tx: throw OverlapError(A)
        Tx->>DB: ROLLBACK — žádný zápis
        Svc-->>API: OverlapError
        API-->>S2: 409 — B zůstává DRAFT
    end

    Note over S1,DB: výsledek: právě jedna CONFIRMED na stole T — BR-02 drží
```

Kde invariant drží:

| Místo | Co dělá | Proč stačí / nestačí |
|---|---|---|
| Zámek Resource v `inResourceTransaction` | serializuje všechny přechody téhož stolu | rozhodnutí B vidí commit A; bez zámku by oba prošli (PostgreSQL READ COMMITTED) — dokazuje `tests/postgres/lock-mechanism.test.ts` |
| `decideAllocation` + `findOverlappingConfirmed` | jediné rozhodnutí BR-02 (Confirm i Approve) | stejná definice překryvu jako Availability (BR-01 polouzavřené intervaly) |
| guard `WHERE state = očekávaný` v `transition()` | druhá pojistka proti přepsání novějšího stavu | chrání závod na **stejné** rezervaci (V-04R.2), ne překryv dvou různých |

Omezení (ADR-03, riziko R-02): invariant chrání jen zápisy přes Reservation Lifecycle. DB nemá
exclusion constraint, takže přímý SQL zápis nebo `npm run db:import-sqlite` jej může obejít.

Testy: V-04R.1, V-04R.2, V-04R.3, V-04R.6–8 (`tests/services/concurrency.test.ts`),
`tests/postgres/lock-mechanism.test.ts`, zátěž `scripts/postgres-load.ts`.

---

## Kontrola konzistence s předchozí dokumentací (3. 11. 2026)

| ID | Porovnání | Výsledek |
|---|---|---|
| SQ-1 | SD-1 vs. [activity OP-01](activity-create-and-availability.md) | Výsledky sedí (400 / 201 DRAFT, bez overlap). Rozdíl v mechanismu: aktivita kreslí dvě samostatné kontroly „Resource exists? / User exists?“, kód dělá jeden INSERT a obě chyby vrací jako jednu 400 z FK. Specifikace připouští oba pohledy. Aktivita neukazuje C07 pravidlo o offsetu časů (V-01.6). |
| SQ-2 | SD-2 vs. activity OP-02 a OP-02 ve specifikaci | OK: validace → 400, neznámý stůl → 404, jen CONFIRMED blokuje, žádná změna stavu. |
| SQ-3 | SD-3 vs. [activity Confirm v0.2](activity-confirm-cancel.md) a [stavový diagram](state-diagram.md) | OK: pořadí stav → BR-04 → BR-05 → BR-02 a kódy 404/409/410/202/200 sedí. Aktivita nezobrazuje zámek a `MissingResourceError` (500) — záměrně, je to logický pohled. |
| SQ-4 | SD-3 vs. [C03 H1](../architecture-and-decisions.md#h1-návrhový-sekvenční-diagram--confirm-reservation) | **H1 je zastaralý vůči kódu po C05:** volá `confirm(id, now)` místo `confirmReservation(id)` + `Clock.now()` po zámku, Lifecycle volá `isExpiredDraft` přímo místo přes `LifecyclePolicy`, Resource čte až po kontrole lhůty a chybí větve BR-04 (CANCELLED + 410) a BR-05 (PENDING_APPROVAL + 202). H1 je historický návrh C03; aktuální tok popisuje SD-3. |
| SQ-5 | SD-3/SD-4 vs. [C05 H3](../architecture-and-decisions.md#detailed-sequence) | OK: stejné pořadí volání (findById → zámek → findById → Clock → policy → findConfirmed → decideAllocation → rollback). |
| SQ-6 | SD-4 vs. ADR-03 a REQ-04 | OK: serializace podle Resource, poražený dostává `OverlapError` (409), ne ztracený zápis. |
