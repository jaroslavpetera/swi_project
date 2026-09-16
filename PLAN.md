# Plán: Rezervační systém pro hospodu (C01 → C02)

Pracovní návrh k odsouhlasení týmem, než začnu psát kód a povinné dokumenty do `docs/`.
Cíl: splnit všech 15 bodů Definition of Done z `TASK.md` před C02.

---

## 1. Doména

**Resource** = stůl v hospodě (má číslo/označení, kapacitu, případně "typ" jako terasa/vnitřek).

Vycházím z nápadu v README (dluh na účtu, předobjednávka piva) a rozšiřuji na plnou doménu:

- **Reservation** – rezervace konkrétního stolu na časový slot, se stavem.
- **User** – host, který rezervaci vytváří (jméno, kontakt; volitelně vazba na "tab"/účet).
- **States**: `DRAFT → CONFIRMED → CANCELLED`, případně `NO_SHOW` / `COMPLETED` (navrhuji přidat, viz níže).
- **Operations**: create, confirm/approve, cancel, check availability.
- **Common rule**: dvě CONFIRMED rezervace stejného stolu se nesmí časově překrývat.

### Návrh vlastního business rule (domain-specific)

Dvě varianty vycházející z vašeho nápadu — vyberte jednu, nebo obě jako budoucí rozšíření:

1. **Dluh na účtu** – rezervaci nelze CONFIRM, pokud má User nesplacený dluh nad stanovený limit (váže se na "aktuální stav dluhu" z README).
2. **No-show timeout** – DRAFT rezervace, která není potvrzena do X minut před začátkem slotu, se automaticky CANCELLED.

Doporučuji variantu 2 pro C01 (je nezávislá na platebním modulu, snadněji testovatelná, dobře demonstruje state-changing operaci). Variantu 1 (dluh) lze zvolit jako **future pressure C (Changeability)** — "přidání platebního/dluhového pravidla do existujícího systému".

### External boundary

Default dle zadání: **Notification Service** (potvrzení rezervace mailem/SMS hostovi). V C01 stačí jako **stub/mock** — to je přímo náplň engineering spike B, pokud ho zvolíte.

---

## 2. Tech stack — varianty (bez C# a Javy)

Zadání povoluje libovolný stack, tým si ho zdůvodní. Tři rozumné varianty pro tříčlenný tým na semestrální projekt:

| Varianta | Stack | Proč | Riziko |
|---|---|---|---|
| **A — Python** (doporučuji) | FastAPI + PostgreSQL + SQLAlchemy + pytest | Nejrychlejší rozjezd, automatický OpenAPI/Swagger (hodí se pro "walking skeleton" demo), čitelný kód pro review | Menší striktnost typů než u staticky typovaných jazyků |
| **B — Node.js/TypeScript** | Express nebo Fastify + PostgreSQL + Prisma + Jest/Vitest | Typová bezpečnost, Prisma dobře modeluje domain entity a migrace, velká komunita | Víc boilerplate okolo async/DI než u FastAPI |
| **C — Go** | Gin/Echo + PostgreSQL + sqlc nebo pgx + `testing` | Jednoduchý jazyk, rychlá kompilace, snadné nasazení jako jeden binary, dobré demo pro Q-pressure (souběžnost) | Tým musí znát Go; víc ruční práce (žádný ORM magic) |

Perzistence: **PostgreSQL** ve všech variantách (spike A vyžaduje "skutečnou DB" — SQLite by pro spike stačil, ale Postgres je věrohodnější pro reálný systém a snadno se spustí přes Docker).

**Moje doporučení:** Python + FastAPI + PostgreSQL — nejmenší tření pro tři lidi, kteří chtějí mít brzy runnable walking skeleton (CP1 = `POST /reservations` → validace → persist → vrácení ID → automatizovaný check), a FastAPI's automatická validace (Pydantic) se dobře hodí na "validate" krok.

Napište, kterou variantu (nebo jinou) chcete — než začnu stavět `src/`, ať to sedí s tím, co tým reálně umí.

