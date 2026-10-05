# C03 Část A — rozdělení práce (Jarda + Honza)

Zadání: *SWI C03 — Část A: Zmapujte současnou realizaci jednoho scénáře* (úterní předstih).
Vstup: Specification Baseline v0.2 ([`specification.md`](specification.md)) a běžící aplikace z C02.
**Jediný výstup:** nové sekce v [`architecture-and-decisions.md`](architecture-and-decisions.md).

| | Jarda (Jaroslav Petera) | Honza (Jan Kovařčík) |
|---|---|---|
| Těžiště | **Hlavní průchod a struktura** — co se při úspěšném Confirm skutečně volá a z jakých částí se to skládá | **Větve, stav, pravidla, závislosti** — kde se rozhoduje, kde je stav, co se děje při chybě |
| Vlastní body | A1, A2, A4, A7 | A3, A5, A6, A8 |
| Reviewuje | A3, A5, A6, A8 | A1, A2, A4, A7 |

Společné: výběr scénáře (sync 0), sjednocení názvů bloků (sync 1), finální kontrola „Hotovo je, když“ (sync 2).
A9 (pravidlo pro AI) platí pro oba a pro všechny body.

---

## Zvolený scénář (navrženo — potvrdit na sync 0)

**OP-03 Confirm Reservation** — zadáním doporučený a u nás zahrnuje i větvení BR-05 (approval),
takže není potřeba brát OP-05 zvlášť.

- Spec: [`specification.md` → OP-03](specification.md) (REQ-03, REQ-04; BR-01/02/04/05)
- Vstup HTTP: `POST /reservations/:id/confirm` v `src/http/app.ts`
- Logika: `ReservationService.confirmReservation()` v `src/services/reservationService.ts`
- Pravidla: `src/domain/rules.ts` (`isExpiredDraft`, `findOverlappingConfirmed`)
- Perzistence: `ReservationRepository` v `src/repositories/reservationRepository.ts`, Prisma + SQLite (`prisma/schema.prisma`)
- Testy jako doklad: `tests/services/reservationService.test.ts`, `tests/services/concurrency.test.ts`,
  `tests/http/app.test.ts`, `tests/spec/c02-completion.test.ts`

---

## Sync body

| # | Kdy | Kdo | Co |
|---|---|---|---|
| S0 | na začátku | oba | Potvrdit scénář OP-03 a seznam REQ/BR (A1). Domluvit, že všechny tabulky budou v `architecture-and-decisions.md` pod jednou sekcí `## C03 Part A — AS-IS: Confirm Reservation`. |
| S1 | po A2 + A3 | oba | Sjednotit **názvy a hranice bloků** (A4) — Honza je používá v A5/A6, Jarda v A7. Bez toho diagram a tabulky nebudou sedět. |
| S2 | na konci | oba | Projít checklist „Hotovo je, když“ (níže), vzájemné review, merge. |

---

## Jarda — hlavní průchod a struktura

### J1 — A1: Reference scénáře
- [ ] Tabulka *Položka / Hodnota*: Scénář = OP-03 Confirm Reservation; Požadavky = REQ-03, REQ-04;
      Pravidla = BR-01, BR-02, BR-04, BR-05; Baseline = v0.2.
- [ ] Jen reference s odkazem do `specification.md`, žádné přepisování spec.

### J2 — A2: Mapování hlavního úspěšného průchodu na kód
- [ ] Vzít *Main scenario* z OP-03 („locate DRAFT; check BR-04; inspect BR-05; … check BR-02 and persist CONFIRMED“).
- [ ] Tabulka *Krok scénáře / Realizace v kódu / Doklad* minimálně pro kroky:
  - přijmout požadavek na potvrzení (route v `app.ts`)
  - načíst Reservation
  - ověřit, že přechod je povolený (stav DRAFT)
  - ověřit BR-04 (no-show cutoff)
  - vyhodnotit BR-05 (approval routing) — v hlavním průchodu = resource **nevyžaduje** schválení
  - vyhodnotit konflikt (BR-02)
  - změnit stav na CONFIRMED
  - uložit výsledek
  - vrátit odpověď (200)
