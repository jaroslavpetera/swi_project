# Activity diagrams — OP-01 Create, OP-02 Check Availability (v0.1 / v0.2)

Owner: A. Each decision node corresponds to a stated precondition or failure outcome in
`../specification.md`; there is no step here that the text does not describe.

## OP-01 — Create Reservation

```mermaid
flowchart TD
    start([User submits Resource, User, interval]) --> v1{Interval valid?<br/>BR-01: start &lt; end}
    v1 -->|no| rej1[/Reject: invalid interval<br/>nothing created/]
    v1 -->|yes| v2{Resource exists?}
    v2 -->|no| rej2[/Reject: unknown Resource<br/>nothing created/]
    v2 -->|yes| v3{User exists?}
    v3 -->|no| rej3[/Reject: unknown User<br/>nothing created/]
    v3 -->|yes| persist[Create Reservation<br/>state = DRAFT]
    persist --> out[/Return identifier and state/]
    rej1 --> done([end])
    rej2 --> done
    rej3 --> done
    out --> done
```

There is no overlap check in this flow (R-2).
A draft that conflicts with a confirmed reservation is created successfully and fails later, at
confirmation. If a reviewer expects a conflict branch here, the disagreement is about R-1, not
about this diagram.

## OP-02 — Check Availability

```mermaid
flowchart TD
    start([User submits Resource and interval]) --> v1{Interval valid?<br/>BR-01: start &lt; end}
    v1 -->|no| rej1[/Reject the query<br/>never answer 'available'/]
    v1 -->|yes| v2{Resource exists?}
    v2 -->|no| rej2[/Reject the query/]
    v2 -->|yes| load[Take CONFIRMED reservations<br/>of this Resource — BR-02]
    load --> ov{Any of them overlaps<br/>the interval? BR-01}
    ov -->|yes| unavail[/Report: unavailable/]
    ov -->|no| avail[/Report: available/]
    rej1 --> done([end])
    rej2 --> done
    unavail --> done
    avail --> done
```

**Two things this flow asserts:**

1. Only CONFIRMED reservations count as blocking under BR-02 (R-1). DRAFT,
   PENDING_APPROVAL, CANCELLED, REJECTED and EXPIRED do not. The query never detects
   expiry or changes state. OP-03 and OP-05 use the same authoritative BR-02.
2. An invalid question is rejected, never answered with `available`. Reporting a free table
   because the question could not be parsed is the worst possible failure mode of this operation:
   it is wrong in the direction that causes double bookings.
