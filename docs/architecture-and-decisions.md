# Architecture & Decisions

## Tech stack

| Vrstva | Volba | Zdůvodnění |
|---|---|---|
| Jazyk | TypeScript (Node.js 20+) | Tým se rozhodl proti C#/Javě; TS dává statické typy a je pro tým nejznámější. |
| HTTP framework | Express | Nejrozšířenější, minimum boilerplate pro malé REST API. |
| Validace vstupu | Zod | Deklarativní validace + inference TS typů ze schémat. |
| ORM / DB přístup | Prisma | Typový bezpečný přístup k DB, snadné migrace, jeden zdroj pravdy (schema.prisma) pro model domény. |
| Databáze (cíl) | PostgreSQL | Zvoleno jako produkční cíl (podporovaný stack ze zadání), reálná relační DB s constraints. |
| Databáze (aktuální dev/spike) | SQLite | Viz ADR níže — v aktuálním vývojovém prostředí není dostupný Docker/PostgreSQL. |
| Testy | Vitest | Rychlé, nativní ESM/TS podpora, bez extra transpilační konfigurace. |

## ADR: SQLite pro C01 spike, PostgreSQL jako produkční cíl

**Kontext:** Zvolený tech stack (viz výše) počítá s PostgreSQL. Ve vývojovém prostředí, kde byl
prováděn C01 engineering spike, ale nebyl dostupný Docker ani lokální instalace PostgreSQL
(a nebylo možné je bez interakce nainstalovat).

**Rozhodnutí:** Spike A (persistence) byl proveden proti **SQLite** přes Prisma. `docker-compose.yml`
s PostgreSQL je připraven v repu pro každého, kdo má lokálně Docker.

**Důsledky:**
- Prisma schéma (`prisma/schema.prisma`) používá `datasource provider = "sqlite"`. Přechod na
  Postgres = změna `provider` na `"postgresql"`, nastavení `DATABASE_URL` na connection string
  z `docker-compose.yml` a spuštění `prisma migrate dev` znovu (Prisma migrace pro SQLite a
  Postgres nejsou binárně kompatibilní, musí se vygenerovat nové).
- Doménová pravidla se změnou providera nemění. Garance souběhu v repository je ale
  závislá na izolačním chování databáze; od dokončení C02 nestačí pouze přepnout provider.
- Tým by měl přechod na Postgres provést nejpozději před CP1 walking skeleton (C03/C04), protože
  SQLite nemá stejné chování při souběžném zápisu (relevantní pro future pressure Q níže).

## Future pressure: Q — Quality / Scale

Zvolená konkrétní pressure a zdůvodnění jsou zapsané v `docs/intent-and-change.md`
(sekce *Selected future pressure*) — shrnutí: 10× víc souběžných rezervací (páteční večer / velká
sportovní akce) zvyšuje riziko race condition v overlap-check při `confirm`. V C01 tuto pressure
**neimplementujeme**, jen ji evidujeme jako známé riziko pro pozdější iterace (kandidát na řešení:
DB transakce s `SELECT ... FOR UPDATE` / unique constraint na (resource, confirmed, no-overlap),
což u SQLite navíc není 1:1 přenositelné — další důvod pro včasný přechod na Postgres).

## ADR: atomické přechody v SQLite pro REQ-04 (22. 9. 2026)

**Problém:** samostatné čtení overlapu a následný bezpodmínečný zápis dovolovaly dvěma
Confirm/Approve alokovat stejný slot; staré čtení také mohlo přepsat Cancel/Reject.

**Rozhodnutí:** všechny rezervace mění stav přes `ReservationRepository.transition`.
Jeden podmíněný `updateMany` kontroluje ID a očekávaný stav; pro cílový CONFIRMED
navíc v témže UPDATE vyžaduje, aby neexistovala překrývající se CONFIRMED rezervace
stejného stolu. SQLite serializuje zápisy, takže následný zapisovatel vyhodnotí
predicate proti již zapsanému výsledku. Předchozí service overlap-check zůstává pro
konkrétní chybovou zprávu; bezpečnost nezávisí na jeho zastaralém výsledku.

Nulový počet změněných řádků je `ReservationConflictError` → HTTP 409. Dva Cancely
na výsledný CANCELLED vrátí stejný úspěch. Vrací se výsledek vlastního přechodu,
nikoli dodatečně načtený stav, který mezitím mohl změnit další příkaz.

**Ověření:** `tests/services/concurrency.test.ts` používá dva nezávislé Prisma
klienty a bariéru po čtení; oba požadavky prokazatelně pracují se starým stavem
před závodem. Pokrývá Confirm/Confirm, Approve/Approve, duplicate Approve,
Confirm/Cancel, Approve/Cancel, Approve/Reject, dvojí Cancel, dotyk intervalů a
smíšený Confirm/Approve. HTTP ověření je V-04R.8. Aktuální výstup je v
[evidenci dokončení](c02-completion-evidence.md).

