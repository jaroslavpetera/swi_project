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
