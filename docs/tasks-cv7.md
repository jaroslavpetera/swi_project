# C07–C08 — nálezy C06, rizika, technická obhajoba a status report

Zadání: *SWI C07–C08 — Project assessment, risks and reviews* (CP1, max. 20 bodů).
Připraveno s AI na pokyn Michala, 29. 10. 2026. Rozdělení a termíny jsou **návrh** — potvrdit v týmu.

| Baseline | Účel |
|---|---|
| `a8f1052` | C06 assessed baseline — proti ní se reprodukují nálezy F1–F3 |
| `c07-reporting-baseline` (větev `c07`) | Reporting baseline pro A i C — opravy a aktuální stav |

## Stav

| Část | Výstup | Kde | Stav |
|---|---|---|---|
| C07 dnes | dispozice F1–F3, akce, closure evidence | [C06 Internal Evidence Assessment](evidence-and-evolution.md#c06-internal-evidence-assessment), [assessment](SWI_C06_Assessment_Hospoda_Devs.md#owner-disposition) | hotovo (návrh) |
| B | 5 rizik v 5 kategoriích, opatření, zbytkové, trigger; 2 issues | [C07 Risk Assessment](evidence-and-evolution.md#c07-risk-assessment) | hotovo (návrh) |
| C | 6 slajdů status reportu | [`c08-project-status.pptx`](c08-project-status.pptx) | hotovo (návrh) |
| A | osnova technické obhajoby | níže | připraveno, **generálka chybí** |
| — | lidské review výstupů C07 | [Lidské review C07](evidence-and-evolution.md#lidské-review-c07) | **chybí** |
| — | PR `c07` → `main` | GitHub | **otevřít / sloučit** |

## Co zbývá týmu (do C08)

1. **Review a potvrzení** dispozic F1/F2, rizik R-01…R-05 a status reportu; zapsat jména do tabulky Lidské review C07. — všichni
2. **Sloučit PR `c07`** (merge commit, ne squash — tag `c07-reporting-baseline` musí zůstat v historii `main`). — Jarda, do 30. 10.
3. **R-03:** den před C08 `npm ci` + `npm test` na notebooku, ze kterého se bude prezentovat. — Honza
4. **R-01:** generálka části A, každý přednáší část, kterou nepsal; projít kontrolní otázky. — Michal organizuje
5. Na C08 se zeptat vyučujícího na bod 10 C02 (I-02).

## A — Technical Design Review (8–10 min)

Jedna linie: **REQ-04 + BR-02 → ADR-03 → Reservation Lifecycle (C05) → testy → C06**.
Ukazovat v otevřeném repozitáři, ne na nových slajdech.

| # | Krok (čas) | Kdo (návrh) | Co ukázat | Doklad |
|---|---|---|---|---|
| 1 | Scope & accepted behavior (1,5 min) | Jarda | Hospoda: stůl = exkluzivní Resource; role Guest / Staff / Approver; operace **OP-03 Confirm**; invariant **BR-02**; změna v0.2 = approval (BR-05/06). | [`specification.md`](specification.md) — BR-01, BR-02, OP-03, OP-05; [`state-diagram.md`](diagrams/state-diagram.md); příklad V-04R.1 |
| 2 | Architecture (2 min) | Honza | AS-IS: BR-02 rozhodovala služba i podmínka v `UPDATE` (dvě chyby, garance jen díky SQLite) → driver D1/D2 → alternativy A (DB constraint) vs. B (Lifecycle + zámek Resource) → **ADR-03 = B**; G2 vlastník přechodů = Lifecycle; H1 sekvence. | [`architecture-and-decisions.md`](architecture-and-decisions.md) — A5, E2, E3, F (ADR-03), G2, G3, H1; kód `ReservationRepository.inResourceTransaction` |
| 3 | Detailed Design (2 min) | Jarda | Jednotka Reservation Lifecycle: kontrakt `LifecyclePolicy` (rozhodnutí jako hodnota), pořadí stav → lhůta → routing → alokace, tabulka C-F1…C-F5, `Close` = zapsat a pak chyba, `Clock` po zámku. | DD H1/H2; `src/domain/lifecyclePolicy.ts`; `src/services/reservationService.ts` › `decide`, `apply`, `allocate` |
| 4 | Verification & Evidence (2 min) | Michal | **Pozitivní:** sousední intervaly se potvrdí (DD-T5 / V-04R.6). **Negativní:** překryv → `OverlapError`, stav DRAFT, rollback (DD-T3). **Souběh:** bez zámku dvě CONFIRMED, se zámkem jedna (`lock-mechanism.test.ts`). **C04 kritérium:** korektnost pod 10× + nové p95 ≤ 500 ms. Oracle = DD/specifikace, ne kód (mutace M1–M5). | `npm test` (142/142); [`c07-postgres-verification.json`](evidence/c07-postgres-verification.json); [C05 evidence](evidence-and-evolution.md#c05-dd-verification-evidence) |
| 5 | C06 findings & decision (1,5 min) | Michal | **F2:** reprodukce (TZ UTC vs. Praha), ACCEPT, oprava + V-01.6/7. **F1:** chyběl práh → doplněn, měření → ADR-03 ponecháno. F3 zamítnut hodnotiteli. | [dispozice](evidence-and-evolution.md#c06-internal-evidence-assessment); diff `src/http/app.ts`; test V-01.6 |

**Živá ukázka (záloha = uložené JSON reporty):**

```bash
npm test                                   # 142/142 na PostgreSQL 16.14
npx vitest run tests/services/reservationLifecycle.unit.test.ts tests/domain/lifecyclePolicy.test.ts
curl -s -X POST localhost:3000/reservations -H 'content-type: application/json' \
  -d '{"resourceId":"…","userId":"…","startsAt":"2027-06-01T18:00:00","endsAt":"2027-06-01T20:00:00"}'   # → 400 (F2)
```

**Kontrolní otázky na generálku:** Proč ne DB exclusion constraint? Co se stane bez zámku na
PostgreSQL? Proč se `NoShowExpiredError` vyhazuje až po commitu? Proč se čas čte až po zámku?
Kde všude se ještě dá BR-02 obejít (ruční SQL — přijatý důsledek, R-02)? Proč práh 500 ms?

## C — Project Status Report (5–7 min)

Šablona z LMS vyplněná v [`c08-project-status.pptx`](c08-project-status.pptx). Kontroly konzistence
ze zadání: stejný commit/tag jako A; stejné nálezy C06; Verified jen s provedeným testem; otevřený
defekt se promítá do RAG a akčního plánu; neověřené opatření nesnižuje skutečné zbytkové riziko.
