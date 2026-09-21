# Specification — Table Reservation System

**Status: Baseline v0.1 — DRAFT, not yet approved by the team.**

| | |
|---|---|
| Scope | Minimal behaviour of the reservation system: Create, Check Availability, Confirm, Cancel |
| Owner A (OP-01, OP-02, BR-01, BR-02, accepted decisions) | Michal Křižák — **done, ready for review** |
| Owner B (OP-03, OP-04, BR-03, BR-04, state transition table) | *(doplnit)* — **TODO** |
| Approval | pending — becomes *Baseline v0.1 approved* only after the consistency check (phase 3) and explicit sign-off by both members |

> Sections marked **TODO (B)** are intentionally left empty. They are not omissions — they are
> owned by the other team member and must not be silently filled in by anyone else, because the
> decisions behind them (cancellation policy, no-show semantics) change the meaning of operations
> that are already written here.

---

## Accepted decisions

Decisions taken before writing the specification. Each one changes the meaning of several
requirements, so they are recorded once, here, and referenced from the operations.

**Proposed by A — every decision needs explicit agreement from B before v0.1 is approved.**
Items D-04, D-05 and D-08 directly define B's operations and are therefore B's call to confirm.

| # | Decision | Rationale | Status |
|---|---|---|---|
| D-01 | A DRAFT Reservation does **not** allocate the Resource. Only CONFIRMED blocks it. | Creation records intent. A guest who never confirms must not block a table, otherwise a spike of abandoned drafts would empty the pub. | agreed by A, **B to confirm** |
| D-02 | Create does **not** check for conflicts. | Follows from D-01: there is nothing to conflict with until allocation happens at confirmation. | agreed by A, **B to confirm** |
| D-03 | Intervals are half-open: `[start, end)`. | Two reservations 18:00–20:00 and 20:00–22:00 are a normal turnover of the same table, not a conflict. Closed intervals would reject the most common real case. | agreed by A, **B to confirm** |
| D-04 | Cancellation is allowed for DRAFT and CONFIRMED while `now < start`. | Cancelling a reservation whose slot has already begun does not free anything useful; the table is already occupied or lost. | **B decides** (BR-03) |
| D-05 | Cancelling an already CANCELLED Reservation is an idempotent success. | A client that retries after a timeout must not receive an error for an operation that already reached the desired state. | **B decides** (BR-03) |
| D-06 | Time source is the server clock in UTC, injectable in the service layer. | Without an injectable clock, no-show and cancellation deadlines cannot be tested deterministically. | agreed by A |
| D-07 | Authorization is **TBD and explicitly out of scope for v0.1**. "Authorized User" means the request carries the identifier of an existing User. No roles, no tokens. | Nobody has specified an authentication model. Inventing roles here would be fabricated precision. | agreed by A, **B to confirm** |
| D-08 | Resources are **exclusive**: one table holds one reservation at a time. `Resource.capacity` is the number of seats, not the number of concurrent reservations. | A table is physically handed over to one party. Capacity is guest-facing information, not a concurrency limit. | agreed by A, **B to confirm** |
| D-09 | Concurrency (REQ-04) is specified as an observable outcome, not as a mechanism. | *How* exclusivity is enforced under concurrency is an architecture question, deferred to C03. | agreed by A |
| D-10 | The no-show rule from C01 is kept as a domain rule in v0.1. | It is our domain-specific rule and it is already implemented and tested. | **B owns** (BR-04) |
| D-11 | Ordering food and drinks is bound to a Reservation, not to a Resource or a User. | The reservation is what entitles a guest to that table at that time; an order without one has no table to be served to. | agreed by A |
| D-12 | Orders are accepted only while the slot is running (BR-05), not from the moment of confirmation. | Confirming days ahead is a promise about a table, not the start of service. Kitchen and bar act on what is ordered now. | agreed by A |
| D-13 | Money is stored in integer hellers (`priceCents`), never as a decimal number. | Repeated addition of a tab in floating point drifts. The unit is an implementation-visible but deliberate choice. | agreed by A |

