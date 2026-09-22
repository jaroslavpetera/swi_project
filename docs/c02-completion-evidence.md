# Evidence C02 — dokončení po auditu issue #9

Datum: **22. 9. 2026**. Autor provedení a technické kontroly: **Codex** na pokyn
uživatele. Výchozí commit `0fa81a1fc47a0ae266f3c6efe5830fdcfbb47ebf`, pracovní
větev `codex/c02-completion`.

## Přijatá baseline

Aktuální `specification.md` je **technicky ověřený kandidát v0.2**, který zachovává
vymezení v0.1 a doplňuje schvalování/objednávky. Explicitní týmový podpis není
doložen a tento dokument jej nenahrazuje. Technická kontrola všech devíti otázek
pro REQ-01…08 je v [requirement review](c02-requirement-review.md); původně požadované
křížové review skutečným druhým členem týmu zůstává k provedení.

## Předvedené základní operace

Create, Check Availability, Confirm a Cancel běží přes skutečný HTTP server nad
SQLite. Approve/Reject a objednávky jsou ověřené navíc. Service testy používají
stejnou DB/repository a explicitní UTC čas pro přesné hranice.

## Skutečně provedené příklady ověření

Příkaz: **`npm run verify:c02`**. Běh 22. 9. 2026, 13:59:53–14:00:03 UTC
(15:59:53–16:00:03 Europe/Prague). Node.js 22.19.0, Prisma 5.20.0, Vitest 2.1.1,
Windows, nová SQLite databáze v systémovém temp adresáři. Vývojová `.env` databáze
nebyla použita. Úvodní spuštění v sandboxu blokovalo stažení engine/spawn; finální
ověření proběhlo po povolení mimo sandbox.

| Krok | Pozorovaný výsledek |
|---|---|
| Generování Prisma Client | úspěch, exit 0 |
| Migrace | všechny 3 aplikovány na novou DB, exit 0 |
| Seed | 9 položek jídelního/nápojového lístku, exit 0 |
| TypeScript build | exit 0 |
| Syntaxe `public/app.js` | `node --check`, exit 0 |
| Testy | **89 passed, 0 failed; 9 souborů**, exit 0 |

| Soubor testů | Počet |
|---|---:|
| `tests/domain/rules.test.ts` | 14 |
| `tests/domain/ordering.test.ts` | 8 |
| `tests/spike/persistence.spike.test.ts` | 1 |
| `tests/services/reservationService.test.ts` | 12 |
| `tests/services/concurrency.test.ts` | 9 |
| `tests/http/app.test.ts` | 13 |
| `tests/spec/op01-op02.test.ts` | 10 |
| `tests/spec/op06-orders.test.ts` | 11 |
| `tests/spec/c02-completion.test.ts` | 11 |

### Opakování z čisté instalace

22. 9. 2026 byla připravena nová dočasná kopie stejného snapshotu bez `node_modules`,
`.env` a databáze. `npm ci --offline --no-audit --no-fund` nainstalovalo **141 balíčků**
podle lockfile z lokální npm cache. První sandboxovaný pokus skončil `spawn EPERM`;
opakování mimo sandbox uspělo. Nejde o tvrzení o dostupnosti registru přes síť.

Následné `npm run verify:c02` (18:43:25–18:43:36 UTC / 20:43:25–20:43:36 místně)
znovu úspěšně provedlo tři migrace, seed devíti položek, build, kontrolu JS a
**89/89 testů**. Report [c02-clean-verification.json](evidence/c02-clean-verification.json)
má **shodný snapshot SHA-256** jako první běh. Závislosti tedy nebyly převzaté
kopírováním původního `node_modules`; čistá instalace i nový databázový stav byly ověřeny.

### Požadavek → operace → příklad → skutečný výsledek

Níže jsou výsledky kontrolované assertions v úspěšně spuštěných testech, nikoli
vymyšlené kopie ručních curl logů. Strojový záznam všech názvů a výsledků je
[c02-verification.json](evidence/c02-verification.json).

