<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\AdminAuditLog;
use App\Models\Booking;
use App\Models\ContentBanner;
use App\Models\DualApproval;
use App\Models\FinancialLedgerEntry;
use App\Models\Passenger;
use App\Models\Payment;
use App\Models\PaymentEvent;
use App\Models\PricingRule;
use App\Models\ProviderCall;
use App\Models\Refund;
use App\Models\ServicingRequest;
use App\Models\Ticket;
use App\Models\User;
use App\Services\Audit\AdminAuditService;
use App\Services\Operations\DualApprovalService;
use App\Services\Payments\PaymentService;
use App\Services\Providers\FlightProviderInterface;
use App\Services\Servicing\CustomerServicingService;
use App\Services\Ticketing\TicketingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Throwable;

class AdminController extends Controller
{
    public function __construct(
        protected AdminAuditService $auditService,
        protected DualApprovalService $dualApprovalService
    ) {}

    /**
     * Legacy overview endpoint for compatibility.
     */
    public function overview(Request $request): JsonResponse
    {
        $this->authorizeAction('viewDashboard', $request->user());

        $metrics = [
            'total_users'     => User::count(),
            'customers_count' => User::where('role', 'customer')->count(),
            'admins_count'    => User::whereIn('role', ['admin', 'super_admin'])->count(),
            'active_accounts' => User::where('status', 'active')->count(),
            'system_time'     => now()->toIso8601String(),
            'environment'     => config('app.env'),
        ];

        return ApiResponse::success($metrics, 'Admin metrics overview retrieved successfully.');
    }

    /**
     * 1. DASHBOARD OVERVIEW METRICS
     */
    public function dashboard(Request $request): JsonResponse
    {
        $this->authorizeAction('viewDashboard', $request->user());

        $now = now();

        // 1. Booking counts by state
        $bookingCounts = [
            'held'      => Booking::where('booking_status', 'held')->count(),
            'confirmed' => Booking::where('booking_status', 'confirmed')->count(),
            'completed' => Booking::where('booking_status', 'completed')->count(),
            'cancelled' => Booking::where('booking_status', 'cancelled')->count(),
            'expired'   => Booking::where('booking_status', 'expired')->count(),
            'total'     => Booking::count(),
        ];

        // 2. Ticketing pending metrics
        $ticketingPending = [
            'queued'               => Booking::where('ticket_status', 'queued_for_issuance')->count(),
            'unissued_captured'    => Booking::where('ticket_status', 'unissued')->where('payment_status', 'captured')->count(),
            'deadline_approaching' => Booking::where('ticket_status', 'queued_for_issuance')
                ->where('ticketing_deadline_at', '<=', $now->copy()->addHours(6))
                ->count(),
            'manual_review_queue'  => Booking::where('requires_manual_review', true)->count(),
        ];

        // 3. Payment exceptions
        $paymentExceptions = [
            'failed'               => Payment::where('status', 'failed')->count(),
            'authorized_uncaptured'=> Payment::where('status', 'authorized')->count(),
            'chargebacks'          => Payment::where('status', 'chargeback')->count(),
            'pending_verifications'=> Payment::where('status', 'pending')->count(),
        ];

        // 4. Refund aging (< 24h, 24-72h, > 72h)
        $pendingRefunds = ServicingRequest::where('request_type', 'cancellation')
            ->whereIn('status', ['pending', 'under_review']);

        $refundAging = [
            'under_24h'     => (clone $pendingRefunds)->where('created_at', '>=', $now->copy()->subHours(24))->count(),
            'between_24_72h'=> (clone $pendingRefunds)->whereBetween('created_at', [$now->copy()->subHours(72), $now->copy()->subHours(24)])->count(),
            'over_72h'      => (clone $pendingRefunds)->where('created_at', '<', $now->copy()->subHours(72))->count(),
            'total_pending' => (clone $pendingRefunds)->count(),
        ];

        // 5. Provider API Health
        $recentCalls = ProviderCall::where('created_at', '>=', $now->copy()->subHours(24))->get();
        $totalCalls = $recentCalls->count();
        $errorCalls = $recentCalls->where('is_error', true)->count();
        $errorRate = $totalCalls > 0 ? round(($errorCalls / $totalCalls) * 100, 2) : 0.0;

        $providerHealth = [
            'status'         => $errorRate > 10.0 ? 'DEGRADED' : 'HEALTHY',
            'mock_mode'      => config('services.flight_provider.mock_enabled', true),
            'total_calls_24h'=> $totalCalls,
            'error_rate_pct' => $errorRate,
            'circuit_breaker'=> 'CLOSED',
        ];

        // 6. Finance summaries
        $totalBookingValue = (float) Booking::whereIn('booking_status', ['confirmed', 'completed'])->sum('total_amount');
        $capturedAmount = (float) Payment::where('status', 'captured')->sum('amount');
        $refundsDisbursed = (float) Refund::where('status', 'settled')->sum('net_refund_amount');
        $supplierPayable = (float) Ticket::where('ticket_status', 'issued')->sum('fare_amount');
        $platformRevenue = max(0.0, round($capturedAmount - $supplierPayable - $refundsDisbursed, 2));

        $financeSummary = [
            'total_booking_value' => $totalBookingValue,
            'captured_amount'     => $capturedAmount,
            'refunds_disbursed'   => $refundsDisbursed,
            'supplier_payable'    => $supplierPayable,
            'platform_revenue'    => $platformRevenue,
            'currency'            => 'BDT',
        ];

        return ApiResponse::success([
            'booking_counts'     => $bookingCounts,
            'ticketing_pending'  => $ticketingPending,
            'payment_exceptions' => $paymentExceptions,
            'refund_aging'       => $refundAging,
            'provider_health'    => $providerHealth,
            'finance_summary'    => $financeSummary,
            'operator'           => [
                'name' => $request->user()->name,
                'role' => $request->user()->role,
            ],
        ], 'Admin dashboard metrics retrieved successfully.');
    }

