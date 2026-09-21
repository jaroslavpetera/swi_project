# Budete pracovat nebo dostanete bídu!!!!!
# swi_project

jarda petarda, honzik kovarčík, Bc. Michal Křižák

## Plán
- Rezervace stolů v hospodě s akutálním stavem dluhu na účtu k zaplacení
- Možnost objednání piva na určitý čas

Podrobný Project Frame (doména, business rules, future pressure) je v
[`docs/intent-and-change.md`](docs/intent-and-change.md), zdůvodnění tech stacku v
[`docs/architecture-and-decisions.md`](docs/architecture-and-decisions.md) a evidence
provedeného engineering spike v [`docs/evidence-and-evolution.md`](docs/evidence-and-evolution.md).

## Tech stack

TypeScript (Node.js) + Express + Prisma. Databáze: SQLite pro lokální vývoj/spike, PostgreSQL
jako produkční cíl (viz ADR v `docs/architecture-and-decisions.md`). Testy: Vitest.

## Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm test        # spustí unit testy + C01 persistence spike
npm run dev      # spustí HTTP server na http://localhost:3000
```

## CP1 walking skeleton

Jedna end-to-end cesta, která bude skutečně runnable po C03 / před C04:

```
POST /reservations
→ validate   (Zod schema: resourceId, userId, startsAt < endsAt)
→ persist    (Prisma → DB, stav DRAFT)
→ return reservation ID   (201, { id, state })
→ automated check         (tests/spike/persistence.spike.test.ts + tests/domain/rules.test.ts)
```

Základ této cesty (validate → persist → return ID) je již implementován v `src/http/app.ts` a
ověřen v rámci C01 engineering spike (viz `docs/evidence-and-evolution.md`) — do CP1 zbývá
doplnit zbytek operací nad plnou doménou (confirm/cancel/availability jsou navrženy a částečně
implementovány, ale nejsou ještě předmětem povinného walking skeleton kroku).