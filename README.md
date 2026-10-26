# Hospoda Devs — rezervační systém (SWI, C02)

*„Budete pracovat nebo dostanete bídu!!!!!“*

| | |
|---|---|
| **Název týmu** | Hospoda Devs |
| **Členové** | Jaroslav Petera, Michal Křižák, Jan Kovařčík |
| **Repozitář** | https://github.com/jaroslavpetera/swi_project |

## Rozsah

Rezervace stolů v hospodě, objednávky jídla a pití a průběžný účet hosta.

Od C02 lze k potvrzené rezervaci **v jejím čase** objednat jídlo a pití
a průběžně vidět účet (zaplaceno / nezaplaceno). Podmínky jsou popsané ve
[`docs/specification.md`](docs/specification.md) jako OP-06 a pravidla BR-07/BR-08.
Předobjednávka před začátkem rezervace ani skutečné platby zatím v rozsahu nejsou.

## Dokumentace

| Dokument | Co v něm najdete |
|---|---|
| [Specifikace](docs/specification.md) | Aktuální kandidát v0.2: požadavky, operace, pravidla a odkazy na diagramy. |
| [Architektura a rozhodnutí](docs/architecture-and-decisions.md) | Tech stack, PostgreSQL, ADR-03/04, drivery a historické AS-IS mapování Confirm Reservation. |
| [C05 Detailed Design](docs/architecture-and-decisions.md#c05-detailed-design) a [evidence](docs/evidence-and-evolution.md#c05-dd-verification-evidence) | Detailní návrh Reservation Lifecycle (Confirm/Approve), testy odvozené z DD a porovnání s kódem; [checklist](docs/tasks-cv5.md). |
| [Technické dokončení C03](docs/c03-technical-completion.md) | Aktuální setup, PostgreSQL testy, převod dat, 10× zátěž a zbývající lidské body. |
| [Evidence C02](docs/c02-completion-evidence.md) | Provedené ověření, vazby na požadavky a zbývající body issue #9. |
| [Kontrola požadavků](docs/c02-requirement-review.md) | Technické review REQ-01 až REQ-08. |
| [Analýza dopadu](docs/c02-completion-impact.md) | Podklad zapsaný před dokončovacími změnami C02. |
| [Project Frame C01](docs/intent-and-change.md) | Původní vymezení domény a future pressure. |
| [Historická evidence C01/C02](docs/evidence-and-evolution.md) a [běhy části A](docs/c02-verification-runs.md) | Spike, review a výsledky před integrovaným ověřením. |
| [Archiv plánování](docs/archive/README.md) | Původní zadání, rozdělení práce a audit; nejsou aktuálním checklistem. |

## Tech stack

TypeScript (Node.js 20+) + Express + Prisma 5.20. Výchozí databáze je PostgreSQL 16;
SQLite zůstává samostatným profilem pro historický spike a regresi. Testy: Vitest.

## Setup

```powershell
npm ci
# Jen pokud .env ještě nemáš:
Copy-Item .env.example .env
npm run dev
```

`npm run dev` spustí připnutý lokální PostgreSQL 16.14 na `127.0.0.1:55432`,
vygeneruje oba Prisma klienty, aplikuje migrace, doplní menu a spustí HTTP aplikaci
na `http://localhost:3000`. Databáze zůstává v ignorovaném `.local/postgres/`;
Ctrl+C ukončí aplikaci i databázi a zachová data. Instalace balíčků vyžaduje
npm registry nebo naplněnou cache; následný běh nepotřebuje Docker ani další stahování.

Pro Docker použij `docker compose up -d db` a `npm run dev:external` se stejnou
výchozí URL. Pro jiný PostgreSQL nastav `DATABASE_URL` v `.env` a také použij
`npm run dev:external`. Oba způsoby používají stejné schéma a migrace.

Existující SQLite databázi lze převést příkazem `npm run db:import-sqlite`, dokud
`.env` obsahuje její `file:` URL a aplikace neběží. Příkaz doplní migrace, vytvoří
zálohu, přenese všechny modely a porovná celé řádky; `.env` změní až po úspěchu.
Původní DB zachová. Lišící se neprázdnou cílovou databázi odmítne přepsat.

Opakovatelné ověření na nových izolovaných databázích:

```bash
npm test                 # PostgreSQL: migrace, převod dat, build a celá sada
npm run verify:postgres  # totéž + 5 → 50 souběžných HTTP požadavků ve třech scénářích
npm run verify:c02
npm run verify:docs
```

`verify:c02` připraví novou SQLite DB a spustí zachovanou regresi. PostgreSQL
specifické testy v tomto profilu výslovně přeskočí. Výsledky jsou v
[PostgreSQL reportu](docs/evidence/c03-postgres-verification.json),
[SQLite reportu](docs/evidence/c03-sqlite-verification.json) a
[kontrole přenosu dat](docs/evidence/c03-data-transfer-verification.json).
Historické reporty C02 se nepřepisují. Ověření nepoužívá vývojovou DB z `.env`;
dočasné databáze zůstanou v systémovém temp adresáři pro diagnostiku a servery se ukončí.

Na `http://localhost:3000` běží responzivní rozhraní pro obsluhu hospody:
rezervace s hledáním hosta a filtrem stavů, ověření dostupnosti, objednávky
a průběžný účet, správa hostů a stolů. Nejdříve přidej hosta a stůl v sekci
**Hosté a stoly**, potom vytvoř rezervaci a potvrď ji v přehledu.
Potvrzení i případné schválení musí proběhnout dříve než 30 minut před návštěvou.
U stolu lze zapnout „Rezervace vyžadují schválení obsluhou“; potvrzení pak
zpřístupní **Schválit / Zamítnout**. Objednávat lze jen během potvrzené návštěvy.
Účet rozlišuje objednáno, podáno a zaplaceno; označení zaplacení eviduje stav,
neprovádí skutečnou platbu. Tlačítko **Načíst data** obnoví data ze serveru.

Frontend zůstává statické HTML/CSS/JavaScript nad stávajícím REST API, bez
nového frameworku nebo samostatného buildu. Návrh, snímky obrazovek a ověření
jsou v [dokumentaci frontendu](docs/frontend.md).

Opakovatelné ověření frontendu ve skutečném prohlížeči:

```bash
npx playwright install chromium --only-shell  # jednorázové stažení prohlížeče
npm run test:frontend
```

Test spustí izolovanou PostgreSQL databázi a HTTP server, projde rezervace,
schvalování a objednávky, ověří rozložení od 320 do 1440 px a uloží snímky
do `docs/evidence/frontend/`. Vývojovou databázi z `.env` nepoužívá.

Historické ověření instalace z 21. 9. 2026 je v evidenci C01. Aktuální integrované
ověření C02, počty testů a vazby na požadavky jsou v
[`docs/c02-completion-evidence.md`](docs/c02-completion-evidence.md).
Specifikace v0.2 je schválená baseline (křížové review a schválení Jarda + Michal
26. 10. 2026); původní pořadí analýzy C02 je přiznaná procesní mezera, viz
[uzavření procesních bodů](docs/c02-completion-evidence.md#uzavření-procesních-bodů-26-10-2026).

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

End-to-end cesta definovaná v C01 pro CP1 (po C03 / před C04):

```
POST /reservations
→ validate   (Zod schema: resourceId, userId, startsAt < endsAt)
→ persist    (Prisma → DB, stav DRAFT)
→ return reservation ID   (201, { id, state })
→ automated check         (tests/spike/persistence.spike.test.ts + tests/domain/rules.test.ts)
```

Základ této cesty (validate → persist → return ID) je již implementován v `src/http/app.ts` a
ověřen v rámci C01 engineering spike. V C02 běží i Confirm, Cancel, Availability,
Approve/Reject a objednávky. Garance souběhu je nyní opakovatelně ověřena na
PostgreSQL 16 včetně 10× zátěže. ADR-04 zachovává expiraci při Approve podle R-16;
lidské review C03 A9/HC3 dokončil Honza 11. 10. 2026
([záznam](docs/architecture-and-decisions.md#review-a9--hc3--technická-kontrola)).
Křížové review C02 a schválení baseline v0.1/v0.2 doplněny 26. 10. 2026.

## Historické splnění C01 — kde co najdete

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
