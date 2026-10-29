# C06 — Assessment Form (CZ)

## Projekt

```text
Hodnotící tým:        [doplňte název týmu a členy]
Hodnocený tým:        Hospoda Devs (Jaroslav Petera, Michal Křižák, Jan Kovařčík)
Projekt:              Rezervační systém hospody — https://github.com/jaroslavpetera/swi_project
Assessed commit/tag:  a8f1052fab7d6f4e0726ebf49786c86206d3ba11 (main = origin/main, „c05 kompletne hotovy“)
Datum:                26. 10. 2026
```

Převzetí (krok 0):

```text
How to build:          npm ci  (postinstall vygeneruje oba Prisma klienty)
How to run:            npm run dev  (embedded PostgreSQL 16.14 na 127.0.0.1:55432)
How to run tests:      npm test  (nová PostgreSQL DB, migrace, seed, tsc, Vitest)
Path to C02 artifacts: docs/specification.md, docs/diagrams/*, docs/c02-completion-evidence.md
Path to C03 artifacts: docs/architecture-and-decisions.md (#c03-part-a…, #c03--architecture),
                       docs/evidence-and-evolution.md#c03--architecture-evidence
Path to C04 evidence:  NEUVEDENO — v repozitáři není artefakt ani sekce „C04“. Použito nejbližší:
                       docs/intent-and-change.md (Selected future pressure Q), C03 driver D2,
                       docs/c03-technical-completion.md, scripts/postgres-load.ts,
                       docs/evidence/c03-postgres-verification.json
Path to C05 artifacts: docs/architecture-and-decisions.md#c05-detailed-design,
                       docs/evidence-and-evolution.md#c05-dd-verification-evidence,
                       tests/services/reservationLifecycle.unit.test.ts, tests/domain/lifecyclePolicy.test.ts
```

Prostředí hodnocení: čistý klon `a8f1052` mimo pracovní kopii, macOS, Node 20.19.5.

## Stavy

`YES / PARTLY / NO / N/A`

Každý řádek musí obsahovat Evidence.

## Baseline

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| B1 Stejná identifikovaná baseline pro docs/code/tests | YES | Hodnoceno na `a8f1052`: specifikace, architektura/DD, evidence, `src/` i `tests/` jsou v jednom commitu. Manifest `docs/evidence/c05-main-postgres-tests.json` (SHA-256 60 souborů zdrojů/testů/migrací/skriptů) se shoduje s `a8f1052` — 0 rozdílů (přepočítáno). **Poznámka:** tag `c05-detailed-design` → `055917c` neobsahuje ověřený stav: `git diff c05-detailed-design a8f1052 -- src tests` = 1 řádek (aserce K4 v `tests/services/reservationLifecycle.unit.test.ts:227`). Evidence C05 tak odpovídá `a8f1052`, ne tagu. |
| B2 Relevantní produkt nebo testy lze spustit | YES | `npm ci` + `npm test` v čistém klonu: embedded PostgreSQL 16.14, READ COMMITTED, base `a8f1052` → **14 souborů, 138/138 passed**. Navíc `npm run verify:postgres` (migrace, drift, build, testy, zátěž) → passed. Poznámka: `npm test` přepisuje sledované `docs/evidence/c03-*.json`, proto běh v klonu. |

## C02 — Engineering Specification

