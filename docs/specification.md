# Specification — Table Reservation System

**Status: v0.2 candidate, technically reviewed; team sign-off pending.**

Updated 22 September 2026 by Codex under the instruction to complete issue #9.
Authoritative behaviour is defined here; earlier drafts remain in Git.
Prior analysis: [completion impact](c02-completion-impact.md).
Review: [requirement acceptance](c02-requirement-review.md).
Executed results: [completion evidence](c02-completion-evidence.md).

| Item | Value |
|---|---|
| v0.1 scope | OP-01 Create, OP-02 Availability, OP-03 direct Confirm, OP-04 Cancel; BR-01…04 |
| v0.2 change | Resource.requiresApproval; OP-05 Approve/Reject, waiting and expiry; BR-05/06 |
| Retained extension | OP-06 ordering/tab, BR-07/08, REQ-07/08 |
| Original owners | A: Michal Křižák (Create, Availability, ordering); B: Jaroslav Petera (Confirm, Cancel, Approve) |
| Approval | Technical review is by Codex. Cross-review by another team member and explicit team approval of v0.1/v0.2 are still required. No new human signature is asserted. |

## Decisions and scope

R-1…R-10 were recorded as agreed by A+B in the merged source. Clarifications and
R-11…R-16 form this implemented candidate; they do not invent approval by A or B.

| ID | Decision | Reason |
|---|---|---|
| R-1 | Only CONFIRMED allocates a table. | Abandoned drafts and pending requests must not hold capacity. |
| R-2 | Create does not check overlap. | Intent and allocation are separate. |
| R-3 | Intervals are half-open. | Consecutive bookings can meet at a boundary. |
| R-4 | Active requests can be cancelled only before start. | Staff may rely on a started booking. |
| R-5 | Cancel on CANCELLED succeeds even after start. | Retries preserve success. |
| R-6 | Time is UTC server time; service tests can inject it. | Boundaries must be reproducible. |
| R-7 | Authentication, ownership and role checks are outside v0.1/v0.2. Create validates a stored userId; Confirm/Cancel/Approve/Reject carry only a reservation ID. Actors express intended users. | Do not imply an identity check absent from the API. |
| R-8 | Preserve BR-04's C01 cutoff. | An unconfirmed intention cannot become a late booking. |
| R-9 | A table is exclusive; capacity counts seats. | One booking receives the whole table. |
| R-10 | REQ-04 states a concurrency outcome. | Mechanisms belong in architecture. |
| R-11 | Orders belong to a Reservation. | It identifies the party/table being served. |
| R-12 | Ordering starts only during a confirmed slot. | Early confirmation does not start service. |
| R-13 | Store money as integer hellers; existing fields retain `Cents`. | Avoid floating-point drift; this is a design decision. |
| R-14 | Past intervals may be created as DRAFT. | Confirm still applies BR-04. |
| R-15 | Walk-ins, table deactivation, real payments, split bills and notifications are outside this candidate. | Do not invent unspecified operations. |
| R-16 | Only an Approve attempt detects expiry; reads are pure. | Preserve an explicit demonstrator trigger; timers remain a C03 driver. |

Former TBD-1/2/4/5 are scope exclusions (R-7/15); TBD-3 is resolved by excluding
walk-ins. Ordering after timely confirmation is consistent with the cutoff.
Ongoing-order test fixtures may prepare CONFIRMED directly in the DB; the tested
ordering operation then runs through HTTP.

## Domain rules and invariants

These are the authoritative definitions; operations and diagrams reference them.

### BR-01 — Interval semantics

An interval is `[startsAt, endsAt)` with parsable UTC timestamps and `startsAt < endsAt`.
Overlap means `A.start < B.end && B.start < A.end`. Adjacent intervals do not overlap.

### BR-02 — Exclusive Resource

No committed application state may contain two overlapping CONFIRMED reservations
of the same Resource. Only CONFIRMED blocks availability. DRAFT, PENDING_APPROVAL,
CANCELLED, REJECTED and EXPIRED do not. REQ-04 governs concurrent allocation.

