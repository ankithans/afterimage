import { ProductionWorkspace } from "./ProductionWorkspace";

export default async function ProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductionWorkspace productionId={id} />;
}