Vybraná operace: **OP-01 Create Reservation (REQ-01)**
Vybraný business rule / invariant: **BR-01 — Interval semantics** (`[startsAt, endsAt)`, „parsable UTC timestamps“, `startsAt < endsAt`; definice překryvu, na které stojí BR-02 a lhůty BR-04/06). Confirm + BR-02 jsou podrobně pokryté v C03/C05 níže.

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| R1 Operation: input + precondition + postcondition/state | YES | `docs/specification.md:110-128`: vstup `POST /reservations {resourceId, userId, startsAt, endsAt}`; precondition: reference existují a platí BR-01; postcondition `[none] → DRAFT`, 201 `{id, state}`, nic se nealokuje; chyby → 400, nic se nevytvoří. |
| R2 Business rule/invariant je jednoznačný | YES | `docs/specification.md:52-55`. Vlastními slovy: BR-01 **zakazuje** interval s `startsAt >= endsAt` a **garantuje**, že intervaly jsou polouzavřené, takže `[18:00,19:00)` a `[19:00,20:00)` se nepřekrývají (překryv = `A.start < B.end && B.start < A.end`). Časy jsou UTC (spolu s R-6 „Time is UTC server time… Boundaries must be reproducible“, `specification.md:31`). Poznámka: není výslovně řečeno, co s časem bez offsetu — viz R4. |
| R3 Operation/rule je konzistentní se state modelem | YES | `docs/diagrams/state-diagram.md` v0.2: `[*] --> DRAFT: create`. Stavová tabulka `specification.md:257`: DRAFT „Blocks? no“, to odpovídá R-1/R-2 (Create nealokuje). Guard `no overlap` u CONFIRMED používá stejnou definici BR-01 (`src/domain/rules.ts:19-21`). |
| R4 Implementace odpovídá specifikované semantics | PARTLY | Code path: `src/http/app.ts:30-37` (Zod `reservationInputSchema`, `refine(endsAt > startsAt)`) → `:146-156` → `ReservationService.createReservation` (`src/services/reservationService.ts:82-84`) → `ReservationRepository.create` se stavem DRAFT (`src/repositories/reservationRepository.ts:76-87`). Polouzavřený interval a `start < end` odpovídají. **Neodpovídá:** `z.coerce.date()` přijme i čas, který není UTC (bez offsetu, holé číslo `"1"`), a vyloží ho v časové zóně serveru — stejný požadavek se uloží jako jiný okamžik podle TZ serveru → **F2**. |
| R5 Existuje vhodná verification evidence | PARTLY | `tests/spec/op01-op02.test.ts:62-98` V-01.1 (201 DRAFT), `:79` V-01.2 (start == end → 400), V-01.3 (neznámý Resource → 400), `:132` V-02.3/4 (dotyk na hranici), `:164` V-02.6 (nečitelný / obrácený interval → 400). Všechny prošly (138/138). Všechny testovací vstupy ale mají sufix `Z`; tvrzení „UTC timestamps“ / R-6 žádný test neověřuje → **F2**. |

## C03 — Architecture

