# C03 — technické dokončení

Datum: 11. 10. 2026. Větev: `c03-technical-completion`. Výchozí commit: `b315e87`.
Autor technického provedení: AI agent na pokyn Honzy. Lidské review A9/HC3
dokončil Honza 11. 10. 2026; [záznam](architecture-and-decisions.md#review-a9--hc3--technická-kontrola).
Křížové review C02 a týmové schválení baseline zůstávají otevřené.
Původní tag `c03-architecture` se neposouvá.

## Provedené změny

| Úkol | Výsledek / doklad |
|---|---|
| PostgreSQL jako výchozí DB | `prisma/schema.prisma`, samostatná migrace `20261011153000_postgresql_init`, `.env.example`, Docker Compose a `scripts/dev-local.mjs`. |
| Zachování SQLite | Původní schéma a tři migrace v `prisma/sqlite/`; oba klienti se generují společně, aplikace a regrese volí provider podle URL. |
| Čistá instalace | Oddělená kopie bez `node_modules`: `npm ci --offline --no-audit --no-fund`, 158 balíčků, postinstall vygeneroval oba klienty. Existující závislosti pracovního projektu zachovány. [Report](evidence/c03-clean-install.json). |
| Lokální vývojová DB | SQLite migrace doplněny; zdroj i záloha zachovány, PostgreSQL import porovnán po celých řádcích, `.env` přepnuto až po úspěchu. Zdroj zde obsahoval 0 řádků ve všech šesti modelech. [Report](evidence/c03-local-database-migration.json). |
| Přenos neprázdných dat | Testovací fixture obsahuje User, Resource, MenuItem, Reservation, Order a OrderItem, milisekundové časy, ceny i vazby. Ověřuje shodu všech polí, bezpečné opakování a odmítnutí lišícího se cíle. [Report](evidence/c03-data-transfer-verification.json). |
| Opakovatelné PostgreSQL ověření | `npm run verify:postgres`: nová DB, `migrate deploy`, kontrola driftu vůči schématu, seed, TypeScript build, syntaxe UI, celá sada a zátěž. [Report](evidence/c03-postgres-verification.json). |
| Důkaz mechanismu ADR-03 | Dva nezávislí klienti na READ COMMITTED. Se zámkem uspěje jedna kolidující alokace; vynechání pouze zámku v testovací podtřídě reprodukuje dvě CONFIRMED. Produkční cesta zámek vždy bere. `tests/postgres/lock-mechanism.test.ts`. |
| 10× zátěž | HTTP dávky 5 a 50 požadavků, tři scénáře, tři opakování; počty odpovědí i uložený invariant se kontrolují. `scripts/postgres-load.ts`. |
| Start lokální aplikace | Lokální PostgreSQL → migrace → seed → HTTP menu/400/404; procesy se po smoke testu ukončí. [Report](evidence/c03-local-startup.json). |
| Dokumentace | Opraveno mapování BR-02 ve stavovém diagramu a realizace `ReservationTx` v H2. Setup, aktuální rizika a checklist rozlišují dnešní a historickou evidenci. |
| Expirace | ADR-04 zachovává R-16 a současné ověřitelné chování: EXPIRED se detekuje při Approve, čtení nemění stav. Worker by vyžadoval změnu baseline. |
| Původní proces C02 | [Dostupná historie prozkoumána](c02-process-history-check.md), původní pořadí nedoloženo; další nápravu řeší tým s vyučujícím. |

## Ověření a zátěž

PostgreSQL **16.14**, výchozí izolace **READ COMMITTED**. Výsledky posledního
úspěšného běhu a SHA-256 souborů jsou v reportech; samotný výchozí commit není
vydáván za commit obsahující pracovní změny.

- PostgreSQL: **95/95 testů**, včetně 2 rozlišujících testů mechanismu.
- SQLite: **93 úspěšných testů**, 2 PostgreSQL testy výslovně přeskočené.
- Zátěž: **495 požadavků** v 18 dávkách; očekávané HTTP 200/409, žádné
  neočekávané chyby a žádné porušení BR-02.

Scénáře: jeden vytížený stůl s Confirm; jeden stůl s kombinací Confirm/Approve;
samostatné stoly s kombinací Confirm/Approve. Pending fixture v kombinovaném
scénáři modeluje dříve podanou žádost po změně konfigurace Resource (V-04R.7).
Pro vytížený stůl očekáváme jeden úspěch a zbytek 409; pro různé stoly všechny úspěchy.
Report ukládá p50/p95/max, dobu dávky a propustnost po každém opakování.

Jde o lokální krátký benchmark, nikoli produkční SLA. Budoucí ověření s velkým
objemem dat, sítí a více procesy zůstává provozní prací. Limit latence pro podmínku
znovuotevření ADR-03 doplněn v C07 (C06 nález F1): p95 ≤ 500 ms na horkém stole při souběhu 50 —
[evidence](evidence-and-evolution.md#c06-internal-evidence-assessment).
Přímé SQL mimo Lifecycle stále může obejít BR-02; architektonická kontrola je textová.

## Opakování

```bash
npm ci
npm test
npm run verify:postgres
npm run verify:c02
npm run verify:docs
```

Ověřovací databáze jsou oddělené od `.env`, lokální servery poslouchají jen na
loopbacku a ukončují se přes `pg_ctl`. Dočasné DB/logy zůstávají pro diagnostiku.
Historické reporty C02 z 22. 9. se nepřepisují; aktuální SQLite regrese zapisuje
[c03-sqlite-verification.json](evidence/c03-sqlite-verification.json).

## Zbývající lidské body

1. **Dokončeno 11. 10. 2026:** Honza provedl review Části A proti `b4f597c`,
   C03 a současných změn; záznam obsahuje jméno, datum, rozsah a nálezy.
   A9/HC3 je odškrtnuto; [záznam review](architecture-and-decisions.md#review-a9--hc3--technická-kontrola).
2. **Dokončeno 26. 10. 2026 (C02 část):** Michal + Jarda — křížové review REQ-01…08 a schválení v0.1/v0.2.
   Samostatný podpis C03 zadání nevyžaduje; lidské review C03 je bod 1.
3. Tým: dodat případný původní podklad analýzy C02 nebo dohodnout nápravu s vyučujícím.
4. **Dokončeno:** issue #9 je na GitHubu uzavřené; checklist aktualizován 26. 10. 2026.

**26. 10. 2026:** body 2 (část C02) a 3 uzavřeny —
[záznam](c02-completion-evidence.md#uzavření-procesních-bodů-26-10-2026).

Technické provedení neuděluje podpis za žádného člena týmu a neuzavírá issue #9.
