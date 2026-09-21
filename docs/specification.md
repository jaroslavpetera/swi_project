# Specification — Table Reservation System

**Status: Baseline v0.1 + change v0.2 — merged from both roles, awaiting joint sign-off.**

| | |
|---|---|
| Scope | Minimal behaviour: Create, Check Availability, Confirm, Cancel — plus the C02 change (Approve) and one domain extension (ordering food and drinks) |
| Owner A | Michal Křižák — OP-01, OP-02, OP-06, BR-01, BR-02, BR-07, BR-08, use case diagram, activity diagrams for Create/Availability/Order |
| Owner B | Jaroslav Petera — OP-03, OP-04, OP-05, BR-03, BR-04, BR-05, BR-06, state diagram, activity diagrams for Confirm/Cancel |
| Approval | **pending** — see *Consistency check*: three items are still open, and the sign-off line cannot be written by one person |

Language: specification text in English (as in the assignment's own reference examples); rationale
and team notes in Czech where that is clearer.

**Numbering after the merge.** Both branches independently used BR-05/BR-06 and REQ-06 for
different things. Resolved in favour of the change (B), which is part of the assignment, and the
ordering extension (A) was renumbered:

| Původně u A | Nyní | Co to je |
|---|---|---|
| BR-05 | **BR-07** | Ordering window |
| BR-06 | **BR-08** | Price capture |
| REQ-06 | **REQ-07** | Place order |
| REQ-07 | **REQ-08** | Tab totals |
| D-01…D-13 | **R-1…R-13** | Accepted decisions (sjednoceno na značení z `c02-plan.md`) |

B's BR-05 (`requiresApproval`), BR-06 (approval validity) and REQ-06 (Approve) keep their numbers.

---

## Accepted decisions (R-1 – R-13)

Phase 0 of the plan. Recorded once here; operations reference them instead of restating them.

R-1 to R-10 were written independently by both members and came out identical — that agreement is
the evidence, not a formality. R-11 to R-13 come from the ordering extension and **still need B's
confirmation**.

| # | Decision | Rationale | Status |
|---|---|---|---|
| R-1 | A DRAFT Reservation does **not** allocate the Resource; only CONFIRMED blocks it. | Creation records intent. A guest who never confirms must not block a table, otherwise a spike of abandoned drafts would empty the pub. | **agreed A + B** |
| R-2 | Create does **not** check for conflicts. | Follows from R-1: there is nothing to conflict with until allocation happens at confirmation. | **agreed A + B** |
| R-3 | Intervals are half-open `[start, end)`. | Reservations 18:00–20:00 and 20:00–22:00 are a normal turnover of the same table, not a conflict. | **agreed A + B** |
| R-4 | Cancellation is allowed for DRAFT and CONFIRMED (from v0.2 also PENDING_APPROVAL) while `now < start`. | Cancelling a slot that has already begun frees nothing useful; staff has already relied on the table being taken. | **agreed A + B**, owned by B (BR-03) |
| R-5 | Cancelling an already CANCELLED Reservation is an idempotent success. | A client retrying after a timeout must not get an error for an operation that already reached the desired state. | **agreed A + B**, owned by B (BR-03) |
| R-6 | Time source is the server clock in UTC, injectable in the service layer. | Without an injectable clock, no-show, approval and cancellation deadlines cannot be tested deterministically. | **agreed A + B** |
| R-7 | Authorization is **TBD, explicitly out of scope for v0.1/v0.2**: "authorized User" means the request carries an existing user's identifier. No roles, no tokens. | Nobody specified an authentication model; inventing roles would be fabricated precision. | **agreed A + B** |
| R-8 | The C01 no-show rule is kept (BR-04): a DRAFT not confirmed at least 30 minutes before `start` can no longer be confirmed. | Our domain-specific rule, already implemented and tested since C01. The number 30 is a team-chosen value, not a measured fact. | **agreed A + B**, owned by B |
| R-9 | Resources are **exclusive**: one table holds one reservation at a time. `capacity` is seats, not concurrent bookings. | A table is physically handed over to one party. | **agreed A + B** |
| R-10 | Concurrency (REQ-04) is specified as an observable outcome, not as a mechanism. | *How* exclusivity is enforced under concurrency is an architecture question, deferred to C03. Same driver as C01's future pressure Q. | **agreed A + B** |
| R-11 | Ordering food and drinks is bound to a Reservation, not to a Resource or a User. | The reservation is what entitles a guest to that table at that time; an order without one has no table to be served to. | A — **B to confirm** |
| R-12 | Orders are accepted only while the slot is running (BR-07), not from the moment of confirmation. | Confirming days ahead is a promise about a table, not the start of service. Kitchen and bar act on what is ordered now. | A — **B to confirm** |
| R-13 | Money is stored in integer hellers (`priceCents`), never as a decimal number. | Repeated addition of a tab in floating point drifts. Implementation-visible, but deliberate. | A — **B to confirm** |

### Open TBDs

| # | Unknown | Why it is not decided | Impact if resolved differently |
|---|---|---|---|
| TBD-1 | Authorization model (R-7) | Not specified by anyone; no source | Adds preconditions and a new failure outcome to all four operations |
| TBD-2 | Whether a Resource can be deactivated (`active` flag in the reference example) | Our domain has no such concept yet; tables are not taken out of service in the current model | Would add a precondition to OP-03 and a failure outcome |

---
## Domain rules and invariants

Defined once. Operations reference them; they are never restated.

### BR-01 — Interval semantics

Reservation intervals are half-open: `[start, end)`.

Two intervals `A` and `B` overlap if and only if `A.start < B.end ∧ B.start < A.end`.

Consequences:
- `[18:00, 20:00)` and `[20:00, 22:00)` do **not** overlap — they are a valid turnover.
- An interval is valid only if `start < end`; `start == end` is rejected as invalid, it is not an
  empty reservation.
- All times are UTC instants (R-6).

### BR-02 — Exclusive Resource invariant

At no committed system state may two CONFIRMED Reservations of the same Resource overlap
(BR-01 defines overlap).

Consequences:
- Reservations in any other state (DRAFT, CANCELLED) never violate this invariant and never
  block a Resource (R-1).
- The invariant is about committed state, not about requests: concurrent attempts that would
  violate it are governed by REQ-04.


### BR-03 Cancellation policy

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

### BR-04 No-show rule (from C01)

A DRAFT reservation that has not been confirmed at least `NO_SHOW_GRACE_MINUTES` (30) minutes
before its start time can no longer be confirmed; an attempt to confirm it instead transitions it
to CANCELLED. This describes observable behaviour, not implementation — no reference to a specific
function or table. The number 30 is a team-chosen value (R-8), not a measured fact.

---
### BR-05 Resource.requiresApproval flag *(v0.2)*

A Resource has a boolean flag `requiresApproval` (default `false`). It changes what OP-03 Confirm
does for a DRAFT reservation of that Resource:
- `false` → direct `DRAFT → CONFIRMED` (v0.1 behaviour, unchanged).
- `true` → `DRAFT → PENDING_APPROVAL`; only an explicit OP-05 Approve can reach CONFIRMED.

The flag is a property of the **Resource**, not of individual reservations — every reservation for
a given Resource either always or never needs approval.

### BR-06 Approval validity / EXPIRED meaning *(v0.2)*

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
### BR-07 — Ordering window

Food and drinks may be ordered against a Reservation only while that Reservation is CONFIRMED
**and** the current time lies inside its interval: `start <= now < end`.

Consequences:
- A DRAFT or CANCELLED Reservation never accepts orders, whatever the time — an unconfirmed
  intention does not entitle anyone to a table or to service.
- The window opens exactly at `start` and closes exactly at `end`, reusing the half-open
  semantics of BR-01. The boundary is therefore defined in one place for the whole system.
- The time source is the server clock (R-6).

### BR-08 — Price capture

The unit price of every ordered item is captured at the moment the order is placed. Later changes
to the menu price do not change the amount of an order that already exists.

Rationale: the guest agreed to the price shown when ordering. Recomputing a tab from the current
menu would silently change what someone already owes.

---
## OP-01 — Create Reservation

**Goal / user value:**
A guest records the intention to take a table for a given time slot, so that it can later be
confirmed. Creating costs nothing and blocks nothing.

**Trigger:**
A User requests a Reservation for Resource R and interval I.

**Observable requirement:**

> **REQ-01:**
> The system shall create a DRAFT Reservation for an existing Resource and an existing User
> when the requested interval is valid, and shall return its identifier and state.

**Preconditions:**
- The User exists (R-7: "authorized" means nothing more than this in v0.1).
- The Resource exists.
- The interval is valid per BR-01 (`start < end`).

**Success postcondition:**
- Exactly one new Reservation exists;
- `Reservation.state = DRAFT`;
- **no Resource allocation is committed** — the Resource remains available for the same interval
  (R-1);
- BR-02 is unaffected.

**State change:**
`[none] → DRAFT`

**Referenced rules:**
BR-01 (interval semantics), R-1/R-2 (DRAFT does not allocate, no conflict check at creation).

**Main success scenario:**
1. User submits Resource, User identifier and interval.
2. System validates the interval per BR-01.
3. System validates that the Resource and the User exist.
4. System creates the Reservation in state DRAFT.
5. System returns the Reservation identifier and its current state.

**Alternative / failure outcomes:**
- invalid interval (`start >= end`, unparsable timestamp, missing field) → reject; no Reservation created;
- unknown Resource → reject; no Reservation created;
- unknown User → reject; no Reservation created;
- interval overlapping an existing CONFIRMED Reservation → **accepted, DRAFT is created** (R-2).
  The conflict is detected at confirmation time (OP-03), not here.

**Verification examples:**

| # | Input | Expected observable result |
|---|---|---|
| V-01.1 | existing Resource + User, `[2027-03-01T18:00, 2027-03-01T20:00)` | one Reservation created, state DRAFT, identifier returned |
| V-01.2 | `start == end` (`18:00`, `18:00`) | rejected, no Reservation created |
| V-01.3 | unknown Resource identifier | rejected, no Reservation created |
| V-01.4 | interval fully inside an existing CONFIRMED reservation | accepted, DRAFT created — proves R-2 |

**Rationale / source:**
Separating intent from allocation is what makes the DRAFT state meaningful at all. If Create
allocated the table, DRAFT and CONFIRMED would differ only in name, and an abandoned draft would
block a table indefinitely. Carried over from the C01 domain model.

**Assumption / unknown / TBD:**
TBD-1 (authorization model, R-7).

---

## OP-02 — Check Availability

**Goal / user value:**
A guest or a staff member can find out whether a table is free for a requested slot before
creating or confirming anything.

**Trigger:**
A User asks whether Resource R is available for interval I.

**Observable requirement:**

> **REQ-02:**
> For an existing Resource and a valid interval, the system shall report the Resource as
> unavailable if the interval overlaps any CONFIRMED Reservation of that Resource, and as
> available otherwise.

**Preconditions:**
- The Resource exists.
- The interval is valid per BR-01.

**Success postcondition:**
- An availability result is returned;
- **no Reservation state is changed** and no Reservation is created — this is a pure query.

**State change:**
none.

**Referenced rules:**
BR-01 (what "overlaps" means), BR-02 (which reservations block), R-1 (DRAFT does not block).

**Main success scenario:**
1. User submits Resource identifier and interval.
2. System validates the interval per BR-01.
3. System validates that the Resource exists.
4. System evaluates the interval against the CONFIRMED Reservations of that Resource.
5. System returns `available` or `unavailable`.

**Alternative / failure outcomes:**
- invalid interval (missing, unparsable, `start >= end`) → reject the query.
  It must **not** be answered with "available" — an unanswerable question has no answer, and a
  silent `available` would be actively misleading;
- unknown Resource → reject the query, for the same reason.

**Verification examples:**

Given one CONFIRMED Reservation of the table for `[18:00, 20:00)`:

| # | Query | Expected observable result |
|---|---|---|
| V-02.1 | `[21:00, 22:00)` | available |
| V-02.2 | `[19:00, 21:00)` — partial overlap | unavailable |
| V-02.3 | `[20:00, 21:00)` — starts exactly when the confirmed one ends | **available** (boundary case of BR-01) |
| V-02.4 | `[17:00, 18:00)` — ends exactly when the confirmed one starts | **available** (boundary case of BR-01) |
| V-02.5 | same interval, but the existing Reservation is DRAFT instead of CONFIRMED | available — proves R-1 |
| V-02.6 | missing or unparsable interval | rejected, not answered with "available" |
| V-02.7 | unknown Resource | rejected |

**Rationale / source:**
Availability is the question a guest asks before everything else, and it is the only operation
whose answer people act on without changing anything. Its meaning must therefore be identical to
the rule that Confirm enforces (BR-02) — if the two diverged, the system would promise slots it
then refuses.

**Assumption / unknown / TBD:**
The answer is a point-in-time statement, not a reservation of the slot. Between a query and a
confirmation, another guest may confirm the same slot (see REQ-04). Communicating that to the
user is a UI concern, out of scope for v0.1.

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

## OP-06 — Place Order (extension beyond the minimal baseline)

> **Scope note.** The C02 baseline is the four core operations. This operation is an **extension**
> of our domain (it comes from the original C01 idea: ordering a beer to your table). It is
> specified with the same structure and the same level of precision, but it is deliberately kept
> separate so that the minimal baseline stays exactly four operations and remains comparable with
> the assignment. It is owned by A.

**Goal / user value:**
Guests sitting at their reserved table order food and drinks to that table, and can see at any
moment what they have run up so far.

**Trigger:**
A User at a CONFIRMED Reservation orders one or more menu items during the reserved slot.

**Observable requirements:**

> **REQ-07:**
> The system shall accept an order of one or more available menu items against a Reservation only
> while that Reservation is CONFIRMED and the current time lies inside its interval (BR-07); the
> resulting order shall record the quantity and the price of each item at the time of ordering.

> **REQ-08:**
> The system shall report, for a Reservation, the total of its orders split into the part that is
> already paid and the part that is still outstanding.

**Preconditions:**
- The Reservation exists.
- BR-07 holds: `Reservation.state = CONFIRMED` and `start <= now < end`.
- Every requested menu item exists and is marked available.
- Every requested quantity is a positive integer.

**Success postcondition:**
- One new Order exists, linked to the Reservation, in state PLACED;
- the Order carries a line per requested item with the quantity and the captured unit price (BR-08);
- the outstanding part of the tab grows by the order total;
- no Reservation state is changed — ordering never alters the reservation lifecycle.

**State change:**
`[none] → PLACED`, and for an existing order `PLACED → SERVED → PAID`.

**Referenced rules:**
BR-01 (interval boundary reused by the ordering window), BR-07 (ordering window), BR-08 (price
capture), R-1 (only a confirmed reservation is a real allocation, and only a real allocation is
served).

**Main success scenario:**
1. Guest picks items from the menu and submits quantities against their Reservation.
2. System checks the ordering window (BR-07).
3. System checks that every item exists and is available.
4. System captures the current price of each item (BR-08).
5. System stores the Order in state PLACED and returns it with its total.

**Alternative / failure outcomes:**
- Reservation is not CONFIRMED → reject, reason `NOT_CONFIRMED`; nothing ordered;
- the slot has not started yet → reject, reason `BEFORE_START`;
- the slot has already ended → reject, reason `AFTER_END`;
- unknown or unavailable menu item → reject the whole order; a partially served order would be
  worse than none, because the guest would not know what is coming;
- empty order → reject;
- unknown Reservation → reject;
- paying an order that has not been served → reject; the order stays PLACED.

**Verification examples:**

| # | Situation | Expected observable result |
|---|---|---|
| V-06.1 | CONFIRMED reservation, `now` inside the slot, 2 beers + 1 goulash | order created in state PLACED with the correct total |
| V-06.2 | DRAFT reservation, `now` inside the slot | rejected, `NOT_CONFIRMED`, nothing ordered |
| V-06.3 | CONFIRMED reservation starting in 2 hours | rejected, `BEFORE_START` |
| V-06.4 | CONFIRMED reservation that ended 2 hours ago | rejected, `AFTER_END` |
| V-06.5 | unknown menu item | rejected, nothing ordered |
| V-06.6 | order with no items | rejected |
| V-06.7 | item marked unavailable | rejected |
| V-06.8 | unknown reservation | rejected |
| V-06.9 | menu price changed after the order was placed | the order total stays unchanged (BR-08) |
| V-06.10 | order placed → served → paid | outstanding total becomes 0, paid total equals the order |
| V-06.11 | pay an order that is still PLACED | rejected, order stays PLACED |

**Rationale / source:**
Comes directly from the original project idea in C01 ("rezervace stolu + objednání piva na určitý
čas" and "aktuální stav dluhu na účtu"). Tying orders to the reserved slot is what makes them
meaningful: it is the reservation that entitles the guest to that table at that time.

**Assumption / unknown / TBD:**

| # | Item | Note |
|---|---|---|
| TBD-3 | **Interaction between BR-04 and BR-07.** Under BR-04 a reservation must be confirmed at least 30 minutes before it starts; under BR-07 ordering is possible only once it has started. A guest who never confirmed in time therefore can never order, even while sitting at the table. This is consistent, but it means walk-in guests are outside the system. **Not decided here** — it is a question for the team (and the obvious candidate is a walk-in flow, not a change to BR-07). | open |
| TBD-4 | Payment is modelled as a state change only. No payment method, no partial payment, no splitting the bill. Nobody has specified any of that, so it is not invented here. | open |
| TBD-5 | Who may order — under R-7 authorization is out of scope, so anyone who knows the reservation identifier can order to it. | open |

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
## Requirement acceptance review

Evidence that accepted requirements went through the nine acceptance questions. Reviewed by the
member who did **not** write the requirement.

### REQ-01 (OP-01 Create) — reviewed by B: *(pending)*

| Question | Answer |
|---|---|
| Meaning | "Valid interval" is defined once in BR-01; "exists" refers to stored Resource and User records. No other term in the requirement is open to interpretation. |
| Need | Without recorded intent there is nothing to confirm later; this is the entry point of the whole system and of the CP1 walking skeleton. |
| Observable outcome | States what exists afterwards (one DRAFT Reservation, identifier returned), not how it is stored. No storage technology is mentioned. |
| Feasibility | Implemented and running today. |
| Verifiability | V-01.1 to V-01.4; each has a single unambiguous expected result. |
| State / time / boundary | Depends on the interval boundary (`start == end` rejected) and on no other state. Creation is allowed for past intervals — deliberately, since only confirmation allocates; see the note below. |
| Concurrency | Two concurrent creations cannot affect each other's business outcome, because DRAFT allocates nothing (R-1). |
| Consistency | Consistent with OP-02 (DRAFT does not block) and with the state diagram entry transition. Consistency with OP-03 to be re-checked once B has written it. |
| Uncertainty | TBD-1 is marked, not invented. |

**Open question for the team:** should creating a Reservation whose `start` is already in the past
be rejected? Today it is accepted. It is harmless (such a draft can never be confirmed under
BR-04), but it may be surprising. Left as an explicit open question rather than silently decided.

### REQ-02 (OP-02 Check Availability) — reviewed by B: *(pending)*

| Question | Answer |
|---|---|
| Meaning | "Overlaps" is BR-01, "blocks" is BR-02 — both defined once. The set of blocking states is named explicitly (CONFIRMED only). |
| Need | Guests ask it before booking; staff ask it before confirming. Without it the only way to learn about a conflict is to be rejected at confirmation. |
| Observable outcome | A reported result plus the explicit statement that nothing changes. Says nothing about how the evaluation is performed. |
| Feasibility | Implemented and running today; consistent with the overlap check used by Confirm. |
| Verifiability | V-02.1 to V-02.7, including both interval boundaries and the DRAFT case. |
| State / time / boundary | Entirely boundary-sensitive — V-02.3 and V-02.4 are exactly the cases where a closed-interval reading would give the opposite answer. |
| Concurrency | The result may be stale the moment it is returned; this is stated in the operation rather than hidden. It does not change committed state, so it cannot break BR-02. |
| Consistency | Uses the same rule as Confirm (BR-02). If B's OP-03 ends up treating a different set of states as blocking, this requirement is wrong — that is consistency check K-2. |
| Uncertainty | The staleness window is acknowledged instead of being papered over with a lock or a hold, neither of which anyone has asked for. |

---

## Consistency check (phase 3)

Done after merging both halves — before the merge most of these could not be evaluated at all.
A row is "OK" only when both members agree.

| # | Check | Owner | Result |
|---|---|---|---|
| K-1 | Create vs. Confirm — is the Resource allocated only at confirmation? | A | **OK.** OP-01 creates a DRAFT and states explicitly that nothing is committed; OP-03 is the only place the overlap check runs. Both halves say the same thing, independently. |
| K-2 | Availability vs. Confirm — do both treat the same states as blocking? | A | **OK for v0.1** (only CONFIRMED blocks, in both OP-02 and OP-03). **OPEN for v0.2**: nothing yet says whether PENDING_APPROVAL blocks availability. B deliberately left the decision to A (task A10/A11). Until it is decided, OP-02 keeps the v0.1 meaning. |
| K-3 | Cancel vs. state diagram — do the text and the diagram allow the same transitions? | B | **OK.** BR-03 allows DRAFT/CONFIRMED (v0.2 also PENDING_APPROVAL) with the guard `now < start`; `docs/diagrams/state-diagram.md` has identical edges and guards, and maps each guard to the function that implements it. |
| K-4 | Interval semantics — is `[start, end)` used in every requirement, example and test? | A | **OK.** BR-01 defines it, BR-02 and OP-02 use it, BR-07 reuses the same boundary for the ordering window, and the boundary cases are tested on both sides (V-02.3/V-02.4 for availability, the ordering-window tests for `now == end`). |
| K-5 | Use case diagram vs. text — does every actor goal have specified behaviour and vice versa? | B | **OPEN — the diagram is behind the text.** `docs/diagrams/use-case.md` shows only the four baseline goals. Missing: the **Approver** actor with Approve/Reject (v0.2, task A12) and the **ordering** goal for the Guest (OP-06). Until that is fixed, the diagram is not a valid view of the system. |
| K-6 | Requirement vs. design decision — did an implementation choice leak into a requirement? | B | **OK with one deliberate exception.** No requirement mentions Prisma, SQL or a table. HTTP status codes *do* appear in the operations (409 vs. 410 vs. 202) — that is intentional: our only interface is HTTP, so the status code is part of the observable outcome, not an implementation detail. R-13 (integer hellers) is a storage decision recorded as a decision, not smuggled in as a requirement. |
| K-7 | Uncertainty vs. fabricated precision — does every number have a source? | A | **OK.** Two numbers exist: the 30-minute no-show grace (BR-04) and the 30-minute approval grace (BR-06). Both are labelled as team-chosen, not measured, and BR-06 says explicitly that nothing forces the two to stay equal. Menu prices are demo data in the seed script, not a requirement. |
| K-8 | Ordering vs. the rest of the lifecycle (new, appeared only after the merge) | A | **OK, and worth stating.** BR-07 requires CONFIRMED, so a PENDING_APPROVAL reservation cannot be ordered against — a table whose approval is still pending is not yet the guest's. Ordering never changes a reservation state, so it cannot violate BR-02 or the state diagram. |

### Open items blocking the v0.1/v0.2 sign-off

1. **K-2 for v0.2** — decide whether PENDING_APPROVAL blocks availability, and write it into OP-02 (owner A, task A11).
2. **K-5** — add the Approver actor and the ordering goal to the use case diagram (owner A, task A12).
3. **R-11 to R-13** — B has not yet confirmed the ordering decisions.
4. **TBD-3** below — the interaction between the no-show rule and the ordering window.

Once these four are closed, replace the header status with
`Specification Baseline v0.2 — approved by the team (date, both names)`.

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

## Poznámka k Definition of Done (B's sloupec)

Viz `docs/c02-plan.md` sekce 11 pro plnou tabulku s vlastníky. Položky, které tato branch
(`c02-person-b`) pokrývá: OP-03/OP-04 (úplná specifikace), BR-03/BR-04 (definovány jednou), OP-05
Approve (úplná specifikace včetně rejection a expirace), stavový diagram v0.1 a v0.2, aplikace
demonstruje confirm/cancel/approve/reject, u každé operace 1 úspěšný + 1 negativní skutečně
spuštěný příklad, architektonický driver pro C03. Zbývá: review od Osoby A (položky "ten druhý"
v tabulce DoD) a joint schválení baseline.