Vybraná responsibility: **C2 R3 — vyhodnotit konflikt a zachovat invariant exkluzivity BR-02** (rozhodnutí o alokaci)
Vybraná interaction: **H1 — Confirm Reservation pod zámkem Resource** (lock → reload → BR-02 → transition / alt OverlapError → rollback → 409)
Vybrané ADR/decision: **ADR-03 — kde se rozhoduje alokace (BR-02) při souběhu** (alternativa B: Lifecycle + zámek Resource)

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| A1 Responsibility + owner jsou explicitní | YES | `docs/architecture-and-decisions.md:364` (C2 R3: „jeden jasný vlastník: ano“); G2 tabulka `:565-571`: **Reservation Lifecycle** owns „lifecycle přechody, rozhodnutí BR-02“; Persistence „poskytuje zámek, ne pravidlo“ (`:573-576`); G3 `:578-594`: owner všech 7 přechodů = Lifecycle. |
| A2 Skutečný code ownership odpovídá architektuře | YES | BR-02 rozhoduje jen `ReservationService.allocate()` (`src/services/reservationService.ts:153-158`) přes `LifecyclePolicy.decideAllocation()` (`src/domain/lifecyclePolicy.ts:53-62`, podle C05 součást Lifecycle). `PrismaReservationTx.transition()` má jen guard očekávaného stavu, bez predikátu překryvu (`src/repositories/reservationRepository.ts:60-70`). Migrace nemá exclusion constraint. `AvailabilityService` jen čte (`src/services/availabilityService.ts:17-26`). `grep` přes `src/`: jediné zápisy do Reservation jsou v `reservationRepository.ts:64,77`. L2 `tests/architecture/lifecycle-ownership.test.ts` 4/4 passed. |
| A3 Dynamic interaction odpovídá skutečnému call path | YES | H1 (`architecture-and-decisions.md:617-661`) vs kód: `app.ts:158-166` → `ReservationService.confirmReservation` → `decide()`: `repository.findById` → `inResourceTransaction` → `UPDATE "Resource" SET id=id` (lock, `reservationRepository.ts:104-123`) → `tx.findById` → `tx.findResource` → `decideConfirm` → `allocate`: `tx.findConfirmedForResource` → `findOverlappingConfirmed` → `tx.transition` → commit; při konfliktu `OverlapError` → rollback → 409 (`app.ts:282`). Odchylky v detailu jsou zdokumentované jako pozdější vývoj: H1 kreslí `confirm(id, now)` z API, kód čte čas z `Clock` až po zámku (C05 N2/DR2); `tx.findResource` se volá před kontrolou stavu (C05 nález K3). |
| A4 ADR/decision odpovídá současné implementaci | YES | ADR-03 (`architecture-and-decisions.md:464-515`) je v kódu stále vidět: všechny přechody (Confirm/Approve/Reject/Cancel) jdou přes `decide()` → `inResourceTransaction` (`reservationService.ts:86-128, 160-178`); guard stavu zůstává jako druhá pojistka; jedna chybová cesta při konfliktu (V-04R.1/V-04R.7 očekávají u poraženého `OverlapError` — `tests/services/concurrency.test.ts:85-94, 136-145`, passed na PostgreSQL). Mechanismus: `tests/postgres/lock-mechanism.test.ts` 2/2 passed (bez zámku vzniknou dvě CONFIRMED). Přijatý důsledek „DB invariant nechrání“ stále platí (žádný constraint). Viz zamítnutý kandidát **F3**. |

## C04 — Quality & Measurement

Quality concern: **Q — Quality / Scale: 10× více souběžných rezervací** (páteční večer) — `docs/intent-and-change.md:69-72`, C03 driver D2 (`architecture-and-decisions.md:285`), ADR-03.
Criterion: **korektnost pod 10×:** horký stůl → právě 1 úspěch a zbytek 409; různé stoly → všechny úspěšné; 0 neočekávaných chyb; 0 porušení BR-02 (`docs/c03-technical-completion.md:34-41`, `scripts/postgres-load.ts:54-61`). Pro latenci kritérium **není** (`c03-technical-completion.md:43-44`).

> Upozornění: tým nemá artefakt označený C04 ani sekci C04 v `docs/evidence-and-evolution.md`. Hodnotíme nejbližší existující řetězec concern → criterion → measurement → decision. Pokud tým C04 odevzdal jinde, je potřeba ho doložit (krok 0 „Path to C04 evidence“).

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| Q1 Criterion je skutečně evaluable | PARTLY | Korektnostní kritérium je jednoznačné a vynucené asercemi (`scripts/postgres-load.ts:54-61`). Kvalitativní trade-off, který tým u ADR-03 sám přijal, ale kritérium nemá: „u velmi horkého stolu roste latence“ (`architecture-and-decisions.md:500`) a „znovu otevřeme, když měření ukáže čekání na zámek Resource jako úzké hrdlo při 10× zátěži“ (`:511`). „Úzké hrdlo“ nemá práh; „konkrétní limit latence zůstává provozní prací“ (`c03-technical-completion.md:43-44`). → **F1** |
| Q2 Measurement měří criterion ve správném contextu | YES | `npm run verify:postgres` → `scripts/postgres-load.ts`: souběh 5 → 50 (= 10×), 3 scénáře (hot-confirm, hot-mixed, distributed-mixed) × 3 opakování, HTTP přes Express + Lifecycle + PostgreSQL 16.14 READ COMMITTED; ověřuje počty 200/409 i uložený invariant. Původní evidence `docs/evidence/c03-postgres-verification.json` (11. 10., `b315e87` + necommitnuté změny, doloženo SHA manifestem). **Zopakováno** na `a8f1052`: 138/138 + všech 18 dávek splnilo kritérium (1/49 resp. 50/0, 0 překryvů). Omezení (lokální, jeden proces) tým sám uvádí. |
| Q3 Decision odpovídá výsledku měření | PARTLY | Tvrzení „BR-02 drží při 10×“ z měření vyplývá. K latenci se ale z měření nic nerozhodlo: p95 při souběhu 50 je na horkém stole 108–164 ms vs. 72–76 ms na různých stolech (11. 10.), v našem běhu 32–65 ms vs. 16–17 ms (2–4×). Nikde není zapsáno, zda to podmínku znovuotevření ADR-03 splňuje. → **F1** |

