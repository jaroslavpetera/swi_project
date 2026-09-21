# Project Frame

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
