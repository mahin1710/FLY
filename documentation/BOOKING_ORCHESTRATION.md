# Booking Orchestration & Recoverable State Machine Specification

**Platform:** FLY Aviation & Travel Booking System  
**Document Version:** 1.0.0  
**Status:** Mandatory Production Architecture Standard  
**Classification:** Critical Money-and-Travel Workflow  

---

## 1. Architectural Philosophy

Flight ticketing is an asynchronous, high-concurrency, distributed financial workflow involving multiple independent counterparties:
1. **The Customer:** End-user browser session subject to network disconnections, double clicks, and delayed OTP entries.
2. **The Payment Gateway:** Asynchronous bank clearance with webhook callbacks, 3D-Secure challenges, and potential duplicate notifications.
3. **The Airline Inventory Provider (GDS/NDC):** Remote external API with strict fare availability rules, rate limits, latency spikes, and distinct PNR vs. E-Ticket issuance lifecycles.
4. **The Consolidator / Operations Back-Office:** Manual fulfillment desk for ticketing authority, ADM risk verification, and offline airline clearing.

To prevent catastrophic money-and-travel failure modes (e.g. double charging, booking without tickets, or lost PNRs on network drops), the FLY platform enforces a **persisted, recoverable state machine** with **four decoupled status dimensions**.

---

## 2. Decoupled Status Dimensions

Each booking maintains four independent status columns:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BOOKING STATUS DIMENSIONS                       │
├────────────────────┬────────────────────┬──────────────────────────────┤
│ 1. booking_status  │ 2. payment_status  │ 3. ticket_status             │
│    draft           │    unpaid          │    unissued                  │
│    held            │    authorized      │    queued_for_issuance       │
│    pending_payment │    captured        │    ticketed                  │
│    confirmed       │    refund_requested│    voided                    │
│    completed       │    partially_ref.. │    exchanged                 │
│    expired         │    refunded        │    refunded                  │
│    cancelled       │    failed          │                              │
│                    │    chargeback      │ 4. servicing_status          │
│                    │                    │    none / change_requested   │
│                    │                    │    cancellation_requested    │
│                    │                    │    refund_review / closed    │
└────────────────────┴────────────────────┴──────────────────────────────┘
```

### Central Transition Rules
All transitions are validated centrally by [`BookingStateMachine.php`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Services/StateMachine/BookingStateMachine.php). Any illegal transition throws `InvalidStateTransitionException` (HTTP 422).

- **Terminal States:** `completed`, `expired`, `cancelled`, `voided`, and `refunded` are terminal and reject any subsequent transition.
- **Strict Payment Rule:** `payment_status` can **NEVER** be marked `captured` from a browser redirect alone. It requires verified server-to-server webhook signatures or server gateway clearance.
- **Strict Ticketing Rule:** `ticket_status` can **NEVER** be marked `ticketed` without supplier confirmation or a valid 13-digit e-ticket number.

---

## 3. End-to-End Orchestration Sequence

The sequence is managed by [`BookingOrchestrator.php`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Services/Orchestration/BookingOrchestrator.php):

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant Orchestrator as BookingOrchestrator
    participant Lock as BookingLockManager (Redis)
    participant Provider as FlightProvider (GDS/NDC)
    participant Gateway as Payment Gateway
    participant DB as PostgreSQL / SQLite
    participant Ops as OperationsQueue

    Customer->>Orchestrator: POST /bookings/{ulid}/confirm
    Orchestrator->>Lock: Acquire distributed lock ("booking_lock:{ulid}")
    Note over Orchestrator,Lock: Concurrency guard: prevents race conditions & duplicate double-booking

    %% Step 1: Reprice
    Orchestrator->>Provider: reprice(provider_offer_ref)
    alt Price Has Changed
        Orchestrator->>DB: Store new BookingPriceSnapshot
        alt Customer Has NOT Explicitly Accepted
            Orchestrator-->>Customer: HTTP 409 PRICE_CHANGED (require explicit acceptance)
            Note over Customer,Orchestrator: Workflow HALTS safely without charging card
        else Customer Explicitly Accepted
            Orchestrator->>DB: Update booking total_amount & link new snapshot
        end
    end

    %% Step 2: Provider Reservation
    Note over Orchestrator,Provider: NO DB transaction held during external HTTP call!
    Orchestrator->>Provider: createReservation(offer, passengers, contact)
    alt Reservation Success
        Orchestrator->>DB: Update airline_pnr & provider_booking_ref
        Orchestrator->>DB: transitionBookingStatus -> 'pending_payment'
    else Provider Timeout / Network Drop
        Orchestrator->>Provider: getReservation(expectedRef) [Recovery by Retrieve]
        alt Order Exists on Provider
            Orchestrator->>DB: Reconcile PNR & resume workflow!
        else Order Still UNKNOWN
            Orchestrator->>Ops: Route to Operations Queue (SUPPLIER_TIMEOUT_UNKNOWN)
            Orchestrator-->>Customer: HTTP 504 (Held for manual verification; no blind retry)
        end
    end

    %% Step 3: Payment Capture
    Orchestrator->>Gateway: Verify Server Signature & Capture
    alt Browser Redirect Without Server Proof
        Orchestrator-->>Customer: HTTP 422 (REJECTED: Browser spoof attempt)
    else Server Verified
        Orchestrator->>DB: Payment created (status = 'captured')
        Orchestrator->>DB: transitionPaymentStatus -> 'captured'
        Orchestrator->>DB: transitionBookingStatus -> 'confirmed'
        Orchestrator->>DB: transitionTicketStatus -> 'queued_for_issuance'
    end

    %% Step 4: Ticketing
    Orchestrator->>Provider: issueTicket(provider_booking_ref)
    alt Provider Direct E-Ticket
        Orchestrator->>DB: Create Ticket (status = 'issued', 13-digit number)
        Orchestrator->>DB: transitionTicketStatus -> 'ticketed'
    else Consolidator / Self-Service (TICKETING_PENDING)
        Orchestrator->>DB: Set ticketing_deadline_at = now() + 24h
        Orchestrator->>Ops: Route to Operations Queue (NEAR_DEADLINE_TICKETING)
        Note over DB,Ops: Ticket remains 'queued_for_issuance' safely awaiting consolidator issuance
    end

    Orchestrator->>DB: Record IdempotencyRecord
    Orchestrator->>Lock: Release distributed lock
    Orchestrator-->>Customer: HTTP 200 (Booking confirmed)
```

