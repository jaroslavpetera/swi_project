# Hospoda Devs — rezervační systém (SWI, C02)

*„Budete pracovat nebo dostanete bídu!!!!!“*

| | |
|---|---|
| **Název týmu** | Hospoda Devs |
| **Členové** | Jaroslav Petera, Michal Křižák, Jan Kovařčík |
| **Repozitář** | https://github.com/jaroslavpetera/swi_project |

## Plán
- Rezervace stolů v hospodě s akutálním stavem dluhu na účtu k zaplacení
- Možnost objednání piva na určitý čas

Od C02 lze k potvrzené rezervaci **v jejím čase** objednat jídlo a pití
a průběžně vidět účet (zaplaceno / nezaplaceno). Podmínky jsou popsané ve
[`docs/specification.md`](docs/specification.md) jako OP-06 a pravidla BR-07/BR-08.
Předobjednávka před začátkem rezervace ani skutečné platby zatím v rozsahu nejsou.

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
npm run seed    # naplní jídelní a nápojový lístek
npm test        # spustí unit testy + C01 persistence spike + příklady ověření ze specifikace
npm run dev      # spustí HTTP server na http://localhost:3000
```

Pro opakovatelnou kontrolu C02 po instalaci závislostí spusťte:

```bash
npm run verify:c02
```

Příkaz připraví **novou oddělenou SQLite databázi**, aplikuje migrace, seed, build
a celou sadu testů. Nepoužije vývojovou databázi z `.env`. Zapíše výsledek a SHA-256
ověřených souborů do [`docs/evidence/c02-verification.json`](docs/evidence/c02-verification.json).
Dočasná databáze zůstane v systémovém temp adresáři pro případnou diagnostiku.

Na `http://localhost:3000` běží jednoduché testovací UI: uživatelé, stoly, rezervace, dostupnost
a objednávky k rezervaci včetně účtu. U stolu lze zapnout „Vyžaduje schválení“;
Confirm pak vrátí PENDING_APPROVAL a zpřístupní Approve/Reject. Výsledek akce
zobrazuje HTTP kód i tělo odpovědi.

Historické ověření instalace z 21. 9. 2026 je v evidenci C01. Aktuální integrované
ověření C02, počty testů a vazby na požadavky jsou v
[`docs/c02-completion-evidence.md`](docs/c02-completion-evidence.md).
Specifikace v0.2 je technicky dokončený kandidát; týmový podpis a křížové lidské
review zůstávají explicitně otevřené.

## API

| Operace | Endpoint |
|---|---|
| Create reservation | `POST /reservations` |
| Confirm / cancel | `POST /reservations/:id/confirm`, `POST /reservations/:id/cancel` |
| Approve / reject | `POST /reservations/:id/approve`, `POST /reservations/:id/reject` |
| Check availability | `GET /resources/:id/availability?start=&end=` |
| Jídelní lístek | `GET /menu-items`, `POST /menu-items` |
| Objednávka k rezervaci | `POST /reservations/:id/orders`, `GET /reservations/:id/orders` |
| Účet hosta | `GET /reservations/:id/tab` |
| Průběh objednávky | `POST /orders/:id/serve`, `POST /orders/:id/pay` |

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
ověřen v rámci C01 engineering spike. V C02 běží i Confirm, Cancel, Availability,
Approve/Reject a objednávky. Pro C03 zbývá zejména přenos garancí souběhu na cílovou
databázi a rozhodnutí o aktivní expiraci; viz `docs/architecture-and-decisions.md`.

## Definition of Done (C01) — kde co najdete

| # | Položka | Stav | Kde |
|---|---|---|---|
| 1 | tým 3–4 členové | ✅ | tabulka nahoře (3 členové) |
| 2 | společný repo | ✅ | https://github.com/jaroslavpetera/swi_project |
| 3 | jasný reservation domain | ✅ | `docs/intent-and-change.md` → *Reservation domain* |
| 4 | Resource + Reservation + User | ✅ | `prisma/schema.prisma`, `src/domain/types.ts` |
| 5 | meaningful Reservation states | ✅ | `DRAFT / CONFIRMED / CANCELLED` — `src/domain/types.ts` |
| 6 | create + confirm + cancel + availability | ✅ | `src/services/reservationService.ts`, `src/http/app.ts` |
| 7 | common overlap rule | ✅ | `src/domain/rules.ts::findOverlappingConfirmed` + testy |
| 8 | 1 domain-specific business rule | ✅ | no-show timeout — `src/domain/rules.ts::isExpiredDraft` |
| 9 | 1 external/system boundary | ✅ | Notification Service (definovaná boundary) — `docs/intent-and-change.md` |
| 10 | kompletní Project Frame | ✅ | `docs/intent-and-change.md` |
| 11 | 1 Q/C/R/L future pressure | ✅ | Q — Quality/Scale — `docs/intent-and-change.md` → *Selected future pressure* |
| 12 | 1 reviewed and integrated change | ✅ | PR #5 — `docs/evidence-and-evolution.md` → *C01 change + review loop* |
| 13 | 1 executed engineering spike | ✅ | Spike A (persistence) — `tests/spike/persistence.spike.test.ts` |
| 14 | spike evidence + decision | ✅ | `docs/evidence-and-evolution.md` |
| 15 | definovaný CP1 walking skeleton | ✅ | sekce *CP1 walking skeleton* výše |
