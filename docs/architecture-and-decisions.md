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
- Repository/service vrstva (`src/repositories`, `src/services`) na volbě DB nezávisí — používají
  jen Prisma Client, takže přechod nezasahuje do byznys logiky.
- Tým by měl přechod na Postgres provést nejpozději před CP1 walking skeleton (C03/C04), protože
  SQLite nemá stejné chování při souběžném zápisu (relevantní pro future pressure Q níže).

## Future pressure: Q — Quality / Scale

Zvolená konkrétní pressure a zdůvodnění jsou zapsané v `docs/intent-and-change.md`
(sekce *Selected future pressure*) — shrnutí: 10× víc souběžných rezervací (páteční večer / velká
sportovní akce) zvyšuje riziko race condition v overlap-check při `confirm`. V C01 tuto pressure
**neimplementujeme**, jen ji evidujeme jako známé riziko pro pozdější iterace (kandidát na řešení:
DB transakce s `SELECT ... FOR UPDATE` / unique constraint na (resource, confirmed, no-overlap),
což u SQLite navíc není 1:1 přenositelné — další důvod pro včasný přechod na Postgres).
