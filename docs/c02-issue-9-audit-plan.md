# Issue #9 — kontrola C02 a plán dokončení

> **Následné provedení plánu:** [evidence dokončení C02](c02-completion-evidence.md)
> obsahuje aktuální stav, 89 úspěšných testů a novou trasovatelnost. Níže je zachován
> původní audit `0fa81a1`, aby se neztratilo, z čeho plán vycházel. Po dokončení je
> 12 bodů plně doložených; lidské review/schválení a původní pořadí analýzy zůstávají
> otevřené, nikoli zpětně označené za splněné.

Datum kontroly: **22. 9. 2026**.

**Závěr: C02 ještě není celé splněné.** Z 16 bodů je 8 doložených, 5 částečně
splněných, 2 nesplněné a u 1 není doložen požadovaný časový postup. Funkční základ
je hotový; hlavní zbývající práce je sjednocení specifikace, diagramů, review a evidence.

## Rozsah a zdroje kontroly

- [Issue #9 — Checkpoint C02](https://github.com/jaroslavpetera/swi_project/issues/9)
  je otevřené, přesto má štítek `done`. Komentář odkazuje na navázaná issues.
- [#10 — C02 - B](https://github.com/jaroslavpetera/swi_project/issues/10) a
  [#11 — C02 - A](https://github.com/jaroslavpetera/swi_project/issues/11) jsou uzavřené.
- Kontrolovaný stav je aktuální GitHub `main`, commit
  [`0fa81a1`](https://github.com/jaroslavpetera/swi_project/commit/0fa81a1fc47a0ae266f3c6efe5830fdcfbb47ebf).
  GitHub API potvrdilo shodu s lokálním `origin/main`.
- [PR #13](https://github.com/jaroslavpetera/swi_project/pull/13) má schválení
  Jaroslava Petery „LGTM“ z 21. 9. 2026. To dokládá review integrace, ale samo
  nedokládá devítibodovou kontrolu každého požadavku ani explicitní schválení baseline.
- Aktuální pracovní větev `adding-url-in-terminal-print` na `417212f` je starší.
  Tento audit hodnotí `main`, nikoli tuto pracovní větev. V ní přibyl pouze tento dokument.
  Odkazy na soubory níže se vztahují ke kontrolovanému commitu na `main`.

## Kontrola všech bodů issue

„Splněno“ znamená doložený konkrétní bod; neznamená automaticky splnění související
kontroly konzistence nebo týmového schválení.

| # | Požadavek | Stav | Důkaz / co zbývá |
|---|---|---|---|
| 1 | Úplná textová specifikace čtyř operací | **Splněno** | `docs/specification.md`: OP-01 Create, OP-02 Availability, OP-03 Confirm, OP-04 Cancel obsahují scénáře, předpoklady, výsledky, chyby, pravidla a příklady. Rozpory řeší bod 6. |
| 2 | Kontrola přijetí každého požadavku | **Částečně** | Acceptance review je rozepsané jen pro REQ-01/02 a obě mají `pending`. Chybí doložené dokončení review REQ-03 až REQ-08, pokud objednávky zůstávají součástí přijatého rozsahu. |
| 3 | Společná pravidla a invarianty definované jednou | **Splněno** | Autoritativní BR-01 až BR-08 jsou v jedné sekci specifikace, operace na ně odkazují. Staré odkazy v dalších dokumentech je nutné opravit. |
| 4 | Use-case pohled minimálního systému | **Splněno pro v0.1** | `docs/diagrams/use-case.md` obsahuje hranici systému, Host/Staff a čtyři cíle. Rozšíření v0.2 hodnotí bod 13. |
| 5 | Stavový diagram životního cyklu Reservation | **Splněno** | `docs/diagrams/state-diagram.md` obsahuje v0.1 i v0.2, včetně PENDING_APPROVAL, REJECTED a EXPIRED. |
| 6 | Konzistence textu, požadavků a diagramů | **Částečně** | K-2 pro v0.2 a K-5 jsou výslovně OPEN. Navíc je potřeba sjednotit expiraci, výjimku idempotentního Cancelu a formulace o souběhu. |
| 7 | Explicitní týmové schválení baseline v0.1 | **Nesplněno** | Hlavička specifikace říká `awaiting joint sign-off`, Approval je `pending`; evidence schválení také výslovně postrádá. |
| 8 | Aplikace demonstruje čtyři základní operace | **Splněno** | Implementace API, testovací UI, zaznamenané HTTP průchody a aktuální úspěšné HTTP/service testy. |
| 9 | Skutečný úspěšný i negativní/hraniční příklad na operaci | **Splněno** | OP-01/02: `docs/c02-verification-runs.md`; OP-03/04: `docs/evidence-and-evolution.md`. Aktuální testy pokrývají i tyto scénáře. |
| 10 | Analýza dopadu před úpravou specifikace | **Nedoloženo** | Analýza existuje, ale samotný nadpis „PŘED psaním“ neprokazuje pořadí. Evidence uvádí jeden souvislý běh v0.1/v0.2; prozkoumaná historie a PR neobsahují samostatný doložený předchozí checkpoint analýzy. |
| 11 | Explicitně dotčené i nedotčené části | **Částečně** | Část B je vyplněná; Create, Availability, use-case pohled a ověření stále odkazují na nedokončenou část A. |
| 12 | Úplná specifikace nové operace Approve | **Splněno** | OP-05 má approve/reject/expired, guardy, výsledky, alternativy a příklady. Sjednocení významu expirace patří do bodu 6. |
| 13 | Oba diagramy aktualizované na v0.2 | **Částečně** | Stavový diagram ano; use-case zůstává v0.1, chybí Approver, Approve/Reject a při ponechání rozšíření také objednávky. |
| 14 | Běžící aplikace odpovídá schválené v0.2 | **Nesplněno** | Implementace v0.2 existuje a testy procházejí, ale baseline není schválená; souběh REQ-04 není garantovaný a některé významy zůstávají otevřené. |
| 15 | Evidence propojuje specifikaci s běžícím chováním | **Částečně** | Vazby OP/REQ → příklady → výstupy existují, ale jsou rozdělené podle větví; chybí sjednocený závěr pro integrovaný commit, aktuální počty testů a schválená baseline. |
| 16 | Konkrétní architektonický driver pro C03 | **Splněno** | REQ-04: atomické potvrzení při souběhu; další driver: expirace čekajícího schválení bez aktivního časovače. Popsané ve specifikaci a evidenci. |

## Aktuální ověření

Testována dočasná kopie kontrolovaného commitu s vlastní SQLite databází `audit.db`.
Závislosti byly zkopírované z existujícího `node_modules`; nešlo o nový test čisté
instalace podle README. Prisma Client byl znovu vygenerovaný pro schéma z `main`.

- Node.js **22.19.0**, Prisma **5.20.0**, Vitest **2.1.1**.
- TypeScript build (`tsc -p tsconfig.json`): **prošel**.
- Všechny **3 migrace**: úspěšně aplikované na oddělenou databázi.
- Testy: **69/69 prošlo, 7/7 souborů**.

| Sada | Počet |
|---|---:|
| `tests/domain/rules.test.ts` | 14 |
| `tests/domain/ordering.test.ts` | 8 |
| `tests/spike/persistence.spike.test.ts` | 1 |
| `tests/services/reservationService.test.ts` | 12 |
| `tests/spec/op01-op02.test.ts` | 10 |
| `tests/spec/op06-orders.test.ts` | 11 |
| `tests/http/app.test.ts` | 13 |

Pro opakování v připravené izolované kopii:

```powershell
$env:DATABASE_URL = 'file:./audit.db'
node node_modules/prisma/build/index.js generate
# Na tomto Windows prostředí migrate deploy bez existujícího souboru skončil
# obecnou chybou Schema engine error. Po vytvoření prázdného souboru uspěl.
if (!(Test-Path -LiteralPath prisma/audit.db)) {
    New-Item -ItemType File -Path prisma/audit.db | Out-Null
}
node node_modules/prisma/build/index.js migrate deploy
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/vitest/vitest.mjs run
```

První pokusy o stažení Prisma engine a spuštění Vitestu byly omezené sandboxem;
finální migrace a testy proběhly po povoleném spuštění mimo sandbox. Vývojová databáze
nebyla použita. UI nebylo v tomto auditu ručně procházeno v prohlížeči. Úspěšná sada
testů není důkazem bezpečnosti při souběhu: stávající test re-checku při Approve
ověřuje postupnou změnu stavu, nikoli paralelní rozhodování.

## Konkrétní rozpory k uzavření

1. **Dostupnost při PENDING_APPROVAL:** kód počítá pouze CONFIRMED, ale K-2 a dopad
   změny ponechávají rozhodnutí otevřené. Doporučení: schválit, že PENDING_APPROVAL
   neblokuje stůl, a doplnit důsledky do OP-02, analýzy a testů.
2. **Expirace:** BR-06 zní jako přechod po uplynutí termínu; OP-05 a implementace
   mění stav až při `approveReservation`. `rejectReservation` deadline nekontroluje
   a běžné načtení rezervací stav nepřeklápí. Popsat jednoznačně okamžik detekce a
   chování Reject/Cancel po termínu. V C02 lze zachovat detekci při Approve, ale musí
   to být vědomé, konzistentní rozhodnutí; časovač může zůstat driverem C03.
3. **Cancel:** předpoklady OP-04 uvádějí `now < startsAt` obecně, zatímco BR-03,
   hlavní scénář a kód vracejí úspěch pro již CANCELLED i po začátku. Výjimku uvést
   explicitně také u předpokladů a výsledků.
4. **Souběh:** REQ-04 slibuje nejvýše jednu CONFIRMED rezervaci, ale service používá
   oddělené čtení a zápis. Také tvrzení, že druhý souběžný Approve vždy uvidí výsledek
   prvního, není zaručené. Tým musí zvolit buď implementaci garance nyní, nebo výslovné
   schválení omezení demonstrátoru a odložení realizace do C03; odložení samo není
   splněním REQ-04 ani úplnou shodou s nezměněnou specifikací.
5. **Rozsah objednávek:** R-11 až R-13 čekají na potvrzení B; TBD-3 se týká hostů bez
   předchozí rezervace. Doporučení: ponechat walk-in mimo C02, jasně to zapsat a
   potvrdit rozsah objednávek. Není nutné kvůli tomu zavádět další operaci.
6. **Zastaralé odkazy:** use-case a activity dokumenty používají D-xx místo R-xx;
   README odkazuje u objednávek na BR-05/06 místo BR-07/08 a uvádí 43 testů.
   Historické počty 24/40/43 zachovat jen jako výsledky konkrétních starších běhů.
   Formulaci R-7 o předání `userId` sladit s Confirm/Cancel/Approve API, které má
   pouze ID rezervace; nevytvářet zdání implementované kontroly identity.

## Plán dalšího postupu

Vlastníci A = Michal Křižák, B = Jaroslav Petera podle specifikace.
Následující rozdělení je návrh, nikoli nové přiřazení úkolů na GitHubu.

### 1. Uzavřít rozhodnutí a rozsah (A + B, první priorita)

- Rozhodnout PENDING_APPROVAL, přesnou expiraci, idempotentní Cancel, vytváření
  rezervací v minulosti a rozsah objednávek/walk-in; potvrdit R-11 až R-13.
- Rozlišit požadovanou garanci souběhu od současného omezení implementace.
- U každého zbývajícího TBD uvést rozhodnutí nebo explicitní vyloučení z baseline.

**Hotovo, když:** nezůstává žádné nerozhodnuté chování uvnitř přijímaného rozsahu;
existuje záznam rozhodnutí se zdůvodněním a skutečnými autory.

### 2. Sjednotit specifikaci a diagramy (A píše svou část, B svou; křížové review)

- A dokončí A10/A11: dopad na Create/Availability, nedotčené části a jejich důvody.
- A dokončí A12: use-case v0.2 s Approver a Approve/Reject; objednávky přidat,
  pokud jsou součástí přijaté specifikace.
- B sjednotí BR-06, OP-05 a stavový diagram; doplní výjimku Cancelu v OP-04.
- Opravit staré identifikátory D-xx/BR-xx a zastaralé věty v README i evidenci.
- Dokončit devítibodové acceptance review všech přijatých REQ a kontrolu K-1 až K-8.

**Hotovo, když:** každému cíli aktéra odpovídá specifikovaná operace, diagramy
odpovídají guardům v textu a každý přijatý REQ má dohledatelného reviewera a výsledek.

### 3. Ověřit sjednocenou v0.2 (A + B, následně nezávislé ověření)

- Spustit aplikaci z aktuálního `main` podle README v čistém prostředí.
- Doplnit cílené scénáře: PENDING_APPROVAL → dostupný slot; Approve → obsazený slot;
  Reject/Expire/Cancel → neblokující rezervace; přesná hranice `start − 30 min`;
  idempotentní Cancel po začátku; zvolené chování Reject po deadline.
- Ověřit re-check při Approve po potvrzení konkurující rezervace a oddělit tento
  postupný scénář od skutečného paralelního testu.
- Pokud se REQ-04 realizuje již teď, doplnit testy paralelních Confirm/Approve
  i kolize se zrušením. Pokud se odkládá, uvést omezení u baseline i evidence.
- UI zatím neobsahuje ovládání Approve/Reject ani příznaku `requiresApproval`.
  Dokončit A13, pokud má demo schvalování probíhat přes UI; jinak připravit jasný
  reprodukovatelný API scénář. API implementace těchto operací už existuje.

**Hotovo, když:** build a celá sada projdou; pro každou základní operaci jsou
zaznamenané kladné i záporné výsledky a nové chování v0.2 má konkrétní ověření.

### 4. Doplnit evidenci a skutečné týmové schválení (A sestaví, B ověří, tým schválí)

- Sjednotit evidenci A a B do přehledu `REQ → OP → příklad/test → výsledek → commit`.
- Zapsat aktuální integrovaný commit a počty testů; nepoužívat samotnou větev jako
  identifikaci testované aplikace. Ověřit také tagy, na které odkazuje stará evidence.
- Dohledat případný časově předcházející podklad analýzy dopadu. Pokud neexistuje,
  přiznat procesní mezeru a dohodnout nápravu s vyučujícím; novým zápisem nelze
  zpětně prokázat, že analýza proběhla před implementací.
- Zaznamenat explicitní schválení vymezené v0.1 i v0.2 se skutečným datem, jmény
  a odkazem na přesný obsah. Pozdější schválení v0.1 nepředstírat jako historické.
- Až poté aktualizovat checklist/stav #9 podle skutečně doložených výsledků.

**Hotovo, když:** všechny body #9 mají dohledatelný důkaz nebo výslovně přijatou
nápravu procesní mezery; zbývající omezení aplikace nejsou označená za hotové požadavky.

### 5. Navázat C03

- Priorita 1: atomická ochrana proti kolidujícím Confirm/Approve a konfliktům se změnou
  stavu. Architektonické rozhodnutí podložit testem paralelních operací.
- Priorita 2: přesný model expirace a případný background proces/notifikace.
- Přechod na PostgreSQL propojit s ověřením migrací a chování při souběhu.
  Samotná výměna databáze současnou mezeru mezi kontrolou a zápisem neodstraní.

Nejbližší konkrétní krok je společné uzavření bodů z fáze 1 a následná oprava
specifikace/use-case v0.2. Další rozšiřování funkcí nyní neřeší hlavní mezery C02.
