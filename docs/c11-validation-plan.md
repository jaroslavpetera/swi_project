# C11 — Plán validace (interní protokol týmu)

> Připraveno s AI na pokyn Michala 23. 11. 2026 podle šablony `VALIDATION_PLAN_TEMPLATE_CZ.md`.
> **Interní dokument — účastník ho nedostane.** Účastník dostává jen [karty](c11-participant-cards.md).
> V C11 vznikají podklady, ne výsledky: všechny kolonky výsledků jsou `NOT RUN` až do C12.
> Kterou metodu (nebo kombinaci) provedeme v C12, upřesní cvičící.

## Společné informace

| Položka | Údaj |
|---|---|
| Tým / repozitář | Hospoda Devs — https://github.com/jaroslavpetera/swi_project |
| Verze / commit | release candidate `c09-rc1` (`a3da8be`) + validační prostředí z větve `c09` (commit s tímto plánem). Před C12 zapsat přesný commit, ze kterého běží validační instance. |
| Cílová role a skutečný účel | **Obsluha hospody** (číšník / vedoucí směny). Přijímá rezervace telefonicky a zapisuje je za hosta. Hlavní cíl: **host má stůl opravdu zajištěný** (CONFIRMED), ne jen „zapsaný“ (DRAFT). U salonku navíc rozhoduje o schválení. Host sám systém nepoužívá (R-7, bez přihlášení). |
| Podporované rozhraní a dokumentace | Webové UI `public/` (sekce **Rezervace**, **Objednávky a účet**, **Hosté a stoly**). Běžná dokumentace = texty v UI (např. „Potvrďte v přehledu nejpozději 30 minut před návštěvou.“) a odstavec o používání v README (sekce Setup, „Na `http://localhost:3000` běží…“). Účastník README dostane jen na požádání; zapíše se jako použití dokumentace, ne jako pomoc týmu. |
| Prostředí, data, přístupy, reset | `npm run validation:env` → oddělený PostgreSQL (`.local/validation`, port 55433), **vždy nová** DB `validation`, migrace, menu a data z [`prisma/validation-seed.ts`](../prisma/validation-seed.ts); aplikace na `http://localhost:3001`. Bez účtů a hesel (R-7). **Reset = Ctrl+C a znovu `npm run validation:env`** — před každým účastníkem a mezi metodami, nikdy během úlohy. Kontrola před C12: `node scripts/validation-env.mjs --smoke` (ověřeno 23. 11. 2026: 4 stoly, 3 rezervace, exit 0). |
| Výchozí data | Hosté: Petr Malý, Jana Dvořáková, Tomáš Beneš, Eva Králová (Kovo Ostrava s.r.o.), Lucie Horáková. Stoly: Stůl 1 · u okna (2), Stůl 2 (4), Stůl 3 (6), Salonek (14, vyžaduje schválení). Rezervace: `c11-seed-01` Stůl 2 / Dvořáková / pá 15. 1. 2027 18:00–20:00 CONFIRMED; `c11-seed-02` Stůl 1 / Beneš / so 16. 1. 2027 19:00–21:00 CONFIRMED; `c11-seed-03` Stůl 3 / Horáková / právě probíhá (−30 min … +90 min od resetu) CONFIRMED. |
| Nezávislé ověření stavu | `npm run validation:readback` (jen čtení přímo z DB, mimo UI): stůl, kapacita, host, **stav**, čas v Europe/Prague, čas poslední změny a objednávky. Hláška v UI ani HTTP 201 nejsou důkaz dokončení — rozhoduje readback. |
| Proxy účastník a limity | Student z jiného týmu jako zástupce obsluhy. Nezná provoz hospody ani telefonování s hosty, zato zná podobné webové systémy. Závěry platí pro tohoto účastníka v laboratoři, **ne pro všechny číšníky**. |
| Známé vlastnosti produktu, které nesmíme vydávat za chybu účastníka | Rezervace nejde upravit — změna času = zrušit a vytvořit novou. Systém nezná počet osob, kapacita stolu je jen informace. Potvrdit lze nejpozději 30 min před začátkem (BR-04). Objednávat lze jen během potvrzené návštěvy (BR-07). |

**Obecná pravidla nápovědy (všechny metody):**

- **Úroveň 0** — opakovat text karty.
- **Úroveň 1** — obecné: „Co byste udělali v podobném systému?“
- **Úroveň 2** — ukázat sekci obrazovky.
- **Úroveň 3** — pojmenovat konkrétní tlačítko.

Úrovně 2–3 se zapisují jako **pomoc** a úloha se pak nepočítá jako „bez pomoci“. Po 10 minutách bez
postupu se moderátor zeptá, zda chce účastník pokračovat; když ne, zapíše se „vzdáno“.

