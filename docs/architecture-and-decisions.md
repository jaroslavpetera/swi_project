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
