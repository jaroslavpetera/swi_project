# 9c — Activity diagrams: Confirm a Cancel

Vlastník: **Osoba B** (`docs/c02-plan.md` úkol B7 pro v0.1; aktualizace pro v0.2 doplněna, aby
diagram nebyl neaktuální vůči `docs/specification.md`, viz konzistenční kontrola K-3).

## Confirm Reservation (OP-03) — v0.1

```mermaid
flowchart TD
    A[Start: POST /reservations/:id/confirm] --> B{Reservation exists?}
    B -- no --> B1[404 Not Found]
    B -- yes --> C{state == DRAFT?}
    C -- no --> C1[409 Invalid state]
    C -- yes --> D{now >= start - 30min?\nBR-04 no-show}
    D -- yes --> D1[state -> CANCELLED\n410 No-show expired]
    D -- no --> E{overlap with a CONFIRMED\nreservation on same Resource?\nBR-01/BR-02}
    E -- yes --> E1[409 Overlap\nstate stays DRAFT]
    E -- no --> F[state -> CONFIRMED\n200]
```

## Confirm Reservation (OP-03) — v0.2 update (BR-05 branch)

Rozdíl oproti v0.1: mezi krok D (no-show) a krok E (overlap) přibývá rozhodovací bod na
`Resource.requiresApproval`. Pro `requiresApproval = true` se overlap kontrola v Confirm
**přeskakuje** — přesouvá se do Approve (OP-05), viz níže.

```mermaid
flowchart TD
    A[Start: POST /reservations/:id/confirm] --> B{Reservation exists?}
    B -- no --> B1[404 Not Found]
    B -- yes --> C{state == DRAFT?}
    C -- no --> C1[409 Invalid state]
    C -- yes --> D{now >= start - 30min?\nBR-04 no-show}
    D -- yes --> D1[state -> CANCELLED\n410 No-show expired]
    D -- no --> G{resource.requiresApproval?\nBR-05}
    G -- yes --> G1[state -> PENDING_APPROVAL\n202 Accepted]
    G -- no --> E{overlap with a CONFIRMED\nreservation on same Resource?}
    E -- yes --> E1[409 Overlap\nstate stays DRAFT]
    E -- no --> F[state -> CONFIRMED\n200]
```

## Cancel Reservation (OP-04) — v0.2 (guard totožný jako v0.1, jen širší množina zrušitelných stavů)

```mermaid
flowchart TD
    A[Start: POST /reservations/:id/cancel] --> B{Reservation exists?}
    B -- no --> B1[404 Not Found]
    B -- yes --> C{state == CANCELLED?}
    C -- yes --> C1[200 unchanged\nR-5 idempotent]
    C -- no --> D{state in\nDRAFT / CONFIRMED / PENDING_APPROVAL?\nBR-03}
    D -- no --> D1[409 Not cancellable\ne.g. REJECTED, EXPIRED]
    D -- yes --> E{now >= startsAt?\nR-4 cancellation window}
    E -- yes --> E1[409 Cancellation window passed]
    E -- no --> F[state -> CANCELLED\n200, slot freed for BR-02]
```

## Approve Reservation (OP-05) — v0.2

```mermaid
flowchart TD
    A[Start: POST /reservations/:id/approve] --> B{Reservation exists?}
    B -- no --> B1[404 Not Found]
    B -- yes --> C{state == PENDING_APPROVAL?}
    C -- no --> C1[409 Invalid state]
    C -- yes --> D{now >= approval deadline?\nBR-06}
    D -- yes --> D1[state -> EXPIRED\n410]
    D -- no --> E{overlap with a CONFIRMED\nreservation on same Resource?\nBR-02, re-checked}
    E -- yes --> E1[409 Overlap\nstate stays PENDING_APPROVAL]
    E -- no --> F[state -> CONFIRMED\n200]
```

Všechny uzly změny stavu používají očekávaný výchozí stav při zápisu; uzly vedoucí
do CONFIRMED navíc atomicky ověřují BR-02. Ztracený souběh vrací 409 bez přepsání
aktuálního stavu, i když předchozí čtení prošlo. Dva Cancely mohou oba úspěšně
vrátit CANCELLED. Viz REQ-04 a `tests/services/concurrency.test.ts`.

Reject (druhá větev OP-05): existence → PENDING_APPROVAL → REJECTED (200);
neznámá rezervace → 404, jiný stav → 409. Deadline se u Reject nekontroluje (BR-06).
