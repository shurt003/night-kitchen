import { LibraryApp } from "@/components/LibraryApp";

// Deep link: renders the library with the detail overlay opened, so the
// shared-element morph still works and back returns to the grid.
export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LibraryApp initialRecipeId={id} />;
}
