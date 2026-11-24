<?php

namespace App\Services\Operations;

use App\Models\DualApproval;
use App\Models\User;
use App\Services\Audit\AdminAuditService;
use InvalidArgumentException;
use RuntimeException;

class DualApprovalService
{
    public function __construct(
        protected AdminAuditService $auditService
    ) {}

    /**
     * Submit an action for secondary administrative dual approval.
     */
    public function requestApproval(
        User $initiator,
        string $actionType,
        string $targetType,
        string|int $targetId,
        array $payload,
        string $reason
    ): DualApproval {
        if (empty($reason) || strlen(trim($reason)) < 5) {
            throw new InvalidArgumentException('A detailed reason (min 5 chars) is required to request dual approval.', 422);
        }

        $approval = DualApproval::create([
            'action_type'          => $actionType,
            'target_type'          => $targetType,
            'target_id'            => (string) $targetId,
            'requested_payload'    => $payload,
            'reason'               => trim($reason),
            'requested_by_user_id' => $initiator->id,
            'status'               => 'pending',
        ]);

        $this->auditService->log(
            $initiator,
            'dual_approval_requested',
            'dual_approvals',
            $approval->id,
            $reason,
            null,
            ['action_type' => $actionType, 'target_id' => $targetId]
        );

        return $approval;
    }

    /**
     * Decide on a dual approval request (Approve or Reject).
     * Strictly enforces segregation of duties: initiator cannot approve their own request!
     */
    public function decide(
        DualApproval $approval,
        User $decider,
        bool $isApproved,
        string $decisionReason
    ): DualApproval {
        if ($approval->status !== 'pending') {
            throw new RuntimeException("Dual approval request is already {$approval->status}.", 422);
        }

        if ($approval->requested_by_user_id === $decider->id) {
            throw new RuntimeException('Segregation of duties violation: An administrator cannot approve their own dual approval request.', 403);
        }

        if (empty($decisionReason) || strlen(trim($decisionReason)) < 5) {
            throw new InvalidArgumentException('A decision justification reason (min 5 chars) is mandatory.', 422);
        }

        $beforeState = ['status' => $approval->status];

        $approval->status = $isApproved ? 'approved' : 'rejected';
        $approval->approved_by_user_id = $decider->id;
        $approval->decision_reason = trim($decisionReason);
        $approval->decided_at = now();
        $approval->save();

        $this->auditService->log(
            $decider,
            'dual_approval_decide',
            'dual_approvals',
            $approval->id,
            $decisionReason,
            $beforeState,
            ['status' => $approval->status, 'decision_reason' => $approval->decision_reason]
        );

        return $approval;
    }
}