| REQ / operace | Úspěšný příklad a výsledek | Negativní/hraniční příklad a výsledek | Test |
|---|---|---|---|
| REQ-01 / Create | V-01.1: 201, ID, DRAFT, právě jeden řádek | V-01.2: nulová délka → 400, nevznikne rezervace; V-01.5: minulost lze vytvořit, potvrdit nelze (410) | `op01-op02`, `c02-completion` |
| REQ-02 / Availability | V-02.1: volný slot → true | V-02.2: překryv CONFIRMED → false; V-02.3/4: dotyk → true; V-02.8/9: pending/rejected/cancelled neblokují | `op01-op02`, `c02-completion` |
| REQ-03 / Confirm | Přímý Confirm → 200 CONFIRMED; V-02.8: schvalovací stůl → 202 PENDING_APPROVAL | V-03.3: přesně cutoff → CANCELLED + NoShowExpiredError; HTTP minulého draftu → 410 | `app`, `reservationService`, `c02-completion` |
| REQ-04 / alokace | V-04R.6: dvě dotýkající se rezervace uspějí | V-04R.1: kolidující potvrzení/schválení má jednoho vítěze; V-04R.8: HTTP [200,409], právě jedna CONFIRMED | `concurrency`, `c02-completion` |
| REQ-05 / Cancel | CONFIRMED před startem → CANCELLED a slot volný | Po startu → 409 beze změny; V-04.3: už CANCELLED zůstává úspěchem i po startu | `app`, `reservationService`, `c02-completion` |
| REQ-06 / Approve | Pending bez kolize → 200 CONFIRMED; Reject → 200 REJECTED | V-05.5: nová kolize → 409, zůstává pending; V-05.6: přesná hranice → EXPIRED; V-05.8 HTTP 410 a při retry 409 | `reservationService`, `app`, `c02-completion` |
| REQ-07 / Place Order | V-06.1: probíhající CONFIRMED → 201 PLACED a součet | V-06.2/3/4: nevyhovující stav/čas → 409; V-06.6 prázdná objednávka → 400 | `op06-orders`, `ordering` |
| REQ-08 / Tab | V-06.10: PLACED → SERVED → PAID, částka se přesune do paid | V-06.11: platba před obsloužením → 409; V-06.9: změna ceníku nemění existující cenu | `op06-orders` |

Další důležité výsledky:

- V-05.7: načtení opožděné pending rezervace ji ponechá pending; Reject po deadline
  vrátí REJECTED. Detekce EXPIRED nastává jen při Approve podle BR-06.
- V-05.9: `requiresApproval: "false"` je neplatný řetězec → 400; JSON boolean je
  přijímán. Dřívější coercion by řetězec vyhodnotil jako true.
- V-04R.2/3/4/5/7 ověřují duplicitní Approve, alokaci proti Cancelu, Approve/Reject,
  idempotentní dvojí Cancel a smíšený Confirm/Approve. Bariéra koordinuje dva
  nezávislé klienty až po načtení starého stavu; nejde pouze o postupné požadavky.

### Skutečný průchod demo UI

22. 9. 2026 přibližně 14:04–14:05 UTC, in-app browser na `http://localhost:3109`,
server z aktuálního buildu, databáze pouze z ověřovacího běhu:

1. Přes formulář vytvořen stůl **C02 UI approval**, kapacita 4, zaškrtnuté
   „Vyžaduje schválení“. Select zobrazil příponu „— schválení“.
2. Formulář vytvořil rezervaci pro 1. 6. 2027 18:00–20:00 místního času:
   **HTTP 201, DRAFT**, ID `6ca4571d-5c85-4ea8-88d8-8d65de3ef134`.
3. Kliknutí Confirm: **HTTP 202, PENDING_APPROVAL**; Approve i Reject byly aktivní.
4. Kliknutí Approve: **HTTP 200, CONFIRMED**; Approve i Reject byly následně zakázané.
5. Druhá rezervace `fee5c122-7353-4d79-b17d-b0b44edf14f9` prošla DRAFT → pending;
   kliknutí Reject vrátilo **HTTP 200, REJECTED**, Cancel byl zakázaný.

Časy z UI se správně odeslaly jako 16:00–18:00 UTC (Europe/Prague v červnu).
Tento průchod ověřuje ovládání UI; celou sadu hraničních situací pokrývají testy výše.

## Nalezený nesoulad a způsob vyřešení