### Open TBDs

| # | Unknown | Why it is not decided | Impact if resolved differently |
|---|---|---|---|
| TBD-1 | Authorization model (D-07) | Not specified by anyone; no source | Adds preconditions and a new failure outcome to all four operations |
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
- All times are UTC instants (D-06).

### BR-02 — Exclusive Resource invariant

At no committed system state may two CONFIRMED Reservations of the same Resource overlap
(BR-01 defines overlap).

Consequences:
- Reservations in any other state (DRAFT, CANCELLED) never violate this invariant and never
  block a Resource (D-01).
- The invariant is about committed state, not about requests: concurrent attempts that would
  violate it are governed by REQ-04.

### BR-03 — Cancellation policy

**TODO (B)** — must state: which states may be cancelled, the time boundary and its source, and
the outcome of cancelling an already CANCELLED Reservation. Proposals D-04 and D-05 are input,
not a decision.

### BR-04 — No-show rule (domain-specific rule from C01)

**TODO (B)** — must state: the grace period before `start`, what happens to a DRAFT Reservation
when a confirmation is attempted after that deadline, and whether the resulting state change is
observable to the user.

### BR-05 — Ordering window

Food and drinks may be ordered against a Reservation only while that Reservation is CONFIRMED
**and** the current time lies inside its interval: `start <= now < end`.

Consequences:
- A DRAFT or CANCELLED Reservation never accepts orders, whatever the time — an unconfirmed
  intention does not entitle anyone to a table or to service.
- The window opens exactly at `start` and closes exactly at `end`, reusing the half-open
  semantics of BR-01. The boundary is therefore defined in one place for the whole system.
- The time source is the server clock (D-06).

### BR-06 — Price capture

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
- The User exists (D-07: "authorized" means nothing more than this in v0.1).
- The Resource exists.
- The interval is valid per BR-01 (`start < end`).

**Success postcondition:**
- Exactly one new Reservation exists;
- `Reservation.state = DRAFT`;
- **no Resource allocation is committed** — the Resource remains available for the same interval
  (D-01);
- BR-02 is unaffected.

**State change:**
`[none] → DRAFT`

**Referenced rules:**
BR-01 (interval semantics), D-01/D-02 (DRAFT does not allocate, no conflict check at creation).

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
- interval overlapping an existing CONFIRMED Reservation → **accepted, DRAFT is created** (D-02).
  The conflict is detected at confirmation time (OP-03), not here.

**Verification examples:**

| # | Input | Expected observable result |
|---|---|---|
| V-01.1 | existing Resource + User, `[2027-03-01T18:00, 2027-03-01T20:00)` | one Reservation created, state DRAFT, identifier returned |
| V-01.2 | `start == end` (`18:00`, `18:00`) | rejected, no Reservation created |
| V-01.3 | unknown Resource identifier | rejected, no Reservation created |
| V-01.4 | interval fully inside an existing CONFIRMED reservation | accepted, DRAFT created — proves D-02 |

**Rationale / source:**
Separating intent from allocation is what makes the DRAFT state meaningful at all. If Create
allocated the table, DRAFT and CONFIRMED would differ only in name, and an abandoned draft would
block a table indefinitely. Carried over from the C01 domain model.

**Assumption / unknown / TBD:**
TBD-1 (authorization model, D-07).

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
BR-01 (what "overlaps" means), BR-02 (which reservations block), D-01 (DRAFT does not block).

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
| V-02.5 | same interval, but the existing Reservation is DRAFT instead of CONFIRMED | available — proves D-01 |
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

## OP-03 — Confirm Reservation

**TODO (B)** — REQ-03 (conditions for confirmation) and REQ-04 (observable outcome under
concurrent conflicting confirmations). Must also state explicitly what happens to the state when
confirmation is rejected, including the no-show case governed by BR-04.

---

## OP-04 — Cancel Reservation

**TODO (B)** — REQ-05, based on the policy decided in BR-03, including the outcome of a Cancel
racing with a Confirm.

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

