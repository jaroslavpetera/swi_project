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

> **Stav 5. 10. 2026:** části H1–H4 (A3, A5, A6, A8) nakonec dopsal Jarda místo Honzy.
> Honza je proto **reviewuje** (místo psaní) a schvaluje celý výstup na S2; vzájemné review
> A1–A8 tím zůstává zachované.

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
- [x] Tabulka *Položka / Hodnota*: Scénář = OP-03 Confirm Reservation; Požadavky = REQ-03, REQ-04;
      Pravidla = BR-01, BR-02, BR-04, BR-05; Baseline = v0.2.
- [x] Jen reference s odkazem do `specification.md`, žádné přepisování spec.

### J2 — A2: Mapování hlavního úspěšného průchodu na kód
- [x] Vzít *Main scenario* z OP-03 („locate DRAFT; check BR-04; inspect BR-05; … check BR-02 and persist CONFIRMED“).
- [x] Tabulka *Krok scénáře / Realizace v kódu / Doklad* minimálně pro kroky:
  - přijmout požadavek na potvrzení (route v `app.ts`)
  - načíst Reservation
  - ověřit, že přechod je povolený (stav DRAFT)
  - ověřit BR-04 (no-show cutoff)
  - vyhodnotit BR-05 (approval routing) — v hlavním průchodu = resource **nevyžaduje** schválení
  - vyhodnotit konflikt (BR-02)
  - změnit stav na CONFIRMED
  - uložit výsledek
  - vrátit odpověď (200)
- [x] Doklad = soubor + třída/metoda, ideálně i konkrétní test (název `it(...)`), nebo runtime výstup.
- [x] **Nedávat** gettery, `toRecord`, `asyncRoute`, Zod parsování apod., pokud nemají vliv na chování.
- [x] Pozor: „změnit stav“ a „uložit“ jsou u nás **jedna operace** (`transition()` = podmíněný `updateMany`) — zapsat to tak, jak to v kódu je, ne podle šablony.

### J3 — A4: Hlavní části implementace
- [x] 3–7 částí na **stejné úrovni detailu** (u nás malá aplikace → konkrétní třídy/moduly). Návrh:
  - Reservation API — `createApp` / route `POST /reservations/:id/confirm` + mapování chyb na HTTP
  - Reservation logic — `ReservationService`
  - Domain rules — `rules.ts` (`isExpiredDraft`, `findOverlappingConfirmed`)
  - Persistence — `ReservationRepository` (+ Prisma client)
- [x] Tabulka *Část / Typ-obsah / Role v tomto scénáři / Doklad*.
- [x] U skupin vypsat, které třídy/funkce obsahují.
- [x] Na S1 předat Honzovi finální názvy bloků.

### J4 — A7: AS-IS strukturální diagram
- [x] Obdélník **Application code**, uvnitř 3–7 bloků z A4, každý s názvem a krátkou rolí.
- [x] Databáze (SQLite přes Prisma) a případné externí systémy **mimo** Application code.
- [x] Jen vazby skutečně použité v Confirm; každá důležitá šipka popsaná operací
      (`confirm(id)`, `findById`, `findResourceById`, `findForResource`, `transition(CONFIRMED)`, `read/write` …).
- [x] Směr šipky = směr volání/závislosti (ověřit podle importů a konstruktorů, `src/index.ts` → `createApp`).
- [x] Neslučovat jednu třídu s celou vrstvou bez vysvětlení; když jsou úrovně různé, označit typ bloku (class / module / database / external system).
- [x] Pod diagram seznam tříd v každém bloku.
- [x] Formát: ASCII v markdownu (jako v zadání), nebo Mermaid / soubor v `docs/diagrams/` s odkazem.
- [x] Zkontrolovat proti A6 od Honzy — v diagramu nesmí být závislost, která v A6 není (a naopak).

---

## Honza — větve, stav, pravidla, závislosti

