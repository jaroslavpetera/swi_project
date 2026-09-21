# Activity diagram — OP-06 Place Order (extension)

Owner: A. Odpovídá `../specification.md`, sekce OP-06, BR-07 a BR-08.

```mermaid
flowchart TD
    start([Host objedná položky ke své rezervaci]) --> v0{Rezervace existuje?}
    v0 -->|ne| rej0[/Odmítnout: neznámá rezervace/]
    v0 -->|ano| v1{Stav = CONFIRMED?}
    v1 -->|ne| rej1[/Odmítnout: NOT_CONFIRMED/]
    v1 -->|ano| v2{now >= start?}
    v2 -->|ne| rej2[/Odmítnout: BEFORE_START/]
    v2 -->|ano| v3{now &lt; end?<br/>BR-01 / BR-07}
    v3 -->|ne| rej3[/Odmítnout: AFTER_END/]
    v3 -->|ano| v4{Všechny položky existují<br/>a jsou dostupné?}
    v4 -->|ne| rej4[/Odmítnout celou objednávku/]
    v4 -->|ano| price[Zafixovat aktuální ceny<br/>položek — BR-08]
    price --> persist[Uložit objednávku<br/>stav = PLACED]
    persist --> out[/Vrátit objednávku včetně součtu/]
```

## Životní cyklus objednávky

```mermaid
stateDiagram-v2
    [*] --> PLACED: place order [BR-07 splněno]
    PLACED --> SERVED: serve
    SERVED --> PAID: pay
    PAID --> [*]
```

Přeskočit krok nejde: zaplatit lze jen objednávku, která byla obsloužena (V-06.11). Účet
(*tab*) je součet objednávek rezervace rozdělený na zaplacené a nezaplacené — nezaplacená část
je „aktuální stav dluhu" z původního zadání projektu v C01.

**Proč se celá objednávka odmítá kvůli jedné neznámé položce:** částečně přijatá objednávka by
znamenala, že host neví, co dostane. Odmítnutí je hlasité a opravitelné, částečné přijetí tiché.