## C05 — Detailed Design & Unit Verification

Vybraná software unit: **Reservation Lifecycle — rozhodnutí Confirm / Approve** (`ReservationService` + `LifecyclePolicy` + `Clock`; C05 DD v `architecture-and-decisions.md:967-1404`)

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| D1 Design intent je explicitní a pochopitelný | YES | DR1–DR7 (`architecture-and-decisions.md:991-1001`), ownership (`:1003-1022`), kontrakty 1–4 vč. pre/post/failures (`:1024-1091`), strukturální pohled (`:1093-1160`), sekvence H3 (`:1162-1214`), operace H1 (`:1216-1317`), rozhodovací tabulky C-F1…C-F5 / A-F1…A-F4 + pseudokód (`:1319-1386`), H4 věci ponechané kódu (`:1388-1403`). Pořadí stav → lhůta → routing → alokace je zdůvodněné. |
| D2 DD odpovídá skutečné implementaci | YES | `decideConfirm` / `decideApprove` / `decideAllocation` (`src/domain/lifecyclePolicy.ts:25-62`) odpovídají tabulkám řádek po řádku; rozhodnutí jako hodnota (union `kind`); `Clock` čten jednou po `tx.findById` uvnitř transakce (`reservationService.ts:166-175`); `Close` → zápis → commit → výjimka až po commitu (`:130-148, 176`); `MissingResourceError` (`:58-64, 88-89`); kontrakt `ReservationTx` (`reservationRepository.ts:14-26, 40-71`). Mismatch tabulka (`evidence-and-evolution.md:437-454`) odpovídá kódu `a8f1052`. |
| D3 Unit/component tests jsou odvoditelné z DD | YES | Tabulka „Tests derived from DD“ (`evidence-and-evolution.md:349-363`) mapuje DD-T1…T11 na DR/kontrakt/řádek tabulky; ID jsou přímo v názvech testů (`tests/services/reservationLifecycle.unit.test.ts`, `tests/domain/lifecyclePolicy.test.ts`, `tests/services/reservationTx.contract.test.ts`, `tests/postgres/lock-mechanism.test.ts`); matice H2 → testy (`evidence-and-evolution.md:398-418`). |
| D4 Relevantní branches/boundaries/states/failures jsou ověřeny | YES | Všech 9 řádků H2 (DD-T9 16 případů + DD-T1…T8 přes službu); hranice: lhůta v rovnosti a 1 ms před ní (DD-T2/T2c, DD-T9), dotýkající se interval (DD-T5, DD-T9); stavy: 5 nepovolených výchozích stavů pro Confirm i Approve (DD-T6/T6b); failures: Overlap + rollback, Close + commit, MissingResource, změna během čekání na zámek (DD-T4/T4b/T8b), guard (DD-T10b), souběh na PG (DD-T11). Netestovaný je jen timeout 30 s → 500 z kontraktu 1; tým ho sám uvádí jako riziko (`evidence-and-evolution.md:476-477`). |
| D5 Vybraný test má smysluplný oracle/expected result | YES | Vybrán **DD-T4** (`reservationLifecycle.unit.test.ts:134-147`): expected `InvalidStateError(currentState = CONFIRMED)` a pořadí `store.findById < lock < tx.findById`. Je odvozen z DR1 / kontraktu 1 („rozhoduje se nad stavem znovu načteným pod zámkem“), ne z kódu. Ověřeno mutací M2 (`decide()` předá zastaralé `located` místo `current`): **DD-T4 selže (1 failed / 39 passed)**, po vrácení vše projde. Souhlasí s tvrzením týmu (`evidence-and-evolution.md:429`). |

