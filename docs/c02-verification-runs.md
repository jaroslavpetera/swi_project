# C02 — skutečně provedené příklady ověření (část A)

> Historický záznam z 21. 9. 2026. Aktuální sjednocené ověření A+B je v
> [c02-completion-evidence.md](c02-completion-evidence.md). Tehdejší počty 24/43 a
> označení D-xx jsou zachované jako historie; současná specifikace používá R-xx.

Podklad pro sekci *Evidence C02* v `evidence-and-evolution.md`. Operace OP-01 a OP-02
(Create, Check Availability), baseline v0.1, vlastník A.

**Jak to bylo spuštěno:** `npx tsx src/index.ts` (port 3102), požadavky přes `curl` proti běžící
aplikaci a reálné databázi. Uvedené výstupy jsou zkopírované z běhu, ne opsané ze specifikace.
Datum: 21. 9. 2026.

Připravená data: jeden `User`, jeden `Resource` (stůl, kapacita 4).

## OP-01 — Create Reservation (REQ-01)

| # | Co se posílalo | Skutečný výstup | Odpovídá spec? |
|---|---|---|---|
| V-01.1 | platný stůl + host, `[2027-03-01T18:00, 20:00)` | `HTTP 201` `{"id":"8d4aab31-…","state":"DRAFT"}` | ✅ |
| V-01.2 | `startsAt == endsAt` (18:00, 18:00) | `HTTP 400` `{"error":{"formErrors":["endsAt must be after startsAt"]}}` | ✅ nic nevzniklo |
| V-01.3 | `resourceId: "neexistujici-stul"` | `HTTP 400` `{"error":"Unknown resourceId or userId"}` | ✅ nic nevzniklo |
| V-01.4 | `[18:30, 19:30)` uvnitř již CONFIRMED `[18:00, 20:00)` | `HTTP 201` `{"id":"ed4378d7-…","state":"DRAFT"}` | ✅ potvrzuje D-02 — Create kolize nekontroluje |

## OP-02 — Check Availability (REQ-02)

Výchozí stav: rezervace `[18:00, 20:00)` **CONFIRMED** (kromě V-02.5, která běžela ještě před potvrzením).

| # | Dotaz | Skutečný výstup | Odpovídá spec? |
|---|---|---|---|
| V-02.5 | `[18:00, 20:00)`, rezervace je zatím DRAFT | `HTTP 200` `{"available":true}` | ✅ DRAFT neblokuje (D-01) |
| V-02.2 | `[19:00, 21:00)` — částečný překryv | `HTTP 200` `{"available":false}` | ✅ |
| V-02.3 | `[20:00, 21:00)` — začíná přesně na konci | `HTTP 200` `{"available":true}` | ✅ hranice `[start,end)` (BR-01) |
| V-02.4 | `[17:00, 18:00)` — končí přesně na začátku | `HTTP 200` `{"available":true}` | ✅ druhá hranice BR-01 |
| V-02.1 | `[21:00, 22:00)` — volný slot | `HTTP 200` `{"available":true}` | ✅ |
| V-02.6 | `?start=blabla&end=nic` | `HTTP 400` `{"error":{…"start":["Invalid date"],"end":["Invalid date"]}}` | ✅ neodpovídá „available“ |
| V-02.7 | neexistující stůl | `HTTP 404` `{"error":"Resource neexistujici-stul not found"}` | ✅ |

Automatizovaná varianta všech těchto příkladů: `tests/spec/op01-op02.test.ts` (10 testů, názvy
testů nesou čísla V-01.x / V-02.x). Celá sada: **24 testů, všechny procházejí.**

## Nalezený nesoulad specifikace × aplikace

| Co | Kde byla chyba | Jak vyřešeno |
|---|---|---|
| `GET /resources/:id/availability` pro **neexistující stůl** vracel `HTTP 200 {"available":true}` | v aplikaci — OP-02 má předpoklad „Resource existuje“, ale kód ho nekontroloval | Doplněna kontrola existence stolu → `HTTP 404`. Chyba byla v implementaci, ne ve specifikaci: odpovědět „volno“ na dotaz o neexistujícím stole je horší než neodpovědět, protože je to chyba ve směru, který vede k dvojím rezervacím. Pokryto testem V-02.7 |

Dva rozdílné kódy pro „neznámý stůl“ jsou záměrné a konzistentní s tím, kde se identifikátor
nachází: v těle požadavku (Create) → `400`, v cestě URL (Availability) → `404`.

## Otevřená otázka na tým

Vytvoření rezervace s `start` v minulosti dnes projde. Je to neškodné (takovou rezervaci stejně
nelze potvrdit kvůli BR-04), ale může to překvapit. **Vědomě nerozhodnuto** — patří na fázi 3
(kontrola konzistence), ne do tichého rozhodnutí implementace.

---

## OP-06 — Place Order (REQ-07, REQ-08, BR-07/BR-08) — rozšíření domény

Spuštěno stejným způsobem (`npx tsx src/index.ts`, port 3103, `curl`) proti reálné DB, 21. 9. 2026.

Připravená data: host, stůl, jídelní lístek ze `npm run seed`, a tři rezervace téhož stolu —
probíhající CONFIRMED, probíhající DRAFT a budoucí CONFIRMED.

> **Poznámka k přípravě:** stav CONFIRMED u **probíhající** rezervace se musel nastavit přímo
> v databázi. Přes API to nejde — BR-04 (no-show) zakazuje potvrdit rezervaci později než 30 minut
> před jejím začátkem. Viz TBD-3 ve specifikaci, je to skutečné napětí mezi dvěma pravidly, ne
> obcházení testu.

| # | Co se posílalo | Skutečný výstup | Odpovídá spec? |
|---|---|---|---|
| V-06.1 | 2× Pivo 12° + 1× Guláš do probíhající CONFIRMED rezervace | `HTTP 201`, stav `PLACED`, `totalCents: 33700`, položky s cenou a názvem | ✅ 337 Kč |
| V-06.2 | totéž do probíhající **DRAFT** rezervace | `HTTP 409` `{"reason":"NOT_CONFIRMED"}` | ✅ |
| V-06.3 | rezervace začínající za 3 hodiny | `HTTP 409` `{"reason":"BEFORE_START"}` | ✅ |
| V-06.5 | neexistující položka lístku | `HTTP 400` `{"error":"Unknown or unavailable menu items: neexistuje"}` | ✅ nic se neobjednalo |
| V-06.6 | prázdná objednávka | `HTTP 400` `an order must contain at least one item` | ✅ |
| V-06.11 | zaplatit objednávku, která ještě nebyla podaná | `HTTP 409` `Order is in state PLACED, expected SERVED` | ✅ |
| — | účet po objednání | `{"unpaidCents":33700,"paidCents":0,"totalCents":33700}` | ✅ |
| — | podáno → zaplaceno | `SERVED` → `PAID`, účet `{"unpaidCents":0,"paidCents":33700}` | ✅ |

Zbylé příklady (V-06.4 konec slotu, V-06.7 vyprodaná položka, V-06.8 neznámá rezervace,
V-06.9 změna ceníku, V-06.10 celý životní cyklus účtu) jsou pokryté automatizovaně v
`tests/spec/op06-orders.test.ts`. Celá sada po přidání objednávek: **43 testů, všechny procházejí.**
