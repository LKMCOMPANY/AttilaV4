import { getBoxes } from "@/app/actions/boxes";
import { InfrastructurePage } from "@/components/admin/infrastructure-page";

export default async function AdminInfrastructure() {
  const boxes = await getBoxes();

  return <InfrastructurePage initialBoxes={boxes} />;
}