## Candidate findings

### F1

```text
Source:
C04 (Q1, Q3) — quality trade-off ADR-03 vs. měření 10× zátěže

Engineering claim:
ADR-03 přijímá negativní důsledek „požadavky na stejný stůl se serializují;
u velmi horkého stolu roste latence“ a rozhodnutí se má znovu otevřít, „když
měření po migraci na PostgreSQL ukáže čekání na zámek Resource jako úzké hrdlo
při 10× zátěži“. Měření 10× zátěže bylo provedeno.

Expected:
Podle C04 řetězec Quality Concern → Evaluable Criterion → Measurement → Decision:
pro latenci / „úzké hrdlo“ existuje rozhodnutelné kritérium a z naměřených hodnot
je zapsané rozhodnutí (ADR-03 ponechat / znovu otevřít).
(docs/architecture-and-decisions.md:500, :511; docs/intent-and-change.md:69-72)

Observed:
Kritérium existuje jen pro korektnost (1 vítěz, zbytek 409, 0 překryvů) a je splněno.
Pro latenci práh není („konkrétní limit latence zůstává provozní prací“,
docs/c03-technical-completion.md:43-44). p95 se jen zaznamenává; nikde není zapsáno,
zda ukazuje „úzké hrdlo“. V docs/evidence-and-evolution.md není sekce C04
a artefakt C04 není nikde označen.

Evidence:
docs/architecture-and-decisions.md:500, :511 (ADR-03 negative consequence + reconsider when)
docs/c03-technical-completion.md:26-45
scripts/postgres-load.ts:54-66 (aserce jen na počty a BR-02; p50/p95/max se jen ukládají)
docs/evidence/c03-postgres-verification.json → load.results
11. 10.: p95 při souběhu 50 — hot-confirm 113–164 ms, hot-mixed 108–124 ms, distributed 72–76 ms

Verification performed:
1) Prohledání docs: žádná sekce/odkaz „C04“, žádný práh latence.
2) Zopakované měření: `npm run verify:postgres` v čistém klonu a8f1052
   (PostgreSQL 16.14, READ COMMITTED, 26. 10. 2026 13:47 UTC) → passed; 18/18 dávek
   splnilo korektnostní kritérium; p95 při 50: hot 32–65 ms vs. distributed 16–17 ms (2–4×).
3) Porovnání s podmínkou znovuotevření ADR-03: nelze ji vyhodnotit, protože není
   definováno, kdy je čekání „úzké hrdlo“.

Result: VERIFIED FINDING
```

### F2

```text
Source:
C02 (R4, R5) — OP-01 Create Reservation, BR-01 + R-6

Engineering claim:
„An interval is [startsAt, endsAt) with parsable UTC timestamps“ (BR-01);
„Time is UTC server time … Boundaries must be reproducible“ (R-6).

Expected:
Stejný požadavek se uloží jako stejný okamžik bez ohledu na časovou zónu serveru;
vstup, který není UTC časem, je buď odmítnut (400), nebo jednoznačně vyložen jako UTC.
(docs/specification.md:31, :52-55)

Observed:
src/http/app.ts:34-35 (a :41-42 pro dostupnost) používá z.coerce.date(), tj. new Date(string).
Čas bez offsetu se vykládá v lokální zóně procesu a přijme se i holé číslo jako „1“.
Uložený interval — a tím i překryv BR-02 a lhůty BR-04/BR-06 — závisí na TZ serveru.
UI posílá toISOString() (public/app.js:548), takže se to týká přímých API klientů.

Evidence:
docs/specification.md:31 (R-6), :54 (BR-01)
src/http/app.ts:30-37, :39-44
tests/spec/op01-op02.test.ts — všechny vstupy končí „Z“, žádný test na čas bez offsetu

Verification performed:
Dočasný verifikační skript (mimo repo): skutečná route POST /reservations a Zod schéma
z a8f1052 se stubem persistence; vypsán okamžik, který by se uložil:
  TZ=UTC:            "2027-06-01T18:00:00" → 201, startsAt 2027-06-01T18:00:00.000Z
  TZ=Europe/Prague:  "2027-06-01T18:00:00" → 201, startsAt 2027-06-01T16:00:00.000Z
  oba:               "1" → 201 (rok 2000/2001); "...Z" a "+02:00" se převádějí správně
Stejný požadavek → jiný uložený interval podle TZ serveru (tým vyvíjí v Europe/Prague).

Result: VERIFIED FINDING
```