### H1 — A3: Alternativní / chybová větev
- [x] Vybrat **jednu** důležitou větev OP-03. Doporučení: **overlap při přímém Confirm → 409, rezervace zůstává DRAFT** (BR-02).
      Alternativy: BR-04 expirace → CANCELLED + 410; souběžný loser → 409 (REQ-04).
- [x] Tabulka *Co říká v0.2 / Kde se podmínka zjistí / Kde se rozhodne výsledek / Co dostane volající*.
- [x] Co dostane volající ověřit v mapování chyb v `app.ts` (status + tělo) a testem.
- [x] **Rozdíly spec ↔ implementace** zapsat jako samostatnou tabulku *Specifikace / Implementace / Doklad*.
      Kandidáti k ověření (nic z toho nezapisovat bez kontroly v kódu/testu):
  - overlap se zjišťuje na dvou místech a vede na **dvě různé výjimky** (`OverlapError` ve službě, `ReservationConflictError` v repository) — vrací obě stejný status a tělo?
  - `resource?.requiresApproval` — co se stane, když Resource neexistuje (spadne to do přímého Confirm)?
  - BR-04: stav CANCELLED se **uloží před** vrácením chyby 410 — odpovídá spec?
  - pořadí kontrol (stav DRAFT → BR-04 → BR-05 → BR-02) vs. pořadí v Main scenario.
- [x] Pokud žádný rozdíl není, napsat to výslovně („rozdíl nenalezen, ověřeno …“).

### H2 — A5: Stav, změna stavu, jedno pravidlo
- [x] **Stav** — tabulka *Otázka / Odpověď / Doklad*:
  - kde je stav Reservation trvale uložen (tabulka `Reservation`, sloupec `state` String, SQLite — `schema.prisma`)
  - který kód **rozhoduje** a který **provádí** přechod DRAFT → CONFIRMED (rozlišit!)
- [x] **Pravidlo BR-02** (exkluzivní Resource) — tabulka:
  - kde se zjistí podmínka
  - kde se podle výsledku rozhodne
  - kde se provede výsledná změna stavu
- [x] Zadání: *„Pokud stejné rozhodnutí dělá více míst, uveďte všechna.“* U nás BR-02 hlídá
      `findOverlappingConfirmed` ve službě **i** predikát v `ReservationRepository.transition()` (a totéž v `approveReservation`). Uvést všechna místa a která z nich je skutečná pojistka (viz ADR o atomických přechodech).

### H3 — A6: Relevantní závislosti
- [x] Tabulka *Závislost / Kde se napojuje / Která část zná technické API / Doklad*.
- [x] Databáze: SQLite přes Prisma — kde se vytváří `PrismaClient` (`src/index.ts`), kdo ho drží.
- [x] Notification Service, IdP: ověřit v kódu, zda existují. Pokud ne, uvést řádek s „v současné implementaci není“ + doklad (kde by se napojily / R-7 v spec), ať je jasné, že to není opomenutí.
- [x] Nevypisovat Express, Zod, Vitest ani jiné běžné knihovny.

### H4 — A8: Otázka pro další C03
- [x] Jedna otázka vycházející z konkrétního nálezu v A2–A7, tabulka *Otázka / Doklad / Proč je důležitá*.
- [x] Kandidát: *Zachová se garance REQ-04/BR-02 po přechodu na PostgreSQL (READ COMMITTED), když dnes stojí na tom, že SQLite serializuje zápisy a overlap je v jednom `updateMany`?*
      Doklad: `ReservationRepository.transition()` + komentář v něm + ADR. Proč: C03 driver (změna DB, 10× zátěž).
