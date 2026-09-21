# C01 Engineering Spike

**Question / unknown:** Dokážeme reálně persistovat `Reservation` do skutečné databáze a znovu ji
načíst se stejnými daty (ne jen s in-memory mockem repository)?

**What we did:**
- Nastaven Prisma + SQLite (`prisma/schema.prisma`, modely `User`, `Resource`, `Reservation`),
  spuštěna migrace `npx prisma migrate dev` proti reálnému souboru `prisma/dev.db`.
- Napsán `tests/spike/persistence.spike.test.ts`: vytvoří `User` + `Resource` + `Reservation`
  přes Prisma Client, poté **novým, nezávislým dotazem** (`findUniqueOrThrow`) načte rezervaci
  zpět z databáze a ověří shodu všech polí (`id`, `state`, `resourceId`, `userId`, `startsAt`,
  `endsAt`).
- Spuštěno `npm test` (Vitest) — spike test + 7 doplňkových unit testů doménových pravidel
  (overlap, no-show).
- Navíc ručně ověřeno end-to-end přes běžící HTTP server (`npx tsx src/index.ts`) a `curl`:
  `POST /reservations` → `DRAFT` → `POST /reservations/:id/confirm` → `CONFIRMED` → druhá
  překrývající se rezervace na stejný stůl správně odmítnuta s `409` → `GET
  /resources/:id/availability` správně vrátil `available: false`.

**Observed result:**
```
✓ tests/domain/rules.test.ts (7 tests) 4ms
✓ tests/spike/persistence.spike.test.ts (1 test) 45ms

Test Files  2 passed (2)
     Tests  8 passed (8)
```
Ruční curl průchod potvrdil identické chování end-to-end (create → confirm → overlap rejection →
availability check), včetně korektního odmítnutí no-show rezervace, u které mezitím uplynula
grace perioda.

**Decision / what changes because of the result:**
Persistence vrstva (Prisma + repository/service pattern) funguje a stává se základem pro CP1
walking skeleton — repository a service kód napsaný pro spike se beze změny použije i tam.
Zároveň platí rozhodnutí zapsané v `docs/architecture-and-decisions.md` (ADR): pro C01 zůstáváme
u SQLite kvůli nedostupnosti Dockeru/PostgreSQL ve vývojovém prostředí, přechod na PostgreSQL je
naplánovaný nejpozději před C03/C04 a je zdokumentovaný jako mechanický krok (změna providera +
nová migrace), ne jako otevřená otázka.

---

# C01 change + review loop

Povinný výstup bodu 6 zadání: jedna konkrétní změna, kterou před integrací viděl druhý člen týmu.

| | |
|---|---|
| **Task / issue** | C01 engineering spike — persistence (`Reservation` → skutečná DB → načtení → ověření) |
| **Branch** | `c01-spike-persistence` |
| **Obsah změny** | Prisma schéma + migrace, repository/service vrstva, doménová pravidla (overlap, no-show), HTTP endpointy, spike test `tests/spike/persistence.spike.test.ts`, doplnění `docs/` |
| **Autor změny** | Jaroslav Petera (commity `a99601a`, `3929548`) |
| **Reviewer před integrací** | Michal Křižák — review na GitHubu v rámci PR #5 |
| **Integrace** | Pull request #5 `c01-spike-persistence → main`, merge commit `c9b84d1` |

Změna tedy nešla do `main` přímo, ale přes PR, který před mergem prošel review druhého člena týmu.

---

# Ověření reprodukovatelnosti (21. 9. 2026)

Spike byl znovu spuštěn z čistého checkoutu (bez `node_modules`, bez `prisma/dev.db`) pouze podle
kroků v README:

```
npm install
cp .env.example .env
npx prisma migrate dev
npm test

✓ tests/domain/rules.test.ts (7 tests)
✓ tests/spike/persistence.spike.test.ts (1 test)
Test Files  2 passed (2)
     Tests  8 passed (8)
```

Žádný nezdokumentovaný krok nebyl potřeba — README je tedy ověřené, ne jen napsané.

---

# Hardening po spike (21. 9. 2026)

Po dokončení spike jsme běžící server ručně proklepli hraničními vstupy (ne jen happy path).
Našli jsme tři chyby, které by blokovaly CP1 walking skeleton, a opravili je:

| # | Problém | Pozorované chování před opravou | Oprava |
|---|---|---|---|
| 1 | Async chyby v Express 4 | `POST /reservations` s neexistujícím `resourceId` → Prisma `P2003` → unhandled rejection → **spadl celý proces**, server dál neodpovídal | `asyncRoute()` obal nad všemi handlery + jeden `errorMiddleware`, který mapuje doménové i Prisma chyby na HTTP kódy (`P2003` → 400) |
| 2 | Chybějící guard na stav | `create → cancel → confirm` vrátilo `CONFIRMED`, tj. zrušenou rezervaci šlo znovu potvrdit (a obejít tím no-show pravidlo) | `confirmReservation` vyžaduje výchozí stav `DRAFT`, jinak `InvalidStateError` → HTTP 409 |
| 3 | Nevalidovaný vstup u availability | `GET /resources/:id/availability` bez parametrů i s `?start=blabla` vrátilo `{"available":true}` — systém hlásil „volno“, i když neměl data | Zod schéma `availabilityQuerySchema` (parsovatelná data, `end > start`), jinak HTTP 400 |