### BR-03 — Cancellation

DRAFT, CONFIRMED and (v0.2) PENDING_APPROVAL may become CANCELLED only while
`now < startsAt`. Already CANCELLED returns unchanged success regardless of time.
REJECTED/EXPIRED cannot be cancelled. Rejection changes no state. Ownership is not
enforced in this demonstrator (R-7).

### BR-04 — No-show cutoff

DRAFT may confirm only while `now < startsAt − 30 minutes`. At or after the cutoff,
a Confirm attempt persists CANCELLED and returns 410. No autonomous DRAFT timer
exists. The 30-minute value is a team-chosen rule, not a measured fact.

### BR-05 — Approval routing

Resource.requiresApproval is a boolean, default false. False routes Confirm to
CONFIRMED; true routes it to PENDING_APPROVAL. Pending does not allocate;
overlap is evaluated when Approve actually allocates.

### BR-06 — Approval deadline and detection

Approve is eligible only while `now < startsAt − 30 minutes`. The value is
team-chosen and currently equals BR-04. An overdue Approve on PENDING_APPROVAL
persists EXPIRED and returns 410. Without that attempt the stored state remains
PENDING_APPROVAL, including on reads/availability. Reject may still produce
REJECTED after the deadline; Cancel may produce CANCELLED under BR-03. Neither
detects expiry. Once EXPIRED is stored, Approve/Reject/Cancel return 409.
EXPIRED, REJECTED and CANCELLED distinguish different causes of closure.

### BR-07 — Ordering window

Ordering requires CONFIRMED and `startsAt <= now < endsAt`. All other states/times
reject ordering. Ordering never changes Reservation state.

### BR-08 — Price capture

Capture each line's unit price on placement. Later menu-price changes do not alter
existing orders. Tab amounts use these captured prices.

## Common HTTP and concurrency outcomes

Invalid input returns 400; unknown reservation ID 404; invalid state or lost
concurrent transition 409. BR-04/06 are explicit exceptions where failure persists
a terminal state before returning 410. OP-03/04/05 may return 409 with reload/retry
when a competing transition changed the state; the loser never overwrites it.
Two concurrent Cancels remain idempotent. Retry is evaluated against current state.

## OP-01 — Create Reservation (REQ-01)

**Goal:** Guest records intent without allocating a table.
**Trigger:** `POST /reservations {resourceId, userId, startsAt, endsAt}`.
**Observable requirement:** existing User/Resource and valid interval produce exactly
one DRAFT; return 201 `{id, state}`.
**Preconditions:** references exist; BR-01 holds.
**Postcondition / state change:** `[none] → DRAFT`; existing availability is unchanged
(an already occupied table remains occupied).
**Rules:** BR-01/02, R-1/2/14.
**Main scenario:** validate fields/interval; verify references through persistence
integrity; create DRAFT; return identifier/state.
**Alternatives:** missing/invalid interval, unknown User/Resource → 400, nothing
created. Overlap or a past interval alone is accepted.
**Concurrency:** independent creations can both succeed because neither allocates.
**Examples:** V-01.1 success; V-01.2 zero duration; V-01.3 unknown Resource;
V-01.4 overlap accepted; V-01.5 past interval followed by rejected Confirm.
**Rationale:** abandoned intent must not hold capacity.
**Scope / TBD:** R-7; no unresolved behaviour inside this operation.

## OP-02 — Check Availability (REQ-02)

