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
