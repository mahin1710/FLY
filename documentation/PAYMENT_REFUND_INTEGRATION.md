# FLY — Payment Gateway Refund Integration & Settlement Guide

**Module:** `fly/services/cancellation_refund_service.py`  
**Config:** `config.py` / `.env.example`

---

## 1. Supported Adapters & Separation of Concerns
1. **Supplier vs Payment Settlement Separation:** Supplier inventory cancellation (`SupplierCancellationAdapter`) updates `cancellations`, revokes QR credentials, and creates independent `refunds` tracking records. Supplier agreement does **not** mark money settled (`REFUNDED`) until payment-provider settlement confirms.
2. **Idempotency Protection:** Every gateway initiation writes a unique `idempotency_key` (`refund_transactions`) and refuses duplicate payouts for the same cancellation/refund scope (`409 DUPLICATE_REFUND` / replay).

---

## 2. SSLCommerz & International Cards (`CardGatewayRefundAdapter`)
Follows the official **SSLCommerz Developer API (`merchantTransIDvalidationAPI.php`)** contract:
- **Sandbox Endpoint:** `https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php`
- **Production Endpoint:** `https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php`
- **Parameters Sent Server-Side (`GET`, `verify=True`):**
  - `store_id` (`Config.SSLCOMMERZ_STORE_ID`)
  - `store_passwd` (`Config.SSLCOMMERZ_STORE_PASS`)
  - `bank_tran_id` (original captured transaction reference)
  - `refund_amount` (exact 2-decimal formatted BDT string)
  - `refund_remarks` (`FLY ticket refund <refund_ref>`)
  - `refund_trans_id` (unique internal `RFTR-...` ID) & `refe_id` (`<refund_ref>`)
  - `v=1`, `format=json`
- **Status Tracking:** Successful initiation returns `refund_ref_id` and transitions strictly to **`GATEWAY_PROCESSING`** (never prematurely `REFUNDED`). Background reconciliation (`run_background_reconciliation_sweep`) and Admin `POST /api/admin/refunds/<ref>/reconcile` query `refund_ref_id` status and mark `REFUNDED` only when settled amount reconciles exactly.

---

## 3. bKash, Nagad & Manual Settlement (`BankTransfer` / `Cash`)
- **bKash (`BkashRefundAdapter`) & Nagad (`NagadRefundAdapter`):** Never invent undocumented merchant API endpoints. Execute through original transaction reference in sandbox mode (`PAYMENT_GATEWAY_ACTIVE=SIMULATED`), or safely route to **`APPROVAL_PENDING`** manual review when live credentials are unconfigured.
- **Bank Transfer / Cash (`ManualSettlementRefundAdapter`):**
  - Verifies original payer account mask.
  - Requires reason (`APPROVE`), enforces **Dual Control** (`DUAL_APPROVE` by a different admin user for Bank/Cash or high-value refunds >= `DUAL_APPROVAL_THRESHOLD_BDT` = BDT 50,000), and blocks `SETTLE` -> `REFUNDED` without valid `transferReference` + `evidenceRef` (`400 EVIDENCE_REQUIRED`).
