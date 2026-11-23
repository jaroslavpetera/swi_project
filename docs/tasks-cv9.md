# C09–C11 — implementace změny a CI, provoz a logy, plán validace

Zadání z LMS: *C09 — Configuration Management*, *C10 — Operations*, *C11 — User Validation*.
Připraveno s AI na pokyn Michala, 23. 11. 2026. Vše na větvi `c09`, PR do `main`.

| Cvičení | Výstup | Kde | Stav |
|---|---|---|---|
| C09 | implementace CR-C08-01 (varianta A), test V-05.10, úprava TC-C08-03 | `src/http/app.ts`, `public/app.js`, `tests/spec/c09-approval-overdue.test.ts` | hotovo, 155/155 lokálně |
| C09 | CI (GitHub Actions): `npm test` + `npm run test:frontend` | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | hotovo, běh 45185464459 zelený |
| C09 | Integration, CI and Release Record, RC `c09-rc1` = **CONDITIONAL** | [evidence › C09](evidence-and-evolution.md#c09--integration-ci-and-release-record) | **čeká na lidské kroky níže** |
| C10 | 4 provozní situace, logy před/po, minimální log | [evidence › C10](evidence-and-evolution.md#c10--provozní-situace-a-logy), `scripts/c10-operations.mjs`, `src/logging.ts` | hotovo, 4× PASS |
| C11 | plán validace A–D, karty účastníka, validační prostředí | [`c11-validation-plan.md`](c11-validation-plan.md), [`c11-participant-cards.md`](c11-participant-cards.md), `npm run validation:env` | hotovo, výsledky `NOT RUN` do C12 |

## Co zbývá týmu (nikdo za vás to nevyplní)

1. **Peer review rozhodnutí C08** — Jarda nebo Honza zapíše jméno, datum a závěr do řádku *Peer reviewer*
   v [kartě CR-C08-01](intent-and-change.md#c08--cr-c08-01--controlled-change-card).
2. **Code review PR `c09` → `main`** — jiný člen než Michal. Zkontrolovat diff proti AC-01…AC-05, chybové cesty,
   čistotu čtení (R-16). Výsledek zapsat do řádku *Peer review* v [C09 evidenci](evidence-and-evolution.md#c09--integration-ci-and-release-record).
3. **Čistý checkout jiným členem:**

   ```bash
   git clone https://github.com/jaroslavpetera/swi_project.git
   cd swi_project
   git checkout c09-rc1
   npm ci
   npm test
   npm run dev
   ```

   Pak otevřít `http://localhost:3000`. Do tabulky *Reprodukce na čistém checkoutu* zapsat OS, verzi Node,
   výsledek a jakoukoli ruční opravu.
4. Po bodech 1–3 změnit rozhodnutí RC z CONDITIONAL na READY (nebo HOLD s důvodem).
5. **C11:** projít plán a karty (nevodící otázky, role moderátor × zapisovatel). Před C12 spustit
   `node scripts/validation-env.mjs --smoke`.
6. Na Windows ověřit, že při Ctrl+C v `npm run start` vznikne řádek `shutdown_requested` (C10 — NOT VERIFIED).

## Jak to vysvětlit na cvičení (po minutě)

- **C09:** Změnu z C08 jsme implementovali přesně podle karty. Server u čekající žádosti počítá
  `approvalOverdue` stejným pravidlem a hodinami jako schvalování. UI pak propadlou žádost nenabídne ke
  schválení. Test hranice (−30:01 / −30:00) vznikl před kódem. Nové i staré testy prošly lokálně i v CI.
  Release je CONDITIONAL, protože chybí lidské review a reprodukce jiným členem — zelená CI nestačí.
- **C10:** Na izolované instanci jsme vyzkoušeli úspěch, kolizi, výpadek DB a restart. Stav jsme vždy
  ověřili přímo v DB. Původní log u výpadku neměl čas ani operaci, proto jsme přidali jeden JSON řádek
  pro technické chyby a start/stop. Úspěchy a doménová zamítnutí vědomě nelogujeme.
- **C11:** Čtyři protokoly nad skutečným UI pro roli obsluhy. Klíčová otázka je, zda obsluha pozná, že
  rezervace je hotová až po potvrzení. Karty jsou oddělené od interního plánu. Pravdu o stavu dává
  readback z DB, ne hláška v aplikaci.
