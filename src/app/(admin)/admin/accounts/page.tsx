import { getAccounts } from "@/app/actions/accounts";
import { AccountsPage } from "@/components/admin/accounts-page";

export default async function AdminAccountsPage() {
  const accounts = await getAccounts();

  return <AccountsPage initialAccounts={accounts} />;
}
