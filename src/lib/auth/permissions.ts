import type { UserRole } from "@/types";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 100,
  manager: 50,
  operator: 10,
};

function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Managers and admins own the account-level decisions: archiving avatars,
 * writing army objectives, switching maintenance on, resolving an attention
 * item without a probe. Operators take and do; they do not decide.
 */
export function isManager(role: UserRole): boolean {
  return hasRole(role, "manager");
}
