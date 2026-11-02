# Project Frame

> Původní rámec C01. Aktuální operace, rozhodnutí a rozsah C02 jsou autoritativně
> v [specification.md](specification.md). Původní riziko souběhu je pro současné
> SQLite aplikační příkazy řešeno; přenos garance na PostgreSQL a vyšší zátěž
> zůstává driverem C03, viz [architektura](architecture-and-decisions.md).

## Reservation domain
Rezervace stolů v hospodě. Host si rezervuje konkrétní stůl na časový slot; systém dále eviduje
stav rezervace a v budoucnu (mimo rozsah C01) i navázaný účet/dluh hosta a možnost předobjednat
pivo na daný čas.

## Purpose
Systém slouží hostům hospody, kteří si chtějí předem zajistit stůl na konkrétní čas, a obsluze,
která potřebuje mít přehled o obsazenosti stolů a nechce řešit dvojí rezervaci stejného stolu.
Cílem je snížit počet konfliktů "stůl je obsazený, i když měl být volný" a dát hostům jistotu.

## Users / Stakeholders
- **Host (Guest)** – vytváří, případně ruší rezervaci.
- **Obsluha / správce hospody (Staff)** – potvrzuje rezervace, řeší výjimky (no-show, konflikty).
- **Notification Service** (systémový aktér, ne uživatel) – posílá hostovi potvrzení rezervace.

## Core concepts
- **Reservation** – rezervace konkrétního `Resource` konkrétním `User`em na časový slot, se stavem.
- **Resource** – rezervovatelný stůl (název/číslo, kapacita).
- **User** – host, který rezervaci vytváří.
- *(mimo minimální rozsah, plánováno do budoucna)* **Tab / Debt** – aktuální nesplacený účet hosta.

## Core operations
- Create reservation
- Confirm / approve reservation
- Cancel reservation
- Check availability

## Persistent state
- **Reservation**: id, `resourceId`, `userId`, `startsAt`, `endsAt`, `state`, `createdAt`.
- **Resource**: id, jméno/označení stolu, kapacita.
- **User**: id, jméno, e-mail (kontakt pro notifikaci).

## State-changing operation
`DRAFT → CONFIRMED` přes `POST /reservations/:id/confirm`. Zároveň platí i přechod
`DRAFT → CANCELLED`, pokud vyprší no-show grace period (viz vlastní business rule níže) nebo host
rezervaci sám zruší (`CONFIRMED → CANCELLED` / `DRAFT → CANCELLED` přes `POST /reservations/:id/cancel`).

## Common business rule
Confirmed reservations for the same resource must not overlap.
(Implementováno v `src/domain/rules.ts::findOverlappingConfirmed`, ověřováno při `confirm`.)

## Domain-specific business rule
**No-show timeout:** DRAFT rezervace, která není potvrzena nejpozději 30 minut před svým začátkem,
už nejde potvrdit — při pokusu o potvrzení se automaticky přepne do `CANCELLED` a vrátí se chyba.
Uvolňuje se tak stůl pro ostatní hosty, aniž by obsluha musela ručně hlídat nepotvrzené rezervace.
(Implementováno v `src/domain/rules.ts::isExpiredDraft`, konstanta `NO_SHOW_GRACE_MINUTES`.)

## External / system boundary
**Notification Service** (default dle zadání) — po potvrzení rezervace by měl host dostat
potvrzení (e-mail/SMS). V rozsahu C01 je to čistě definovaná boundary bez implementace; skutečná
integrace/stub je kandidát na engineering spike B v některé z dalších iterací.

## Assumption
Předpokládáme, že jedna rezervace patří vždy k **jednomu konkrétnímu stolu** (ne k typu/kategorii
stolu) — přiřazování hosta k libovolnému volnému stolu daného typu není v rozsahu C01–C02.

## Unknown
Zatím nevíme, jak přesně bude fungovat vazba na dluh/účet hosta (nápad z README) vzhledem ke stavům
rezervace — jestli nesplacený dluh zablokuje jen `confirm`, nebo i samotné vytvoření rezervace.
Toto je zároveň hlavní kandidát na zvolenou future pressure (Changeability).

## Selected future pressure
Category: **Q — Quality / Scale**