- [ ] Doklad = soubor + třída/metoda, ideálně i konkrétní test (název `it(...)`), nebo runtime výstup.
- [ ] **Nedávat** gettery, `toRecord`, `asyncRoute`, Zod parsování apod., pokud nemají vliv na chování.
- [ ] Pozor: „změnit stav“ a „uložit“ jsou u nás **jedna operace** (`transition()` = podmíněný `updateMany`) — zapsat to tak, jak to v kódu je, ne podle šablony.

### J3 — A4: Hlavní části implementace
- [ ] 3–7 částí na **stejné úrovni detailu** (u nás malá aplikace → konkrétní třídy/moduly). Návrh:
  - Reservation API — `createApp` / route `POST /reservations/:id/confirm` + mapování chyb na HTTP
  - Reservation logic — `ReservationService`
  - Domain rules — `rules.ts` (`isExpiredDraft`, `findOverlappingConfirmed`)
  - Persistence — `ReservationRepository` (+ Prisma client)
- [ ] Tabulka *Část / Typ-obsah / Role v tomto scénáři / Doklad*.
- [ ] U skupin vypsat, které třídy/funkce obsahují.
- [ ] Na S1 předat Honzovi finální názvy bloků.

### J4 — A7: AS-IS strukturální diagram
- [ ] Obdélník **Application code**, uvnitř 3–7 bloků z A4, každý s názvem a krátkou rolí.
- [ ] Databáze (SQLite přes Prisma) a případné externí systémy **mimo** Application code.
- [ ] Jen vazby skutečně použité v Confirm; každá důležitá šipka popsaná operací
      (`confirm(id)`, `findById`, `findResourceById`, `findForResource`, `transition(CONFIRMED)`, `read/write` …).
- [ ] Směr šipky = směr volání/závislosti (ověřit podle importů a konstruktorů, `src/index.ts` → `createApp`).
- [ ] Neslučovat jednu třídu s celou vrstvou bez vysvětlení; když jsou úrovně různé, označit typ bloku (class / module / database / external system).
- [ ] Pod diagram seznam tříd v každém bloku.
- [ ] Formát: ASCII v markdownu (jako v zadání), nebo Mermaid / soubor v `docs/diagrams/` s odkazem.
- [ ] Zkontrolovat proti A6 od Honzy — v diagramu nesmí být závislost, která v A6 není (a naopak).

---

## Honza — větve, stav, pravidla, závislosti

### H1 — A3: Alternativní / chybová větev
- [ ] Vybrat **jednu** důležitou větev OP-03. Doporučení: **overlap při přímém Confirm → 409, rezervace zůstává DRAFT** (BR-02).
      Alternativy: BR-04 expirace → CANCELLED + 410; souběžný loser → 409 (REQ-04).
- [ ] Tabulka *Co říká v0.2 / Kde se podmínka zjistí / Kde se rozhodne výsledek / Co dostane volající*.
- [ ] Co dostane volající ověřit v mapování chyb v `app.ts` (status + tělo) a testem.
- [ ] **Rozdíly spec ↔ implementace** zapsat jako samostatnou tabulku *Specifikace / Implementace / Doklad*.
      Kandidáti k ověření (nic z toho nezapisovat bez kontroly v kódu/testu):
  - overlap se zjišťuje na dvou místech a vede na **dvě různé výjimky** (`OverlapError` ve službě, `ReservationConflictError` v repository) — vrací obě stejný status a tělo?
  - `resource?.requiresApproval` — co se stane, když Resource neexistuje (spadne to do přímého Confirm)?
  - BR-04: stav CANCELLED se **uloží před** vrácením chyby 410 — odpovídá spec?
  - pořadí kontrol (stav DRAFT → BR-04 → BR-05 → BR-02) vs. pořadí v Main scenario.
- [ ] Pokud žádný rozdíl není, napsat to výslovně („rozdíl nenalezen, ověřeno …“).