- [x] Jiný kandidát podle nálezů z A3 (např. duplicitní kontrola BR-02 ve službě a repository) — vybrat jednu, nejsilněji podloženou.
- [x] Před zapsáním probrat s Jardou (S2).

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
| Hlavní kroky scénáře jsou namapované na konkrétní implementaci | A2 | Jarda | [x] |
| Jedna důležitá alternative/failure větev je dohledaná | A3 | Honza | [x] |
| Případný rozdíl v0.2 ↔ implementace je zaznamenaný | A3 | Honza | [x] |
| Hlavní části jsou identifikované na srovnatelné úrovni detailu | A4 | Jarda | [x] |
| Je jasné, kde je stav uložen, kde se mění a kde se vynucuje jedno pravidlo | A5 | Honza | [x] |
| Relevantní externí/perzistenční závislosti jsou dohledané | A6 | Honza | [x] |
| AS-IS diagram odpovídá skutečnému kódu | A7 | Jarda | [x] |
| Existuje jedna evidencí podložená otázka pro další C03 | A8 | Honza | [x] |
| Reference scénáře (scénář, REQ, BR, baseline) | A1 | Jarda | [x] |
| Všechna tvrzení ověřena (AI pravidlo) — čeká na review Honzy | A9 | oba | [ ] |
| Vše je v `docs/architecture-and-decisions.md` + odkaz z README | — | oba | [x] |

---
---

# C03 hlavní část (Architecture) — zbývající práce

Zadání: *SWI C03 — Architecture* (`SWI_C03_students_bilingual_v10.html`), postup
AS-IS → drivers → … → ADR → TO-BE → realizace → delta → implementace → ověření.

## Co už je hotové (5. 10. 2026)

| Bod | Stav | Kde |
|---|---|---|
| B drivery (D1–D4) | hotovo | `architecture-and-decisions.md` → *C03 — Architecture* |
| C1 doménový model, C2 odpovědnosti | hotovo | tamtéž |
| D otázka, E1–E3 alternativy, F **ADR-03** (zvolena B: alokace v Reservation Lifecycle pod zámkem Resource) | hotovo | tamtéž |
| G1–G4 pohledy, H1 sekvence, H2 třídní diagram, I cross-view | hotovo | tamtéž |
| K implementace | **kód hotový**, commit `c2c9a7d`; zápis do dokumentace chybí (J, K) | `src/repositories/reservationRepository.ts`, `src/services/reservationService.ts`, `src/services/availabilityService.ts`, `tests/services/concurrency.test.ts` |

Ověřeno: `tsc --noEmit` čisté; celá sada **89/89** na nové izolované SQLite DB, 3× po sobě.

### Důležité nálezy, které musí projít do dokumentace

1. **Na SQLite nelze zámek Resource testem odlišit.** Prisma otevírá interaktivní transakce
   `BEGIN IMMEDIATE` (ověřeno logem SQL dotazů) → celé transakce jsou serializované už samy.
   Mutační test (zámek zakomentován) prošel → na SQLite mechanismus nedokázán.
   **Aktualizace:** ověřeno na PostgreSQL 18.4 ručním během (L1) — bez zámku 8/9 testů souběhu selže.
2. **Vývojová DB z `.env` nemá migraci `20260921131639_add_orders`** → `tests/spec/op06-orders.test.ts`
   na ní padá (tabulka `MenuItem` neexistuje). Nesouvisí se změnou. Testy pouštět na izolované DB
   (viz níže) nebo si lokálně spustit `npx prisma migrate dev`.
3. **Zastaralý Prisma client** → `tsc` hlásil chyby v objednávkách; po `npx prisma generate` čisté.

Jak pustit testy na čisté DB (bez zásahu do `dev.db`):