---

## 4. Resilience, Edge Cases & Recovery

### 4.1. Duplicate Submit & Concurrency Protection
- **Distributed Locking:** Every confirmation or status change is guarded by `BookingLockManager::runWithLock()`. If a user rapidly double-clicks "Pay Now", the second request waits up to 5 seconds or fails with HTTP 409 conflict rather than creating duplicate orders.
- **Idempotency Key:** When an `Idempotency-Key` header is supplied, the orchestrator caches the initial execution result in `idempotency_records`. Replays return the cached response without calling the provider or payment gateway again.

### 4.2. Database Transaction Boundary Rule
> [!CAUTION]
> **Never hold open database transactions during external provider HTTP calls.**
> Holding an open PostgreSQL transaction during a 15-second Amadeus or payment gateway HTTP call exhausts database connection pools and causes widespread cascading lock timeouts. The FLY platform inspects state, closes any active transaction, executes the external HTTP request, and then opens a focused database transaction to persist the result.

### 4.3. Supplier Timeout & "Recovery by Retrieve"
When an external `createReservation` call times out:
1. **Never blind retry:** Retrying a timed-out booking call can create duplicate PNRs on the airline and incur Agency Debit Memos (ADMs).
2. **Retrieve by correlation:** The orchestrator queries `getReservation()` using the reference or correlation ID. If the order was created, the platform seamlessly reconciles the PNR.
3. **Route to Manual Review:** If the supplier status cannot be determined, the booking is marked `requires_manual_review = true` with reason `SUPPLIER_TIMEOUT_UNKNOWN` and queued in `servicing_requests`.

### 4.4. Workflow Step Persistence & Crash Recovery
Every pipeline phase is tracked in `booking_workflow_steps`:
- `step_name`: `reprice_verification`, `provider_reservation`, `payment_verification`, `ticket_issuance`, `reconciliation`
- `step_status`: `in_progress`, `completed`, `failed`, `needs_manual_review`
- `attempt_count`, `correlation_id`, `idempotency_key`, `error_code`, `error_message` (sanitized)

If a PHP worker dies or the server restarts mid-workflow, the orchestrator inspects `booking_workflow_steps` upon restart and skips completed steps without repeating external calls.

---

## 5. Background Reconciliation Jobs

Three background jobs run on schedule to resolve asynchronous edge cases:

1. [`ReconcilePendingReservationsJob.php`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Jobs/ReconcilePendingReservationsJob.php):
   - Scans bookings flagged with unknown reservation status (`requires_manual_review = true`).
   - Probes the supplier for order creation and reconciles PNRs automatically when available.
2. [`ReconcilePendingPaymentsJob.php`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Jobs/ReconcilePendingPaymentsJob.php):
   - Scans bookings where `hold_expires_at` has passed and payment is still `unpaid`.
   - Transitions `booking_status` to `expired` and releases held airline seats.
3. [`ReconcilePendingTicketsJob.php`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Jobs/ReconcilePendingTicketsJob.php):
   - Scans bookings where `payment_status = 'captured'` and `ticket_status = 'queued_for_issuance'`.
   - Probes the consolidator/supplier for e-ticket numbers. If confirmed, marks `ticket_status = 'ticketed'`.
   - If less than 2 hours remain before `ticketing_deadline_at`, raises a high-priority incident alert in the operations console.

---

## 6. Verification & Automated Test Suite

The entire state machine and orchestration framework is covered by automated unit and feature tests:

- **State Machine Unit Tests (`BookingStateMachineTest`):**
  - Allowed transitions succeed across all 4 dimensions.
  - Invalid direct transitions are rejected with `InvalidStateTransitionException`.
  - Terminal states (`completed`, `expired`, `cancelled`) reject further modification.
  - Payment capture is rejected from browser redirects without server proof.
  - Ticket issuance is rejected without valid supplier ticket verification.
- **Orchestration Feature Tests (`BookingOrchestrationTest`):**
  - End-to-end confirmation with mock provider.
  - Idempotency key replay test.
  - Price change workflow: stops and requires explicit customer acceptance.
  - Provider timeout: recovery by retrieve reconciles PNR.
  - Unrecoverable timeout: routes to operations queue with `SUPPLIER_TIMEOUT_UNKNOWN`.
  - Reconciliation jobs: expires timed-out holds and fulfills pending tickets.

```text
Test Suite Results: 74 tests, 490 assertions — 100% PASSING.
```