**Ověření po opravě** (stejné požadavky proti běžícímu serveru):

```
1) confirm po cancelu : 409 {"error":"Reservation is in state CANCELLED, expected DRAFT"}
2) availability        : 400 (bez parametrů) / 400 (start=blabla&end=nic)
3) neexistující FK     : 400 {"error":"Unknown resourceId or userId"}
   server po chybě     : 200 (proces běží dál)
```

Všechny tři případy jsou navíc pokryté regresními testy v `tests/http/app.test.ts`, takže se
nemohou vrátit nepozorovaně:

```
✓ tests/domain/rules.test.ts (7 tests)
✓ tests/spike/persistence.spike.test.ts (1 test)
✓ tests/http/app.test.ts (6 tests)

Test Files  3 passed (3)
     Tests  14 passed (14)
```

**Decision:** validace vstupu a překlad chyb na HTTP kódy patří do walking skeletonu už od CP1 —
krok `validate` v `POST /reservations` nestačí řešit jen Zod schématem, protože část chyb
(neexistující stůl/host) se pozná až na úrovni DB.

---

## Evidence C02: specifikace → běžící aplikace (Osoba B)

> Tato sekce pokrývá jen díl Osoby B (`c02-person-b` branch) dle rozdělení v `docs/c02-plan.md`.
> Díl Osoby A (Create, Availability, use case diagram, review) je mimo rozsah této branch a bude
> doplněn odděleně.

**Přijatá baseline:** Specification Baseline v0.1 (`docs/specification.md`) — status **draft**,
napsáno Osobou B (R-1–R-10 přejaty z doporučení `docs/c02-plan.md`, OP-03/OP-04/BR-03/BR-04
kompletně specifikovány). Formální `approved by the team` hlavička čeká na review od Osoby A a
společný Sync 1/Sync 2 — viz "Zbývající předpoklad / neznámá" níže.

**Předvedené základní operace:** OP-03 Confirm, OP-04 Cancel, OP-05 Approve/Reject (v0.2). Všechny
běží proti reálnému HTTP serveru (`npx tsx src/index.ts`) nad SQLite (stejný stack jako C01 spike).

**Skutečně provedené příklady ověření:**

Automatizované (viz `npm test`, 40/40 zelených — `tests/domain/rules.test.ts`,
`tests/services/reservationService.test.ts`, `tests/http/app.test.ts`, plus C01's
`tests/spike/persistence.spike.test.ts`):

```
✓ tests/domain/rules.test.ts        (14 tests)
✓ tests/spike/persistence.spike.test.ts (1 test)
✓ tests/services/reservationService.test.ts (12 tests)
✓ tests/http/app.test.ts            (13 tests)

Test Files  4 passed (4)
     Tests  40 passed (40)
```

Ruční HTTP průchod (`curl` proti běžícímu serveru, 21. 9. 2026) — přesně 1 úspěšný + 1
negativní/hraniční příklad na operaci, dle tabulky ve fázi 4 zadání:

*OP-03 Confirm — úspěch:*
```
POST /reservations {startsAt: 2027-06-01T18:00, endsAt: 2027-06-01T19:00} → 201 DRAFT
POST /reservations/:id/confirm → 200 {"state":"CONFIRMED", ...}
```

*OP-03 Confirm — kolize (negativní):*
```
POST /reservations {startsAt: 2027-06-01T18:30, endsAt: 2027-06-01T19:30}  (překrývá výše)
POST /reservations/:id/confirm → 409
  {"error":"Reservation overlaps with confirmed reservation <id>"}
```

*OP-04 Cancel — úspěch (před startem, uvolní slot):*
```
POST /reservations/:id/cancel → 200 {"state":"CANCELLED", ...}
GET /resources/:id/availability?start=2027-06-01T18:00&end=2027-06-01T19:00
  → {"available": true}
```

*OP-04 Cancel — po startu (negativní, R-4):*
```
POST /reservations {startsAt: 2020-01-01T18:00, endsAt: 2020-01-01T19:00}  (už v minulosti)
POST /reservations/:id/cancel → 409
  {"error":"Reservation <id> can no longer be cancelled: it has already started"}
```

*OP-05 Approve — úspěch:*
```
Resource requiresApproval=true
POST /reservations {...} → 201 DRAFT
POST /reservations/:id/confirm → 202 {"state":"PENDING_APPROVAL"}
POST /reservations/:id/approve → 200 {"state":"CONFIRMED"}
```

