# C05 Detailed Design — rozdělení práce (Jarda + Honza + Michal)

> ## ✅ C05 uzavřeno (stav 26. 10. 2026)
>
> Kroky 1–6 jsou hotové a sloučené do `main` (PR #20, `055917c`). Přehled commitů a uzavření:
> [C05 Commit/tag](evidence-and-evolution.md#committag) a [Uzavření C05](evidence-and-evolution.md#uzavření-c05-s3).
>
> | # | Úkol | Kdo | Detail |
> |---|---|---|---|
> | 1 | ~~**Lidské review A9**~~ — hotovo 26. 10. 2026 (Jarda, Honza) | Jarda, Honza | [Lidské review A9](evidence-and-evolution.md#lidské-review-a9) |
> | 2 | ~~Pushnout tag `c05-detailed-design`~~ — hotovo 26. 10. 2026 (→ `055917c`) | Jarda | — |

Zadání: *SWI C05 — Detailed Design: od architektury k návrhovému záměru a unit testům*.
Vstup: C03 architektura v [`architecture-and-decisions.md`](architecture-and-decisions.md)
(C2 odpovědnosti, ADR-03, G2/G3, H1, H2) a aktuální kód na `main` (`7ba6a05`).
Větev: **`c05`**. Tag na konci: **`c05-detailed-design`**.

**Výstupy (jen dvě místa):**

- [`architecture-and-decisions.md`](architecture-and-decisions.md) → nová sekce `## C05 Detailed Design`
- [`evidence-and-evolution.md`](evidence-and-evolution.md) → nová sekce `## C05 DD Verification Evidence`
- \+ kód a testy, které z DD vyplynou (krok 6)

> **Hlavní past zadání:** „DD je technický základ pro implementaci a unit verification. **Není to
> zpětný popis hotového kódu.**“ Lifecycle už z C03 implementovaný máme. Proto DD píšeme jako
> **návrhový záměr** (včetně rozhodnutí, která současný kód ještě nesplňuje — viz *Návrhové
> změny k rozhodnutí*), a **commit s DD musí v historii předcházet commitu s implementací**.
> Rozdíly design ↔ kód pak v kroku 6 vědomě rozhodneme, ne „opravíme diagram podle kódu“.

Pravidlo pro AI z C03 (A9) platí dál: každý text/kód připravený AI musí projít lidským review
a reviewer to zapíše do evidence.

---

## Zvolená jednotka (navrženo — potvrdit na S0)

**Reservation Lifecycle — rozhodnutí o přechodu Confirm / Approve** (prvek z C03 G2, třída
`ReservationService`, odpovědnosti R2, R3, R5, R6 z C2).

Proč právě tahle: obsahuje skutečnou logiku (stavový automat, BR-02 alokace, BR-04/05/06 lhůty
a routing, chování při chybách včetně „zapiš a pak vyhoď“), má jasnou hranici z ADR-03 a jedno
významné rozhraní (`ReservationStore` / `ReservationTx`).

| Položka | Hodnota |
|---|---|
| Architecture unit | Reservation Lifecycle (C03 G2, ADR-03) |
| Požadavky | REQ-03, REQ-04, REQ-06 |
| Scénáře | OP-03 Confirm, OP-05 Approve/Reject (Cancel OP-04 jen okrajově) |
| Business pravidla | BR-01, BR-02, BR-04, BR-05, BR-06 |
| Kód | `src/services/reservationService.ts`, `src/domain/rules.ts`, `src/repositories/reservationRepository.ts` (port) |

Záložní varianta, kdyby nám vyučující Lifecycle neuznal kvůli tomu, že je už „hotový“:
**Ordering (OP-06)** — `orderService.ts` + BR-07/BR-08; v C03 nebyl rozpracovaný.

---

## Návrhové změny k rozhodnutí (S0)

DD má mít reálný dopad na kód. Kandidáti, kde dnešní kód **nesplňuje** to, co by DD mělo
explicitně říct — na S0 vybrat, které přijmeme (doporučuji N1 + N3, N2 volitelně):

| # | Návrhové rozhodnutí | Dnes v kódu | Proč |
|---|---|---|---|
| N1 | **Rozhodovací logika přechodu jako čistá funkce / policy** (např. `decideConfirm(reservation, resource, now) → Outcome` s výsledky `INVALID_STATE / EXPIRE / ROUTE_TO_APPROVAL / ALLOCATE`), `ReservationService` jen orchestruje transakci a zápis | větvení je natvrdo uvnitř callbacku `confirmReservation` / `approveReservation` | rozhodovací tabulka z kroku 4 se dá přímo otestovat unit testem bez DB; jasné místo pro změnu pravidla |
| N2 | **Jednotný zdroj času (`Clock`)** injektovaný do Lifecycle | `now: Date = new Date()` jako default parametr v každé metodě | C2 R6 „jednotný zdroj času“ — dnes není vynucený |
| N3 | **Unit testy Lifecycle přes in-memory fake `ReservationStore`** | všechny testy služby jdou přes skutečnou DB | test isolation přes port je přesně to, k čemu zadání v kroku 3 rozhraní chce |

---

## Rozdělení

| | Jarda | Honza | Michal |
|---|---|---|---|
| Těžiště | **Struktura** — co jednotka dělá, kdo co vlastní, kontrakty | **Chování** — operace, algoritmus, sekvence | **Verifikace** — testy odvozené z DD, evidence |
| Kroky zadání | 1, 2, 3 | 4 | 5, 6 (evidence) |
| Implementace (krok 6) | N1 (+ N2) v `src/` | review kódu proti DD | N3 fake store + nové testy |
| Reviewuje | krok 4 (Honza) | kroky 1–3 (Jarda), 5 (Michal) | kroky 1–4 (konzistence s testy) |

Pořadí závislostí: **1–3 → 4 → 5 → (commit DD) → 6**. Honza může začít krok 4 hned po S1
(stačí mu názvy prvků a rozhraní), Michal začne krok 5 po S2.

---

## Sync body

| # | Kdy | Kdo | Co |
|---|---|---|---|
| S0 | na začátku | všichni | Potvrdit jednotku (Lifecycle Confirm/Approve) a které z N1–N3 přijímáme. |
| S1 | po kroku 3 (Jarda) | Jarda + Honza | Zafixovat **názvy prvků, rozhraní a chyb** — Honza je používá v metodách a sekvenci, Michal v testech. |
| S2 | po kroku 4 (Honza) | všichni | Projít DD; **commit DD** (bez kódu). Michal od tohoto okamžiku odvozuje testy. |
| S3 | po kroku 6 | všichni | Tabulka design ↔ code, checklist DoD, review, tag `c05-detailed-design`, PR `c05` → `main`. |

---

## Jarda — kroky 1–3 (struktura)

> **Stav 12. 10. 2026:** J1–J3 hotové v [C05 Detailed Design](architecture-and-decisions.md#c05-detailed-design)
> (připraveno s AI → čeká na lidské review, viz A9). Návrh **předpokládá přijetí N1 + N2 + N3** —
> pokud S0 některé odmítne, upravit ownership tabulku a diagram.
>
> **Předávka na S1 (názvy pro Honzu a Michala):**
> - prvky: `ReservationService` (orchestrátor), `LifecyclePolicy` (čistý modul), `ReservationRules`,
>   `ReservationStore`, `ReservationTx`, `Clock`
> - rozhodnutí policy: `decideConfirm → InvalidState | Close(CANCELLED, NO_SHOW_CUTOFF) | RouteToApproval | Allocate`,
>   `decideApprove → InvalidState | Close(EXPIRED, APPROVAL_DEADLINE) | Allocate`,
>   `decideAllocation → Free | Conflict(id)`
> - detailní odpovědnosti DR1–DR7 (odkazovat v metodách i testech)
> - chyby beze změny: `NotFoundError`, `InvalidStateError`, `NoShowExpiredError`, `ApprovalExpiredError`,
>   `OverlapError`, `ReservationConflictError`
> - nově rozhodnuto: čas se čte **po zámku**; chybějící Resource v transakci = porušený invariant → chyba

### J1 — Krok 1: Vybraná jednotka
- [x] Tabulka *Selected architecture unit / Related requirement(s) / Related scenario(s) / Relevant business rule(s)* (návrh výše).
- [x] Jednou větou hranice: co do jednotky patří (rozhodnutí o přechodu + BR-02) a co ne (HTTP mapování R1, DB zámek R8, Availability R7).

### J2 — Krok 2: Detailed responsibilities (3–7)
- [x] Tabulka *Detailed responsibility / Why is it needed?*. Návrh:
  - načíst aktuální stav pod zámkem Resource (ne stav z requestu)
  - ověřit, že přechod je ze stavu povolený (statechart)
  - vyhodnotit časovou lhůtu (BR-04 / BR-06) a případně zapsat terminální stav
  - zvolit cílový stav podle Resource (BR-05: CONFIRMED vs PENDING_APPROVAL)
  - rozhodnout alokaci (BR-02) nad potvrzenými rezervacemi téhož Resource
  - atomicky zapsat přechod s guardem očekávaného stavu (REQ-04)
  - vrátit výsledek nebo jednoznačnou doménovou chybu (po commitu, je-li zapsán terminální stav)
- [x] Nemíchat se třídami — to je až krok 3.

### J3 — Krok 3: Ownership, data/state, rozhraní
- [x] Tabulka *Responsibility / Owner / State/data / Why here?* — owner = `ReservationService`, `LifecyclePolicy` (N1), `rules.ts`, `ReservationStore`, `ReservationTx`, `Clock` (N2).
- [x] **Interface + kontrakt** (min. jeden, doporučuji dva):
  - `ReservationStore.inResourceTransaction(resourceId, work)` — pre: Resource existuje; post: `work` běží serializovaně vůči ostatním transakcím téhož Resource, commit/rollback celku; failures.
  - `ReservationTx.transition(reservation, state)` — pre: `reservation.state` je stav načtený v téže tx; post: uložen nový stav; failure: `ReservationConflictError`, když se stav mezitím změnil.
  - (N1) `decideConfirm(...) : Outcome` — pre/post/failures.
- [x] **Focused UML structural view** — Mermaid class diagram, 4–8 prvků: `ReservationService`, policy (N1), `ReservationRules`, `ReservationStore`, `ReservationTx`, `Clock` (N2), chyby. Ukázat směr závislostí a kdo vlastní `ReservationState`. Vycházet z C03 H2, ale **zúžit a doplnit nové prvky** — ne kopírovat.
- [x] Na S1 předat názvy Honzovi a Michalovi.

---

## Honza — krok 4 (chování)

> **Stav 12. 10. 2026:** H1–H4 připravené podle předávky S1 v
> [C05 Detailed Design](architecture-and-decisions.md#detailed-sequence).
> Operace používají `LifecyclePolicy`, `Clock` a DR1–DR7; rozhodovací řádky C-F1…C-F5
> a A-F1…A-F4 jsou připravené pro Michalovy testy. Technická kontrola kroků 1–3 a
> výchozího kódu je v [evidenci](evidence-and-evolution.md#honzova-část--technická-kontrola-a-předávka).
> Připraveno AI na pokyn Honzy; lidské review dle A9 a týmový průchod S2 tím nejsou potvrzené.
> Krok 5 a cílová implementace přibyly při synchronizaci před pushem (`f24326a`, `58600c2`);
> jejich Honzovo review zůstává následným krokem.

### H1 — Significant methods / operations
- [x] Pro `confirmReservation`, `approveReservation`, `allocate` (BR-02) a (N1) `decideConfirm` / `decideApprove` šablona:
      *Operation / Responsibility / Input / Output / Preconditions / Postconditions / Side effects / Failure behavior*.
- [x] U Failure behavior výslovně: které chyby zapíšou stav **a pak** se vyhodí (`NoShowExpiredError` → CANCELLED, `ApprovalExpiredError` → EXPIRED) a které nechají stav beze změny (`OverlapError`, `InvalidStateError`, `NotFoundError`).
- [x] Nedokumentovat gettery, `toRecord`, `decide()` jako pouhou delegaci (pokud nemá vlastní rozhodnutí).

### H2 — Algorithm / decision logic
- [x] **Rozhodovací tabulka** Confirm: vstupy *stav × lhůta BR-04 × requiresApproval × konflikt BR-02* → výsledek (cílový stav / chyba / zda se zapisuje). Totéž pro Approve (*stav × lhůta BR-06 × konflikt*).
- [x] Pořadí vyhodnocení podmínek explicitně (stav → lhůta → BR-05 → BR-02) a **proč** zrovna v tomto pořadí.
- [x] Pseudocode `allocate` (BR-02, polouzavřený interval BR-01, vynechání sebe sama).

### H3 — Detailed sequence
- [x] Jeden významný scénář **uvnitř jednotky**, ne HTTP → DB. Doporučuji Approve s konfliktem BR-02:
      `ReservationService → ReservationStore.inResourceTransaction → ReservationTx.findById → policy/rules → ReservationTx.findConfirmedForResource → OverlapError (rollback)`.
- [x] Pod diagram dvě řádky „C03 architecture level vs C05 DD level“ (jako v zadání).

### H4 — DD decisions intentionally left to code
- [x] Seznam: `toRecord`, Prisma `updateMany` detaily, konkrétní SQL zámku (`UPDATE "Resource" SET id=id`), texty chybových zpráv, …

---

## Michal — kroky 5 a 6 (verifikace)

> **Stav 12. 10. 2026:** M1–M3 hotové v [C05 DD Verification Evidence](evidence-and-evolution.md#c05-dd-verification-evidence)
> (s AI → čeká na lidské review, A9). Testy DD-T1–T11 jsou odvozené z kroků 1–3:
> - unit přes fake store: `tests/services/reservationLifecycle.unit.test.ts`;
> - rozhodovací tabulka policy: `tests/domain/lifecyclePolicy.test.ts`;
> - kontrakt `transition` nad DB: `tests/services/reservationTx.contract.test.ts`;
> - souběh: `lock-mechanism.test.ts`.
>
> Testy jsou upravené na Jardovo N1/N2. Mismatch je přepsaný: všechny tři rozdíly jsou YES.
> `npm test` na PostgreSQL 16.14: 137/137. Mutační kontrola: 5/5 zanesených chyb zachyceno.
> **Pro Honzu:** po kroku 4 porovnat rozhodovací tabulku s DD-T9 a metody s DD-T1–T8.

### M1 — Krok 5: Testy odvozené z DD (min. 5)
- [x] Tabulka *DD element / decision | What must hold? | Test level | Test case* — každý řádek musí odkazovat na konkrétní prvek z kroků 3–4. Minimálně:

| DD element | Co musí platit | Úroveň | Test case (návrh) |
|---|---|---|---|
| interface contract `transition` | stale stav → `ReservationConflictError`, nic nepřepíše | component (DB) | již existuje v `concurrency.test.ts` → odkázat |
| algorithm branch (rozhodovací tabulka) | DRAFT + Resource s approval → PENDING_APPROVAL, BR-02 se nevyhodnocuje | unit (fake store / čistá policy) | nový |
| state transition | DRAFT po lhůtě BR-04 → zapsáno CANCELLED **a** vyhozena `NoShowExpiredError` | unit (fake store) | nový — ověří „zapsat a pak vyhodit“ |
| failure behavior | konflikt BR-02 → `OverlapError`, stav zůstává DRAFT / PENDING_APPROVAL, nic nezapsáno | unit (fake store) | nový |
| collaboration | Lifecycle rozhoduje nad stavem z `tx.findById`, ne nad stavem z prvního čtení mimo tx | unit (fake store vrací jiný stav uvnitř tx) | nový |
| collaboration | dva souběžné Confirm na PostgreSQL → právě jeden vítěz | integration (PostgreSQL) | existuje `lock-mechanism.test.ts` → odkázat |

- [x] U **alespoň dvou** testů rozepsat *Selected level / Why this level / What design decision does this test verify?* (doporučuji fake-store „rozhoduje nad stavem z tx“ a PostgreSQL souběh — ukazují, proč jeden je unit a druhý integrace).

### M2 — Implementace testů (N3)
- [x] In-memory `ReservationStore` / `ReservationTx` fake v `tests/` (žádná DB), umožní nastavit Resource, potvrzené rezervace a stav viděný uvnitř tx.
- [x] Nové unit testy v `tests/services/` (např. `reservationLifecycle.unit.test.ts`); názvy testů = ID řádků z M1, ať je vazba DD → test dohledatelná.
- [x] Spustit `npm test` (PostgreSQL sada) — výsledek uložit do `docs/evidence/c05-*.json` jako u C03.

### M3 — Krok 6: Evidence `## C05 DD Verification Evidence`
- [x] *Tests derived from DD* — odkaz na tabulku M1.
- [x] *Unit/component tests executed* — příkaz, počet testů, výsledek, datum, prostředí.
- [x] *Design ↔ implementation mismatch* (po implementaci N1/N2) — tabulka *DD decision / Implemented? (YES/PARTLY/NO) / Evidence (file/test) / Action (keep / update DD / update code)*. Podklady dodá Jarda (co z N1/N2 udělal) a Honza (review kódu proti krokům 3–4).
- [x] *Resolution* — u každého rozdílu, **proč** jsme rozhodli tak, jak jsme rozhodli.
- [x] *Remaining design risk* — např. Ordering a Cancel mimo DD; SQLite nerozliší zámek; disciplína „stav mění jen Lifecycle“ (L2).
- [x] *Commit/tag* — hash commitu s DD, hash commitu s implementací, tag `c05-detailed-design`.

---

## Jarda — implementace (krok 6, po S2)

> **Stav 12. 10. 2026:** N1 + N2 implementováno (necommitnuto — commitnout až po commitu DD).
> `npm test` (PostgreSQL 16, embedded): **95 passed / 0 failed**, typecheck `tsconfig.verify.json` OK.
>
> **Pro Michala (M2, M3):**
> - Nové: `src/domain/lifecyclePolicy.ts` (`decideConfirm`, `decideApprove`, `decideAllocation`),
>   `src/domain/clock.ts` (`Clock`, `systemClock`), `MissingResourceError` v `reservationService.ts`;
>   `ResourceRecord` přesunut do `src/domain/types.ts` (repository ho re-exportuje).
> - `ReservationService(store, clock = systemClock)`; metody už **nemají parametr `now`** — čas se čte
>   `clock.now()` jednou uvnitř transakce po zámku.
> - Testovací hodiny: `tests/support/clock.ts` (`TestClock.set(date)`); fake store dej klidně vedle.
> - Upravené testy (jen přechod z `now` parametru na clock, tvrzení beze změny):
>   `reservationService.test.ts`, `c02-completion.test.ts`, `concurrency.test.ts`, `lock-mechanism.test.ts`.
> - Podklady pro mismatch tabulku: všechny tři rozdíly z „Rozdíly proti kódu na `main`“ jsou teď
>   implementované (YES); `MissingResourceError` zatím nemá test ani HTTP mapování (→ 500 záměrně).
> - Pozor: `npm test` i `verify:docs` přepisují soubory `docs/evidence/c03-*.json` — před commitem vrátit.
- [x] N1: vytáhnout rozhodnutí do čisté funkce / policy podle kroku 3–4; `ReservationService` jen orchestruje.
- [x] N2 (pokud přijato): `Clock` do konstruktoru, sestavení v `src/index.ts` / `app.ts`.
- [x] Žádný existující test nesmí oslabit tvrzení o chování; L2 (`lifecycle-ownership.test.ts`) musí dál projít.
- [x] Kde kód **nejde** udělat podle DD, nepřepisovat DD potichu — zapsat Michalovi do mismatch tabulky.

---

## Hotovo je, když (kontrola na S3) — Definition of Done ze zadání

| Kritérium zadání | Kde | ✔ |
|---|---|---|
| jedna architecture responsibility / unit | [Selected architecture unit](architecture-and-decisions.md#selected-architecture-unit) | [x] |
| detailed responsibilities | [DR1–DR7](architecture-and-decisions.md#detailed-responsibilities) | [x] |
| ownership | [Design elements and ownership](architecture-and-decisions.md#design-elements-and-ownership) | [x] |
| významné interface / contract | [kontrakty 1–4](architecture-and-decisions.md#key-interfaces--contracts) | [x] |
| focused structural UML view | [Focused structural view](architecture-and-decisions.md#focused-structural-view) | [x] |
| detailed sequence | [H3](architecture-and-decisions.md#detailed-sequence) | [x] |
| významné methods / operations | [H1](architecture-and-decisions.md#important-methods--operations) | [x] |
| algorithm / decision logic | [H2](architecture-and-decisions.md#algorithm--decision-logic) | [x] |
| minimálně 5 testů odvozených z DD | [DD-T1–T11](evidence-and-evolution.md#tests-derived-from-dd) | [x] |
| testy spuštěné | [běhy](evidence-and-evolution.md#unitcomponent-tests-executed), [Uzavření C05](evidence-and-evolution.md#uzavření-c05-s3) | [x] |
| DD porovnáno s implementací | [mismatch](evidence-and-evolution.md#design--implementation-mismatch) | [x] |
| commit + PR `c05` → `main` | PR #20, `055917c` | [x] |
| tag `c05-detailed-design` | na `055917c`, pushnut 26. 10. 2026 | [x] |
| lidské review AI výstupů zapsané (A9) | [Lidské review A9](evidence-and-evolution.md#lidské-review-a9) — hotovo 26. 10. 2026 (Jarda, Honza) | [x] |
| `node scripts/check-docs.mjs` projde | [Uzavření C05](evidence-and-evolution.md#uzavření-c05-s3) | [x] |