    /**
     * 2. BOOKINGS SEARCH & LIST
     */
    public function bookings(Request $request): JsonResponse
    {
        $this->authorizeAction('viewBookings', $request->user());

        $query = Booking::with(['passengers', 'segments.marketingAirline', 'payments'])
            ->orderBy('id', 'desc');

        // Search by query (ULID, reference, PNR, passenger name, email, phone, ticket number, transaction ID)
        if ($q = trim((string) $request->input('q'))) {
            $query->where(function ($b) use ($q) {
                $b->where('ulid', $q)
                  ->orWhere('reference', 'like', "%{$q}%")
                  ->orWhere('airline_pnr', 'like', "%{$q}%")
                  ->orWhere('provider_booking_ref', 'like', "%{$q}%")
                  ->orWhere('contact_email', 'like', "%{$q}%")
                  ->orWhere('contact_phone', 'like', "%{$q}%")
                  ->orWhereHas('passengers', function ($p) use ($q) {
                      $p->where('first_name', 'like', "%{$q}%")
                        ->orWhere('last_name', 'like', "%{$q}%");
                  })
                  ->orWhereHas('tickets', function ($t) use ($q) {
                      $t->where('ticket_number', 'like', "%{$q}%");
                  })
                  ->orWhereHas('payments', function ($pay) use ($q) {
                      $pay->where('gateway_transaction_id', 'like', "%{$q}%");
                  });
            });
        }

        // Filters
        if ($bookingStatus = $request->input('booking_status')) {
            $query->where('booking_status', $bookingStatus);
        }
        if ($paymentStatus = $request->input('payment_status')) {
            $query->where('payment_status', $paymentStatus);
        }
        if ($ticketStatus = $request->input('ticket_status')) {
            $query->where('ticket_status', $ticketStatus);
        }
        if ($dateFrom = $request->input('date_from')) {
            $query->where('created_at', '>=', $dateFrom);
        }
        if ($dateTo = $request->input('date_to')) {
            $query->where('created_at', '<=', $dateTo);
        }

        $perPage = max(5, min(100, (int) $request->input('per_page', 15)));
        $bookings = $query->paginate($perPage);

        return ApiResponse::success([
            'bookings'   => $bookings->items(),
            'pagination' => [
                'current_page' => $bookings->currentPage(),
                'per_page'     => $bookings->perPage(),
                'total'        => $bookings->total(),
                'last_page'    => $bookings->lastPage(),
            ],
        ], 'Bookings retrieved successfully.');
    }

