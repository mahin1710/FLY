<?php

namespace App\Policies;

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
     * Determine whether the user can view or manage users.
     */
    public function manageUsers(User $user): bool
    {
        return $user->isActive() && $user->isAdmin();
    }

    /**
     * Determine whether the user can manage flights and schedules.
     */
    public function manageFlights(User $user): bool
    {
        return $user->isActive() && $user->isAdmin();
    }

    /**
     * Determine whether the user can modify system settings (super admin only).
     */
    public function manageSettings(User $user): bool
    {
        return $user->isActive() && $user->isSuperAdmin();
    }
}
