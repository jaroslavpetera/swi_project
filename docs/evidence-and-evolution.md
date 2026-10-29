# C01 Engineering Spike

> Historická evidence C01 a oddělené větve C02 z 21. 9. 2026. Aktuální integrovaný
> stav, 89 testů, výsledky UI a vazby REQ → test → snapshot jsou v
> [Evidence C02 — dokončení](c02-completion-evidence.md). Níže uvedené počty testů,
> otevřené otázky a názvy větví popisují tehdejší běhy, nikoli aktuální stav.

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

> Tato sekce pokrývá jen díl Osoby B (`c02-person-b` branch) dle rozdělení v [původním plánu](archive/c02/plan.md).
> Díl Osoby A (Create, Availability, use case diagram, review) je mimo rozsah této branch a bude
> doplněn odděleně.

**Přijatá baseline:** Specification Baseline v0.1 (`docs/specification.md`) — status **draft**,
napsáno Osobou B (R-1–R-10 přejaty z doporučení [původního plánu](archive/c02/plan.md), OP-03/OP-04/BR-03/BR-04
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
  přesně nesoulad, který [původní plán](archive/c02/plan.md) (fáze 4 tabulka) predikoval. Oprava: `isCancellable` +
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
fázích podle harmonogramu z [původního plánu](archive/c02/plan.md) (sekce 12) — v0.1 (cancellation window + idempotent
cancel) a v0.2 (approval workflow) jsou proto zdokumentované jako dvě jasně oddělené sekce v
`docs/specification.md` a `docs/diagrams/`, ale v gitu existuje jen finální `v0.2` tag, ne
samostatný `v0.1` tag na dřívějším commitu.

---

## C03 — Architecture Evidence

Všechny body odkazují do [`architecture-and-decisions.md`](architecture-and-decisions.md);
obsah se zde nekopíruje. Branch `c03`.

**Baseline:** v0.2 (`specification.md`), scénář OP-03 Confirm Reservation s větví BR-05 → OP-05 Approve.

**Part A:** [C03 Part A — AS-IS](architecture-and-decisions.md#c03-part-a--as-is-confirm-reservation)
(A1–A8, stav kódu `b4f597c`). Klíčový nález: BR-02 rozhodovaly dvě místa (služba nad zastaralým
čtením + podmínka v `UPDATE`) se dvěma různými chybami; garance stála na serializaci zápisů v SQLite.

**Drivers:** D1 exkluzivní alokace při souběhu, D2 přechod na PostgreSQL a 10× zátěž, D3 pozdní
approval, D4 jeden vlastník lifecycle přechodů — sekce *B*. Notifikace vědomě vynechány (R-15).

**Decision question:** Kde má být provedeno autoritativní rozhodnutí o alokaci (BR-02), aby platilo
při souběhu i po přechodu na PostgreSQL a při 10× zátěži? — sekce *D*.

**Alternatives:** A — invariant v DB (PostgreSQL exclusion constraint); B — invariant v aplikačním
Reservation Lifecycle, serializace podle Resource — sekce *E1*, porovnání *E2*.

**Scenario walkthrough:** souběžný Confirm dvou překrývajících se rezervací + approval větev
a pozdní Approve, obě alternativy — sekce *E3*.

**ADR:** ADR-03 — zvolena B — sekce *F*.

**Views:**
- domain class — *C1* (Mermaid classDiagram)
- context — *G1*
- static architecture — *G2* (5 prvků, povolené závislosti)
- state ownership — *G3* (7 přechodů, owner vždy Reservation Lifecycle)
- runtime/deployment — *G4* (jeden proces, jedna DB)
- design sequence — *H1* (Confirm pod zámkem Resource, alt BR-02)
- focused design class — *H2* (`ReservationService`, `ReservationStore`, `ReservationTx`, …)

**Cross-view issues found/resolved:** mezi pohledy B–H rozpor nenalezen (*I*). Rozdíly mezi
návrhem a AS-IS kódem převedeny do delty (*J*). Závěrečná kontrola proti zadání našla dva další
rozdíly a opravila je: H2 neodpovídal kódu (`AvailabilityService` čte z adaptéru, ne z portu;
chybělo `create`) → H2 opraven; route dostupnosti četla Resource přímo z Prismy → přesunuto do
Availability (J, K).

**AS-IS → TO-BE delta:** *J* — 7× CHANGE (všechny provedeny), 4× KEEP, 2× VERIFY (obě ověřeny: L1, L2).

**Implementation changes:** commit `c2c9a7d` — `inResourceTransaction` + `ReservationTx`
v persistence, všechny přechody v Lifecycle pod zámkem Resource, BR-02 jen v `allocate()`,
`AvailabilityService`; úpravy testů souběhu zdůvodněny v *K*. Následně kontrola existence Resource
v OP-02 přesunuta do Availability.

**Behaviour verification:** *L1* — 89/89 na nové izolované SQLite DB (3×), po L2 93/93; runtime
smoke test po změně (Confirm 200, překryv 409, dostupnost, 404, approval 202→200); success, overlap,
BR-04, approval, `V-04R.1`–`8`. Mechanismus ADR-03 ověřen ručně na PostgreSQL 18.4 (READ COMMITTED):
se zámkem 89/89, bez zámku 8 z 9 testů souběhu selže (dvě překrývající se CONFIRMED).

**Architecture conformance rule + result:** *L2* — „stav Reservation mění jen Reservation Lifecycle
přes `tx.transition()` uvnitř `inResourceTransaction`“; `tests/architecture/lifecycle-ownership.test.ts`
4/4, celá sada 93/93; 4 úmyslná porušení zachycena.

**Remaining uncertainty / risk:**
- Od 11. 10. je PostgreSQL 16 výchozí provider a ověření je opakovatelné.
  SQLite zůstává regresním profilem; v něm nelze zámek odlišit od serializace celé DB.
- 10× HTTP zátěž je změřena v lokálním běhu 5 → 50 požadavků. Produkční SLA,
  objem reálných dat ani distribuované síťové prostředí tímto během nejsou prokázané.
- D3: vypršení PENDING_APPROVAL zůstává při Approve podle R-16 a ADR-04;
  případný worker vyžaduje změnu přijímaného chování.
- Mimo slice čte Reservation API DB přímo (administrace uživatelů/stolů/menu, výpis rezervací
  stolu); stav Reservation nemění. Pravidlo L2 hlídá jen zápisy.
- Chybějící lokální migrace jsou doplněny, konfigurace převedena na PostgreSQL.
  Regresní testy dále používají izolované DB a nezasahují do vývojových dat.
- Texty C03 i Části A připravila AI; **lidské review A9/HC3 dokončil Jan Kovařčík
  11. 10. 2026** ([záznam](architecture-and-decisions.md#review-a9--hc3--technická-kontrola)).
  Týmové schválení baseline a samostatné procesní body C02 zůstávají otevřené.

**Commit/tag:** implementace `c2c9a7d` + `f6fb771` (kontrola existence Resource v Availability); L2 test `83c7319`;
oprava tabulky J `013795c`. Branch `c03` sloučena do `main` přes PR #15, merge commit **`a04be34`**
= tag **`c03-architecture`**.

**Technické dokončení 11. 10. 2026:** větev `c03-technical-completion`, výchozí
historický commit `b315e87`. Nové změny nejsou součástí původního tagu.
Aktuální ověření, SHA-256 ověřených souborů, přenos dat a zátěž jsou v
[technické evidenci](c03-technical-completion.md). Technické běhy samy nejsou lidským
schválením; následné lidské review Honzy je doloženo výše samostatně.

## C05 DD Verification Evidence

Ověřuje návrh v [C05 Detailed Design](architecture-and-decisions.md#c05-detailed-design)
(jednotka Reservation Lifecycle, Confirm / Approve). Rozdělení práce: [M1–M3](tasks-cv5.md#michal--kroky-5-a-6-verifikace).

> **Stav 12. 10. 2026 (Michal, připraveno s AI → čeká na lidské review, A9):**
> - Testy jsou odvozené z kroků 1–3 DD: DR1–DR7, kontrakty 1–4 a *Rozdíly proti kódu na `main`*.
> - Krok 4 (Honza) je doplněný. Jeho rozhodovací tabulky H2 jsou porovnané s testy
  [níže](#pokrytí-rozhodovacích-tabulek-h2-testy). Všech 9 řádků je pokrytých, chybějící test pro A-F4 byl doplněn (DD-T3c).
> - Testy ověřují návrhový záměr. Nejdřív se psaly proti kódu `7ba6a05` před N1/N2: tam DD-T7 selhal
>   (`it.fails`) a DD-T8/T9 čekaly (`todo`).
> - Po Jardově implementaci (`f24326a`) testy přešly na `Clock` a DD-T7–T9 jsou plnohodnotné testy.
>
> **Aktualizace 26. 10. 2026:** sloučeno do `main` (PR #20, `055917c`). Aktuální stav uzavření a
> lidského review je v [Uzavření C05](#uzavření-c05-s3).

### Tests derived from DD

| ID | DD element / decision | What must hold? | Test level | Test case |
|---|---|---|---|---|
| DD-T1 | **algorithm branch:** DR5, `decideConfirm → RouteToApproval` | DRAFT na Resource s `requiresApproval` → PENDING_APPROVAL. BR-02 se **nevyhodnocuje** (nečte se `findConfirmedForResource`), ani když existuje překrývající se CONFIRMED. Bez schválení → `Allocate` → CONFIRMED. | unit (fake store) | `reservationLifecycle.unit.test.ts` › DD-T1, DD-T1b |
| DD-T2 | **state transition:** DR4, `Close(CANCELLED / EXPIRED)` — „zapiš a pak oznam“ | V okamžiku lhůty BR-04 se uloží CANCELLED **a** vyhodí se `NoShowExpiredError`. Transakce commitne, nesmí udělat rollback. Totéž pro BR-06: EXPIRED + `ApprovalExpiredError`. 1 ms před lhůtou se tato větev nevezme. | unit (fake store) | DD-T2, DD-T2b, DD-T2c |
| DD-T3 | **failure behavior:** DR6/DR7, `decideAllocation → Conflict` | Překryv s CONFIRMED → `OverlapError` s id konfliktní rezervace. Nic se nezapíše, stav zůstane DRAFT / PENDING_APPROVAL a transakce udělá rollback. Approve vyhodnocuje BR-02 znovu v okamžiku rozhodnutí. | unit (fake store) | DD-T3, DD-T3b |
| DD-T4 | **collaboration:** DR1, kontrakt 1 („čtení pod zámkem“) | Rozhoduje se nad stavem z `tx.findById` po zámku, ne nad prvním čtením mimo transakci. Pořadí volání je `store.findById → lock → tx.findById`. Změna commitnutá během čekání na zámek vede na `InvalidStateError` nebo `OverlapError`. | unit (fake store) | DD-T4, DD-T4b |
| DD-T5 | **algorithm:** DR6, rozsah alokace (BR-01) | Neblokují: dotýkající se CONFIRMED interval (polouzavřený), překrývající se DRAFT / PENDING / CANCELLED / REJECTED / EXPIRED ani CONFIRMED jiného Resource. | unit (fake store) | DD-T5 |
| DD-T6 | **state transition:** DR3, `InvalidState(expected)` | Confirm jen z DRAFT, Approve jen z PENDING_APPROVAL. Z ostatních stavů skončí `InvalidStateError` se správným `expectedState` a stav se nezmění (nelze např. oživit CANCELLED). | unit (fake store) | DD-T6 (5 stavů), DD-T6b (5 stavů) |
| DD-T7 | **interface contract:** kontrakt 3, precondition „Resource existuje“ | Chybějící Resource uvnitř transakce = porušený invariant → `MissingResourceError`. Nic se nezapíše, rollback. | unit (fake store) | DD-T7 |
| DD-T8 | **interface contract:** kontrakt 4 `Clock` (N2), DR2 | `now()` se čte **jednou** na příkaz, uvnitř transakce, po zámku. Lhůta překročená během čekání na zámek se počítá: požadavek přijde před cutoff, zámek získá po něm → CANCELLED + `NoShowExpiredError`. | unit (fake store + test clock) | DD-T8, DD-T8b |
| DD-T9 | **algorithm / decision table:** kontrakt 3 `LifecyclePolicy` (N1) | Celá tabulka `decideConfirm` (7 kombinací) a `decideApprove` (5) i pořadí *stav → lhůta → routing*: po cutoff se neposílá ke schválení, CONFIRMED po cutoff se nezavírá. `decideAllocation` vrací `Conflict(id)` / `Free`, kandidát není svým konfliktem. Policy je čistá: zmrazené vstupy, žádná výjimka, deterministická. | unit (čistá funkce, bez úložiště) | `tests/domain/lifecyclePolicy.test.ts` › DD-T9 (16 případů) |
| DD-T10 | **interface contract:** kontrakt 2 `ReservationTx.transition` / `findConfirmedForResource` | Ze zastaralého stavu → `ReservationConflictError` a novější stav se nepřepíše. Z aktuálního stavu se nový stav uloží. `findConfirmedForResource` vrací jen CONFIRMED daného Resource. | component (skutečná DB, Prisma adaptér) | `reservationTx.contract.test.ts` › DD-T10, DD-T10b, DD-T10c (**nový**, kontrakt dřív neměl test) |
| DD-T11 | **collaboration / concurrency:** kontrakt 1, ADR-03 | Dvě souběžná rozhodnutí o alokaci na PostgreSQL READ COMMITTED: se zámkem Resource má právě jednoho vítěze, bez zámku vzniknou dvě CONFIRMED. | integration (PostgreSQL) | existující `tests/postgres/lock-mechanism.test.ts` |

Testovací dvojníci:
- [`tests/support/inMemoryReservationStore.ts`](../tests/support/inMemoryReservationStore.ts)
  (N3) implementuje `ReservationStore` / `ReservationTx` podle kontraktů 1–2:
  - commit při vrácení hodnoty, rollback při výjimce;
  - `transition` s pojistkou očekávaného stavu;
  - `whileWaitingForLock` simuluje transakci, která commitne během čekání na zámek;
  - `calls` zaznamenává pořadí spolupráce.
- [`tests/support/clock.ts`](../tests/support/clock.ts) (`TestClock`, Jarda) nahrazuje systémový čas.

**DD-T4 — rozhodnutí nad stavem čteným pod zámkem**
- *Selected level:* unit, `ReservationService` s in-memory portem.
- *Why this level:* chování závisí na **pořadí** čtení a zámku, ne na databázi. Fake umí
  deterministicky vložit cizí commit přesně mezi první čtení a zámek. Se skutečnou DB by to
  vyžadovalo bariéry mezi dvěma klienty a výsledek by se hůř reprodukoval. Že skutečný zámek
  serializuje, dokazuje zvlášť DD-T11.
- *What design decision does this test verify?* DR1 a kontrakt 1: Lifecycle rozhoduje výhradně nad
  stavem znovu načteným v `inResourceTransaction`. Mutace M2 níže to potvrzuje.

**DD-T9 — rozhodovací tabulka LifecyclePolicy**
- *Selected level:* unit, čistá funkce bez úložiště, transakce i hodin.
- *Why this level:* N1 vytáhlo rozhodnutí z transakce právě proto, aby šla celá tabulka (stav ×
  lhůta × routing) projít bez I/O a každá kombinace byla jeden řádek testu. Přes službu a DB by se
  stejné kombinace testovaly draze a nepřímo.
- *What design decision does this test verify?* kontrakt 3: pořadí vyhodnocení, neúspěch jako
  hodnota (žádná výjimka) a determinismus. Mutace M4 a M5 níže to potvrzují.

**DD-T11 — souběh na PostgreSQL**
- *Selected level:* integration (skutečný PostgreSQL, dva nezávislí klienti).
- *Why this level:* garance ADR-03 stojí na řádkovém zámku databáze pod READ COMMITTED. Fake ani
  SQLite (`BEGIN IMMEDIATE`) ji nedokážou ani vyvrátit.
- *What design decision does this test verify?* postcondition kontraktu 1 („`work` běží
  serializovaně vůči ostatním transakcím téhož Resource“).

#### Pokrytí rozhodovacích tabulek H2 testy

Kontrola Honzových tabulek z [Algorithm / decision logic](architecture-and-decisions.md#algorithm--decision-logic)
proti testům, 12. 10. 2026. Každý řádek je pokrytý na dvou úrovních: na úrovni čisté policy
(rozhodnutí) a na úrovni služby s fake store (zápis, commit/rollback, chyba).

| Řádek H2 | Policy (DD-T9) | Služba + fake store (zápis / chyba) | Shoda |
|---|---|---|---|
| C-F1 jiný než DRAFT → `InvalidStateError`, žádný zápis | CONFIRMED po cutoff, PENDING, CANCELLED | DD-T6 (5 stavů), DD-T4 | ano |
| C-F2 DRAFT, `now >= cutoff` → CANCELLED, pak chyba | DRAFT v cutoff, i s `requiresApproval` | DD-T2 (commit, ne rollback), DD-T8b (cutoff během čekání na zámek) | ano |
| C-F3 DRAFT, včas, `requiresApproval` → PENDING bez čtení CONFIRMED | `RouteToApproval` | DD-T1 (`findConfirmedForResource` se nevolá) | ano |
| C-F4 DRAFT, včas, konflikt → `OverlapError(id)`, žádný zápis | `decideAllocation → Conflict(id)` | DD-T3, DD-T4b | ano |
| C-F5 DRAFT, včas, bez konfliktu → CONFIRMED | `Allocate`, `Free` | DD-T1b, DD-T2c (1 ms před cutoff), DD-T5 | ano |
| A-F1 jiný než PENDING → `InvalidStateError`, žádný zápis | DRAFT, CONFIRMED, EXPIRED | DD-T6b (5 stavů) | ano |
| A-F2 PENDING, `now >= deadline` → EXPIRED, pak chyba | PENDING v deadline | DD-T2b | ano |
| A-F3 PENDING, včas, konflikt → `OverlapError`, zůstává PENDING | `Conflict(id)` | DD-T3b | ano |
| A-F4 PENDING, včas, bez konfliktu → CONFIRMED, jeden zápis | `Allocate` | **DD-T3c (doplněn při této kontrole)** | ano |

Pseudocode alokace (striktní překryv, ignorování vlastního id, DRAFT/PENDING neblokují) pokrývají
DD-T5 a DD-T9 › *candidate is never its own conflict* / *touching interval*. Pravidlo H2 „Clock
se čte jednou po zámku“ pokrývá DD-T8. **Rozpor mezi krokem 4, testy a kódem nebyl nalezen.**

### Unit/component tests executed

Prostředí 12. 10. 2026: Windows 11, Node, Vitest 2.1.1.

| Běh | Výsledek |
|---|---|
| Před N1/N2 (kód `7ba6a05`): `npx vitest run tests/services/reservationLifecycle.unit.test.ts` | 21 passed, 2 todo. DD-T7 jako očekávané selhání (`it.fails`): kód návrh nesplňoval. |
| Po N1/N2 (`f24326a`): `npx vitest run tests/services/reservationLifecycle.unit.test.ts tests/domain/lifecyclePolicy.test.ts` (bez DB) | **39 passed** (23 + 16) |
| Mutace M1: `Close` vyhodí chybu uvnitř transakce | **3 failed**: DD-T2, DD-T2b, DD-T8b (rollback zahodil terminální stav) |
| Mutace M2: `decide` předá do rozhodnutí stav z prvního čtení (`located`) | **1 failed**: DD-T4 |
| Mutace M3: `clock.now()` čten navíc před zámkem | **1 failed**: DD-T8 |
| Mutace M4: v `decideConfirm` vynechán routing BR-05 | **2 failed**: DD-T1, DD-T9 |
| Mutace M5: `decideAllocation` nevyřadí kandidáta | **1 failed**: DD-T9 |
| Po každé mutaci kód vrácen | 39 passed; `git status src` beze změn |
| Po kontrole kroku 4: přidán DD-T3c (A-F4), stejný příkaz bez DB | **40 passed** (24 + 16) |
| `npm test` (embedded PostgreSQL **16.14**, `read committed`, nová DB, migrace + seed + `tsc` + celá sada) | **137 passed, 0 failed, 0 todo** (14 souborů), včetně DD-T1–T11 a L2 `lifecycle-ownership` — [`c05-postgres-tests.json`](evidence/c05-postgres-tests.json). Běh proběhl před přidáním DD-T3c, který nepotřebuje DB. Opakovaný běh po něm se nespustil, protože běžící `npm run dev` držel zamčený Prisma engine (EPERM). Je potřeba ho zopakovat před tagem. |

### Design ↔ implementation mismatch

Porovnání návrhu s kódem na `c05` po implementaci (`f24326a`). Stav před implementací (`7ba6a05`)
je ve sloupci *Před*.

| DD decision | Před (`7ba6a05`) | Implemented? | Evidence | Action |
|---|---|---|---|---|
| DR1: rozhodnutí nad stavem znovu načteným pod zámkem | YES | YES | `ReservationService.decide()`; DD-T4 | keep |
| DR2 / N2: `Clock`, `now()` jednou na příkaz po zámku | NO (`now = new Date()` jako parametr, vyhodnocený před zámkem) | YES | `src/domain/clock.ts`, `decide()` volá `clock.now()` v transakci; DD-T8, DD-T8b | update code — provedeno |
| DR3: povolený zdrojový stav | YES | YES | `decideConfirm` / `decideApprove` → `InvalidState`; DD-T6, DD-T9 | keep |
| DR4: terminální stav commitnout, chybu vyhodit až po commitu | YES | YES | `Close` → `Outcome { expired }`; DD-T2, DD-T2b | keep |
| DR5: routing BR-05 bez alokace | YES | YES | `RouteToApproval`; DD-T1, DD-T9 | keep |
| DR6: alokace jen proti CONFIRMED téhož Resource, bez sebe, BR-01 | YES | YES | `decideAllocation`; DD-T3, DD-T5, DD-T9 | keep |
| DR7 / kontrakt 2: pojistka očekávaného stavu v `transition` | YES | YES | `PrismaReservationTx.transition`; DD-T10b | keep |
| Kontrakt 1: serializace podle Resource | YES | YES (PostgreSQL) | `inResourceTransaction`; DD-T11 | keep |
| N1 / kontrakt 3: rozhodnutí v `LifecyclePolicy` jako hodnota | NO (větvení v callbacku služby) | YES | `src/domain/lifecyclePolicy.ts`; DD-T9 | update code — provedeno |
| Kontrakt 3: chybějící Resource = porušený invariant → chyba | NO (`resource?.requiresApproval` → přímý Confirm) | YES | `MissingResourceError`; DD-T7 | update code — provedeno |
| Mapování `MissingResourceError` na HTTP | — | PARTLY | žádné mapování v `errorMiddleware` → 500 | keep (záměr, viz Resolution) |

### Resolution

- **N1, N2 a chybějící Resource: změněn kód, ne DD.** Návrh byl správný a kód ho nerealizoval.
  - N1 dává rozhodovací tabulce jedno testovatelné místo (DD-T9).
  - N2 je jediný způsob, jak splnit C2 R6 („jednotný zdroj času“). Zároveň opravuje skutečnou vadu:
    `now` vyhodnocené před až 30 s čekáním na zámek posouvalo lhůtu BR-04 / BR-06. Opravu dokládá
    DD-T8b.
  - Tiché pokračování bez Resource by obešlo BR-05, kdyby se invariant cizího klíče někdy porušil.
- **`MissingResourceError` → 500 ponecháno.** Nastat může jen při porušeném invariantu databáze
  (povinný cizí klíč, žádná DELETE route). Je to tedy chyba systému, ne klienta. HTTP mapování je
  mimo hranici DD (R1, Reservation API).
- **Ostatní řádky: keep.** C03 implementace už odpovídala DR1, DR3–DR7. Dokládají to testy
  odvozené z DD, ne z kódu, a mutační kontrola ukazuje, že tyto testy návrh opravdu hlídají.
- Žádný rozdíl se neřešil úpravou DD podle kódu.

### Remaining design risk

- **Krok 4 DD je doplněný a ověřený proti testům** (viz *Pokrytí rozhodovacích tabulek H2*). V historii
  větve ale implementace `f24326a` předchází commitu s krokem 4. Krok 4 byl připravený souběžně a do větve
  se dostal až rebasem. Zadání chce DD před implementací. Kroky 1–3 (`ef8257c`) implementaci předcházejí.
- Fake store modeluje kontrakty 1–2, ne skutečnou DB. Shodu adaptéru s kontraktem dokládají jen
  DD-T10 (transition, čtení) a DD-T11 (zámek). Kontrakt „timeout 30 s → chyba DB“ testem pokrytý není.
- Cancel (OP-04), Reject a Ordering jsou mimo DD. Používají stejnou transakční cestu a `Clock`, ale
  jejich pravidla nejsou v `LifecyclePolicy` (Reject a Cancel rozhodují přímo ve službě).
- Pravidlo „stav mění jen Lifecycle“ hlídá dál textová kontrola L2 (`lifecycle-ownership.test.ts`), ne typy.
- Testy a text připravila AI za Michala. Lidské review A9 doplněno 26. 10. 2026 — viz [Lidské review A9](#lidské-review-a9).

### Commit/tag

Větev `c05`, sloučená do `main` přes **PR #20** (merge commit **`055917c`**, 26. 10. 2026).

| Commit | Autor | Obsah |
|---|---|---|
| `f5a4676` | Jarda | plán a rozdělení práce (`tasks-cv5.md`) |
| `ef8257c` | Jarda | DD kroky 1–3: jednotka, DR1–DR7, ownership, kontrakty 1–4, strukturální pohled |
| `f24326a` | Jarda | implementace N1 (`LifecyclePolicy`), N2 (`Clock`), `MissingResourceError`; testy převedené na `TestClock` |
| `ad1ede6` | Michal | testy odvozené z DD (DD-T1–T10), fake `ReservationStore` (N3), první evidence |
| `58600c2` | Michal | testy na Clock API, DD-T7–T9 plnohodnotné, mismatch před/po N1+N2, mutační kontrola |
| `a48d2e0` | Honza | DD krok 4: H1 operace, H2 rozhodovací tabulky, H3 sekvence, H4 |
| `600645c` | Michal | kontrola kroku 4 proti testům, DD-T3c (A-F4) |
| `055917c` | Jarda | merge PR #20 `c05` → `main` |

Tag **`c05-detailed-design`** → `055917c` (merge commit, stejně jako `c03-architecture` u C03).
Uzavírací úprava dokumentace (tato sekce, checklist v `tasks-cv5.md`) je samostatný commit nad tagem.

### Honzova část — technická kontrola a předávka

**Datum:** 12. 10. 2026 (Europe/Prague). **Provedl:** Codex na pokyn Honzy.
Jde o technickou kontrolu a přípravu H1–H4, nikoli potvrzení lidského review dle A9.
Výchozí větev `c05` po `git pull --ff-only`: `ef8257c` (Jardovy kroky 1–3);
kontrola níže byla připravena nad aplikační baseline `7ba6a05`, před stažením novějších commitů. Kód a testy se v Honzově části nemění.

**Dokončené výstupy:** [H1 operace](architecture-and-decisions.md#important-methods--operations),
[H2 rozhodovací tabulky a algoritmus](architecture-and-decisions.md#algorithm--decision-logic),
[H3 sekvence](architecture-and-decisions.md#detailed-sequence),
[H4 detaily ponechané kódu](architecture-and-decisions.md#dd-decisions-intentionally-left-to-code).
Řádky C-F1…C-F5 a A-F1…A-F4 umožňují Michalovi odvodit testy včetně priority chyb,
hranice v rovnosti a odložení BR-02 pro pending. Výsledek `Close` musí testovat služba
spolu s transakčním fake store: samotná čistá policy neprokáže commit před vyhozením chyby.

**Kontrola Jardových kroků 1–3:** vybraná jednotka odpovídá C03 ADR-03/G2 a požadavkům
REQ-03/04/06; DR1–DR7 pokrývají významná rozhodnutí Confirm/Approve. Rozhraní policy vrací
hodnoty a zachovává oddělení rozhodnutí od zápisu; ownership odpovídá pravidlu L2.
Clock po zámku a tvrdé odmítnutí chybějícího Resource jsou vědomé změny proti baseline.
H1–H4 používají stejné názvy a výsledky z předávky S1; nebyl nalezen blokující rozpor
se specifikací BR-01/02/04/05/06. Obsah Mermaid sekvence zkontrolován proti kontraktům;
render diagramu tento běh neověřuje.

**Historické podklady proti baseline `7ba6a05` (nejde o finální M3):**

| DD decision | Implemented? v baseline | Evidence | Action |
|---|---|---|---|
| DR1: rozhodnutí nad opětovně načteným stavem pod zámkem Resource | YES | [ReservationService.decide](../src/services/reservationService.ts), [transakční port a adaptér](../src/repositories/reservationRepository.ts) | keep; při refaktoringu zachovat |
| H2: stav → lhůta → routing → alokace; pending bez BR-02 | YES | `confirmReservation` / `approveReservation` v [Lifecycle](../src/services/reservationService.ts) | keep; převést do policy |
| DR4/H1: terminální stav commitnutý před expirační chybou | YES | `Decision`, návrat `{ expired }` a vyhození až po `inResourceTransaction` v [Lifecycle](../src/services/reservationService.ts) | keep; zachovat i po N1 |
| N1: čistá `LifecyclePolicy`, včetně `decideAllocation` | NO | Větvení a vyhození `OverlapError` přímo v [Lifecycle](../src/services/reservationService.ts) | update code — Jarda po DD |
| N2/DR2: jeden injektovaný Clock, `now` čtené po zámku | NO | Výchozí parametr `now = new Date()` v [Lifecycle](../src/services/reservationService.ts) | update code — Jarda; test čekání přes cutoff má používat Clock |
| Chybějící Resource odmítnout jako porušení invariantu | NO | `resource?.requiresApproval` v [Lifecycle](../src/services/reservationService.ts) | update code — Jarda; nepřevádět null na přímý Confirm |
| H2: polouzavřený překryv, ignorování sebe sama a ne-CONFIRMED | YES | `allocate` v [Lifecycle](../src/services/reservationService.ts), [rules](../src/domain/rules.ts) | keep; přesun rozhodnutí do `decideAllocation` |

**Resolution:** chybějící N1/N2 nejsou důvodem přepsat DD podle dnešního kódu.
Přijmout cílový návrh a implementaci změnit v Jardově kroku 6; ověřit Michalovými testy N3.
Při původní přípravě této části kroky 5 a cílová implementace ještě neexistovaly. Při synchronizaci před pushem byly staženy commity `f24326a`, `ad1ede6` a `58600c2`; aktuální stav zachycuje Michalova evidence výše. Jejich Honzovo review
zůstává následným krokem. Týmový průchod S2/S3, lidské review A9, tag a PR nejsou uzavřené.

**Kontroly dokumentace:** `npm run verify:docs` a `git diff --check`;
výsledek kontroly odkazů je v [C05 reportu](evidence/c05-document-links.json).
Historický C03 report zachován. Nová C05 unit/component sada se v této dokumentační části
nespouští; její implementace a běh patří Michalovi (M1–M3).

### Uzavření C05 (S3)

**Datum:** 26. 10. 2026. Připraveno s AI na pokyn Jardy; jde o technickou kontrolu, ne o lidské review A9.

| Kontrola | Výsledek |
|---|---|
| Definition of Done ze zadání | kroky 1–6 obsahově hotové — [checklist](tasks-cv5.md#hotovo-je-když-kontrola-na-s3--definition-of-done-ze-zadání) |
| Sloučení | PR #20 → `main`, `055917c` |
| Testy na `main` po merge (`npm test`, embedded PostgreSQL 16.14, READ COMMITTED, base `055917c`, 26. 10. 2026 11:19 CET, Linux/WSL2, po opravě K4) | **138 passed / 0 failed** (14 souborů; +1 proti 137 = DD-T3c z `600645c`) — [`c05-main-postgres-tests.json`](evidence/c05-main-postgres-tests.json) |
| Odkazy v dokumentech (`node scripts/check-docs.mjs`) | prošlo (exit 0); skript zapisuje report do `c03-document-links.json`, ten ponechán jako historický C03 report |
| Tag | `c05-detailed-design` → `055917c` |
| Lidské review A9 | **hotovo** 26. 10. 2026 — Jarda (krok 4, testy), Honza (kroky 1–3 a kód) — viz tabulka níže |

Věty „PR a tag nejsou uzavřené“ v Honzově části a „Tag po S3“ v původní evidenci popisují stav
12. 10. 2026 a jsou ponechány jako historie; platí tato sekce.

#### Technická kontrola AI (26. 10. 2026)

**Provedl:** Claude (AI) na pokyn Jardy. Nejde o lidské review A9; slouží jako podklad pro reviewery níže.
Rozsah: DD kroky 1–4 v [C05 Detailed Design](architecture-and-decisions.md#c05-detailed-design) proti kódu
`src/domain/lifecyclePolicy.ts`, `src/domain/clock.ts`, `src/services/reservationService.ts` a testům DD-T1–T11.

Ověřeno beze změny:

- tabulky H2 (C-F1…C-F5, A-F1…A-F4) odpovídají `decideConfirm` / `decideApprove` řádek po řádku;
- sekvence H3 odpovídá skutečnému pořadí volání v `ReservationService.decide` / `allocate`;
- kontrakty 2–4 odpovídají portu, fake store i Prisma adaptéru;
- DD-T9 má 16 případů (7 + 5 + 4), jak uvádí evidence; pokrytí H2 v tabulce výše sedí;
- mutace **M1** (3 failed: DD-T2, DD-T2b, DD-T8b) a **M3** (1 failed: DD-T8) zopakovány se stejným
  výsledkem, kód poté vrácen; M2, M4, M5 neopakovány.

| # | Nález | Závažnost | Řešení |
|---|---|---|---|
| K1 | Strukturální pohled neukazuje závislost `ReservationService → ReservationRules` (`isCancellable`, `isPastCancellationWindow`), kterou kód má kvůli Cancel. | nízká | Doplněna poznámka pod diagram: závislost je mimo hranici DD (OP-04). Diagram ponechán. |
| K2 | Kontrakt 1 neříkal, co se stane při porušené precondition „Resource existuje“ — přesně scénář DD-T7. | nízká | Doplněno do *Failures* kontraktu 1: zámek nic nezamkne, Lifecycle odmítne `MissingResourceError` před zápisem. |
| K3 | Confirm čte Resource před rozhodnutím o stavu, takže u rezervace mimo DRAFT bez Resource vyhraje `MissingResourceError` nad `InvalidStateError`. | informativní | Ponecháno: odpovídá H1 („nenalezené záznamy řeší H1 před dokončením rozhodnutí“) a nastat může jen při porušeném cizím klíči. |
| K4 | DD-T8 ověřoval čtení hodin po zámku, ale ne **po opětovném načtení rezervace**, které H2 vyžaduje. | nízká | Do DD-T8 přidána aserce `tx.findById` < `clock.now`; 40/40 unit testů prochází. |
| K5 | `tasks-cv5.md` uváděl u jednotky jen REQ-03, REQ-04; DD krok 1 uvádí i REQ-06. | nízká | Plán sjednocen s DD. |
| K6 | Evidence 12. 10. žádá zopakovat `npm test` před tagem (běh 137 byl před DD-T3c). | — | Vyřešeno během 26. 10. (138 passed) v tabulce výše. Prostředí 12. 10. neuvádí verzi Node — ponecháno jako historie. |

Blokující rozpor mezi DD, kódem a testy nalezen nebyl.

#### Lidské review A9

Pravidlo A9 (z C03): každý výstup připravený AI musí přečíst člověk, který ho nepsal, a zapsat se
sem. Do vyplnění tohoto záznamu **lidské review C05 doloženo není**. Podkladem jsou nálezy K1–K6 výše:
reviewer je ověří (souhlasí / nesouhlasí) a projde body níže.

| Výstup | Autor (s AI) | Reviewer | Datum | Výsledek / nálezy |
|---|---|---|---|---|
| DD kroky 1–3 (`ef8257c`) + implementace N1/N2 (`f24326a`) | Jarda | Honza (Jan Kovařčík) | 26. 10. 2026 | přečetl výstup a technickou kontrolu AI; souhlasí se všemi nálezy K1–K6 a jejich řešením, další nálezy nemá (souhlas sdělen Jardovi osobně) |
| DD krok 4 H1–H4 (`a48d2e0`) | Honza | Jarda (Jaroslav Petera) | 26. 10. 2026 | přečetl výstup a technickou kontrolu AI; souhlasí se všemi nálezy K1–K6 a jejich řešením, další nálezy nemá |
| Testy DD-T1–T11, fake store, evidence M1–M3 (`ad1ede6`, `58600c2`, `600645c`) | Michal | Jarda (Jaroslav Petera) | 26. 10. 2026 | přečetl výstup a technickou kontrolu AI; souhlasí se všemi nálezy K1–K6 a jejich řešením, další nálezy nemá |

Co má reviewer minimálně ověřit (stačí odškrtnout do sloupce *Výsledek*):

- **Kroky 1–3:** DR1–DR7 odpovídají C03 C2 (R2/R3/R5/R6); kontrakty 1–4 sedí na kód
  (`src/domain/lifecyclePolicy.ts`, `src/domain/clock.ts`, `ReservationService.decide`);
  diagram neobsahuje závislost, která v kódu není.
- **Krok 4:** řádky C-F1…C-F5 a A-F1…A-F4 odpovídají `decideConfirm` / `decideApprove`;
  sekvence H3 odpovídá skutečnému pořadí volání (`findById` → zámek → `tx.findById` → `clock.now()`).
- **Testy:** každý řádek DD-T* odkazuje na existující test; mutace M1–M5 jsou popsané
  reprodukovatelně; tabulka mismatch neobsahuje řádek „update DD“ bez zdůvodnění.

## C06 Internal Evidence Assessment

> **Stav 29. 10. 2026:** připraveno s AI na pokyn Michala jako **návrh dispozice**. Rozhodnutí
> ACCEPT / REJECT a vlastníky musí potvrdit tým (Jarda, Honza, Michal) a zapsat se do
> [Lidského review C07](#lidské-review-c07). Dokud se tak nestane, platí jako návrh.

**Assessed baseline:** `a8f1052` (`main`, „c05 kompletne hotovy“), 26. 10. 2026. Hodnocení od
nezávislého týmu: [`SWI_C06_Assessment_Hospoda_Devs.md`](SWI_C06_Assessment_Hospoda_Devs.md)
(B1–B2 YES, R1–R3 YES, R4–R5 PARTLY, A1–A4 YES, Q1/Q3 PARTLY, Q2 YES, D1–D5 YES).
**Reporting baseline (opravy):** větev `c07`, tag `c07-reporting-baseline` (commit v
[Commit/tag](#committag-c07)).

### Verified findings

Každý nález jsme nezávisle zopakovali proti `a8f1052` (C07, „Verify“).

| ID | Claim (náš artefakt) | Expected ↔ Observed | Naše ověření | Výsledek |
|---|---|---|---|---|
| **F2** | BR-01 „parsable UTC timestamps“, R-6 „Boundaries must be reproducible“ (`specification.md`) | Expected: stejný požadavek = stejný okamžik bez ohledu na TZ serveru. Observed: `z.coerce.date()` v `src/http/app.ts` vyloží čas bez offsetu v zóně serveru, přijme i `"1"`. | Skript se Zod schématem z `a8f1052` (29. 10.): `"2027-06-01T18:00:00"` → `18:00Z` při `TZ=UTC`, `16:00Z` při `Europe/Prague`; `"1"` → rok 2001. Žádný test vstup bez `Z` nepokrýval. | **VERIFIED FINDING** (defekt specifikace ↔ kód) |
| **F1** | ADR-03 „znovu otevřít, když měření ukáže zámek Resource jako úzké hrdlo při 10× zátěži“; Q — 10× souběh (`intent-and-change.md`) | Expected: rozhodnutelné kritérium pro „úzké hrdlo“ a zapsané rozhodnutí z měření. Observed: kritérium jen pro korektnost; p95 se ukládalo bez prahu, rozhodnutí o ADR-03 chybělo. | Prohledání `docs/`: práh latence nikde; `scripts/postgres-load.ts` asertoval jen počty 200/409 a BR-02. | **VERIFIED FINDING** (chybějící evidence kvality) |
| F3 | ADR-03 „jedna chybová cesta při konfliktu“ | Hodnotitelé sami zamítli: `ReservationConflictError` se přes aplikaci nemůže uplatnit. | Nepřezkoumáváme — souhlasíme s jejich ověřením (V-04R.1/7, L2). | REJECTED CANDIDATE |

### Owner disposition

| Nález | Rozhodnutí | Zdůvodnění | Vlastník (návrh) |
|---|---|---|---|
| F2 | **ACCEPTED — change required** | Reprodukováno. Výsledek závisí na prostředí, což přímo odporuje R-6; ovlivňuje i BR-02 a lhůty BR-04/06. UI posílá `toISOString()`, takže změna nerozbije frontend. | Michal |
| F1 | **ACCEPTED — change required (evidence, ne kód Lifecycle)** | Přijatý negativní důsledek ADR-03 bez měřitelné podmínky nejde vyhodnotit. Doplňujeme práh a rozhodnutí; implementace Lifecycle se nemění. | Jarda |
| F3 | **NO CHANGE REQUIRED** | Zamítnuto hodnotiteli; guard v `transition` je záměrně druhá pojistka (ADR-03, DD kontrakt 2). | — |

### Actions / justified no-change decisions

| Nález | Akce | Closure evidence | Stav |
|---|---|---|---|
| F2 | `src/http/app.ts`: `startsAt`/`endsAt` i `start`/`end` dostupnosti = ISO 8601 s povinným offsetem (`z.string().datetime({ offset: true })`), jinak 400. BR-01 zpřesněno (`specification.md`), nové příklady V-01.6 / V-01.7. | `tests/spec/op01-op02.test.ts` › V-01.6 (3 vstupy bez offsetu → 400, nic nevytvořeno), V-01.7 (`+02:00` uloženo jako stejný UTC okamžik), V-02.6 (dostupnost bez offsetu → 400). Před opravou by V-01.6 vracel 201. `npm test` 142/142 — [`c07-postgres-tests.json`](evidence/c07-postgres-tests.json). | **Uzavřeno** (čeká na lidské review) |
| F1 | Kritérium: *na horkém stole (`hot-confirm`, `hot-mixed`) při souběhu 50 musí být p95 ≤ 500 ms aspoň ve 2 ze 3 opakování; jinak je zámek úzké hrdlo a ADR-03 se znovu otevře.* Verdikt počítá `scripts/postgres-load.ts` (`latencyDecision`), build kvůli latenci nepadá. ADR-03 a `c03-technical-completion.md` odkazují na práh. | `npm run verify:postgres` 29. 10. 2026 (Windows 11, PostgreSQL 16.14, READ COMMITTED): p95 hot-confirm 239 / 173 / 176 ms, hot-mixed 147 / 154 / 145 ms; různé stoly 57–94 ms; 495 požadavků v 18 dávkách, 0 porušení BR-02 → **„ADR-03 kept“** — [`c07-postgres-verification.json`](evidence/c07-postgres-verification.json). | **Uzavřeno** (čeká na lidské review) |
| F3 | Žádná změna. | Zdůvodnění hodnotitelů v assessmentu. | — |

Proč 500 ms: Confirm/Approve provádí obsluha v UI a 0,5 s je běžná hranice „okamžité“ odezvy;
souběh 50 na **jeden** stůl je extrémní případ (10× výchozích 5). Práh je **rozhodnutí týmu**,
ne odvozený limit — měření ukazuje rezervu zhruba 2×.

### Remaining evidence gaps

- Měření latence je lokální, jeden proces, krátké dávky — není to produkční SLA (beze změny proti C03).
- Kritérium F1 se vyhodnocuje jen při `verify:postgres`, ne v běžném `npm test`.
- Hodnotitelé si všimli, že tag `c05-detailed-design` (`055917c`) neobsahuje aserci K4 přidanou
  v `7e62f78`; evidence C05 tedy odpovídá `a8f1052`, ne tagu. Neopravujeme přesunem tagu
  (historie), uvádíme to zde.
- Bod 10 C02 (původní pořadí analýzy) čeká na vyjádření vyučujícího.
- Skripty `npm test` / `verify:docs` přepisují sledované `docs/evidence/c03-*.json` — viz issue I-01.

## C07 Risk Assessment

> Návrh připravený s AI 29. 10. 2026 z reálného stavu repozitáře; L/I, strategie a vlastníky
> potvrdí tým v [Lidském review C07](#lidské-review-c07). Termíny „do 2. 11. 2026“ = před C08
> (navrženo, potvrdit podle termínu cvičení).

Stupnice podle zadání: L, I ∈ {1, 2, 3}; priorita L × I: 1–2 LOW, 3–4 MEDIUM, 6–9 HIGH.
Počáteční riziko = před opatřením. Skutečné zbytkové = jen pokud je opatření provedené a ověřené,
jinak **NOT VERIFIED**.

| ID | Kategorie | Příčina → nejistá událost → důsledek | Počáteční L / I / priorita + zdůvodnění |
|---|---|---|---|
| **R-01** | People / Resources | Většinu implementace a uzavírání (C03 K, C05 N1/N2, PostgreSQL setup, merge, tagy) dělal jeden člen (Jarda: 28 ze 46 ne-merge commitů na `main`) a velkou část textů připravila AI → při obhajobě CP1 nebo v nepřítomnosti Jardy ostatní nevysvětlí mechanismus ADR-03, DD nebo nálezy C06 → ztráta bodů v kritériu *Engineering Review & Defence*, zpoždění CP2. | L=2 (koncentrace je doložená; nepřítomnost všech na C06 ukázala, že výpadek nastává), I=3 (obhajoba je hodnocené kritérium) → **HIGH (6)** |
| **R-02** | Technical / Quality | BR-02 vynucuje jen Reservation Lifecycle (ADR-03, bez DB constraint), kontrola L2 je textová a `npm run db:import-sqlite` zapisuje rezervace přímo (`createMany`) → zápis mimo Lifecycle uloží dvě překrývající se CONFIRMED téhož stolu → porušení hlavního invariantu (dvojitá rezervace). | L=1 (žádná známá cesta se nepoužívá, ale import existuje), I=3 (hlavní invariant domény) → **MEDIUM (3)** |
| **R-03** | Release / Operation | Spuštění závisí na `npm ci` se sítí a na platformním balíčku `embedded-postgres` 16.14.0-beta.17 → na prezentačním počítači (jiná platforma, bez sítě, blokovaný port 55432) se aplikace ani testy nespustí → živá ukázka *Working Solution* při C08 selže. | L=2 (beta závislost, škola/síť mimo naši kontrolu), I=2 (lze nahradit uloženými reporty, ale ztratí se přesvědčivost) → **MEDIUM (4)** |
| **R-04** | Schedule / Integration | Výstupy se integrují těsně před termínem (C05 merge 26. 10., v den odevzdání; C07 29. 10.) → nálezy z obhajoby C08 nebo z review nestihneme opravit a ověřit před CP2 → do CP2 vstoupí otevřené nálezy. | L=2 (opakovaný vzorec C03/C05), I=2 (náprava realistická, ale tlačí rozsah) → **MEDIUM (4)** |
| **R-05** | Scope / Requirements | Vypršení PENDING_APPROVAL se detekuje jen při dalším Approve (R-16, ADR-04) → v CP2 se objeví požadavek na aktivní expiraci (např. seznam čekajících obsahuje propadlé) → přepracování BR-06, OP-05, V-05.7 a DD. | L=1 (v0.2 to výslovně nepožaduje), I=2 (lokální změna Lifecycle) → **LOW (2)** |

| ID | Strategie | Opatření, vlastník, termín | Doklad opatření | Očekávané zbytkové | Skutečné zbytkové | Akceptace / trigger |
|---|---|---|---|---|---|---|
| R-01 | MITIGATE | Každý člen přednese v části A část, kterou **nepsal** (Michal: Verification & C06, Honza: architektura ADR-03, Jarda: DD); generálka s kontrolními otázkami. Vlastník: Michal, do 2. 11. 2026. | Plán v [`tasks-cv7.md`](tasks-cv7.md); generálka zatím neproběhla. | L=1 / I=3 → MEDIUM (3) | **NOT VERIFIED** | Akceptuje tým; trigger: člen při generálce nezodpoví kontrolní otázku ke své části. |
| R-02 | MITIGATE | Import odmítne zdroj s překrývajícími se CONFIRMED (`assertExclusiveConfirmed` v `scripts/lib/data-transfer.mjs`). Ruční SQL zůstává (přijatý důsledek ADR-03). Vlastník: Jarda, hotovo 29. 10. 2026. | `scripts/verify-data-transfer.mjs`: zdroj se dvěma překrývajícími se CONFIRMED → odmítnuto, cíl beze změny — `overlappingConfirmedRefused: true` v [`c07-data-transfer-verification.json`](evidence/c07-data-transfer-verification.json). | L=1 / I=3 → MEDIUM (3) | **L=1 / I=3 → MEDIUM (3)** — cesta importem uzavřena a ověřena; dopad zůstává 3, protože ruční SQL je dál možné. | Akceptuje Jarda (ADR-03); trigger: nový skript / admin nástroj zapisující `Reservation`, selhání L2 testu. |
| R-03 | MITIGATE | Den před C08 `npm ci` + `npm test` na **prezentačním** notebooku; zálohou uložené reporty `docs/evidence/c07-*.json` a `docker compose` (`npm run dev:external`). Vlastník: Honza, do 2. 11. 2026. | Čistý běh existuje na 3 platformách: Windows 11 (Michal, 29. 10., 142/142), macOS (hodnotitelé C06, 26. 10.), Linux/WSL2 (Jarda, 26. 10.). Prezentační stroj zatím neověřen. | L=1 / I=2 → LOW (2) | **NOT VERIFIED** | Akceptuje Honza; trigger: `npm ci` nebo start PostgreSQL selže na prezentačním stroji. |
| R-04 | MITIGATE | PR `c07` → `main` sloučit do 30. 10. 2026; nálezy z C08 zapsat jako issues se lhůtou týden před CP2. Vlastník: Jarda. | Zatím jen plán. | L=1 / I=2 → LOW (2) | **NOT VERIFIED** | Akceptuje Jarda; trigger: PR otevřený déle než 2 dny nebo issue po lhůtě. |
| R-05 | ACCEPT | Bez změny; rozhodnutí ADR-04 (lazy detekce, žádný worker). Vlastník: Honza. | ADR-04 v `architecture-and-decisions.md`, test V-05.7. | L=1 / I=2 → LOW (2) | LOW (2) — přijato, opatření se neprovádí | Akceptuje Honza; trigger: požadavek na automatický přechod podle času v zadání CP2 nebo od vyučujícího. |

### Open issues (ne rizika)

| ID | Problém (už nastal) | Dopad | Vlastník / další krok |
|---|---|---|---|
| I-01 | `npm test`, `verify:postgres` a `verify:docs` přepisují sledované `docs/evidence/c03-*.json`; každý běh se musí ručně vracet. | Riziko nechtěně commitnuté změny historické evidence (zmínili hodnotitelé C06, B2). | Jarda — výstupy zapisovat do souboru podle běhu, ne do historických C03 reportů; do CP2. |
| I-02 | Bod 10 C02 (původní pořadí analýzy) uzavřen týmem jako přiznaná mezera. | Bez potvrzení vyučujícího zůstává procesní otázka otevřená. | Tým — zeptat se na C08. |

### Lidské review C07

| Výstup | Připravil | Reviewer | Datum | Výsledek |
|---|---|---|---|---|
| Dispozice F1–F3 a opravy (`src/http/app.ts`, testy V-01.6/7, `postgres-load.ts`, import) | Michal (s AI) | *doplní tým* | | |
| Registr rizik R-01…R-05, issues | Michal (s AI) | *doplní tým* | | |
| Status report C08 (`docs/c08-project-status.pptx`) | Michal (s AI) | *doplní tým* | | |

### Commit/tag C07

Větev `c07`. Reporting baseline pro části A a C = commit „C07: dispozice nálezů C06, oprava F2,
kritérium F1, rizika“ s tagem **`c07-reporting-baseline`**. Ověření běželo nad stejným obsahem
zdrojů (`baseCommit` v reportu je předchozí `1393c70` + tyto změny; SHA-256 souborů je v reportu).
