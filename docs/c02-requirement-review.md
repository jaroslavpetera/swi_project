# C02 — kontrola přijetí požadavků

Datum: 22. 9. 2026. Reviewer: **Codex**. Rozsah: REQ-01 až REQ-08 v aktuální
`specification.md`, všechny otázky z fáze 1 původního `c02-plan.md`.
Kontrola porovnává text, diagramy, implementaci a skutečně spuštěné testy uvedené v
[evidenci](c02-completion-evidence.md). Výsledek: technicky přijatelné v uvedeném
rozsahu SQLite demonstrátoru. Nejde o podpis Michala/Jaroslava ani o náhradu
požadovaného křížového review druhým členem týmu.

## REQ-01 — Create

| Otázka | Závěr |
|---|---|
| Význam | DRAFT je úmysl, validní interval definuje BR-01, existence znamená uložený User/Resource. |
| Potřeba | Vstup celého rezervačního procesu a walking skeletonu. |
| Pozorovatelný výsledek | 201, ID, DRAFT; jedna nová rezervace, žádná alokace. |
| Proveditelnost | Implementováno v API, service a repository; reálná SQLite. |
| Ověřitelnost | V-01.1…5: vytvoření, nulová délka, neznámý stůl, konflikt, minulost. |
| Stav/čas/hranice | Minulost je výslovně povolena R-14; `start == end` odmítnuto. |
| Souběh | Dvě vytvoření mohou uspět, protože nealokují. |
| Konzistence | BR-02, OP-02/03 a vstupní hrana stavového diagramu souhlasí. Opraveno původní tvrzení, že Create vždy ponechá stůl volný — pouze nemění dostupnost. |
| Nejistota | R-7 vylučuje autentizaci; existence User není důkaz identity volajícího. |

## REQ-02 — Availability

| Otázka | Závěr |
|---|---|
| Význam | Blokuje pouze CONFIRMED, překryv určuje BR-01. |
| Potřeba | Host/obsluha mohou zjistit obsazenost před žádostí. |
| Pozorovatelný výsledek | 200 boolean; 400/404 pro neplatný dotaz; žádná změna rezervací. |
| Proveditelnost | API kontroluje existenci a validitu; service používá BR-02. |
| Ověřitelnost | V-02.1…9, V-05.6; test čistého dotazu v `op01-op02.test.ts`. |
| Stav/čas/hranice | Dotyk intervalů je volný; pending/rejected/expired/cancelled neblokují. |
| Souběh | Snapshot není hold; následný Confirm/Approve může dostat 409. |
| Konzistence | K-2 uzavřeno: stejné blokující stavy při dostupnosti i alokaci. Čtení nespouští BR-06. |
| Nejistota | Žádný nerozhodnutý stav uvnitř rozsahu; platnost odpovědi není časově garantována. |

## REQ-03 — Confirm

| Otázka | Závěr |
|---|---|
| Význam | Potvrzení je přímá alokace nebo žádost čekající na Approver podle BR-05. |
| Potřeba | Odděluje úmysl od závazné rezervace. |
| Pozorovatelný výsledek | 200 CONFIRMED / 202 PENDING_APPROVAL; chyby 404/409/410 jsou vymezené. |
| Proveditelnost | Obě větve běží nad DB a jsou dostupné v API/UI. |
| Ověřitelnost | Stávající HTTP Confirm příklady; V-02.8, V-03.3 a V-01.5. |
| Stav/čas/hranice | Pouze DRAFT; přesně na cutoff se uloží CANCELLED a vrátí 410. |
| Souběh | Podléhá REQ-04 a ochraně výchozího stavu; ztracený závod vrací 409. |
| Konzistence | Stejné guardy v BR-04/05, OP-03, activity a state diagramu. |
| Nejistota | Doménovou roli Staff neověřuje autentizace (R-7). |

## REQ-04 — souběžná alokace

| Otázka | Závěr |
|---|---|
| Význam | Nejvýše jedna ze vzájemně kolidujících alokací může uspět; starý stav nepřepíše nový. |
| Potřeba | Zabránit dvěma hostům získat stejný stůl/čas a obnovování zrušených žádostí. |
| Pozorovatelný výsledek | Vítěz CONFIRMED, poražený 409 bez alokace; zrušení není přepsáno starým čtením. |
| Proveditelnost | Podmíněný databázový zápis implementován pro SQLite; mechanismus je v ADR, nikoli v požadavku. |
| Ověřitelnost | V-04R.1…8, dva klienti s bariérou po čtení plus HTTP souběh. |
| Stav/čas/hranice | CONFIRMED je blokující; sousední intervaly oba uspějí (V-04R.6). |
| Souběh | Pokryty Confirm/Confirm, Approve/Approve, Confirm/Approve, duplicate Approve, alokace/Cancel, Approve/Reject, dvojí Cancel. |
| Konzistence | BR-02 platí při commitu; chyby 409 a možnost retry jsou shodně uvedeny u OP-03/04/05. |
| Nejistota | Zatížení 10× ani PostgreSQL nebyly tímto testem prokázány; C03 musí port garance znovu ověřit. |

