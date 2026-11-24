<?php

namespace App\Policies;

use App\Models\DualApproval;
use App\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class AdminPolicy
{
    use HandlesAuthorization;

    /**
     * Determine whether the user can access the admin dashboard.
     */
    public function viewDashboard(User $user): bool
    {
        return $user->isActive() && $user->isAdmin();
    }

    /**
     * Determine whether the user can view bookings list and details.
     */
    public function viewBookings(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'ticketing_agent',
            'support_agent',
            'finance_admin',
        ], true);
    }

    /**
     * Determine whether the user can view the ticketing queue.
     */
    public function viewTicketingQueue(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'ticketing_agent',
        ], true);
    }

    /**
     * Determine whether the user can retrieve/reconcile ticket with provider.
     */
    public function reconcileTicket(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'ticketing_agent',
        ], true);
    }

    /**
     * Determine whether the user can escalate ticket to manual review queue.
     */
    public function escalateTicket(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'ticketing_agent',
        ], true);
    }

    /**
     * STRICT SECURITY MANDATE:
     * Never provide a "force ticketed" button or permission.
     * Ticket status becomes 'ticketed' ONLY from authoritative supplier proof.
     */
    public function forceTicket(User $user): bool
    {
        return false; // Denied for ALL roles unconditionally
    }

    /**
     * Determine whether the user can view payments and gateway events.
     */
    public function viewPayments(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'finance_admin',
            'operations_admin',
        ], true);
    }

    /**
     * Determine whether the user can reconcile payments.
     */
    public function reconcilePayment(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'finance_admin',
        ], true);
    }

    /**
     * Determine whether the user can view customer servicing requests and quotes.
     */
    public function viewServicing(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'finance_admin',
            'support_agent',
        ], true);
    }

    /**
     * Determine whether the user can disburse financial refunds.
     */
    public function disburseRefund(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'finance_admin',
        ], true);
    }

    /**
     * Determine whether the user can view customer profiles and histories.
     */
    public function viewCustomers(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'admin',
            'operations_admin',
            'support_agent',
        ], true);
    }

    /**
     * Determine whether the user can view provider API settings and health.
     */
    public function viewProviders(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'operations_admin',
        ], true);
    }

    /**
     * Determine whether the user can toggle provider sandbox/live mode.
     */
    public function toggleProviderMode(User $user): bool
    {
        return $user->isActive() && $user->isSuperAdmin();
    }

    /**
     * Determine whether the user can view pricing rules and markups.
     */
    public function viewPricing(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'pricing_manager',
            'operations_admin',
        ], true);
    }

    /**
     * Determine whether the user can create or update pricing rules.
     */
    public function managePricing(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'pricing_manager',
        ], true);
    }

    /**
     * Determine whether the user can view content banners and destinations.
     */
    public function viewContent(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'content_manager',
            'operations_admin',
        ], true);
    }

    /**
     * Determine whether the user can create or update content banners.
     */
    public function manageContent(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'content_manager',
        ], true);
    }

    /**
     * Determine whether the user can view system users, roles, and audit logs.
     */
    public function viewUsers(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'operations_admin',
        ], true);
    }

    /**
     * Determine whether the user can revoke user sessions or manage roles.
     */
    public function manageUsers(User $user): bool
    {
        return $user->isActive() && $user->isSuperAdmin();
    }

    /**
     * Determine whether the user can view financial and operational reports.
     */
    public function viewReports(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'operations_admin',
            'finance_admin',
            'pricing_manager',
        ], true);
    }

    /**
     * Determine whether the user can export reports and financial data.
     */
    public function exportReports(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'finance_admin',
        ], true);
    }

    /**
     * Determine whether the user can view dual approval requests.
     */
    public function viewDualApprovals(User $user): bool
    {
        return $user->isActive() && in_array($user->role, [
            'super_admin',
            'operations_admin',
            'finance_admin',
            'pricing_manager',
        ], true);
    }

    /**
     * Determine whether the user can approve/reject a dual approval request.
     * Prevents self-approval: initiator cannot approve their own request!
     */
    public function decideDualApproval(User $user, ?DualApproval $approval = null): bool
    {
        if (!$user->isActive()) {
            return false;
        }

        if ($approval && $approval->requested_by_user_id === $user->id) {
            // Strict segregation of duties: Initiator CANNOT approve own request
            return false;
        }

        if ($user->isSuperAdmin()) {
            return true;
        }

        if (!$approval) {
            return in_array($user->role, ['finance_admin', 'pricing_manager', 'operations_admin'], true);
        }

        return match ($approval->action_type) {
            'disburse_refund'          => $user->role === 'finance_admin',
            'update_pricing_rule'      => $user->role === 'pricing_manager',
            'update_provider_settings' => $user->isSuperAdmin(),
            'manual_status_change'     => in_array($user->role, ['operations_admin', 'finance_admin'], true),
            default                    => false,
        };
    }
}
