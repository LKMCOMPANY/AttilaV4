import type { UserRole } from "@/types";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 100,
  manager: 50,
  operator: 10,
};

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

export function isManager(role: UserRole): boolean {
  return hasRole(role, "manager");
}

export function getDashboardPath(role: UserRole): string {
  if (role === "admin") return "/admin";
  return "/dashboard";
}
