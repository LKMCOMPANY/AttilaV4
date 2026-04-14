export type UserRole = "admin" | "manager" | "operator";

export type AccountStatus = "active" | "standby" | "archived";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  account_id: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  status: AccountStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountWithUsers extends Account {
  profiles: UserProfile[];
  user_count: number;
}