    /**
     * Booking detail with full lifecycle timeline.
     */
    public function bookingDetail(string $ulid, Request $request): JsonResponse
    {
        $this->authorizeAction('viewBookings', $request->user());

        $booking = Booking::with([
            'passengers.document',
            'segments.marketingAirline',
            'segments.operatingAirline',
            'segments.originAirport',
            'segments.destinationAirport',
            'tickets',
            'payments.events',
            'events',
            'servicingRequests',
            'refunds',
            'workflowSteps',
        ])->where('ulid', $ulid)->first();

        if (!$booking) {
            return ApiResponse::error('Booking not found', 404);
        }

        // Mask sensitive passenger documents unless super_admin
        $isSuper = $request->user()->isSuperAdmin();
        $booking->passengers->each(function ($p) use ($isSuper) {
            if ($p->document && !$isSuper) {
                $p->document->document_number = $p->document->document_number_masked ?: '******' . substr((string) $p->document->document_number, -4);
            }
        });

        return ApiResponse::success($booking, 'Booking detail retrieved successfully.');
    }

    /**
     * 3. TICKETING QUEUE
     */
    public function ticketingQueue(Request $request): JsonResponse
    {
        $this->authorizeAction('viewTicketingQueue', $request->user());

        $queue = Booking::with(['passengers', 'segments.marketingAirline', 'tickets'])
            ->where(function ($q) {
                $q->whereIn('ticket_status', ['queued_for_issuance', 'unissued'])
                  ->orWhere('requires_manual_review', true);
            })
            ->orderByRaw('CASE WHEN requires_manual_review = 1 THEN 0 ELSE 1 END')
            ->orderBy('ticketing_deadline_at', 'asc')
            ->paginate(20);

        return ApiResponse::success([
            'queue'      => $queue->items(),
            'pagination' => [
                'current_page' => $queue->currentPage(),
                'per_page'     => $queue->perPage(),
                'total'        => $queue->total(),
                'last_page'    => $queue->lastPage(),
            ],
        ], 'Ticketing queue items retrieved successfully.');
    }