---

## 3. Struktura repozitáře (dle zadání)

```
swi_project/
├── README.md                          # + sekce "CP1 walking skeleton" (bod 9)
├── docs/
│   ├── intent-and-change.md           # Project Frame (bod 4)
│   ├── architecture-and-decisions.md  # tech stack, future pressure zdůvodnění
│   └── evidence-and-evolution.md      # C01 Engineering Spike (bod 8)
├── src/                                # dle zvoleného stacku
├── tests/
└── docker-compose.yml                 # PostgreSQL pro lokální vývoj + spike A
```

---

## 4. Future pressure — varianty k výběru

| Kategorie | Konkrétní pressure | Proč sedí na hospodu |
|---|---|---|
| **R — Risk** | Double-booking stolu v pátek večer má reálný finanční/reputační dopad | Overlap rule je jádro systému, chyba tam bolí nejvíc |
| **C — Changeability** | Přidání nového pravidla (dluh na účtu) nebo nového typu resource (VIP salónek vs. běžný stůl) | Přímo navazuje na váš nápad s dluhem |
| **Q — Scale** | 10× víc souběžných rezervací o víkendu / při akci (fotbal v TV) | Realistický scale scénář pro hospodu |
| **L — Release** | Schema migrace při přidání "předobjednávka piva" bez výpadku | Váže se na druhý nápad z README |

Doporučuji **C (Changeability)** — přímo naváže na oba nápady z README (dluh, předobjednávka piva) a dobře se demonstruje beze změny infrastruktury. Ale je to čistě týmové rozhodnutí, klidně zvolte jinou.

---

## 5. Engineering spike — varianty k výběru

| Varianta | Co obnáší | Náročnost |
|---|---|---|
| **A — Persistence** | Reservation → reálná DB → načtení zpět → ověření (running code + test) | Střední — přímo potřebné i pro walking skeleton, takže se práce nevyhodí |
| **B — Boundary failure** | Notification Service stub → simulace success/timeout/failure, test pro oba případy | Střední — dobrá demonstrace boundary z Project Frame |
| **C — Reproducible build** | Druhý člen týmu udělá clean checkout a spustí build/test/run **jen podle README** | Nejnižší náročnost, ale vyžaduje disciplínu v README už teď |

**Doporučuji A** — je to práce, kterou stejně potřebujete pro CP1 walking skeleton, takže spike navíc rovnou posune projekt dál (žádná zahozená práce).

---

## 6. Co udělám dál (po odsouhlasení výše)

1. Zapíšu `docs/intent-and-change.md` s vyplněným Project Frame (dle vašich odpovědí na body 1–5 výše).
2. Založím kostru `src/` dle zvoleného stacku + `docker-compose.yml` pro Postgres.
3. Namodeluji doménu: `Resource`, `Reservation` (se stavy), `User` + overlap rule.
4. Implementuju zvolený engineering spike jako skutečně spustitelný kód/test.
5. Zapíšu `docs/evidence-and-evolution.md` (otázka, co jsme udělali, výsledek, rozhodnutí).
6. Založím issue/PR pro "C01 engineering spike", ať ho může jiný člen týmu zreviewovat před mergem (bod 6 zadání — potřebuju vědět, kdo bude reviewer).
7. Doplním do README sekci **CP1 walking skeleton** (`POST /reservations` → validate → persist → return ID → automated check).
8. Doplním `docs/architecture-and-decisions.md` se zdůvodněním tech stacku a future pressure.

---

## 7. Otevřené otázky pro tým

- Který tech stack (A/B/C výše, nebo jiný)?
- Které business rule chcete jako to "vlastní" — dluh, no-show timeout, nebo obě (jedna teď, druhá jako future pressure)?
- Která future pressure kategorie (Q/C/R/L)?
- Který engineering spike (A/B/C)?
- Kdo bude reviewer změny pro spike (bod 6 zadání vyžaduje, aby změnu před integrací viděl jiný člen týmu)?