**Goal:** Guest/Staff learns whether a table is free.
**Trigger:** `GET /resources/:id/availability?start=&end=`.
**Observable requirement:** 200 `{available: false}` iff BR-02 finds a blocker;
otherwise true, for an existing Resource and valid interval.
**Preconditions:** Resource exists; BR-01.
**Postcondition / state change:** result only; nothing created or modified.
**Rules:** BR-01/02; BR-06 does not make this an expiry command.
**Main scenario:** validate query; find Resource; evaluate BR-02; return result.
**Alternatives:** invalid interval → 400; unknown Resource in URL → 404. Neither
error is answered with `available: true`.
**Concurrency:** result is a snapshot, not a hold or a promise of later confirmation.
**Examples:** V-02.1 free, .2 occupied, .3/.4 touching boundaries, .5 DRAFT,
.6 invalid query, .7 unknown table, .8 pending/approved/cancelled, .9 rejected;
V-05.6 expired.
**Rationale:** pending approvals do not silently hold capacity.
**Scope / TBD:** all non-CONFIRMED states are explicitly non-blocking.

## OP-03 — Confirm Reservation (REQ-03, REQ-04)

**Goal:** Staff turns intent into allocation or an approval request.
**Trigger:** `POST /reservations/:id/confirm`, no body required.
**REQ-03:** eligible DRAFT directly confirms for a non-approval Resource; otherwise
records a pending request.
**Preconditions:** existing DRAFT; BR-04 allows confirmation.
**Postcondition / state change:** `DRAFT → CONFIRMED` (200), or v0.2
`DRAFT → PENDING_APPROVAL` (202); only the former allocates.
**Rules:** BR-01/02/04/05; common concurrent outcomes.
**Main scenario:** locate DRAFT; check BR-04; inspect BR-05; if approval required,
persist pending; otherwise check BR-02 and persist CONFIRMED.
**Alternatives:** unknown → 404; wrong state → 409; BR-04 expiry → CANCELLED + 410;
overlap on direct Confirm → 409, retaining DRAFT; concurrent loser → 409 without
overwriting the winner.

**REQ-04:** competing Confirm/Approve requests for overlapping intervals of the
same Resource may produce at most one CONFIRMED reservation. Loser returns 409
without allocation. Concurrent changes on the same reservation cannot overwrite
a decision based on newer state. See architecture for SQLite enforcement and the
PostgreSQL migration constraint.

**Examples:** existing Confirm success/overlap HTTP examples; V-03.3 cutoff;
V-04R.1 competing allocations; .3 allocation/Cancel; .6 touching intervals;
.7 mixed Confirm/Approve; .8 HTTP 200/409.
**Rationale:** accepting intent differs from exclusive allocation.
**Scope / TBD:** R-7; REQ-04 is implemented on current SQLite, not deferred.

## OP-04 — Cancel Reservation (REQ-05)

**Goal:** Guest/Staff withdraws a request and releases any allocated slot.
**Trigger:** `POST /reservations/:id/cancel`.
**Observable requirement:** apply BR-03 and return 200 CANCELLED.
**Preconditions:** reservation exists; already CANCELLED (no time condition), or a
cancellable state before start.
**Postcondition / state change:** DRAFT/CONFIRMED/PENDING_APPROVAL → CANCELLED, or
unchanged CANCELLED. Released slot is available unless another booking allocates it.
**Rules:** BR-02/03 and common concurrent outcomes.
**Main scenario:** load; return existing CANCELLED immediately; check state/time;
persist CANCELLED.
**Alternatives:** unknown → 404; REJECTED/EXPIRED or closed window → 409 unchanged;
concurrent state change → 409, reload/retry. Committed cancellation cannot be
resurrected by a stale Confirm/Approve.
**Examples:** existing HTTP success/free slot and after-start failure; V-04.3 cancel
pending after approval deadline, retry after start; V-04R.3 race; .5 double Cancel.
**Rationale:** protect started bookings and make retries harmless.
**Scope / TBD:** R-7 excludes ownership enforcement.

## OP-05 — Approve / Reject (REQ-06, v0.2)