*OP-05 Reject:*
```
POST /reservations/:id/confirm → 202 {"state":"PENDING_APPROVAL"}
POST /reservations/:id/reject → 200 {"state":"REJECTED"}
POST /reservations/:id/approve (po reject) → 409
  {"error":"Reservation is in state REJECTED, expected PENDING_APPROVAL"}
```

Vypršení schválení (EXPIRED) a re-kontrola overlapu při approve (souběh — "svět se mezitím
změnil") nejsou proveditelné jako ruční curl scénář bez čekání desítky minut reálného času —
ověřeny automatizovaně na service vrstvě s injektovaným `now` (R-6), viz
`tests/services/reservationService.test.ts` (`isApprovalExpired`, "re-checks BR-02 overlap at
approve time").

**Nalezený nesoulad a způsob vyřešení:**
- Před touto branch **Cancel nehlídal čas začátku** — dalo se zrušit i po startu rezervace, což je
  přesně nesoulad, který `docs/c02-plan.md` (fáze 4 tabulka) predikoval. Oprava: `isCancellable` +
  `isPastCancellationWindow` v `src/domain/rules.ts`, použito v `cancelReservation`. Pokryto testy.
- Před touto branch nebyla ověřena/otestována **idempotence Cancelu** (R-5) — druhé zavolání
  cancelu na už zrušenou rezervaci fungovalo náhodou (Prisma `update` na stejný stav neselže), ale
  nebylo to explicitní rozhodnutí ani otestované chování. Nyní explicitně v `cancelReservation`
  (krátkocestná návratová hodnota před kontrolou zrušitelnosti) + testováno.
- Specifikace (OP-04) původně nerozlišovala mezi "už CANCELLED" (idempotentní úspěch) a "v jiném
  terminálním stavu" (REJECTED/EXPIRED, chyba) — obě situace vypadají navenek podobně ("nejde
  znovu zrušit"), ale mají odlišit se muset kvůli BR-03's zdůvodnění (kdo/co rezervaci ukončil).
  Rozhodnuto v BR-03 a promítnuto zpět do `isCancellable`/`NotCancellableError`.

**Shrnutí dopadu změny:** viz `docs/specification.md` sekce *Dopad změny C02* — B's řádky
(Confirm, Approve, Cancel, Stavový diagram, Architektura) kompletní; A's řádky (Create,
Availability, Use case diagram, Ověření dostupnosti) čekají na Osobu A.

**Zbývající předpoklad / neznámá:**
- Kdo přesně je "authorized Approver" (role/oprávnění) je TBD — stejná kategorie jako R-7 pro
  Usera; C02 to neřeší, jen to explicitně pojmenovává jako neznámou, ne jako vymyšlené číslo.
  (`docs/specification.md`, OP-05 → Předpoklad/TBD)
- Zda PENDING_APPROVAL blokuje Availability, je rozhodnutí Osoby A (fáze 5 tabulka, řádek
  Availability) — dokud není hotové, `checkAvailability` je v této branch **beze změny** (počítá
  jen CONFIRMED, jako v C01).
- Baseline v0.1/v0.2 v `docs/specification.md` nejsou formálně "approved by the team" — chybí
  review Osoby A a společné Sync body (K-1/K-2/K-4/K-7, use case diagram proti B's textu).

**Architektonické drivery přenesené do C03:**
1. **REQ-04 concurrency** — souběžné Confirm/Approve pro kolidující rezervace stejného Resource
   nemá žádnou locking/transakční garanci; overlap check je "read-then-write" bez ochrany proti
   race condition. Toto je totožný driver jako future pressure Q z C01 — C02 ho jen rozšiřuje i na
   Approve (re-check při approve řeší jen "co se stalo *mezi* žádostí a rozhodnutím", ne souběžné
   rozhodování ve stejném okamžiku).
2. **Vypršení schválení (EXPIRED) se detekuje líně**, ne časovačem/notifikací — reservace zůstane
   "nesprávně" PENDING_APPROVAL v databázi, dokud se jí něco nedotkne (další approve pokus, nebo
   budoucí read). Pro C03: buď scheduled job, který stavy aktivně sklápí, nebo explicitní
   dokumentace, že "EXPIRED" je logický, ne fyzický stav dokud se nezobrazí.

**Commit / tag aplikace:** branch `c02-person-b`, tag `v0.2` (na finálním commitu této branch).
Poznámka k procesu: tato branch byla dokončena v jednom souvislém běhu, ne ve dvou oddělených
fázích podle harmonogramu z `docs/c02-plan.md` (sekce 12) — v0.1 (cancellation window + idempotent
cancel) a v0.2 (approval workflow) jsou proto zdokumentované jako dvě jasně oddělené sekce v
`docs/specification.md` a `docs/diagrams/`, ale v gitu existuje jen finální `v0.2` tag, ne
samostatný `v0.1` tag na dřívějším commitu.
