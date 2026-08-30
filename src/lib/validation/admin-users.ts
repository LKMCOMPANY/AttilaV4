import { z } from "zod";

/**
 * Member-login provisioning payload — single source of truth shared by
 * the admin server action (web dashboard) and the Bearer REST route
 * (`/api/admin/users`, native macOS client). Platform admins are
 * provisioned out-of-band: `role` only ever accepts the two member roles.
 */
export const createUserSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  display_name: z.string().min(1, "Name is required").max(100),
  role: z.enum(["manager", "operator"]),
  account_id: z.string().uuid("Invalid account"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
