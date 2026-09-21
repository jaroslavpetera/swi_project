# Reservation System — Specification

Status: **Specification Baseline v0.1 — draft, Person B portion only.**
Scope note: this document is being written on the `c02-person-b` branch, which covers only
**Osoba B**'s ownership from `docs/c02-plan.md` (reservation lifecycle: Confirm, Cancel, Approve).
Sections owned by **Osoba A** (OP-01 Create, OP-02 Check Availability, BR-01, BR-02, the use case
diagram, and consistency checks K-1/K-2/K-4/K-7) are marked `> TODO (Osoba A)` below — they are
deliberately not fabricated here, so the real Osoba A's work and this branch don't conflict when
merged. The joint sign-off line (`approved by the team`) cannot be written by one person and is
left open until both roles and the cross-review (Sync 1/2) have actually happened.

Language: specification text in English (per the assignment's own reference examples); rationale
notes that quote the C02 plan or explain a team decision are in Czech where that's clearer.

---

## Accepted decisions (R-1 – R-10)

Fáze 0 je společné rozhodnutí obou rolí. Níže je **návrh Osoby B** — přejímá doporučení
z `docs/c02-plan.md` beze změny (Osoba B do nich nemá důvod zasahovat jinak, protože jsou
konzistentní s tím, co už platí z C01), s důrazem na R-4/R-5/R-8, které jsou B's přímá
odpovědnost. Řádek "Status" říká, čí je to rozhodnutí a jestli je potvrzené.

| # | Question | Decision | Status |
|---|---|---|---|
| R-1 | Does DRAFT allocate the Resource? | **No** — DRAFT is intent only, blocks nothing until CONFIRMED | Adopted (matches existing C01 code, no reason to change) |
| R-2 | Is the collision check done at Create? | **No**, follows from R-1 | Adopted |
| R-3 | Interval semantics | **`[start, end)`**, half-open — adjacent reservations 10–11 and 11–12 don't collide | Adopted (matches `rangesOverlap` from C01) |
| R-4 | Cancellation policy (BR-03) | **DRAFT and CONFIRMED may be cancelled, but only while `now < start`** | **Proposed by B, implemented this branch** — see BR-03 |
| R-5 | Cancelling an already-cancelled reservation | **Idempotent success** (200, state stays CANCELLED) | **Proposed by B, implemented this branch** |
| R-6 | Time source | **Server time, UTC**, injectable at the service layer (`now: Date = new Date()`) | Adopted — used by `confirmReservation`, `approveReservation`, `cancelReservation` |
| R-7 | Authorization | **TBD, explicitly out of scope for v0.1**: an "authorized User" means the request carries an existing user's `userId`; roles are not checked | Adopted as TBD — see OP-03/OP-04/OP-05 Předpoklad/TBD |
| R-8 | Our C01 domain rule (no-show) | **BR-04**: a DRAFT not confirmed at least 30 min before `start` can no longer be confirmed; the attempt flips it to CANCELLED | Adopted from C01, unchanged |
| R-9 | Exclusive vs. capacity Resource | **Exclusive** — one Resource = one reservation at a time, even though it has a `capacity` (that's seats, not concurrent bookings) | Adopted (matches C01 BR-02) |
| R-10 | Concurrency (REQ-04) | **Observable outcome**: of two colliding concurrent Confirms, at most one ends CONFIRMED. *How* this is guaranteed is a C03 topic. | Adopted — this is the same architectural driver as C01's Future Pressure Q |

> Toto je návrh k potvrzení s Osobou A (fáze 0 je nedělitelná); dokud obě role nepotvrdí, hlavička
> výše zůstává "draft", ne "approved by the team".

---

## OP-01 Create Reservation

> TODO (Osoba A) — mimo rozsah této branch (`c02-person-b`). Viz `docs/c02-plan.md` → úkol A1.

## OP-02 Check Availability

> TODO (Osoba A) — mimo rozsah této branch. Viz `docs/c02-plan.md` → úkol A2.
> Poznámka od B: OP-05 níže (approve) se opírá o to, že Availability počítá pouze CONFIRMED
> rezervace (nezměněno z C01) — pokud A v rámci A2/fáze 6 rozhodne jinak, zpětně to ovlivní
> "Nové příklady ověření" v sekci *Dopad změny C02* níže.

---

## OP-03 Confirm Reservation

**REQ-03** (základní potvrzení) **+ REQ-04** (souběh).

**Goal:** turn an intended reservation (DRAFT) into a binding one (CONFIRMED) that blocks its
Resource for the requested interval — or, for a Resource that requires approval, into a pending
request (see BR-05, v0.2 below).

**Triggering event:** an authorized User requests confirmation of a specific Reservation by id.

**Observable request:** `POST /reservations/:id/confirm`, no body. Identifies exactly one
Reservation.

**Preconditions:** a Reservation with the given id exists; its state is DRAFT; `now` is before its
no-show deadline (`start − 30min`, BR-04).

**Postcondition (success, v0.1 — Resource does not require approval):** `state = CONFIRMED`; the
reservation now counts toward BR-02 exclusivity for its Resource.

**State change:** `DRAFT → CONFIRMED`.

**Rule reference:** BR-01 (interval semantics, used by the overlap check), BR-02 (exclusivity —
enforced here, at confirm time), BR-04 (no-show).

**Main scenario:**
1. Look up the reservation by id.
2. Reject if its state is not DRAFT.
3. Reject (and flip the reservation to CANCELLED) if the no-show deadline has passed — BR-04.
4. Compute overlap against other CONFIRMED reservations of the same Resource, per BR-01/BR-02.
5. Reject if an overlap is found.
6. Otherwise set `state = CONFIRMED`.

**Alternative / error outcomes:**
- Unknown id → 404, no state change.
- State ≠ DRAFT → 409, state unchanged.
- No-show deadline passed → the reservation is first moved to CANCELLED, then the request is
  rejected with 410. This is the *one* exception to "on rejection the state stays unchanged" —
  it must be explicit, because it's a state change that happens as a side effect of a rejected
  request.
- An overlapping CONFIRMED reservation exists for the same Resource → 409, state stays DRAFT.

**Concurrency (REQ-04):** if two Confirm requests race for two reservations that collide on the
same Resource, the observable outcome is that **at most one** of them ends up CONFIRMED — the
other must observe either a 409 (overlap) or must not itself reach CONFIRMED. *How* this is
guaranteed (locking, a DB-level constraint, a transaction) is out of scope for C02 — this is the
architectural driver carried forward to C03 (same driver as C01's Future Pressure Q; see R-10).

**Příklady ověření** (skutečně spuštěné, viz `docs/evidence-and-evolution.md` pro plné HTTP výstupy):
- DRAFT with no conflicting CONFIRMED reservation → `200`, `state: CONFIRMED`.
- DRAFT overlapping an existing CONFIRMED reservation on the same Resource → `409`, state stays
  DRAFT.

**Zdůvodnění:** overlap is checked at Confirm, not at Create (R-1/R-2) — a DRAFT is only an
intention and doesn't block the Resource, so two guests may hold competing DRAFTs for the same
slot; only the act of confirming resolves the conflict, in favour of whichever request confirms
first (or, more precisely, whichever request's confirm commits first — see REQ-04 above).

**Předpoklad/TBD:** none beyond R-7 (authorization) for v0.1. See v0.2 update below for the
approval-workflow branch.

---

## OP-04 Cancel Reservation

**REQ-05.**

**Goal:** let the User end a reservation that's no longer wanted before it starts, freeing the
Resource without waiting for it to expire on its own.

**Triggering event:** an authorized User requests cancellation of a specific Reservation by id.

**Observable request:** `POST /reservations/:id/cancel`, no body.

**Preconditions:** a Reservation with the given id exists; per BR-03 its state is one of DRAFT,
CONFIRMED (or already CANCELLED — idempotent case, R-5); `now < startsAt`.

**Postcondition:** `state = CANCELLED`. If the reservation had been CONFIRMED, the Resource's slot
is free again for future overlap checks (BR-02).

**State change:** `DRAFT/CONFIRMED → CANCELLED` (idempotent no-op if already CANCELLED).

**Rule reference:** BR-03.

**Main scenario:**
1. Look up the reservation by id.
2. If already CANCELLED, return `200` unchanged — R-5.
3. If `now ≥ startsAt`, reject — the cancellation window has passed (R-4).
4. Otherwise set `state = CANCELLED`.

**Alternative / error outcomes:**
- Unknown id → 404.
- `now ≥ startsAt` → 409 ("reservation can no longer be cancelled: it has already started"),
  state unchanged.

**Concurrency:** Cancel racing with Confirm on the same reservation — if Cancel commits first,
a subsequent Confirm sees `state ≠ DRAFT` → 409; if Confirm commits first, a subsequent Cancel
still succeeds (CONFIRMED is a cancellable state) as long as `now < startsAt`. No ordering beyond
"the loser observes the other's effect" is promised — same open class as REQ-04.

**Příklady ověření:**
- CONFIRMED reservation cancelled before its start → `200`, `state: CANCELLED`, and the slot is
  reported available again by Check Availability.
- Attempt to cancel a reservation whose start has already passed → `409`, state unchanged.

**Zdůvodnění:** BR-03's time boundary exists because an unrestricted cancel-anytime policy would
let a guest release a table after the reservation's start, once staff has already relied on it
being taken — the boundary protects the assumption that a reservation past its start is a
completed-or-no-show event, not something to undo after the fact.

**Předpoklad/TBD:** whether Staff (not just the guest who created the reservation) may also cancel
it is TBD — R-7 leaves authorization out of scope, so "authorized User" here just means "the
request carries a valid `userId`," not a role check.

---

## BR-01 Interval semantics

> TODO (Osoba A) — viz `docs/c02-plan.md` → úkol A3. B's operace (OP-03, OP-04) odkazují na toto
> pravidlo, ale jeho definice patří A.

## BR-02 Exclusive Resource invariant

> TODO (Osoba A) — viz úkol A3. Poznámka: implementačně je toto pravidlo v C01 kódu
> (`findOverlappingConfirmed`) a OP-03/OP-05 na něj v této branch odkazují jako na existující,
> nezměněné pravidlo — formální textovou definici ale píše A.

## BR-03 Cancellation policy

A reservation in state DRAFT or CONFIRMED (and, from v0.2, PENDING_APPROVAL — see below) may be
cancelled by its owning User, but only while `now < startsAt` (R-4). An attempt to cancel after
the reservation's start is rejected.

Cancelling an already-CANCELLED reservation is idempotent: the operation succeeds (`200`) and the
state remains CANCELLED (R-5) — a client that retries a cancel request after a timeout must not
receive an error.

Cancelling a reservation in a different terminal state (from v0.2: REJECTED, EXPIRED) is rejected
— these are distinct outcomes, and cancel does not "cancel" a decision the system or an approver
already closed.

**Zdůvodnění:** distinguishing "the guest withdrew" (CANCELLED) from "the request was closed by
someone/something else" (REJECTED/EXPIRED, from v0.2) matters for a future audit trail — who
ended the reservation, and why — even though that trail isn't consumed anywhere yet in C01/C02.

## BR-04 No-show rule (from C01)

A DRAFT reservation that has not been confirmed at least `NO_SHOW_GRACE_MINUTES` (30) minutes
before its start time can no longer be confirmed; an attempt to confirm it instead transitions it
to CANCELLED. This describes observable behaviour, not implementation — no reference to a specific
function or table. The number 30 is a team-chosen value (R-8), not a measured fact.

---

## State table (textová předloha pro stavový diagram, B4)

| State | Meaning | Reachable from | Via | Terminal? |
|---|---|---|---|---|
| DRAFT | Intention; does not block the Resource (R-1) | — | create | no |
| CONFIRMED | Binding; blocks the Resource under BR-02 | DRAFT, PENDING_APPROVAL (v0.2) | confirm (no approval needed), approve | no |
| CANCELLED | Withdrawn by the User; idempotent target state | DRAFT, CONFIRMED, PENDING_APPROVAL (v0.2), CANCELLED itself | cancel `[now < start]` | yes |
| PENDING_APPROVAL *(v0.2)* | Confirm requested on a Resource that requires approval; awaiting a decision | DRAFT | confirm `[resource.requiresApproval]` | no |
| REJECTED *(v0.2)* | An Approver actively declined the request | PENDING_APPROVAL | reject | yes |
| EXPIRED *(v0.2)* | No approve/reject decision was made before the approval deadline | PENDING_APPROVAL | (lazily detected) | yes |

Viz `docs/diagrams/state-diagram.md` pro grafickou verzi (v0.1 a v0.2, Mermaid).

---

## Konzistenční kontroly K-3, K-5, K-6 (B8)

| # | Kontrola | Výsledek |
|---|---|---|
| K-3 | Cancel vs. stavový diagram — dovoluje text i diagram totéž? | **OK.** OP-04/BR-03 povolují cancel z DRAFT/CONFIRMED (v0.1) a navíc PENDING_APPROVAL (v0.2), vždy s guardem `now < start`; `docs/diagrams/state-diagram.md` má identické hrany a guardy. |
| K-5 | Use case diagram vs. text — má každý cíl aktéra specifikované chování a naopak? | **Částečně blokováno.** B's aktéři a jejich chování (User: confirm/cancel; Approver: approve/reject, v0.2) jsou plně popsané v OP-03/OP-04/OP-05. Samotný use case diagram je úkol A (9a) — jakmile existuje, je potřeba znovu zkontrolovat, že se v něm objevuje aktér "Approver" pro v0.2 (viz úkol A12). |
| K-6 | Požadavek vs. návrhové rozhodnutí — neprolezlo někam "použij Prisma/Postgres"? | **OK.** OP-03, OP-04, OP-05, BR-03, BR-04, BR-05, BR-06 popisují jen pozorovatelné HTTP chování a stavy; žádná zmínka Prisma/Postgres/SQL/konkrétní tabulky v požadavkovém textu (implementační poznámky jsou odděleně v komentářích kódu, ne ve specifikaci). |

---

## Impact analysis — Change: Approval workflow (Fáze 5, PŘED psaním v0.2)

> Change: *Some Resources require approval by an authorized person before a reservation can
> become CONFIRMED. Approval may be delayed, rejected, or expire.*

Řádky vlastněné B (Confirm, Approve, Cancel, Stavový diagram, Architektura):

| Oblast | Otázka | Odpověď |
|---|---|---|
| Confirm | Zůstává okamžitá, nebo se dělí na "žádost o schválení" + "schválení"? | **Dělí se podmíněně.** Pokud `Resource.requiresApproval` je `false`, OP-03 je beze změny (v0.1 chování). Pokud `true`, Confirm produkuje nový výsledek — PENDING_APPROVAL — místo CONFIRMED. Je to nová větev existující operace, ne nová operace. |
| Approve | Nová operace a nový aktér? Kdo ji smí provést? | **Ano** — nová operace OP-05 a nový aktér "Approver" (osoba oprávněná schvalovat žádosti pro daný Resource). Kdo přesně je "authorized Approver" je TBD, stejná kategorie jako R-7 pro User. |
| Cancel | Lze zrušit PENDING_APPROVAL? | **Ano** (rozhodnutí B13). Zrušení čekající žádosti je stejný záměr jako zrušení DRAFTu — host se rozmyslel. OP-04 tedy přidává PENDING_APPROVAL do seznamu zrušitelných stavů; zbytek OP-04 (guard `now < start`, idempotence) je beze změny. |
| Stavový diagram | Potřebujeme PENDING_APPROVAL / REJECTED / EXPIRED, nebo jen část? | **Všechny tři.** PENDING_APPROVAL modeluje "požádáno, nerozhodnuto". REJECTED a EXPIRED musí být odlišené od CANCELLED kvůli zdůvodnění v BR-03 (kdo/co rezervaci ukončil) — obě jsou tedy nové terminální stavy. |
| Architektura | Vzniká driver pro perzistentní/asynchronní proces, časovač, notifikaci? | **Ano.** Detekce EXPIRED vyžaduje, aby něco zaznamenalo, že termín schválení vypršel. C02 to řeší **líně** (kontrola při dalším dotknutí rezervace — stejný vzor jako BR-04's `isExpiredDraft`), ne přes background job. To je správné pro demonstraci, ale nevyhodnotí se, dokud se nikdo na rezervaci nepodívá — skutečný časovač/notifikace je driver pro C03 (viz níže). |

(Řádky Create, Availability, Use case diagram, Ověření vlastní A — viz `docs/c02-plan.md` úkol A10.)

---

## Dopad změny C02

**Změněná podmínka:** Some Resources require approval by an authorized person before a
reservation can become CONFIRMED. Approval may be delayed, rejected, or expire.

**Dotčené požadavky:** REQ-03 (Confirm) získává novou podmíněnou větev; nový REQ-06 (Approve);
REQ-05 (Cancel) získává nový zrušitelný stav (PENDING_APPROVAL).

**Nedotčené požadavky + proč (B's část):** BR-01 (interval semantics) a BR-02 (exclusivity) jsou
beze změny — pořád platí jen pro CONFIRMED rezervace, schvalování nemění význam "overlap". Přímá
cesta OP-03 `DRAFT → CONFIRMED` (když `!requiresApproval`) je beze změny — celé v0.1 chování pro
resources bez schvalování je zachováno beze změny chování i kódu.
*(Řádky Create/Availability nedotčené části vlastní A — viz `docs/c02-plan.md` úkol A11.)*

**Nový aktér nebo operace:** Nová operace **OP-05 Approve Reservation** (níže). Nový aktér
"Approver". Promítnutí do use case diagramu je úkol A (A12).

**Změněná pravidla:** Nová vlastnost Resource `requiresApproval` (**BR-05**). Nový význam pro
EXPIRED (**BR-06**) — odlišný od no-show CANCELLED: no-show (BR-04) znamená "o potvrzení nikdy
nepožádáno", EXPIRED znamená "požádáno, ale nikdo v termínu nerozhodl".

**Změna use case diagramu:** TODO (Osoba A, úkol A12).

**Změna stavového diagramu:** hotovo — viz `docs/diagrams/state-diagram.md`, v0.2 přidává
PENDING_APPROVAL/REJECTED/EXPIRED s guardy.

**Nové příklady ověření:** Approve úspěch (PENDING_APPROVAL bez kolize → CONFIRMED); Approve s
nově vzniklou kolizí (409, zůstává PENDING_APPROVAL); Reject (PENDING_APPROVAL → REJECTED);
vypršení schválení (PENDING_APPROVAL po termínu → EXPIRED při dalším dotčení). Všechny skutečně
spuštěné — viz `docs/evidence-and-evolution.md`.
*(Availability v průběhu schvalování je rozhodnutí a úkol A — úkol A9/A13.)*

**Architektonické drivery pro C03:**
1. REQ-04 concurrency — žádná locking/transakční garance pro souběžné Confirm/Approve (otevřeno
   od C01 future pressure Q).
2. Vypršení schválení se detekuje líně, ne časovačem/notifikací — skutečný asynchronní mechanismus
   je odložen do C03.

---

## OP-05 Approve Reservation *(v0.2)*

**REQ-06.**

**Goal:** let an Approver decide a PENDING_APPROVAL reservation — turning a request into either a
binding reservation or a closed-out non-reservation.

**Triggering event:** an Approver decides a specific PENDING_APPROVAL reservation.

**Observable request:** `POST /reservations/:id/approve` (accept) or `POST /reservations/:id/reject`
(decline). Both identify exactly one Reservation, no body.

**Preconditions:** the Reservation exists; its state is PENDING_APPROVAL; for approve, the
approval deadline has not passed (BR-06).

**Postcondition (approve, success):** `state = CONFIRMED` — now blocks its Resource under BR-02,
same as a direct v0.1 confirm.

**Postcondition (reject):** `state = REJECTED` (terminal).

**Postcondition (approval expired):** `state = EXPIRED` (terminal) — detected lazily: the first
request that touches an overdue PENDING_APPROVAL reservation (an approve attempt, in this
specification) observes and applies the transition.

**State change:** `PENDING_APPROVAL → CONFIRMED` (approve, no overlap, before deadline);
`PENDING_APPROVAL → REJECTED` (reject); `PENDING_APPROVAL → EXPIRED` (deadline passed).

**Rule reference:** BR-02 (re-checked here — see below), BR-05, BR-06.

**Main scenario (approve):**
1. Look up the reservation by id.
2. Reject if state ≠ PENDING_APPROVAL.
3. If the approval deadline has passed, transition to EXPIRED and reject the request (410).
4. **Re-run** the BR-02 overlap check against currently-CONFIRMED reservations of the same
   Resource — not the check from when the request was first made, because another reservation for
   the same slot may have been confirmed in the meantime.
5. If an overlap is found, reject (409); state stays PENDING_APPROVAL (an Approver can retry
   later, or reject the now-unsatisfiable request).
6. Otherwise set `state = CONFIRMED`.

**Main scenario (reject):**
1. Look up the reservation by id.
2. Reject if state ≠ PENDING_APPROVAL.
3. Set `state = REJECTED`.

**Alternative / error outcomes:**
- Unknown id → 404.
- State ≠ PENDING_APPROVAL (already CONFIRMED/REJECTED/EXPIRED/CANCELLED) → 409, for both
  approve and reject.
- Approval deadline passed at approve time → the reservation transitions to EXPIRED, request
  answered 410 (same pattern as BR-04's no-show 410, for consistency).
- Overlap re-discovered at approve time → 409, state stays PENDING_APPROVAL.

**Concurrency:** two Approve calls racing on the *same* reservation are covered by the general
"state ≠ PENDING_APPROVAL" rule (the second call sees the first's result). The re-check in step 4
is what guards the *cross-reservation* race — two different reservations for the same slot both
reaching CONFIRMED — the same open driver as REQ-04.

**Příklady ověření** (skutečně spuštěné, viz evidence):
- PENDING_APPROVAL with no conflict → approve → `200`, `state: CONFIRMED`.
- PENDING_APPROVAL where a competing reservation was confirmed after the request was made →
  approve → `409`, stays PENDING_APPROVAL (service-level test, see
  `tests/services/reservationService.test.ts`).
- PENDING_APPROVAL → reject → `200`, `state: REJECTED`.
- PENDING_APPROVAL past its approval deadline → approve attempt → `EXPIRED` +
  `ApprovalExpiredError` (service-level test — the HTTP layer intentionally has no way to fake the
  clock, so this scenario is exercised at the service layer with an injected `now`, matching R-6).

**Zdůvodnění:** re-checking overlap at approve time (not trusting the check that would have run at
request time) is the direct fix for the "past" this change creates — a request can sit
PENDING_APPROVAL for a while, during which the world can change.

**Předpoklad/TBD:** "authorized Approver" is scoped the same way R-7 scopes "authorized User" — a
valid identity is assumed present, role/permission checking is out of scope for C02. The approval
deadline length (BR-06) is a team-chosen value, not a measured fact — same caveat as BR-04.

---

## OP-03 Confirm Reservation — v0.2 update

Adds one branch between the no-show check (step 3) and the overlap check (step 4/5) of the v0.1
scenario above:

4. Look up the reservation's Resource.
5. If `Resource.requiresApproval` is `true` → set `state = PENDING_APPROVAL` and return **202
   Accepted** (not 200) — the request was accepted, but the reservation is not CONFIRMED yet; the
   overlap check is deferred to OP-05 Approve.
6. Otherwise (unchanged v0.1 path) → run the overlap check, set CONFIRMED, return 200.

**Zdůvodnění pro 202 místo 200:** signals "accepted, decision pending" — matches HTTP's own
convention for accepted-but-not-yet-complete, and lets a client tell the two outcomes apart
without inspecting the body.

## OP-04 Cancel Reservation — v0.2 update

Cancellable states become DRAFT, CONFIRMED, **PENDING_APPROVAL** (added — decision B13). Guard
(`now < startsAt`, R-4) and idempotence on CANCELLED (R-5) are unchanged. Explicitly **not**
cancellable: REJECTED, EXPIRED — cancel doesn't apply to a decision the system/approver already
closed (BR-03's rationale extends unchanged to these two new terminal states).

---

## BR-05 Resource.requiresApproval flag *(v0.2)*

A Resource has a boolean flag `requiresApproval` (default `false`). It changes what OP-03 Confirm
does for a DRAFT reservation of that Resource:
- `false` → direct `DRAFT → CONFIRMED` (v0.1 behaviour, unchanged).
- `true` → `DRAFT → PENDING_APPROVAL`; only an explicit OP-05 Approve can reach CONFIRMED.

The flag is a property of the **Resource**, not of individual reservations — every reservation for
a given Resource either always or never needs approval.

## BR-06 Approval validity / EXPIRED meaning *(v0.2)*

A PENDING_APPROVAL reservation has an approval deadline, relative to its own start time:
`APPROVAL_GRACE_MINUTES` (chosen: 30 — same value and the same "team-chosen number, not a
measured fact" caveat as BR-04's no-show grace; kept numerically equal to
`NO_SHOW_GRACE_MINUTES` for C02 so "time to react" means the same thing whether or not a Resource
requires approval, though nothing requires the two to stay equal going forward).

If no Approve/Reject decision is made by the deadline, the reservation transitions to EXPIRED.
EXPIRED is distinct from REJECTED (an Approver actively declined it) and distinct from
CANCELLED-via-no-show (BR-04 — the request was never even eligible for approval, because it never
reached PENDING_APPROVAL in the first place) — this distinction matters for the same future
audit-trail reason as BR-03.

---

## Poznámka k Definition of Done (B's sloupec)

Viz `docs/c02-plan.md` sekce 11 pro plnou tabulku s vlastníky. Položky, které tato branch
(`c02-person-b`) pokrývá: OP-03/OP-04 (úplná specifikace), BR-03/BR-04 (definovány jednou), OP-05
Approve (úplná specifikace včetně rejection a expirace), stavový diagram v0.1 a v0.2, aplikace
demonstruje confirm/cancel/approve/reject, u každé operace 1 úspěšný + 1 negativní skutečně
spuštěný příklad, architektonický driver pro C03. Zbývá: review od Osoby A (položky "ten druhý"
v tabulce DoD) a joint schválení baseline.