### F3

```text
Source:
C03 (A4) — ADR-03 „Konflikt má jednu chybovou cestu (OverlapError → 409)“

Engineering claim:
Při konfliktu BR-02 dostane volající vždy OverlapError; dvě různé chyby pro stejnou
příčinu (nález z Části A) jsou odstraněny.

Expected:
Poražený souběhu dostane OverlapError / InvalidStateError, ne ReservationConflictError.
(docs/architecture-and-decisions.md:488-489, C2 R1)

Observed (podezření):
ReservationConflictError („changed concurrently; reload and retry“) v kódu stále existuje
a mapuje se na 409 (src/repositories/reservationRepository.ts:6-10, :68; src/http/app.ts:279).

Evidence / Verification performed:
- Inspekce call path: každý tx.transition běží v decide() → inResourceTransaction pod
  zámkem Resource (reservationService.ts:86-128, 160-178). Jiné zápisy Reservation v src/
  nejsou (grep; L2 test 4/4). Guard se proto přes aplikaci nemůže uplatnit.
- Spuštěné testy na PostgreSQL: V-04R.1 a V-04R.7 vyžadují u poraženého OverlapError,
  V-04R.2/4 InvalidStateError — 138/138 passed.
- ADR-03 guard výslovně ponechává jako „druhou pojistku“ (architecture-and-decisions.md:488)
  a DD kontrakt 2 ho tak popisuje.

Result: REJECTED CANDIDATE — implementace odpovídá ADR-03.
```

## Owner disposition

*Vyplnili vlastníci projektu (Hospoda Devs), 29. 10. 2026 — návrh připravený s AI, potvrzení
týmu viz [Lidské review C07](evidence-and-evolution.md#lidské-review-c07). Podrobnosti a
closure evidence: [C06 Internal Evidence Assessment](evidence-and-evolution.md#c06-internal-evidence-assessment).*

| Finding | ACCEPTED / REJECTED / DEFERRED | Reason/evidence | Action / no-change |
|---|---|---|---|
| F1 | ACCEPTED — change required | Zopakováno: práh pro „úzké hrdlo“ v ADR-03 nikde není. | Kritérium p95 ≤ 500 ms (horký stůl, souběh 50, 2 ze 3 opakování) ve `scripts/postgres-load.ts` + ADR-03; měření 29. 10.: 145–239 ms → ADR-03 ponecháno (`docs/evidence/c07-postgres-verification.json`). Vlastník Jarda. |
| F2 | ACCEPTED — change required | Reprodukováno: `"2027-06-01T18:00:00"` → 18:00Z (UTC) vs. 16:00Z (Europe/Prague); `"1"` přijato. | `src/http/app.ts`: povinný offset, jinak 400; BR-01 zpřesněno; testy V-01.6, V-01.7, V-02.6; 142/142 (`docs/evidence/c07-postgres-tests.json`). Vlastník Michal. |
| F3 | — (REJECTED CANDIDATE, není třeba reagovat) | Souhlasíme se zdůvodněním hodnotitelů. | Žádná změna. |