**Goal:** Approver accepts or declines a waiting request.
**Trigger:** `POST /reservations/:id/approve` or `/reject`, no body required.
**Observable requirement:** eligible approval → CONFIRMED (200); rejection →
REJECTED (200); overdue approval attempt → EXPIRED (410).
**Preconditions:** existing PENDING_APPROVAL; approval also requires BR-06 and BR-02.
Reject has no deadline condition.
**Postcondition / state change:** pending → CONFIRMED/REJECTED/EXPIRED as above;
overlap refusal retains PENDING_APPROVAL.
**Rules:** BR-01/02/05/06, REQ-04, common concurrent outcomes.
**Approve scenario:** load pending; check deadline; if overdue persist EXPIRED and
return 410; otherwise re-check current allocations and commit CONFIRMED only if free.
**Reject scenario:** load pending; persist REJECTED regardless of deadline.
**Alternatives:** unknown → 404; wrong state → 409; overlap → 409; concurrent loser
→ 409. No terminal state is reopened.
**Concurrency:** duplicate Approve or Approve/Reject cannot both win; checking old
availability alone is insufficient, REQ-04 applies at commit too.
**Examples:** existing service/API success, conflict, reject and expiry;
V-05.5 changed availability, .6 deadline, .7 late Reject/pure read, .8 HTTP expiry;
V-04R.1/2/4/7 races.
**Rationale:** table availability may change while a request waits.
**Scope / TBD:** R-7 excludes permissions; BR-06 explicitly defines lazy expiry.

## OP-06 — Ordering and tab (REQ-07, REQ-08)

**Goal:** Guest orders; Staff records service/payment; both inspect the tab.
**Trigger:** place/list orders, read tab, mark served or paid.
**REQ-07:** non-empty order with positive integer quantities of existing available
menu items within BR-07 produces PLACED with captured prices (201).
**REQ-08:** return unpaid, paid and total amounts using BR-08; permit
`PLACED → SERVED → PAID`, rejecting out-of-order transitions.
**Preconditions:** reservation exists for order/tab access; BR-07 for placement;
order exists in the preceding state for serve/pay.
**Postcondition / state change:** create Order or change Order state. Reservation
never changes. Reads have no side effects.
**Rules:** BR-07/08, R-11/12/13/15.
**Main scenarios:**
1. `POST /reservations/:id/orders {items:[{menuItemId, quantity}]}` validates input,
   checks reservation/window/menu, captures prices, creates order and lines together.
2. `GET /reservations/:id/orders` returns orders; `/tab` returns orders and
   `unpaidCents`, `paidCents`, `totalCents` (200). Unpaid includes PLACED/SERVED;
   total = unpaid + paid; an empty tab is zero.
3. `POST /orders/:id/serve` records SERVED from PLACED (200).
4. `POST /orders/:id/pay` records PAID from SERVED (200).
**Alternatives:** invalid/empty items or unavailable/unknown menu item → 400, no
order; missing reservation/order → 404; outside BR-07 → 409 with NOT_CONFIRMED,
BEFORE_START or AFTER_END; wrong serve/pay state → 409.
**Concurrency:** separate placements are separate orders; no idempotency key is
promised. Duplicate serve/pay may observe the same successful transition; they do
not charge a payment provider. Tab reads are snapshots.
**Examples:** V-06.1…11 in `tests/spec/op06-orders.test.ts` and domain ordering tests.
**Rationale:** record service/debt without changing allocation.
**Scope / TBD:** no walk-ins, real/partial payments or bill splitting (R-15).

## State table and views

| State | Meaning | Incoming operation | Blocks? | Terminal? |
|---|---|---|---|---|
| DRAFT | Intention | Create | no | no |
| PENDING_APPROVAL | Waiting for decision/detection | Confirm with BR-05 | no | no |
| CONFIRMED | Allocation of its interval | Direct Confirm, Approve | yes | no |
| CANCELLED | Withdrawal/no-show cutoff | Cancel, overdue Confirm | no | yes |
| REJECTED | Explicit decline | Reject | no | yes |
| EXPIRED | Overdue approval detected | Overdue Approve | no | yes |