### H2 — A5: Stav, změna stavu, jedno pravidlo
- [ ] **Stav** — tabulka *Otázka / Odpověď / Doklad*:
  - kde je stav Reservation trvale uložen (tabulka `Reservation`, sloupec `state` String, SQLite — `schema.prisma`)
  - který kód **rozhoduje** a který **provádí** přechod DRAFT → CONFIRMED (rozlišit!)
- [ ] **Pravidlo BR-02** (exkluzivní Resource) — tabulka:
  - kde se zjistí podmínka
  - kde se podle výsledku rozhodne
  - kde se provede výsledná změna stavu
- [ ] Zadání: *„Pokud stejné rozhodnutí dělá více míst, uveďte všechna.“* U nás BR-02 hlídá
      `findOverlappingConfirmed` ve službě **i** predikát v `ReservationRepository.transition()` (a totéž v `approveReservation`). Uvést všechna místa a která z nich je skutečná pojistka (viz ADR o atomických přechodech).

### H3 — A6: Relevantní závislosti
- [ ] Tabulka *Závislost / Kde se napojuje / Která část zná technické API / Doklad*.
- [ ] Databáze: SQLite přes Prisma — kde se vytváří `PrismaClient` (`src/index.ts`), kdo ho drží.
- [ ] Notification Service, IdP: ověřit v kódu, zda existují. Pokud ne, uvést řádek s „v současné implementaci není“ + doklad (kde by se napojily / R-7 v spec), ať je jasné, že to není opomenutí.
- [ ] Nevypisovat Express, Zod, Vitest ani jiné běžné knihovny.

### H4 — A8: Otázka pro další C03
- [ ] Jedna otázka vycházející z konkrétního nálezu v A2–A7, tabulka *Otázka / Doklad / Proč je důležitá*.
- [ ] Kandidát: *Zachová se garance REQ-04/BR-02 po přechodu na PostgreSQL (READ COMMITTED), když dnes stojí na tom, že SQLite serializuje zápisy a overlap je v jednom `updateMany`?*
      Doklad: `ReservationRepository.transition()` + komentář v něm + ADR. Proč: C03 driver (změna DB, 10× zátěž).
- [ ] Jiný kandidát podle nálezů z A3 (např. duplicitní kontrola BR-02 ve službě a repository) — vybrat jednu, nejsilněji podloženou.
- [ ] Před zapsáním probrat s Jardou (S2).

---

## A9 — pravidlo pro AI (oba)

- AI smí pomáhat s navigací, návrhem trace a první verzí diagramu.
- Do `architecture-and-decisions.md` jde **jen tvrzení ověřené** v kódu, testu nebo runtime.
- Každý řádek tabulky musí mít konkrétní doklad (soubor + metoda / test / výstup). Reviewer to namátkově kontroluje.
- Hinty v tomto souboru jsou jen ukazatele — nejsou ověřenou evidencí.

---

## Hotovo je, když (kontrola na S2)

| Kritérium zadání | Bod | Vlastník | ✔ |
|---|---|---|---|
| Hlavní kroky scénáře jsou namapované na konkrétní implementaci | A2 | Jarda | [ ] |
| Jedna důležitá alternative/failure větev je dohledaná | A3 | Honza | [ ] |
| Případný rozdíl v0.2 ↔ implementace je zaznamenaný | A3 | Honza | [ ] |
| Hlavní části jsou identifikované na srovnatelné úrovni detailu | A4 | Jarda | [ ] |
| Je jasné, kde je stav uložen, kde se mění a kde se vynucuje jedno pravidlo | A5 | Honza | [ ] |
| Relevantní externí/perzistenční závislosti jsou dohledané | A6 | Honza | [ ] |
| AS-IS diagram odpovídá skutečnému kódu | A7 | Jarda | [ ] |
| Existuje jedna evidencí podložená otázka pro další C03 | A8 | Honza | [ ] |
| Reference scénáře (scénář, REQ, BR, baseline) | A1 | Jarda | [ ] |
| Všechna tvrzení ověřena (AI pravidlo) | A9 | oba | [ ] |
| Vše je v `docs/architecture-and-decisions.md` + odkaz z README | — | oba | [ ] |