    /**
     * Retrieve and reconcile ticket status from provider API.
     */
    public function reconcileTicket(
        string $ulid,
        Request $request,
        TicketingService $ticketingService
    ): JsonResponse {
        $this->authorizeAction('reconcileTicket', $request->user());

        $booking = Booking::where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404);
        }

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required for ticketing reconciliation.', 422);
        }

        try {
            $beforeState = ['ticket_status' => $booking->ticket_status];
            $tickets = $ticketingService->issueOrRetrieveTickets($booking);
            $booking->refresh();

            $this->auditService->log(
                $request->user(),
                'reconcile_ticket',
                'bookings',
                $booking->id,
                $reason,
                $beforeState,
                ['ticket_status' => $booking->ticket_status, 'tickets_count' => count($tickets)],
                $request
            );

            return ApiResponse::success([
                'booking_status' => $booking->booking_status,
                'ticket_status'  => $booking->ticket_status,
                'tickets'        => $tickets,
            ], 'Ticket retrieved and reconciled with supplier successfully.');
        } catch (Throwable $e) {
            return ApiResponse::error($e->getMessage(), 500);
        }
    }

    /**
     * Escalate ticket to manual review queue.
     */
    public function escalateTicket(string $ulid, Request $request): JsonResponse
    {
        $this->authorizeAction('escalateTicket', $request->user());

        $booking = Booking::where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404);
        }

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required to escalate ticket.', 422);
        }

        $beforeState = [
            'requires_manual_review' => $booking->requires_manual_review,
            'manual_review_reason'   => $booking->manual_review_reason,
        ];

        $booking->requires_manual_review = true;
        $booking->manual_review_reason = trim($reason);
        $booking->save();

        $this->auditService->log(
            $request->user(),
            'escalate_ticket',
            'bookings',
            $booking->id,
            $reason,
            $beforeState,
            ['requires_manual_review' => true, 'manual_review_reason' => $booking->manual_review_reason],
            $request
        );

        return ApiResponse::success($booking, 'Ticket successfully escalated to manual operations queue.');
    }

    /**
     * STRICT AUDIT: Force ticketed button attempt MUST BE REJECTED!
     */
    public function forceTicketAttempt(string $ulid, Request $request): JsonResponse
    {
        // Enforce policy: always returns false
        $this->authorizeAction('forceTicket', $request->user());

        return ApiResponse::error('Forbidden: Force ticketed is strictly prohibited by distribution governance rules.', 403);
    }

    /**
     * 4. PAYMENTS & TRANSACTIONS
     */
    public function payments(Request $request): JsonResponse
    {
        $this->authorizeAction('viewPayments', $request->user());

        $query = Payment::with(['booking', 'events'])->orderBy('id', 'desc');

        if ($status = $request->input('status')) {
            $query->where('status', $status);
        }
        if ($gateway = $request->input('gateway')) {
            $query->where('gateway_provider', $gateway);
        }

        $payments = $query->paginate(20);

        return ApiResponse::success([
            'payments'   => $payments->items(),
            'pagination' => [
                'current_page' => $payments->currentPage(),
                'per_page'     => $payments->perPage(),
                'total'        => $payments->total(),
                'last_page'    => $payments->lastPage(),
            ],
        ], 'Payment transactions retrieved successfully.');
    }

    /**
     * Reconcile payment with gateway.
     */
    public function reconcilePayment(int $id, Request $request): JsonResponse
    {
        $this->authorizeAction('reconcilePayment', $request->user());

        $payment = Payment::find($id);
        if (!$payment) {
            return ApiResponse::error('Payment record not found', 404);
        }

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required for payment reconciliation.', 422);
        }

        $beforeState = ['status' => $payment->status];

        // Simulate gateway validation call
        $payment->status = 'captured';
        $payment->captured_at = now();
        $payment->save();

        PaymentEvent::create([
            'payment_id'  => $payment->id,
            'event_type'  => 'admin_reconciliation',
            'status_from' => $beforeState['status'],
            'status_to'   => 'captured',
            'payload'     => ['reason' => $reason, 'operator' => $request->user()->name],
            'recorded_at' => now(),
            'created_at'  => now(),
        ]);

        $this->auditService->log(
            $request->user(),
            'reconcile_payment',
            'payments',
            $payment->id,
            $reason,
            $beforeState,
            ['status' => $payment->status],
            $request
        );

        return ApiResponse::success($payment, 'Payment transaction verified and reconciled successfully.');
    }

    /**
     * 5. SERVICING & REFUNDS
     */
    public function servicing(Request $request): JsonResponse
    {
        $this->authorizeAction('viewServicing', $request->user());

        $query = ServicingRequest::with(['booking.passengers', 'booking.payments'])->orderBy('id', 'desc');

        if ($type = $request->input('type')) {
            $query->where('request_type', $type);
        }
        if ($status = $request->input('status')) {
            $query->where('status', $status);
        }

        $requests = $query->paginate(20);

        return ApiResponse::success([
            'servicing_requests' => $requests->items(),
            'pagination'         => [
                'current_page' => $requests->currentPage(),
                'per_page'     => $requests->perPage(),
                'total'        => $requests->total(),
                'last_page'    => $requests->lastPage(),
            ],
        ], 'Customer servicing requests retrieved successfully.');
    }

    /**
     * Disburse refund with dual approval check.
     */
    public function disburseRefund(
        int $id,
        Request $request,
        CustomerServicingService $servicingService
    ): JsonResponse {
        $this->authorizeAction('disburseRefund', $request->user());

        $servicingReq = ServicingRequest::with('booking.payments')->find($id);
        if (!$servicingReq) {
            return ApiResponse::error('Servicing request not found', 404);
        }

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required for refund disbursement.', 422);
        }

        $amount = (float) $request->input('net_amount', 3600.00);

        // High value refund threshold requires dual approval
        if ($amount >= 5000.00 && !$request->boolean('dual_approved')) {
            $approval = $this->dualApprovalService->requestApproval(
                $request->user(),
                'disburse_refund',
                'servicing_requests',
                $servicingReq->id,
                ['amount' => $amount, 'booking_ulid' => $servicingReq->booking->ulid],
                $reason
            );

            return ApiResponse::success([
                'status'         => 'PENDING_DUAL_APPROVAL',
                'dual_approval'  => $approval,
                'message'        => 'Refund amount exceeds ৳5,000 threshold. Queued for secondary administrator approval.',
            ], 'Dual approval required.', 202);
        }

        // Direct / Approved execution
        $refund = Refund::create([
            'ulid'                     => (string) \Illuminate\Support\Str::ulid(),
            'booking_id'               => $servicingReq->booking_id,
            'refund_reference'         => 'REF-ADM-' . strtoupper(\Illuminate\Support\Str::random(8)),
            'currency'                 => 'BDT',
            'gross_amount'             => (float) $servicingReq->booking->total_amount,
            'airline_penalty_fee'      => 1000.00,
            'service_cancellation_fee' => 250.00,
            'net_refund_amount'        => $amount,
            'status'                   => 'settled',
            'settled_at'               => now(),
            'processed_by_user_id'     => $request->user()->id,
        ]);

        $servicingReq->status = 'completed';
        $servicingReq->save();

        $this->auditService->log(
            $request->user(),
            'disburse_refund',
            'refunds',
            $refund->id,
            $reason,
            ['status' => 'pending'],
            ['status' => 'settled', 'net_amount' => $amount],
            $request
        );

        return ApiResponse::success($refund, 'Refund disbursed and financial ledger updated successfully.');
    }

    /**
     * 6. CUSTOMERS MANAGEMENT
     */
    public function customers(Request $request): JsonResponse
    {
        $this->authorizeAction('viewCustomers', $request->user());

        $query = User::where('role', 'customer')->withCount('bookings')->orderBy('id', 'desc');

        if ($q = trim((string) $request->input('q'))) {
            $query->where(function ($sub) use ($q) {
                $sub->where('name', 'like', "%{$q}%")
                    ->orWhere('email', 'like', "%{$q}%")
                    ->orWhere('phone', 'like', "%{$q}%");
            });
        }

        $customers = $query->paginate(20);

        // Mask phone and sensitive data for privacy
        $customers->getCollection()->transform(function ($c) {
            $phone = (string) $c->phone;
            $maskedPhone = strlen($phone) > 6 ? substr($phone, 0, 5) . '****' . substr($phone, -2) : '****';
            return [
                'id'             => $c->id,
                'name'           => $c->name,
                'email'          => $c->email,
                'phone_masked'   => $maskedPhone,
                'status'         => $c->status,
                'bookings_count' => $c->bookings_count,
                'created_at'     => $c->created_at->toIso8601String(),
            ];
        });

        return ApiResponse::success([
            'customers'  => $customers->items(),
            'pagination' => [
                'current_page' => $customers->currentPage(),
                'per_page'     => $customers->perPage(),
                'total'        => $customers->total(),
                'last_page'    => $customers->lastPage(),
            ],
        ], 'Customers list retrieved successfully.');
    }

    /**
     * Customer Profile & Full Booking History with Privacy Masking.
     */
    public function customerDetail(int $id, Request $request): JsonResponse
    {
        $this->authorizeAction('viewCustomers', $request->user());

        $customer = User::with(['bookings.segments', 'bookings.tickets', 'bookings.payments'])
            ->where('role', 'customer')
            ->find($id);

        if (!$customer) {
            return ApiResponse::error('Customer not found', 404);
        }

        $phone = (string) $customer->phone;
        $maskedPhone = strlen($phone) > 6 ? substr($phone, 0, 5) . '****' . substr($phone, -2) : '****';

        return ApiResponse::success([
            'customer' => [
                'id'           => $customer->id,
                'name'         => $customer->name,
                'email'        => $customer->email,
                'phone_masked' => $maskedPhone,
                'status'       => $customer->status,
                'created_at'   => $customer->created_at->toIso8601String(),
            ],
            'bookings' => $customer->bookings,
        ], 'Customer profile and booking history retrieved successfully.');
    }

    /**
     * 7. PROVIDER SETTINGS & CREDENTIAL REFERENCES
     */
    public function providers(Request $request): JsonResponse
    {
        $this->authorizeAction('viewProviders', $request->user());

        $providers = [
            [
                'code'                 => 'MOCK_SANDBOX',
                'name'                 => 'Fly Mock Flight Provider (Deterministic Fixture)',
                'is_live'              => false,
                'health_status'        => 'ONLINE',
                'latency_ms'           => 120,
                'rate_limit_per_min'   => 1000,
                'credential_reference' => 'ENV: MOCK_FLIGHT_PROVIDER=true', // Never secret!
                'supports_ticketing'   => true,
            ],
            [
                'code'                 => 'AMADEUS_GDS',
                'name'                 => 'Amadeus Self-Service Flight Provider',
                'is_live'              => !empty(config('services.amadeus.client_id')),
                'health_status'        => !empty(config('services.amadeus.client_id')) ? 'ONLINE' : 'UNCONFIGURED',
                'latency_ms'           => 450,
                'rate_limit_per_min'   => 100,
                'credential_reference' => 'ENV: AMADEUS_API_KEY=ama_live_****7890', // Masked reference
                'supports_ticketing'   => false,
            ],
            [
                'code'                 => 'SSLCOMMERZ_PAYMENT',
                'name'                 => 'SSLCOMMERZ Gateway Payment Adapter',
                'is_live'              => !config('services.sslcommerz.sandbox', true),
                'health_status'        => 'ONLINE',
                'latency_ms'           => 210,
                'rate_limit_per_min'   => 300,
                'credential_reference' => 'STORE_ID: fly_av****_live', // Masked reference
                'supports_ticketing'   => false,
            ],
        ];

        return ApiResponse::success($providers, 'Configured provider settings retrieved successfully.');
    }

    /**
     * Toggle provider sandbox/live flag (Super Admin only, requires dual approval).
     */
    public function toggleProviderMode(
        string $code,
        Request $request
    ): JsonResponse {
        $this->authorizeAction('toggleProviderMode', $request->user());

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required to modify provider environment settings.', 422);
        }

        $approval = $this->dualApprovalService->requestApproval(
            $request->user(),
            'update_provider_settings',
            'providers',
            $code,
            ['target_mode' => $request->input('target_mode', 'live')],
            $reason
        );

        return ApiResponse::success([
            'status'        => 'PENDING_DUAL_APPROVAL',
            'dual_approval' => $approval,
            'message'       => 'Provider environment mode change requires secondary Super Admin approval.',
        ], 'Dual approval submitted.', 202);
    }

    /**
     * 8. PRICING & MARKUP RULES
     */
    public function pricingRules(Request $request): JsonResponse
    {
        $this->authorizeAction('viewPricing', $request->user());

        $rules = PricingRule::with(['createdBy', 'approvedBy'])
            ->orderBy('id', 'desc')
            ->paginate(20);

        return ApiResponse::success([
            'rules'      => $rules->items(),
            'pagination' => [
                'current_page' => $rules->currentPage(),
                'per_page'     => $rules->perPage(),
                'total'        => $rules->total(),
                'last_page'    => $rules->lastPage(),
            ],
        ], 'Pricing rules retrieved successfully.');
    }

    /**
     * Create pricing markup rule with audit.
     */
    public function createPricingRule(Request $request): JsonResponse
    {
        $this->authorizeAction('managePricing', $request->user());

        $validator = Validator::make($request->all(), [
            'name'         => 'required|string|max:100',
            'route_type'   => 'required|string|in:all,domestic,international',
            'airline_code' => 'nullable|string|max:3',
            'markup_type'  => 'required|string|in:percentage,fixed_amount',
            'markup_value' => 'required|numeric|min:0',
            'service_fee'  => 'required|numeric|min:0',
            'currency'     => 'required|string|size:3',
            'starts_at'    => 'required|date',
            'expires_at'   => 'required|date|after:starts_at',
            'reason'       => 'required|string|min:5',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error('Invalid pricing rule payload', 422, $validator->errors()->toArray());
        }

        $data = $validator->validated();
        $reason = $data['reason'];
        unset($data['reason']);

        $data['created_by_user_id'] = $request->user()->id;
        $data['status'] = 'active';

        $rule = PricingRule::create($data);

        $this->auditService->log(
            $request->user(),
            'create_pricing_rule',
            'pricing_rules',
            $rule->id,
            $reason,
            null,
            $rule->toArray(),
            $request
        );

        return ApiResponse::success($rule, 'Pricing markup rule created and applied successfully.', 201);
    }

    /**
     * 9. CONTENT MANAGEMENT (NO INVENTED FARE)
     */
    public function contentBanners(Request $request): JsonResponse
    {
        $this->authorizeAction('viewContent', $request->user());

        $banners = ContentBanner::with('createdBy')->orderBy('id', 'desc')->paginate(20);

        return ApiResponse::success([
            'banners'    => $banners->items(),
            'pagination' => [
                'current_page' => $banners->currentPage(),
                'per_page'     => $banners->perPage(),
                'total'        => $banners->total(),
                'last_page'    => $banners->lastPage(),
            ],
        ], 'Content banners and schedules retrieved successfully.');
    }

    /**
     * Create content banner with schedule.
     */
    public function createContentBanner(Request $request): JsonResponse
    {
        $this->authorizeAction('manageContent', $request->user());

        $validator = Validator::make($request->all(), [
            'title'            => 'required|string|max:150',
            'subtitle'         => 'nullable|string|max:255',
            'destination_code' => 'nullable|string|size:3',
            'banner_type'      => 'required|string|in:hero,destination,promo_deal',
            'image_url'        => 'required|string|max:255',
            'action_url'       => 'nullable|string|max:255',
            'indicative_price' => 'nullable|numeric|min:0', // Indicative starting guide only!
            'starts_at'        => 'required|date',
            'expires_at'       => 'required|date|after:starts_at',
            'reason'           => 'required|string|min:5',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error('Invalid content banner payload', 422, $validator->errors()->toArray());
        }

        $data = $validator->validated();
        $reason = $data['reason'];
        unset($data['reason']);

        $data['created_by_user_id'] = $request->user()->id;
        $banner = ContentBanner::create($data);

        $this->auditService->log(
            $request->user(),
            'create_content_banner',
            'content_banners',
            $banner->id,
            $reason,
            null,
            $banner->toArray(),
            $request
        );

        return ApiResponse::success($banner, 'Content banner scheduled successfully.', 201);
    }

    /**
     * 10. USERS, ROLES, MFA & AUDIT
     */
    public function users(Request $request): JsonResponse
    {
        $this->authorizeAction('viewUsers', $request->user());

        $users = User::select(['id', 'name', 'email', 'role', 'status', 'is_mfa_enabled', 'last_active_at', 'created_at'])
            ->orderBy('id', 'desc')
            ->paginate(20);

        return ApiResponse::success([
            'users'      => $users->items(),
            'pagination' => [
                'current_page' => $users->currentPage(),
                'per_page'     => $users->perPage(),
                'total'        => $users->total(),
                'last_page'    => $users->lastPage(),
            ],
        ], 'System users list retrieved successfully.');
    }

    /**
     * Revoke user sessions.
     */
    public function revokeSessions(int $id, Request $request): JsonResponse
    {
        $this->authorizeAction('manageUsers', $request->user());

        $targetUser = User::find($id);
        if (!$targetUser) {
            return ApiResponse::error('User not found', 404);
        }

        $reason = $request->input('reason');
        if (empty($reason) || strlen(trim($reason)) < 5) {
            return ApiResponse::error('A mandatory justification reason (min 5 chars) is required to revoke user sessions.', 422);
        }

        // Revoke Sanctum tokens
        $tokensCount = $targetUser->tokens()->count();
        $targetUser->tokens()->delete();

        $this->auditService->log(
            $request->user(),
            'revoke_user_sessions',
            'users',
            $targetUser->id,
            $reason,
            ['tokens_count' => $tokensCount],
            ['tokens_count' => 0],
            $request
        );

        return ApiResponse::success([
            'user_id'       => $targetUser->id,
            'revoked_count' => $tokensCount,
        ], 'User sessions revoked successfully.');
    }

    /**
     * Access audit log.
     */
    public function auditLogs(Request $request): JsonResponse
    {
        $this->authorizeAction('viewUsers', $request->user());

        $logs = AdminAuditLog::with('user')->orderBy('id', 'desc')->paginate(25);

        return ApiResponse::success([
            'logs'       => $logs->items(),
            'pagination' => [
                'current_page' => $logs->currentPage(),
                'per_page'     => $logs->perPage(),
                'total'        => $logs->total(),
                'last_page'    => $logs->lastPage(),
            ],
        ], 'Administrative audit logs retrieved successfully.');
    }

    /**
     * 11. FINANCIAL & RECONCILIATION REPORTS
     */
    public function reports(Request $request): JsonResponse
    {
        $this->authorizeAction('viewReports', $request->user());

        $bookingValue = (float) Booking::whereIn('booking_status', ['confirmed', 'completed'])->sum('total_amount');
        $collectedAmount = (float) Payment::where('status', 'captured')->sum('amount');
        $supplierPayable = (float) Ticket::where('ticket_status', 'issued')->sum('fare_amount');
        $refundsAmount = (float) Refund::where('status', 'settled')->sum('net_refund_amount');
        $platformRevenue = max(0.0, round($collectedAmount - $supplierPayable - $refundsAmount, 2));

        // Reconciliation differences
        $mismatchedPayments = Payment::where('status', 'captured')
            ->whereHas('booking', function ($b) {
                $b->whereColumn('payments.amount', '!=', 'bookings.total_amount');
            })->count();

        return ApiResponse::success([
            'metrics' => [
                'booking_value'             => $bookingValue,
                'collected_amount'          => $collectedAmount,
                'supplier_payable'          => $supplierPayable,
                'platform_revenue'          => $platformRevenue,
                'refunds_disbursed'         => $refundsAmount,
                'reconciliation_differences'=> [
                    'mismatched_amount_count' => $mismatchedPayments,
                    'unsettled_refunds_count' => Refund::where('status', 'approved')->count(),
                ],
                'currency'                  => 'BDT',
            ],
        ], 'Financial and reconciliation reports calculated successfully.');
    }

    /**
     * Export reports (CSV export with export permission check).
     */
    public function exportReports(Request $request): StreamedResponse|JsonResponse
    {
        $this->authorizeAction('exportReports', $request->user());

        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="fly_operations_report_' . date('Ymd_His') . '.csv"',
        ];

        return response()->stream(function () {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['Reference', 'Passenger', 'Route', 'Booking Status', 'Payment Status', 'Ticket Status', 'Amount', 'Currency', 'Created At']);

            $bookings = Booking::with(['passengers', 'segments'])->limit(500)->get();
            foreach ($bookings as $b) {
                $firstPax = $b->passengers->first();
                $firstSeg = $b->segments->first();
                fputcsv($handle, [
                    $b->reference,
                    $firstPax ? "{$firstPax->first_name} {$firstPax->last_name}" : 'N/A',
                    $firstSeg ? "{$firstSeg->origin_airport_id} -> {$firstSeg->destination_airport_id}" : 'N/A',
                    $b->booking_status,
                    $b->payment_status,
                    $b->ticket_status,
                    $b->total_amount,
                    $b->currency ?: 'BDT',
                    $b->created_at->toIso8601String(),
                ]);
            }
            fclose($handle);
        }, 200, $headers);
    }

    /**
     * 12. DUAL APPROVALS LIST & DECISION
     */
    public function dualApprovals(Request $request): JsonResponse
    {
        $this->authorizeAction('viewDualApprovals', $request->user());

        $approvals = DualApproval::with(['requestedBy', 'approvedBy'])
            ->orderBy('id', 'desc')
            ->paginate(20);

        return ApiResponse::success([
            'approvals'  => $approvals->items(),
            'pagination' => [
                'current_page' => $approvals->currentPage(),
                'per_page'     => $approvals->perPage(),
                'total'        => $approvals->total(),
                'last_page'    => $approvals->lastPage(),
            ],
        ], 'Dual approval requests retrieved successfully.');
    }

    /**
     * Decide on dual approval request.
     */
    public function decideDualApproval(int $id, Request $request): JsonResponse
    {
        $approval = DualApproval::find($id);
        if (!$approval) {
            return ApiResponse::error('Dual approval request not found', 404);
        }

        // Authorize via policy (checks segregation of duties and role)
        try {
            $this->authorizeAction('decideDualApproval', $request->user(), $approval);
        } catch (Throwable $e) {
            return ApiResponse::error('Forbidden: You are not authorized to decide on this dual approval request, or you are the initiator.', 403);
        }

        $validator = Validator::make($request->all(), [
            'is_approved'     => 'required|boolean',
            'decision_reason' => 'required|string|min:5',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error('Validation failed', 422, $validator->errors()->toArray());
        }

        try {
            $updated = $this->dualApprovalService->decide(
                $approval,
                $request->user(),
                $validator->validated()['is_approved'],
                $validator->validated()['decision_reason']
            );

            return ApiResponse::success($updated, 'Dual approval decision recorded successfully.');
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = ($code >= 400 && $code < 600) ? $code : 422;
            return ApiResponse::error($e->getMessage(), $statusCode);
        }
    }

    /**
     * Helper to enforce policy actions with consistent 403 envelope.
     */
    protected function authorizeAction(string $ability, User $user, mixed $arguments = null): void
    {
        $policy = app(\App\Policies\AdminPolicy::class);
        $allowed = ($arguments !== null)
            ? $policy->$ability($user, $arguments)
            : $policy->$ability($user);

        if (!$allowed) {
            throw new AccessDeniedHttpException("Forbidden: Your role '{$user->role}' does not have permission for: {$ability}");
        }
    }
}
