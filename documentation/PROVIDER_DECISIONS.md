# Flight Inventory Provider Decisions & Due-Diligence Guide

**Project Brand:** FLY Aviation & Travel  
**Author / Engineering Maintainer:** `mahin1710`  
**Document Version:** 1.0.0  
**Mandatory Compliance Rule:** **Do not claim a provider can issue tickets until verified.**  
*Current Verified Status:* All active search results and bookings operate on the normalized internal database provider (`DatabaseDemoSupplier`). External providers listed below represent commercial options subject to contractual agreements and accreditation.

---

## 1. Inventory Sourcing Architecture Options

To connect the FLY platform to live airline inventory and ticketing authority, four primary supply channels exist in the aviation technology ecosystem:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FLIGHT INVENTORY SOURCING                          │
├────────────────────┬────────────────────┬───────────────────────────────┤
│ 1. Legacy GDS      │ 2. NDC Aggregators │ 3. B2B Consolidator Hubs      │
│    (Amadeus/Sabre) │    (Duffel, etc.)  │    (Flyhub, Sabre BD, TBO)    │
├────────────────────┴────────────────────┴───────────────────────────────┤
│ 4. Direct Airline APIs (Biman, US-Bangla, Air Astra, NOVOAIR)           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Comparison & Evaluation Matrix

| Sourcing Channel | Examples | Key Advantages | Primary Disadvantages & Roadblocks | Ticketing Authority Required |
|---|---|---|---|---|
| **1. Global Distribution Systems (GDS)** | Amadeus, Sabre, Travelport | Global coverage ($400+$ airlines); robust interline booking; high reliability; standardized PNR handling. | High monthly minimum fees; steep learning curve (EDIFACT/SOAP/REST); requires IATA accreditation & heavy bank guarantee. | **Requires IATA / BSP Bangladesh Accreditation** |
| **2. NDC Aggregators** | Duffel, Travelfusion | Modern developer-first REST JSON APIs; access to rich airline content (ancillaries, branded fares); rapid integration. | Lower domestic Bangladesh market coverage; variable response latencies; per-segment booking fees. | **Aggregator acts as Merchant of Record / Ticketing Agent (Depends on tier)** |
| **3. B2B Consolidator / Host Agency** | Flyhub, Sabre Bangladesh, TBO Holidays | Immediate ticketing access without own IATA license; local BDT currency settlement; high domestic airline availability. | Margin sharing (commission split); dependency on third-party uptime; non-standardized custom APIs. | **Uses Consolidator's IATA License (Turnkey)** |
| **4. Direct Carrier APIs** | Biman Bangladesh Airlines, US-Bangla | Zero GDS distribution surcharge; direct access to lowest domestic fares and full seat inventory. | Fragmented custom protocols (Navitaire, Crane, SabreSonic); individual commercial agreements with each carrier. | **Direct Carrier Merchant Agreement** |

---

## 3. Sourcing Strategy Recommendations (Phased Approach)

### Phase A: Current Development & Demonstration (Active)
- **Engine:** `DatabaseDemoSupplier` (embedded inside [`database.py`](file:///c:/Users/mahed/Desktop/FLY/database.py)).
- **Status:** **VERIFIED & OPERATIONAL.**
- **Characteristics:** Seeded with accurate Bangladesh domestic routes (Dhaka `DAC`, Chittagong `CGP`, Cox's Bazar `CXB`, Sylhet `ZYL`, Jessore `JSR`) and regional hubs (Kolkata `CCU`, Bangkok `BKK`, Dubai `DXB`, Singapore `SIN`, Kuala Lumpur `KUL`).
- **Labeling:** All generated flight numbers and tickets are explicitly badged **DEMO / SIMULATED**.

### Phase B: Commercial Launch (Recommended Path)
- **Recommended Channel:** **B2B Consolidator Hub (e.g., Flyhub / Sabre Bangladesh)**.
- **Rationale:** Obtaining an independent IATA accreditation in Bangladesh requires substantial financial audits, bank guarantees ($\sim\$50,000 - \$100,000+$ USD equivalent in BDT), and Civil Aviation Authority of Bangladesh (CAAB) licensing. Integrating with an established local consolidator allows FLY to launch commercially within weeks using the consolidator's existing ticketing authority while preserving full brand ownership on the frontend.

### Phase C: Enterprise Scale
- **Recommended Channel:** **Direct Hybrid (Amadeus/Sabre GDS + Direct NDC via Duffel)**.
- **Rationale:** Activated once monthly booking volume exceeds $1,000+$ segments to maximize net commission margins and establish direct carrier relationships.

---

## 4. Due Diligence & Commercial Readiness Checklist

Before moving any provider integration from sandbox to live commercial ticketing, the following due-diligence checklist must be formally completed and signed off:

```markdown
- [ ] Commercial Contract & NDA Executed
  - [ ] Legal entity verification
  - [ ] Clear SLA on booking/ticketing response times (<3.0s)
  - [ ] Scheduled maintenance notification protocol
- [ ] Licensing & Accreditation Verification
  - [ ] Verified IATA accreditation number OR host agency agreement
  - [ ] Civil Aviation Authority of Bangladesh (CAAB) travel agent license
  - [ ] Trade license and TIN/BIN registration in Bangladesh
- [ ] Financial Settlement & Security
  - [ ] Bank guarantee or revolving credit line established
  - [ ] Agency Debit Memo (ADM) dispute resolution policy documented
  - [ ] Void / same-day cancellation window agreed (typically 23:59 on issue date)
  - [ ] Refund processing timeline SLA (target: 7–14 business days)
- [ ] Technical Integration & Sandbox Verification
  - [ ] Sandbox test environment verified with end-to-end PNR generation
  - [ ] Test booking creation, live price quote, seat map retrieval
  - [ ] Test ticketing issuance and verified valid 13-digit e-ticket output
  - [ ] Test voluntary cancellation and void transactions
  - [ ] Error handling for sold-out segments, schedule changes, fare jumps
- [ ] Security & Data Handling
  - [ ] API keys stored in server-side KMS / environment variables (never committed)
  - [ ] IP whitelisting configured between FLY backend and provider gateway
  - [ ] PII and passport data transit encryption (TLS 1.3)
```

---

## 5. Open Commercial & Regulatory Decisions `[OPEN DECISION]`

1. `[OPEN DECISION: PROVIDER-01]` **Consolidator Partner Selection:** Which B2B flight consolidator in Bangladesh will be contracted for initial live inventory (Flyhub, Sabre Travel Network Bangladesh, or TBO Holidays)?
2. `[OPEN DECISION: PROVIDER-02]` **Bank Guarantee & Cash Deposit Allocation:** What financial deposit amount will be allocated for the airline ticket settlement credit line?
3. `[OPEN DECISION: PROVIDER-03]` **Agency Debit Memo (ADM) Liability:** How will inventory booking errors or customer chargebacks be buffered against carrier ADMs?
4. `[OPEN DECISION: PROVIDER-04]` **Direct Low-Cost Carrier (LCC) Integration:** Will domestic budget carriers (Air Astra, NOVOAIR) be booked via GDS or scraped/integrated via direct API?
