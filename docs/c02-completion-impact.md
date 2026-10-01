# C02 — analýza dokončení před úpravami

Datum: 22. 9. 2026. Výchozí commit: `0fa81a1fc47a0ae266f3c6efe5830fdcfbb47ebf`.
Autor této analýzy: Codex, na pokyn uživatele dokončit plán auditu #9.
Tento dokument vzniká před změnami specifikace, implementace a testů v tomto kroku.
Nedokládá zpětně pořadí původní práce z 21. 9. 2026.

## Rozhodnutí pro implementaci a ověření

- PENDING_APPROVAL neblokuje stůl; pouze CONFIRMED představuje alokaci.
- Zachovat detekci expirace při Approve. Reject může odmítnout dosud čekající žádost
  i po deadline, Cancel ji může zrušit před začátkem. Čtení nemění stav. Nezavádět
  časovač ani automatickou expiraci při každém požadavku.
- Již CANCELLED lze idempotentně zrušit i po začátku. Create může zaznamenat minulý
  interval, ale potvrzení podléhá no-show pravidlu. Walk-in a autorizace jsou mimo rozsah.
- Ponechat objednávky a zachycení cen; role v diagramu vyjadřují doménový záměr,
  nikoli implementovanou autentizaci. Týmové schválení nebude vydáváno za provedené.
- Realizovat REQ-04 v aktuální SQLite implementaci: přechod do CONFIRMED musí v jediném
  databázovém zápisu podmínit změnu očekávaným stavem a neexistencí kolize. Ostatní
  změny stavu také podmínit očekávaným stavem, aby zrušení nepřepsalo staré potvrzení
  a naopak. Při ztraceném souběhu vracet 409; opakovaný Cancel na CANCELLED uspěje.

## Dopad

| Oblast | Dotčení a důvod | Ověření |
|---|---|---|
| OP-01 / REQ-01 | Chování beze změny; explicitně vymezit minulý interval | Stávající create scénáře + minulý interval |
| OP-02 / REQ-02 | Chování beze změny; doplnit význam všech neblokujících stavů | HTTP pending → approved/rejected/cancelled, service expired |
| OP-03 / REQ-03 | Zachovat přímou a schvalovací větev; chránit zápis při souběhu | Dosavadní HTTP testy + přesná hranice deadline |
| REQ-04 | Odstranit mezeru mezi kontrolou a zápisem | Dva nezávislé Prisma klienty, koordinované souběžné čtení, potvrzení a schválení |
| OP-04 / REQ-05 | Upřesnit výjimku idempotence; zabránit přepsání změněného stavu | Cancel po začátku; paralelní Confirm/Cancel a Approve/Cancel |
| OP-05 / REQ-06 | Upřesnit trigger expirace a Reject po deadline; chránit zápis | Hranice deadline, zamítnutí, nový konflikt, souběh |
| OP-06 / REQ-07/08 | Chování objednávek a účtu beze změny | Stávající testy objednávek a cen |
| BR-01, BR-07/08 | Intervaly, objednávací okno a ceny se nemění | Regrese existujících testů |
| Diagramy | Doplnit Approver a objednávky do v0.2; shodné guardy | Kontrola cíl → operace → stavový přechod |
| Demo UI | Přidat requiresApproval a Approve/Reject | HTTP workflow + kontrola ovládání |
| Evidence | Sjednotit REQ → test → výsledek → přesný snapshot | Výstupy build/test a otisk ověřených souborů |

## Rizika a C03

Podmíněný zápis bude ověřen na SQLite; pro PostgreSQL je nutné znovu navrhnout a
ověřit izolaci/constrainty (samotný podobný dotaz pod READ COMMITTED nestačí).
Časovač expirace, notifikace, autentizace a skutečné platební operace se nepřidávají.
Acceptance review provede Codex transparentně pod svým jménem. Požadavek původního
plánu na review druhým členem týmu a týmový podpis zůstávají lidskými kroky.