> **REQ-06:**
> The system shall accept an order of one or more available menu items against a Reservation only
> while that Reservation is CONFIRMED and the current time lies inside its interval (BR-05); the
> resulting order shall record the quantity and the price of each item at the time of ordering.

> **REQ-07:**
> The system shall report, for a Reservation, the total of its orders split into the part that is
> already paid and the part that is still outstanding.

**Preconditions:**
- The Reservation exists.
- BR-05 holds: `Reservation.state = CONFIRMED` and `start <= now < end`.
- Every requested menu item exists and is marked available.
- Every requested quantity is a positive integer.

**Success postcondition:**
- One new Order exists, linked to the Reservation, in state PLACED;
- the Order carries a line per requested item with the quantity and the captured unit price (BR-06);
- the outstanding part of the tab grows by the order total;
- no Reservation state is changed — ordering never alters the reservation lifecycle.

**State change:**
`[none] → PLACED`, and for an existing order `PLACED → SERVED → PAID`.

**Referenced rules:**
BR-01 (interval boundary reused by the ordering window), BR-05 (ordering window), BR-06 (price
capture), D-01 (only a confirmed reservation is a real allocation, and only a real allocation is
served).

**Main success scenario:**
1. Guest picks items from the menu and submits quantities against their Reservation.
2. System checks the ordering window (BR-05).
3. System checks that every item exists and is available.
4. System captures the current price of each item (BR-06).
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
| V-06.9 | menu price changed after the order was placed | the order total stays unchanged (BR-06) |
| V-06.10 | order placed → served → paid | outstanding total becomes 0, paid total equals the order |
| V-06.11 | pay an order that is still PLACED | rejected, order stays PLACED |

**Rationale / source:**
Comes directly from the original project idea in C01 ("rezervace stolu + objednání piva na určitý
čas" and "aktuální stav dluhu na účtu"). Tying orders to the reserved slot is what makes them
meaningful: it is the reservation that entitles the guest to that table at that time.

**Assumption / unknown / TBD:**

| # | Item | Note |
|---|---|---|
| TBD-3 | **Interaction between BR-04 and BR-05.** Under BR-04 a reservation must be confirmed at least 30 minutes before it starts; under BR-05 ordering is possible only once it has started. A guest who never confirmed in time therefore can never order, even while sitting at the table. This is consistent, but it means walk-in guests are outside the system. **Not decided here** — it is a question for the team (and the obvious candidate is a walk-in flow, not a change to BR-05). | open |
| TBD-4 | Payment is modelled as a state change only. No payment method, no partial payment, no splitting the bill. Nobody has specified any of that, so it is not invented here. | open |
| TBD-5 | Who may order — under D-07 authorization is out of scope, so anyone who knows the reservation identifier can order to it. | open |

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
| Concurrency | Two concurrent creations cannot affect each other's business outcome, because DRAFT allocates nothing (D-01). |
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

To be completed jointly once OP-03 and OP-04 exist. A rule is "OK" only when both members agree.

| # | Check | Owner | Result |
|---|---|---|---|
| K-1 | Create vs. Confirm — is the Resource allocated only at confirmation? | A | pending (needs OP-03) |
| K-2 | Availability vs. Confirm — do both treat the same states as blocking? | A | pending (needs OP-03) |
| K-3 | Cancel vs. state diagram — do the text and the diagram allow the same transitions? | B | pending |
| K-4 | Interval semantics — is `[start, end)` used in every requirement, example and test? | A | OK for OP-01, OP-02, BR-01, BR-02; pending for OP-03, OP-04 |
| K-5 | Use case diagram vs. text — does every actor goal have specified behaviour and vice versa? | B | pending |
| K-6 | Requirement vs. design decision — did an implementation choice leak into a requirement? | B | pending |
| K-7 | Uncertainty vs. fabricated precision — does every number have a source? | A | OK for A's parts: the only numeric value in OP-01/OP-02 is the interval itself, which comes from the request. The 30-minute grace period belongs to BR-04 and must be justified by B. |
