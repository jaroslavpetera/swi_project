# C08 — Controlled Change: od požadavku k rozhodnutí a ověřitelné změně

Zadání: *SWI C08 — Controlled Change*. Připraveno s AI na pokyn Michala, 2. 11. 2026.
Rozhodnutí je **návrh**, dokud ho tým nepotvrdí v peer review.

| Fáze zadání | Výstup | Kde | Stav |
|---|---|---|---|
| 0. Zmrazit before | commit `ff027e3`, tag `c08-before`, runtime, schéma, příkaz | [evidence › Krok 0](evidence-and-evolution.md#krok-0--výchozí-baseline-before) | hotovo |
| 1. Pojmenovat změnu | CR-C08-01 (propadlé čekající žádosti v přehledu obsluhy), AC-01…AC-05 | [karta změny](intent-and-change.md#c08--cr-c08-01--controlled-change-card) | hotovo |
| 2. Ověřit dosavadní chování | TC-C08-01 (pozitivní), TC-C08-02 (negativní), TC-C08-03 (pozorování omezení) — skutečně spuštěno na PostgreSQL, 147/147 | [evidence › test cases](evidence-and-evolution.md#tc-c08-01--pozitivní-sousední-interval-se-schválí), `tests/spec/c08-baseline.test.ts`, [`c08-postgres-tests.json`](evidence/c08-postgres-tests.json) | hotovo |
| 3. Analyzovat dopady | Impact Matrix (CHANGE / CHECK / NO IMPACT s důvodem) | karta změny | hotovo |
| 4. Posoudit varianty | Options Matrix A–D + důsledky nečinnosti | karta změny | hotovo |
| 5. Přijmout rozhodnutí | ACCEPT varianta A (C = DEFER) | karta změny | **návrh — chybí peer reviewer** |
| 6. Předat do C09 | delta, nový oracle V-05.10, regrese | karta změny › handoff | hotovo |

## Co zbývá týmu

1. **Peer review rozhodnutí** — někdo jiný než Michal (Jarda nebo Honza) kriticky posoudí kartu změny,
   hlavně předpoklad „stačí příznak, není potřeba EXPIRED v DB“, a zapíše jméno, datum a závěr do
   řádku *Peer reviewer* v [`intent-and-change.md`](intent-and-change.md#c08--cr-c08-01--controlled-change-card).
2. **Ověřit reprodukovatelnost:** jiný člen spustí `npm test` na `c08` a očekává 147/147 (zadání:
   „jiný člen obnoví stejný výchozí stav“).
3. **C09:** implementovat podle handoff tabulky — nejdřív test V-05.10, pak změna.

## Jak to vysvětlit na cvičení (1 minuta)

Změna: obsluha vidí v přehledu žádosti, které už nejde schválit (uplynul termín BR-06), a tlačítko
Schválit vrátí chybu. Nejdřív jsme testy ověřili, že dosavadní pravidla platí (sousední interval projde,
překryv se odmítne) a že problém skutečně existuje (TC-C08-03). Varianty: příznak počítaný serverem (A),
zápis při čtení (B), worker (C), výpočet jen v prohlížeči (D). Bereme A — nejmenší změna, nemění
schválená pravidla a čas určuje server, ne prohlížeč (poučení z nálezu F2). Worker odkládáme, dokud ho
někdo skutečně nebude potřebovat.