Concrete pressure: 10× víc souběžných rezervací v krátkém okně — typicky páteční/sobotní večer
nebo velká sportovní akce (fotbal v TV), kdy velké množství hostů zkouší rezervovat stoly ve
stejný čas.

Why it is relevant to our reservation system: Overlap-check (`findOverlappingConfirmed`) dnes
prochází všechny rezervace daného stolu při každém `confirm`. Při výrazně vyšším počtu souběžných
požadavků na stejný resource roste riziko race condition mezi "read existing" a "write CONFIRMED"
(dvě potvrzení projdou souběžně dřív, než se stihne zapsat první). V C01 to neřešíme
implementačně, ale je to první místo, kde bychom museli zavést např. DB-level unikátní
constraint/transakci nebo optimistic locking.

## C08 / CR-C08-01 — Controlled Change Card

> Připraveno s AI na pokyn Michala 2. 11. 2026. Rozhodnutí je **návrh** — platí až po peer review
> zapsaném níže. Test cases a výsledky: [C08 v evidence](evidence-and-evolution.md#c08-controlled-change--baseline-a-test-cases).

**Request source and concrete project need:** role Obsluha / Approver (Staff). V přehledu rezervací
(`public/app.js`) se žádost, které uplynul termín schválení BR-06 (`startsAt − 30 min`), dál počítá mezi
„Čeká na schválení“ a nabízí tlačítko **Schválit**; to pak vždy skončí chybou 410. Obsluha tak řeší
žádosti, které už schválit nejde, a nevidí, které čekající jsou opravdu ještě rozhodnutelné.
Podnět navazuje na riziko **R-05** (lazy expiry) z [C07](evidence-and-evolution.md#c07-risk-assessment).

**Before commit/tag + spec/BR/ADR + schema/config:** `ff027e3` (tag `c08-before`); spec v0.2 BR-05,
BR-06, OP-05, R-16; ADR-04 (expirace se detekuje jen při Approve); migrace `20261011153000_postgresql_init`;
konstanta `APPROVAL_GRACE_MINUTES = 30` v `src/domain/rules.ts` (není konfigurovatelná).

**Old accepted behavior / observable limitation:** stav PENDING_APPROVAL se změní na EXPIRED až pokusem
o Approve (BR-06, R-16). Čtení (`GET /resources/:id/reservations`) vrací uložený stav a nic o termínu
— doloženo [TC-C08-03](evidence-and-evolution.md#tc-c08-03--pozorování-výchozího-chování-pro-cr-c08-01).

**New intended behavior, scope, out of scope:** klient (UI obsluhy) se od serveru dozví, že čekající
žádost je po termínu schválení, a nenabídne ji ke schválení ani ji nezapočítá mezi čekající.
*Mimo rozsah:* fyzické přepnutí na EXPIRED bez akce uživatele (worker), notifikace hosta, změna
30minutové lhůty, oprávnění rolí (R-7).

**Acceptance conditions:**

| ID | Typ | Podmínka |
|---|---|---|
| AC-01 | pozitivní | Čekající žádost **před** termínem (`now < startsAt − 30 min`) je v přehledu čekající a lze ji schválit (200 CONFIRMED při volném stole). |
| AC-02 | negativní | Čekající žádost **v termínu nebo po něm** se v přehledu nenabízí ke schválení a nepočítá se mezi čekající; přímý pokus o Approve dál vrací 410 a uloží EXPIRED (BR-06 beze změny). |
| AC-03 | hranice | Přesně v `startsAt − 30:00` (serverové hodiny, UTC) je žádost **po termínu** — shodně s BR-06 „eligible only while `now <` deadline“. V `startsAt − 30:01` ještě není. |
| AC-04 | regrese | BR-02: nevzniknou dvě překrývající se CONFIRMED (TC-C08-01/02, V-04R.*, `lock-mechanism.test.ts`). |
| AC-05 | regrese | Čtení zůstává čisté (R-16, V-05.7): po GET je uložený stav stejný. Reject a Cancel po termínu fungují jako dnes (BR-03, BR-06). |

**Impact analysis method / evidence reviewed:** od AC-02 jsme hledali vlastníka pravidla termínu
(`rules.ts::isApprovalExpired`, volá ho `LifecyclePolicy.decideApprove` pod zámkem), všechny zapisovače
stavu (jen Reservation Lifecycle — `tests/architecture/lifecycle-ownership.test.ts`; import viz R-02),
čtecí cesty (`app.ts` `GET /resources/:id/reservations`, `AvailabilityService`) a konzumenty (UI
`public/app.js`, `docs/frontend.md`, `scripts/verify-frontend.mjs`). Prošli jsme spec, stavový diagram,
ADR-03/04, DD C05 a testy V-05.6–8.

| Dimension / exact artifact | CHANGE / CHECK / NO IMPACT + why | Needed delta / verification | Owner / evidence |
|---|---|---|---|
| Spec: BR-06, R-16 (`specification.md`) | **CHANGE** — doplnit, že čtení smí vrátit odvozený příznak „po termínu“ bez změny uloženého stavu. | Věta k BR-06 + příklad V-05.10 (hranice). | Jarda; review spec |
| Spec: OP-02 Availability | **NO IMPACT** — PENDING ani EXPIRED stůl neblokuje (BR-02); výsledek dostupnosti se nemění. | Regrese V-02.8. | testy V-02.* |
| Stavový model (`diagrams/state-diagram.md`) | **NO IMPACT** — žádný nový stav ani přechod; PENDING → EXPIRED dál jen přes Approve. | — | — |
| Architektura: ADR-04, vlastnictví (ADR-03) | **CHECK** — ADR-04 zůstává (žádný worker). Pravidlo termínu musí mít jednoho vlastníka: čtecí cesta volá `isApprovalExpired`, neduplikuje ho. Lifecycle zůstává jediný zapisovač. | Poznámka k ADR-04; `lifecycle-ownership.test.ts` musí projít. | Honza |
| Detailní návrh C05 (`LifecyclePolicy`, `Clock`) | **NO IMPACT** na `decideApprove`; **CHECK** hodiny — čtení musí použít stejný `Clock` (serverové UTC), ne hodiny prohlížeče. | `createApp(prisma, clock?)` s výchozím `systemClock`. | Jarda; DD-T* beze změny |
| Kód: `src/http/app.ts` `GET /resources/:id/reservations` | **CHANGE** — přidat do každého řádku `approvalOverdue: boolean` = `isApprovalExpired(r, clock.now())`. | Integrační test hranice. | Michal |
| Data / schéma / migrace | **NO IMPACT** — příznak se počítá, neukládá; staré PENDING řádky ho dostanou automaticky. Import (`db:import-sqlite`) stav nemění. | — | — |
| API kontrakt | **CHANGE (aditivní)** — nové pole, stávající klienti nejsou dotčeni; žádná nová role (R-7). | README tabulka API. | Michal |
| Frontend `public/app.js`, `docs/frontend.md` | **CHANGE** — počítadlo čekajících bez `approvalOverdue`; u takové žádosti štítek „Po termínu schválení“, bez **Schválit**, ponechat **Zamítnout** / **Zrušit** dle BR-03. | `npm run test:frontend` + snímek. | Honza |
| Konfigurace / CI / release | **NO IMPACT** konfigurace (konstanta 30 min, UTC server). **CHECK** release — aditivní změna, rollback = revert commitu, bez migrace dat. | Záznam release v C09. | Jarda |
| Testy / rizika | **CHANGE** — nový oracle V-05.10 před implementací; regrese TC-C08-01/02, V-05.7, V-04R.*, lock. TC-C08-03 krok 1 se po změně upraví (pole přibude). **R-05** se částečně ošetří (viditelnost), fyzická expirace zůstává ACCEPT. | Viz handoff. | Michal |
| Provoz / obnova | **CHECK** — v DB zůstávají propadlé žádosti jako PENDING_APPROVAL, dokud je nikdo nezkusí schválit; přímé dotazy do DB / reporty je počítají jako čekající. | Uvést jako známé omezení. | tým |

**Alternatives and comparable criteria:**

| Option | Meets AC? | Benefit | Cost / failure / rollback | Verification |
|---|---|---|---|---|
| **A — odvozený příznak při čtení na serveru** | AC-01–05 ano | Malá aditivní změna, jeden vlastník pravidla (`isApprovalExpired`), R-16 i ADR-04 platí, serverové hodiny. | DB dál obsahuje propadlé PENDING (omezení provozu). Rollback = revert. | V-05.10 hranice −30:01 / −30:00 / po startu; regrese TC-C08-01/02/03, V-05.7. |
| B — expirace při čtení (GET uloží EXPIRED) | AC-01–04 ano, **AC-05 ne** | DB odpovídá realitě po prvním čtení. | Porušuje R-16 (čtení zapisuje), GET by musel brát zámek Resource (ADR-03) → zápisy i při prohlížení, změna ADR-04. | Souběh GET × Approve, zámek ve čtení. |
| C — worker periodicky ukládá EXPIRED | ano (s prodlevou intervalu) | Stav v DB je aktuální bez interakce. | Nový proces, plánovač, retry, souběh s Approve, provozní monitoring; znovuotevření ADR-04; nejvyšší náklad. | Test workeru, restart, souběh worker × Approve. |
| D — jen UI s hodinami prohlížeče | částečně (AC-03 **ne**) | Žádná změna serveru. | Pravidlo BR-06 se duplikuje v JS a závisí na hodinách klienta — stejná třída chyby jako C06 F2 (výsledek podle prostředí). | Hranici nejde spolehlivě ověřit. |

**Inaction consequences / feasible compensation:** obsluha dál kliká na **Schválit** u žádostí, které nejde
schválit, a dostává chybu 410; počet čekajících je nadhodnocený. Kompenzace bez změny kódu: proškolit
obsluhu, že 410 znamená propadlou žádost (neřeší AC-02).

**Peer reviewer and challenged assumption:** *doplní tým (jméno, datum, závěr)*. Ke kritickému posouzení:
„Stačí obsluze příznak v přehledu, nebo potřebuje stav EXPIRED fyzicky v DB (reporty, export)?“ —
pokud ano, A nestačí a je třeba C.

**Decision:** **ACCEPT — varianta A** (návrh; vlastník Michal, 2. 11. 2026). Důvod: splňuje všechny AC
s nejmenší změnou, nemění přijatá rozhodnutí R-16 / ADR-04 a ponechává jediného vlastníka pravidla.
Varianty B a D zamítnuty (porušují R-16, resp. R-6); C **DEFER** — znovu otevřít, pokud CP2 nebo
vyučující požaduje fyzický stav EXPIRED bez akce (trigger R-05).

**If ACCEPT: smallest change and acceptance tests to perform in C09:**

| Předávka | Obsah |
|---|---|
| Před změnou | `c08-before` = `ff027e3`; TC-C08-01/02/03 PASS, celá sada 147/147 ([`c08-postgres-tests.json`](evidence/c08-postgres-tests.json)) |
| Přijato | CR-C08-01 varianta A |
| Delta | `src/http/app.ts`: `createApp(prisma, clock = systemClock)`; `GET /resources/:id/reservations` přidá `approvalOverdue` přes `isApprovalExpired`. `public/app.js`: počítadlo, štítek, skrýt Schválit. `specification.md` BR-06 + V-05.10; README API; `docs/frontend.md`; poznámka u ADR-04. |
| Nový test oracle (napsat před implementací) | V-05.10 s pevnými hodinami: `startsAt − 30:01` → `false`; `startsAt − 30:00` → `true`; po `startsAt` → `true`; stav ≠ PENDING_APPROVAL → `false`. Po GET je uložený stav beze změny. |
| Regrese | TC-C08-01/02 (BR-02), TC-C08-03 (s novým polem), V-05.6–8, V-04R.*, `lock-mechanism.test.ts`, `lifecycle-ownership.test.ts`, `npm run test:frontend` |
| Riziko | Rozdíl hodin klient × server už nehraje roli (rozhoduje server); zbývá omezení „DB obsahuje propadlé PENDING“ — R-05, actual **NOT VERIFIED** do C09. |
| C09 handoff | PR se změnou, `npm test` na čistém checkoutu, `test:frontend`, záznam release a aktualizace R-05. |

**Open uncertainty and next trigger:** zda bude CP2 vyžadovat fyzickou expiraci (→ varianta C);
trigger: požadavek na reporty / export čekajících žádostí nebo zadání CP2.
