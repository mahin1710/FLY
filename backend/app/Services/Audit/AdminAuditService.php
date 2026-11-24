<?php

namespace App\Services\Audit;

use App\Models\AdminAuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use InvalidArgumentException;

class AdminAuditService
{
    /**
     * List of sensitive administrative actions requiring a mandatory reason.
     */
    protected const SENSITIVE_ACTIONS = [
        'disburse_refund',
        'reconcile_payment',
        'reconcile_ticket',
        'escalate_ticket',
        'revoke_user_sessions',
        'create_pricing_rule',
        'update_pricing_rule',
        'toggle_provider_mode',
        'dual_approval_decide',
        'manual_status_change',
    ];

    /**
     * Record an immutable administrative action audit log.
     */
    public function log(
        User $actor,
        string $action,
        string $targetType,
        string|int $targetId,
        ?string $reason = null,
        ?array $before = null,
        ?array $after = null,
        ?Request $request = null
    ): AdminAuditLog {
        // Enforce reason requirement for sensitive operations
        if (in_array($action, self::SENSITIVE_ACTIONS, true) && (empty($reason) || strlen(trim($reason)) < 5)) {
            throw new InvalidArgumentException(
                "A mandatory reason (minimum 5 characters) is required for sensitive administrative action: {$action}",
                422
            );
        }

        $ip = $request ? $request->ip() : request()->ip();
        $userAgent = $request ? substr((string) $request->userAgent(), 0, 255) : substr((string) request()->userAgent(), 0, 255);

        return AdminAuditLog::create([
            'user_id'      => $actor->id,
            'action'       => $action,
            'target_type'  => $targetType,
            'target_id'    => (string) $targetId,
            'reason'       => $reason ? trim($reason) : null,
            'ip_address'   => $ip,
            'user_agent'   => $userAgent,
            'before_state' => $before,
            'after_state'  => $after,
            'created_at'   => now(),
        ]);
    }
}