CONFIRMED remains stored after its interval ends; no COMPLETED state is in scope.
Historical queries still evaluate that interval. Terminal states have no outgoing
transitions; repeated Cancel on CANCELLED is a no-op.
Views: [use cases](diagrams/use-case.md), [states](diagrams/state-diagram.md),
[Create/Availability](diagrams/activity-create-and-availability.md),
[Confirm/Cancel/Approve](diagrams/activity-confirm-cancel.md),
[ordering](diagrams/activity-place-order.md).

## Consistency check — 22 September 2026

Technical review by Codex; not team approval.

| Check | Result / proof |
|---|---|
| K-1 Create vs allocation | OK: OP-01 allocates nothing, OP-03/05 allocate; V-01.4. |
| K-2 Availability vs allocation | OK: BR-02 throughout; V-02.8/9 and V-05.6 cover new states. |
| K-3 Cancel vs graph | OK: BR-03 guards and time-independent CANCELLED no-op; V-04.3. |
| K-4 Intervals | OK: BR-01/07, V-02.3/4, V-04R.6 and ordering boundary tests. |
| K-5 Actors/goals | OK: v0.2 use cases cover OP-01…06, including Approver and order lifecycle; R-7 bounds identity. |
| K-6 Requirement vs mechanism | OK: outcomes here; SQLite mechanism in architecture; R-13 explicitly a design decision. |
| K-7 Uncertainty | OK: deadlines are team-chosen; scope bounded by R-7/15; signature pending. |
| K-8 Ordering vs lifecycle | OK: CONFIRMED only, no Reservation transitions; V-06.2/3/4. |
| K-9 Expiry | OK: Approve is the trigger in BR-06/text/diagram; V-05.7/8. |
| K-10 Concurrency | OK for SQLite application commands; V-04R.1…8. PostgreSQL needs revalidation. |

## Impact analysis — approval change and completion

This completes both roles' affected/unaffected analysis. The original order of
work on 21 September is **not proven**; today's prior analysis is linked above.

| Area | Affected? | Reason |
|---|---|---|
| OP-01 / REQ-01 | No behaviour change | Always creates DRAFT without allocation, regardless of resource flag. |
| OP-02 / REQ-02 | Meaning clarified, rule unchanged | Only CONFIRMED blocks; new states explicitly non-blocking. |
| OP-03 / REQ-03 | Yes | Approval flag adds pending/202; false retains direct result. |
| REQ-04 | New allocation path covered | Approve also needs exclusivity; completion enforces it atomically on SQLite. |
| OP-04 / REQ-05 | New source state | Pending can cancel under the existing time/idempotence policy. |
| OP-05 / REQ-06 | New actor and operation | Approver accepts/rejects; Approve detects expiry. |
| BR-01/02 | Invariants unchanged | Half-open intervals and exclusive CONFIRMED allocation remain. |
| BR-03/04 | Cancel adds pending; no-show unchanged | EXPIRED differs from DRAFT no-show cancellation. |
| BR-05/06 | New rules | Resource flag and approval cutoff/detection. |
| OP-06 / REQ-07/08, BR-07/08 | No approval-induced behaviour change | Pending cannot order; captured prices and totals remain. |
| Use cases | Updated v0.2 | Approver, Approve/Reject and retained ordering/tab/service/payment goals. |
| State graph | Updated v0.2 | Pending/rejected/expired and precise triggers; no invented timer/read transition. |
| Verification | Extended | V-02.8/9, V-03.3, V-04.3, V-05.5…9, V-04R.1…8; evidence matrix links results. |

## C03 drivers and outstanding process

1. Port exclusivity and guarded transitions to PostgreSQL with a proven isolation/
   constraint strategy under 10× load. SQLite tests do not prove another provider.
2. Decide whether timely physical expiry/notifications need a worker; define retries
   and observability before implementation.
3. A human peer still must complete cross-review; the team must explicitly approve
   v0.1/v0.2. Agent text cannot substitute for their signature.
4. Find contemporaneous proof of original prior analysis or acknowledge the process
   gap with the instructor. Never backdate evidence.
