import { ItemForm } from "@/components/ItemForm";

export default function NewItemPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Novo item</h1>
      <ItemForm mode="create" />
    </main>
  );
}