```bash
export DATABASE_URL="file:/tmp/c03verify/verify.db"; mkdir -p /tmp/c03verify
npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

## Rozdělení

| | Jarda | Honza |
|---|---|---|
| Těžiště | **Delta, implementace, ověření chování** | **Architektonické pravidlo, evidence, review** |
| Body | J, K (zápis), L1, ověření na PostgreSQL | L2, M, review B–K, finální checklist |
| Reviewuje | L2, M | J, K, L1 + celý návrh B–I a kód |

Pořadí: J → (K, L1 ‖ L2) → M → review → PR. L2 a L1 jdou dělat paralelně.

## Jarda

### JC1 — J: AS-IS → TO-BE delta
- [x] Tabulka *Oblast / AS-IS / TO-BE / Akce* v `architecture-and-decisions.md`. Návrh řádků:
  - rozhodnutí BR-02: služba + `none` predikát v repository → jen Lifecycle pod zámkem — CHANGE
  - transakce: žádná → `inResourceTransaction` — CHANGE
  - Confirm/Approve/Reject/Cancel mimo transakci → v transakci — CHANGE
  - chybová cesta konfliktu: `OverlapError` / `ReservationConflictError` → `OverlapError` (409) — CHANGE
  - `checkAvailability` v `ReservationService` → `AvailabilityService` — CHANGE
  - guard očekávaného stavu v UPDATE, `errorMiddleware`, `rules.ts` — KEEP
  - zámek Resource na PostgreSQL — **VERIFY** (nález 1)
  - „stav Reservation mění jen Lifecycle“ — VERIFY → L2 (Honza)
- [x] Do Části A (A2–A7) připsat poznámku, že popisuje stav **před** `c2c9a7d` (AS-IS zůstává AS-IS).

### JC2 — K: zápis implementace
- [x] Krátká sekce *K. Implementace*: co se změnilo (4 soubory), proč se změnily testy souběhu
      (poražený nyní rozhoduje nad commitnutým stavem → doménová chyba 409 místo
      `ReservationConflictError`; V-04R.3 připouští serializované pořadí confirm → cancel), commit `c2c9a7d`.
- [x] Projít diff `git show c2c9a7d` a potvrdit, že sedí s H1/H2 (názvy metod `ReservationTx`, `ReservationStore`).
- [x] Doplnit do ADR-03 → *Přijaté negativní důsledky* nález 1 (`BEGIN IMMEDIATE`).
- [ ] Na konci vytvořit tag, např. `c03-architecture`, a zapsat ho do M (spolu s Honzou).

### JC3 — L1: ověření chování
- [x] Na izolované DB spustit relevantní C02 testy a vyplnit tabulku *Ověření / Výsledek / Doklad*:
  - success path — `confirms a DRAFT reservation with no conflict` (`tests/http/app.test.ts`), runtime curl 200
  - alternative/failure — overlap → 409 + DRAFT (`tests/http/app.test.ts`), BR-04 `V-03.3`
  - boundary/concurrency — `V-04R.1`–`V-04R.8`, `V-04R.6` (dotyk intervalů)
- [x] Zapsat přesný příkaz, datum a počet testů (aktuálně 89/89).

### JC4 — ověření ADR-03 na PostgreSQL (doporučeno, ne povinné zadáním)
- [x] Docker Desktop → *Settings → Resources → WSL Integration* → zapnout pro tuto distribuci.
- [x] `docker compose up -d db`; dočasně `provider = "postgresql"` + `DATABASE_URL` na compose DB;
      `npx prisma db push`; spustit `tests/services/concurrency.test.ts` **se zámkem i bez něj**
      (zakomentovat `$executeRaw` v `inResourceTransaction`). Očekávání: bez zámku spadne `V-04R.1`.
- [x] Vše vrátit (`git checkout prisma/schema.prisma`), výsledek zapsat do L1 a ADR-03.
- [x] ~~Pokud nestihneme~~ — nebylo třeba, ověřeno přes `embedded-postgres` (Docker ve WSL nedostupný): v J nechat VERIFY a v M uvést jako zbývající riziko.

## Honza

### HC1 — L2: jedno architektonické pravidlo + opakovatelná kontrola
- [x] Pravidlo z ADR-03 / G2: **„Stav Reservation smí měnit pouze Reservation Lifecycle
      (`ReservationService`) přes `ReservationTx.transition()` uvnitř `inResourceTransaction`.“**
- [x] Kontrola jako Vitest test, např. `tests/architecture/lifecycle-ownership.test.ts`, který projde
      `src/**/*.ts` a selže, když:
  - `.reservation.update` / `.reservation.updateMany` / `.reservation.upsert` je mimo
    `src/repositories/reservationRepository.ts`;
  - `.transition(` na rezervaci je volané mimo `src/services/reservationService.ts`
    (pozor: `OrderService` má vlastní `transition` pro objednávky — odlišit);
  - `src/http/**` importuje `repositories/` jinak než pro sestavení v `createApp`.
- [x] Ověřit, že kontrola **selže**, když pravidlo porušíte (dočasně přidat zakázané volání), a zapsat to.
- [x] Zapsat *Architektonické pravidlo / Kontrola / Výsledek*.

### HC2 — M: evidence
- [x] Do `docs/evidence-and-evolution.md` přidat `## C03 — Architecture Evidence` přesně podle šablony
      ze zadání (Baseline, Part A, Drivers, Decision question, Alternatives, Scenario walkthrough, ADR,
      Views ×7, Cross-view issues, Delta, Implementation changes, Behaviour verification,
      Architecture conformance rule + result, Remaining uncertainty / risk, Commit/tag).
- [x] Remaining uncertainty musí obsahovat nález 1 (PostgreSQL neověřeno, pokud JC4 neproběhne)
      a lazy expiraci D3 (nevyřešeno, mimo ADR-03).
- [x] Odkazy vést do sekcí `architecture-and-decisions.md`, nic nekopírovat.

> **Stav:** HC1 a HC2 dopsal Jarda (s AI). HC3 musí udělat Honza sám — AI review nenahrazuje lidské (A9).
> AI kontrola proti oběma zadáním našla a opravila: H2 ↔ kód, kontrolu existence Resource v API (J, K)
> a doplnila runtime ověření po změně (L1). Projít, zda je rozdílů víc.

### HC3 — review
- [ ] Projít Část A (A1–A8) i C03 B–I a kód `c2c9a7d` — každé tvrzení musí mít doklad (A9: texty
      psal AI, musí je ověřit člověk). Nalezené chyby opravit nebo zapsat.
- [ ] Odškrtnout A9 v checklistu Části A výše.

## Hotovo je, když (C03 hlavní část)

| Kritérium zadání | Bod | Vlastník | ✔ |
|---|---|---|---|
| 3–5 driverů podložených požadavky/evidencí | B | hotovo | [x] |
| Doménový model konzistentní s C02 | C1 | hotovo | [x] |
| Odpovědnosti explicitní s ownership požadavky | C2 | hotovo | [x] |
| Jedna decision question, dvě materiálně odlišné alternativy | D, E1 | hotovo | [x] |
| Alternativy porovnané vůči driverům a prošlé stejným scénářem | E2, E3 | hotovo | [x] |
| ADR s rozhodnutím, negativními důsledky a reconsider when | F | hotovo (nález 1 doplněn) | [x] |
| Context, static, state ownership, runtime si neodporují | G1–G4 | hotovo | [x] |
| Scénář realizovaný sequence diagramem | H1 | hotovo | [x] |
| Design class diagram podporuje stejnou realizaci | H2 | hotovo | [x] |
| Cross-view kontrola před změnou kódu | I | hotovo | [x] |
| Delta CHANGE / KEEP / VERIFY | J | Jarda | [x] |
| Relevantní C02 verification po změně prochází | K, L1 | Jarda | [x] |
| Opakovatelná kontrola architektonického pravidla | L2 | Honza | [x] |
| Evidence a přesný commit/tag | M | Honza (+ Jarda tag) — evidence hotová, **tag chybí** | [ ] |
| Lidské review všech AI textů | HC3 | Honza | [ ] |
