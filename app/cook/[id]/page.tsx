import { CookMode } from "@/components/CookMode";

export default async function CookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CookMode recipeId={id} />;
}