## A — Pozorované uživatelské úlohy

- **Validační otázka:** Dokáže obsluha, která systém nezná, bez technické nápovědy zajistit stůl tak, aby
  byl skutečně závazný (CONFIRMED), a zrušit existující rezervaci? A ví správně, kdy je hotovo?
- **Karta účastníka A1:** [Karta A1](c11-participant-cards.md#karta-a1) — Petr Malý, pá 15. 1. 2027
  18:00–20:00, 4 osoby.
- **Karta účastníka A2 (nezávislá na A1):** [Karta A2](c11-participant-cards.md#karta-a2) — zrušit návštěvu
  Tomáše Beneše v so 16. 1. 2027.
- **Počáteční stav:** po resetu.
  - A1: Stůl 2 (4 místa) je v termínu obsazený (`c11-seed-01`), Stůl 3 (6) volný, Stůl 1 má jen 2 místa.
    Úloha tak zkouší i výběr stolu a ověření dostupnosti.
  - A2: `c11-seed-02` je CONFIRMED. Úlohy na sobě nezávisí; A2 nepracuje se Stolem 2 ani 3.
- **Co zaznamenáme (formulář níže):**
  - čas od přečtení karty do „hotovo“;
  - pořadí akcí: sekce, výběr stolu, „Je tu volno?“, vytvoření, **Potvrdit**;
  - chyby a hlášky (např. kolize 409);
  - zaváhání, úroveň pomoci;
  - **doslovná slova**, kterými účastník řekne, že je hotovo, a co podle něj znamená stav, který vidí.
- **Předem daný úspěch:**
  - **A1:** podle readbacku existuje pro Petra Malého v pá 15. 1. 2027 18:00–20:00 rezervace
    **CONFIRMED** na stole s kapacitou ≥ 4. Druhá rezervace na stejný stůl a čas nevznikla. Účastník
    hotovo oznámí až po potvrzení. **Neúspěch:** rezervace jen DRAFT, stůl s kapacitou < 4, nebo „hotovo“ bez potvrzení.
  - **A2:** `c11-seed-02` je **CANCELLED** a Stůl 1 je pro so 16. 1. 19:00–21:00 podle „Je tu volno?“ volný.
  - Obě bez nápovědy úrovně 2–3. Čas je doplňková metrika, ne kritérium.
- **Nezávislý oracle / readback:** po „hotovo“ `npm run validation:readback`. Porovnáme řádek
  hosta, stůl, kapacitu, čas a stav s kritériem. Doplňkově `GET /resources/:id/availability`. Účastník
  readback nevidí.
- **Co metoda neprokáže:**
  - typickou úspěšnost skutečných číšníků;
  - příčinu zaváhání (to dá rozhovor B);
  - chování při stresu a hluku provozu;
  - nic o souběhu dvou obsluh.

| Úloha | Čas / pozorované akce | Nápověda | Co si účastník myslí | Skutečný readback | Interpretace |
|---|---|---|---|---|---|
| A1 | nezjištěno | nezjištěno | nezjištěno | NOT RUN | až po provedení (C12) |
| A2 | nezjištěno | nezjištěno | nezjištěno | NOT RUN | až po provedení (C12) |

## B — Strukturovaný rozhovor a použití

- **Validační otázka:** Co pro obsluhu znamená „rezervace je hotová“? Odpovídá tomu, jak systém
  rozlišuje stavy **Rozpracovaná → Potvrzená** a **Čeká na schválení**?
- **Nevodící otevřené otázky (pět):**
  1. „Popište, jak u vás nebo v podobném podniku probíhá přijetí rezervace po telefonu.“
  2. „Podle čeho poznáte, že má host stůl opravdu jistý?“
  3. „Co potřebujete vidět o rezervaci, když host přijde ke dveřím?“
  4. „Co by se podle vás mělo stát, když rezervaci musí ještě někdo jiný odsouhlasit?“
  5. „Když host volá, že přijde jindy nebo vůbec, co od systému čekáte?“
- **Navazující sonda s produktem:** [Karta B](c11-participant-cards.md#karta-b--sonda-s-produktem-předává-se-až-po-rozhovoru)
  — Jana Dvořáková, čt 21. 1. 2027 17:00–19:00, 2 osoby. „Řekněte, kdy podle vás bylo hotovo.“
  **Potvrzení předem neprozrazovat.** Sonda se předá až po všech pěti otázkách, aby rozhovor neovlivnila.
- **Způsob záznamu:**
  - Ke každé otázce 1–2 **doslovné výroky** (v uvozovkách) a jedna věta „z toho plyne očekávání: …“.
  - Pozorování ze sondy se zapisuje zvlášť.
  - Názory nepřevádíme na PASS/FAIL. Neptáme se sugestivně (např. „Matl vás nápis Rozpracovaná?“),
    ale „Co pro vás znamená stav, který teď vidíte?“.
  - Zapisuje druhý člen týmu, moderátor jen klade otázky.
- **Jak zvlášť zkontrolujeme tvrzení o dokončení:** když účastník řekne „hotovo“, provedeme
  readback. Rozpor zapíšeme jako **rozpor očekávání × produkt**, ne jako chybu účastníka. Příklad:
  účastník tvrdí „hotovo“, ale rezervace je DRAFT.
- **Co metoda neprokáže:**
  - technickou správnost systému;
  - rozšíření názoru mezi obsluhou (jeden účastník);
  - že by navržená úprava problém skutečně odstranila.

| Otázka / sonda | Doslovný výrok | Plynoucí očekávání | Readback (jen sonda) |
|---|---|---|---|
| B1–B5 | nezjištěno | nezjištěno | — |
| Sonda | nezjištěno | nezjištěno | NOT RUN |

## C — Scénářové akceptační posouzení

| Scénář / uživatelský význam | Předem dané akceptační podmínky | Karta pro účastníka / námitky | Jak ověříme reálný výsledek |
|---|---|---|---|
| **C1: Zajistit stůl pro skupinu.** Host chce mít jistotu, že pro 4 lidi bude stůl. | (1) Existuje **CONFIRMED** rezervace Petra Malého v so 23. 1. 2027 19:00–21:00 na stole s kapacitou ≥ 4. (2) Účastník v UI pozná, že je potvrzená (štítek **Potvrzená**). (3) Žádná jiná CONFIRMED rezervace se na stejném stole v čase nepřekrývá (BR-02). | [Karta C1](c11-participant-cards.md#karta-c1). Otázky po provedení: „Je to výsledek, který byste pro hosta považovali za hotový?“, „Chybí vám nějaká informace, např. počet osob nebo poznámka?“, „Který krok vám nebyl jasný?“ | `npm run validation:readback` — řádek hosta, stůl, kapacita, stav, čas. **Tento scénář se v C12 provede na běžícím systému.** |
| **C2: Zrušit a uvolnit stůl.** Jiný host má mít šanci stůl dostat. | (1) `c11-seed-01` je **CANCELLED**. (2) „Je tu volno?“ pro Stůl 2, pá 15. 1. 2027 18:00–20:00 hlásí volno. (3) Zrušená rezervace v přehledu zůstává viditelná se stavem **Zrušená** (dohledatelnost). | [Karta C2](c11-participant-cards.md#karta-c2). Otázky: „Odpovídá výsledek tomu, co byste po zrušení čekali?“, „Potřebujete něco vědět o tom, kdo a kdy rušil?“ | readback (stav `c11-seed-01`) + `GET /resources/:id/availability?start=2027-01-15T17:00:00Z&end=2027-01-15T19:00:00Z` → `available: true`. |

- **Jak účastník posoudí vhodnost:** u každého scénáře odpoví na tři otázky z tabulky.
  - Zapíšeme **souhlas / námitku / nezodpovězený předpoklad** zvlášť od toho, zda scénář technicky prošel.
  - Námitka typu „chybí mi počet osob“ je validační zjištění, ne neúspěch scénáře. Systém počet osob
    vědomě neeviduje (rozsah v0.2).
- **Co metoda neprokáže:**
  - formální převzetí zákazníkem (proxy student není provozovatel hospody);
  - pokrytí dalších scénářů (schválení, objednávky);
  - jedna zkouška nepokrývá hraniční časy (BR-04) ani souběh.

| Scénář | Provedení (actual) | Readback | Souhlas / námitka / předpoklad |
|---|---|---|---|
| C1 | NOT RUN | NOT RUN | nezjištěno |
| C2 | NOT RUN | NOT RUN | nezjištěno |

## D — Krátký pilot

- **Validační otázka:** Zvládne obsluha s produktem souvislou směnu, kde se plán mění? Tedy
  rezervaci salonku se schválením, mezitím probíhající návštěvu s objednávkou a placením, a nakonec
  přesun termínu, který systém neumí jako „úpravu“.
- **Karta účastníka:** [Karta D — vaše směna](c11-participant-cards.md#karta-d--vaše-směna). Krok 1 je na kartě,
  další kroky čte moderátor v daný okamžik (bez technického návodu):
  2. *Vedoucí:* „Žádosti o salonek dnes schvalujete vy. Podívejte se, co čeká na rozhodnutí, a rozhodněte.“
  3. *Stůl 3:* „Paní Lucie Horáková u stolu 3 si objednává dvakrát Kofolu a guláš. Za chvíli jídlo
     donesete a paní pak chce zaplatit.“
  4. *Telefon:* „Volá znovu paní Králová: večírek začne o hodinu později, **od 18:00 do 22:00**.“
- **Počáteční podmínky, délka, dokumentace:** reset těsně před pilotem (kvůli probíhající návštěvě
  `c11-seed-03`, která trvá jen 2 h od resetu). Orientačně 20 min. Účastník má UI a jeho texty,
  README na požádání.
- **Co a kdy pozorujeme:**
  - Po kroku 1: pozná, že salonek vyžaduje schválení (stav **Čeká na schválení** po Potvrdit),
    a co tomu říká.
  - Po kroku 2: najde čekající žádost a schválí ji.
  - Po kroku 3: najde sekci **Objednávky a účet** a správnou návštěvu, sestaví objednávku,
    označí podání a zaplacení a rozumí účtu (objednáno / podáno / zaplaceno).
  - Po kroku 4 (klíčový): jak řeší změnu času bez funkce „upravit“. Zruší a vytvoří znovu? Nechá
    obě? Zapomene na nové schválení? Kolikrát se zastaví?
- **Skutečný stav ověřený v klíčových bodech (readback po krocích 1, 2, 3, 4):**
  - **po 1:** rezervace Kovo / Salonek / 22. 1. 2027 17:00–21:00 = PENDING_APPROVAL;
  - **po 2:** CONFIRMED;
  - **po 3:** objednávka u `c11-seed-03` s položkami 2× Kofola (0,4 l) a 1× Guláš s knedlíkem
    ve stavu **PAID**;
  - **po 4:** původní rezervace 17:00–21:00 je CANCELLED a existuje **právě jedna** aktivní
    rezervace Kovo na salonku 18:00–22:00 ve stavu CONFIRMED (ne DRAFT ani PENDING_APPROVAL).

  Každý mezivýsledek se zapíše **před** dalším krokem; nic se mezi kroky neresetuje.
- **Dvě otázky pro debrief:** „Kde jste si během směny museli něco domyslet?“ — „Co by vám v běžný
  pátek večer chybělo nebo zdržovalo?“
- **Co se v simulaci nedá prokázat:**
  - provoz více obsluh najednou (souběh ověřují testy V-04R, ne pilot);
  - dlouhodobá spolehlivost a výkon;
  - skutečný tlak provozu;
  - reálné platby — systém jen eviduje stav „zaplaceno“;
  - že se termín schválení (30 min) projeví u žádosti, protože pilot pracuje s termíny za dva měsíce.

| Krok | Pozorování | Nápověda | Readback | Interpretace |
|---|---|---|---|---|
| 1 Salonek | nezjištěno | nezjištěno | NOT RUN | až po provedení |
| 2 Schválení | nezjištěno | nezjištěno | NOT RUN | až po provedení |
| 3 Objednávka a placení | nezjištěno | nezjištěno | NOT RUN | až po provedení |
| 4 Přesun termínu | nezjištěno | nezjištěno | NOT RUN | až po provedení |
| Debrief | nezjištěno | — | — | — |

## Před C12

- [x] Každá metoda odpovídá skutečné existující aplikaci. Úlohy používají jen existující funkce:
  vytvořit, potvrdit, schválit, zrušit, dostupnost, objednávka, podání, zaplacení.
- [x] Účastnické podklady neobsahují skrytý správný postup ani oracle. Karty jsou v samostatném
  souboru a nezmiňují tlačítka **Potvrdit** ani **Schválit**.
- [x] Interní očekávání jsou stanovena předem; při tvrzeném dokončení máme readback
  (`npm run validation:readback`).
- [x] Aplikaci a data lze bezpečně připravit: `npm run validation:env`, kontrola `--smoke`
  23. 11. 2026 prošla. Vývojová DB ani testy se nepoužívají.
- [x] Jsou uvedeny limity všech čtyř metod a účastníka.
- [ ] Plán je uložen pod identifikovatelnou verzí/commitem — doplnit commit po sloučení PR `c09`.
- [x] **Skutečné výsledky jsou prázdné (`NOT RUN`).**
- [ ] Tým plán prošel (Jarda, Honza): zkontrolovat nevodící formulace otázek a role moderátor × zapisovatel.

**Metoda/metody, které se opravdu provedou na C12:** upřesní cvičící později.