**Rozsah garance:** aplikační příkazy na současném SQLite schématu. Přímé administrátorské
zápisy do DB ji mohou obejít. Pro PostgreSQL pod READ COMMITTED nelze ze stejného
dotazu odvodit stejnou garanci; před migrací zavést a ověřit např. serializaci podle
Resource či exclusion constraint pro intervaly, plus ochranu přechodů stavu.
Jednoduchý UNIQUE na identických začátcích/koncích libovolný překryv intervalů neřeší.

**C03 driver:** zachovat REQ-04 při změně DB a 10× zatížení; druhý driver je fyzická
expirace bez dalšího Approve a případná notifikace. Tyto mechanismy nejsou součástí
této změny. Nezavádí se globální mutex omezený na jeden proces.

## C03 Part A — AS-IS: Confirm Reservation

Mapování současné realizace jednoho scénáře z baseline v0.2. Tvrzení jsou ověřená
v kódu (commit `b4f597c`, branch `c03`), testy a za běhu aplikace dne 5. 10. 2026.
Řádky kódu odkazují na tento stav.

### A1. Sledovaný scénář

| Položka | Hodnota |
|---|---|
| Scénář / operace | [OP-03 Confirm Reservation](specification.md#op-03--confirm-reservation-req-03-req-04) |
| Požadavky | REQ-03, REQ-04 |
| Pravidla / invarianty | BR-01, BR-02, BR-04, BR-05 |
| Baseline | v0.2 |

### A2. Hlavní průchod scénáře v kódu

Hlavní úspěšný průchod: existující DRAFT, před termínem BR-04, Resource bez schvalování
(`requiresApproval = false`), žádná překrývající se CONFIRMED rezervace → `DRAFT → CONFIRMED`, HTTP 200.

| Krok scénáře z C02 | Realizace v kódu | Doklad |
|---|---|---|
| přijmout požadavek na potvrzení | route `POST /reservations/:id/confirm` v `createApp()` volá `ReservationService.confirmReservation(id)` | `src/http/app.ts:156-165` |
| načíst Reservation (locate DRAFT) | `ReservationService.confirmReservation()` → `ReservationRepository.findById(id)`; neexistuje → `NotFoundError` | `src/services/reservationService.ts:64-65`, `src/repositories/reservationRepository.ts:38` |
| ověřit, že přechod je povolený | `confirmReservation()` vyžaduje stav `DRAFT`, jinak `InvalidStateError` | `src/services/reservationService.ts:69-71`; runtime: druhý Confirm téže rezervace → 409 `Reservation is in state CONFIRMED, expected DRAFT` |
| ověřit BR-04 (no-show cutoff) | `isExpiredDraft(reservation, now)` (hranice `startsAt − 30 min`) | `src/services/reservationService.ts:73`, `src/domain/rules.ts:35`; test `V-03.3` v `tests/spec/c02-completion.test.ts` |
| vyhodnotit BR-05 (approval routing) | `ReservationRepository.findResourceById()`; při `requiresApproval = false` pokračuje přímým Confirm | `src/services/reservationService.ts:82-85`; test `confirms directly to CONFIRMED when the resource does not require approval` v `tests/services/reservationService.test.ts` |
| vyhodnotit konflikt (BR-02) | `ReservationRepository.findForResource()` + `findOverlappingConfirmed()` (vlastní rezervace vyřazena); konflikt → `OverlapError` | `src/services/reservationService.ts:87-92`, `src/domain/rules.ts:24` |
| změnit stav a uložit výsledek | `ReservationRepository.transition(reservation, CONFIRMED)` — **jeden** podmíněný `updateMany`: shoda ID + původního stavu a v témže dotazu podmínka, že neexistuje překrývající se CONFIRMED stejného Resource | `src/services/reservationService.ts:94`, `src/repositories/reservationRepository.ts:48-75` |
| vrátit výsledek volajícímu | route vrátí 200 a tělo rezervace se stavem `CONFIRMED` (202 jen pro `PENDING_APPROVAL`) | `src/http/app.ts:160-163`; test `confirms a DRAFT reservation with no conflict` v `tests/http/app.test.ts`; runtime: `POST /reservations/{id}/confirm` → `"state":"CONFIRMED"` [HTTP 200] |

Poznámky k mapování:

- Změna stavu a uložení nejsou dva kroky: rozhodnutí služby se uplatní až podmíněným
  zápisem v repository. Když podmínka neplatí (souběžná změna nebo mezitím potvrzený
  překryv), `transition()` nezmění žádný řádek a vyhodí `ReservationConflictError`
  (`src/repositories/reservationRepository.ts:66-72`).
- Pořadí kontrol v kódu (stav → BR-04 → BR-05 → BR-02) odpovídá *Main scenario*
  OP-03 („locate DRAFT; check BR-04; inspect BR-05; … check BR-02 and persist CONFIRMED“).
- Chyby z kroků výše převádí na HTTP jediné místo, `errorMiddleware()` (`src/http/app.ts:282`).

Testy ověřující průchod, spuštěné 5. 10. 2026: `npx vitest run tests/http/app.test.ts
tests/services/reservationService.test.ts tests/services/concurrency.test.ts
tests/spec/c02-completion.test.ts tests/domain/rules.test.ts` → 5 souborů, 59/59 testů prošlo.

### A3. Alternativní / chybová větev

*Vlastník: Honza — viz [`tasks-cv3.md`](tasks-cv3.md) H1.*

### A4. Hlavní části implementace

Aplikace je malá, proto jsou bloky na úrovni konkrétních tříd/modulů (jeden soubor = jeden blok).

| Část implementace | Typ / obsah | Role v tomto scénáři | Doklad |
|---|---|---|---|
| Reservation API | modul `src/http/app.ts`: route `POST /reservations/:id/confirm`, `errorMiddleware()` | přijme příkaz Confirm, zvolí 200/202, převede doménové a DB chyby na 404/409/410 | `src/http/app.ts:156-165`, `:282-305` |
| Reservation logic | třída `ReservationService` (`confirmReservation()`) | řídí scénář: načte rezervaci, ověří stav, BR-04, BR-05 a BR-02, požádá o přechod | `src/services/reservationService.ts:63-95` |
| Domain rules | modul `src/domain/rules.ts`: `isExpiredDraft()`, `findOverlappingConfirmed()`, `rangesOverlap()` | čisté funkce vyhodnocující BR-04 a BR-02/BR-01 nad načtenými daty | `src/domain/rules.ts:19-43` |
| Reservation persistence | třída `ReservationRepository` (+ `ReservationConflictError`), používá Prisma Client | načte Reservation a Resource, provede atomický podmíněný přechod stavu, při neúspěchu hlásí konflikt | `src/repositories/reservationRepository.ts:38-80` |

Sestavení: `src/index.ts` vytvoří `PrismaClient` a předá ho `createApp()`, která vytvoří
`ReservationRepository(prisma)` a `ReservationService(repository)` (`src/http/app.ts:84-86`).

### A5. Stav, změna stavu a pravidlo

*Vlastník: Honza — viz [`tasks-cv3.md`](tasks-cv3.md) H2.*

### A6. Relevantní závislosti

*Vlastník: Honza — viz [`tasks-cv3.md`](tasks-cv3.md) H3.*

### A7. AS-IS strukturální diagram

```text
+----------------------------- Application code ------------------------------+
|                                                                             |
|  [Reservation API]  (module, src/http/app.ts)                               |
|  role: accepts POST /reservations/:id/confirm, maps errors to HTTP          |
|        |                                                                    |
|        | confirmReservation(id)                                             |
|        v                                                                    |
|  [Reservation logic]  (class ReservationService)                            |
|  role: orchestrates Confirm: state, BR-04, BR-05, BR-02, requests change    |
|        |                                  |                                 |
|        | isExpiredDraft(),                | findById, findResourceById,     |
|        | findOverlappingConfirmed()       | findForResource,                |
|        v                                  | transition(CONFIRMED)           |
|  [Domain rules]  (module rules.ts)        v                                 |
|  role: evaluates BR-04, BR-02/BR-01   [Reservation persistence]             |
|                                       (class ReservationRepository)         |
|                                       role: loads Reservation/Resource,     |
|                                       atomic conditional state update       |
|                                                  |                          |
+--------------------------------------------------|--------------------------+
                                                   | read Reservation/Resource,
                                                   | conditional UPDATE state
                                                   | (Prisma Client)
                                                   v
                                     [Reservation DB]  (database, SQLite)
                                     tables Reservation, Resource
```

Šipky odpovídají směru volání (a importů): API → logic → rules / persistence → DB.
Domain rules nevolají nic dalšího. V tomto scénáři se nevolá žádný externí systém
(notifikace, IdP); kód žádného HTTP klienta ani autentizaci neobsahuje — podrobnosti v A6.

Obsah bloků:

- **Reservation API:** `createApp()` — route `POST /reservations/:id/confirm`, `errorMiddleware()`
- **Reservation logic:** `ReservationService.confirmReservation()`; výjimky `NotFoundError`,
  `InvalidStateError`, `NoShowExpiredError`, `OverlapError`
- **Domain rules:** `isExpiredDraft()`, `findOverlappingConfirmed()`, `rangesOverlap()`
- **Reservation persistence:** `ReservationRepository.findById()`, `findResourceById()`,
  `findForResource()`, `transition()`; `ReservationConflictError`
- **Reservation DB:** SQLite (`prisma/schema.prisma`, `datasource db { provider = "sqlite" }`),
  modely `Reservation` (sloupec `state`) a `Resource` (sloupec `requiresApproval`)

### A8. Otázka pro další C03

*Vlastník: Honza — viz [`tasks-cv3.md`](tasks-cv3.md) H4.*