| Nález | Rozhodnutí / oprava |
|---|---|
| K-2 nebylo uzavřené pro pending | BR-02 a OP-02 explicitně stanoví neblokování; test V-02.8/9. |
| K-5: use-case pouze v0.1 | Doplněn celý v0.2 pohled včetně Approver a OP-06 cílů. |
| BR-06 naznačovalo automatickou expiraci | Zachován skutečný trigger Approve; doplněny Reject/read/Cancel důsledky do pravidla, textu i diagramu. |
| Cancel předpoklady odporovaly idempotenci | Výjimka pro již CANCELLED uvedena nezávisle na čase; V-04.3. |
| REQ-04 nebylo garantované | Očekávaný stav a overlap podmínka přesunuty do jednoho SQLite UPDATE; ztracený závod → 409; koordinované testy. |
| Role naznačovaly kontrolu identity | R-7 přesně říká, co API předává/ověřuje; nevymýšlí autentizaci. |
| Chybějící schvalování v UI | Boolean checkbox, Approve/Reject a viditelné HTTP výsledky; ověřeno v prohlížeči. |
| Staré počty a odkazy | Aktuální evidence oddělena od historických 24/40/43/69 testů; opraveny BR a R odkazy. |

## Shrnutí dopadu změny

[Analýza před dnešní úpravou](c02-completion-impact.md) identifikuje dotčené i
nedotčené části. Úplná analýza schvalování je v `specification.md`: Create a
pravidlo dostupnosti zůstávají, Confirm má novou větev, Cancel další výchozí stav,
Approve/Approver a BR-05/06 přibývají. Intervaly, exklusivita a ceny objednávek se
nemění. Dnešní oprava souběhu realizuje již existující REQ-04 pro SQLite.

## Zbývající předpoklad / neznámá

- **Lidské review a schválení:** původní plán vyžaduje druhého člena týmu a podpis
  baseline. Technická kontrola je hotová, jejich jednání nelze agentem deklarovat.
- **Původní časová posloupnost:** analýza z 21. 9. nebyla doložena jako předcházející
  implementaci. Dnešní předem zapsaná analýza tuto historii zpětně neopravuje.
- **Rozsah:** autorizace, walk-in, platební provider a background expiry jsou
  explicitně mimo kandidáta. Nejde o nerozhodnuté větve jeho základních operací.

## Architektonické drivery přenesené do C03

1. Stejná garance exklusivity po přechodu na PostgreSQL a při 10× souběhu; ověřit
   izolaci/constrainty, nezaměnit SQLite výsledek za důkaz přenositelnosti.
2. Aktivní expirace a notifikace bez dalšího Approve; definovat worker, retry a
   observability podle potřeb produktu.

## Commit / identifikace ověřené aplikace

Base: `0fa81a1fc47a0ae266f3c6efe5830fdcfbb47ebf` + pracovní změny této větve.
**Snapshot SHA-256: `13453bf90dcbd7b1aecbc9473ca26eae491f5073fd6ee744097f571fd1a674a2`.**
Strojový manifest obsahuje hash každého zdrojového souboru, testů, migrací, UI,
specifikace, diagramů, review, předběžné analýzy, README a konfigurace. Hash
neobsahuje tento popis výsledků ani sám sebe, aby nevznikla kruhová závislost.
Samotný base commit není vydáván za commit obsahující nové změny.

## Aktualizovaný stav issue #9

| Body | Stav po dokončení |
|---|---|
| 1, 3, 4, 5, 8, 9, 12, 16 | Nadále splněné a ověřené. |
| **6, 11, 13, 15** | **Dokončené:** konzistence, úplný dopad, oba diagramy v0.2, integrovaná reprodukovatelná evidence. |
| **2** | Všech 8 požadavků technicky zkontrolováno přes 9 otázek; lidské křížové review dle původního plánu ještě chybí. |
| 7 | Týmový podpis v0.1 stále nedoložen. |
| 10 | Původní předchozí analýza nedoložena; dnešní změna má vlastní předchozí analýzu. |
| 14 | Běžící kandidát v0.2 a REQ-04 ověřeny; slovo „schválené“ čeká na skutečný týmový podpis. |

Celkem **12 plně doložených bodů**; u zbývajících čtyř je přesně pojmenovaná
procesní mezera. Issue nebylo na GitHubu uzavřeno ani označeno za plně dokončené.