## REQ-05 — Cancel

| Otázka | Závěr |
|---|---|
| Význam | Zrušení aktivní žádosti a idempotentní opakování jsou dvě explicitní větve. |
| Potřeba | Uvolnit nepotřebný slot a bezpečně opakovat požadavek po ztracené odpovědi. |
| Pozorovatelný výsledek | 200 CANCELLED; mimo okno nebo v REJECTED/EXPIRED 409, bez změny. |
| Proveditelnost | Stavová/time kontrola a podmíněný zápis implementované. |
| Ověřitelnost | HTTP success/failure, service policy testy, V-04.3, V-04R.3/5. |
| Stav/čas/hranice | `now == startsAt` zavírá okno; už CANCELLED uspěje i po konci. |
| Souběh | Dva Cancely uspějí; konflikt s novým stavem vrací 409 a dovoluje opakování. |
| Konzistence | OP-04 předpoklady nově explicitně obsahují výjimku z časového guardu; diagram ji popisuje jako no-op. |
| Nejistota | Nevymýšlí se výjimka pro Staff po začátku ani kontrola vlastnictví. |

## REQ-06 — Approve / Reject

| Otázka | Závěr |
|---|---|
| Význam | Rozhodnutí nad pending; EXPIRED znamená zjištěnou opožděnost při Approve, ne automatický časovač. |
| Potřeba | Obsluha může schválení odložit nebo odmítnout, aniž by držela stůl. |
| Pozorovatelný výsledek | 200 CONFIRMED/REJECTED, 410 s uloženým EXPIRED, 409 pro stav/kolizi. |
| Proveditelnost | API/service/UI implementovány; čas injektovatelný pro service testy. |
| Ověřitelnost | Service approval testy, HTTP approval flow, V-05.5…9 a V-04R.1/2/4/7. |
| Stav/čas/hranice | Na cutoff Approve expiruje. Reject po cutoff uspěje, čtení neexpiruje (V-05.7). |
| Souběh | Duplicitní Approve i Approve/Reject mají nejvýše jednoho vítěze. Overlap kontrolován i při zápisu. |
| Konzistence | BR-06, OP-05 a stavový diagram mají stejný trigger; rozdíl proti DRAFT no-show je záměrný. |
| Nejistota | Role Approver bez autentizace; background expiry/notifikace zůstává C03. |

## REQ-07 — objednávka

| Otázka | Závěr |
|---|---|
| Význam | Neprázdné položky dostupného menu v kladných celých množstvích pro probíhající CONFIRMED. |
| Potřeba | Navazuje službu hospody na konkrétní rezervaci. |
| Pozorovatelný výsledek | 201 PLACED s položkami/cenami; neplatný vstup nic nevytvoří. |
| Proveditelnost | API, OrderService, repository a UI existují; objednávka/položky vznikají společně. |
| Ověřitelnost | V-06.1…9, doménové ordering testy. |
| Stav/čas/hranice | `start <= now < end`; před startem a přesně na konci odmítnuto; pending neobjednává. |
| Souběh | Nezávislé POSTy znamenají nezávislé objednávky; idempotency key není slíben. |
| Konzistence | BR-07 nezasahuje do stavu Reservation ani BR-02; v use-case je cíl Guest. |
| Nejistota | Walk-in je explicitně mimo rozsah; fixture CONFIRMED není tvrzení o podpoře walk-in API. |

## REQ-08 — účet a průběh objednávky

| Otázka | Závěr |
|---|---|
| Význam | Účet rozlišuje PLACED/SERVED jako nezaplacené a PAID jako zaplacené. |
| Potřeba | Host i obsluha zjistí dluh a zaznamenají průběh služby. |
| Pozorovatelný výsledek | total = paid + unpaid; serve/pay respektují PLACED → SERVED → PAID. |
| Proveditelnost | Tab výpočet a stavové endpointy implementovány. |
| Ověřitelnost | V-06.9 cena po změně menu, V-06.10 účet/životní cyklus, V-06.11 předčasná platba. |
| Stav/čas/hranice | Prázdný účet je nula; ceny jsou zachyceny při objednání; Reservation se nemění. |
| Souběh | Účet je snapshot. Duplicitní serve/pay mohou pozorovat stejný přechod; skutečný platební účinek neexistuje. |
| Konzistence | Use-case obsahuje tab/service/payment; OP-06 a ordering stavový diagram souhlasí. |
| Nejistota | Platba je záznam stavu, bez poskytovatele, splitu či částečné úhrady. |

## Předání lidskému reviewerovi

Technické nedostatky nalezené při kontrole jsou promítnuté do specifikace, diagramů,
implementace a testů. Pro pravidlo „reviewuje jiný člen týmu“ zbývá, aby skutečný
člen týmu zkontroloval tento výsledek a zapsal své jméno, datum, rozsah REQ-01…08
a nálezy/jejich vyřešení do PR nebo dokumentace. Do té doby tento lidský procesní
bod zůstává otevřený, i když všech devět technických otázek je zodpovězeno.
