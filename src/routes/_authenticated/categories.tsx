import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/categories")({
  head: () => ({ meta: [{ title: "Categories — Company Expense Manager" }] }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const { data: cats } = useQuery({
    queryKey: ["categories", companyId],
    queryFn: async () => (await supabase.from("categories").select("*").eq("company_id", companyId!).order("name")).data ?? [],
    enabled: !!companyId,
  });

  const add = async () => {
    if (!newName.trim() || !companyId) return;
    const { error } = await supabase.from("categories").insert({ company_id: companyId, name: newName.trim() });
    if (error) return toast.error(error.code === "23505" ? "That category already exists." : error.message);
    setNewName("");
    qc.invalidateQueries({ queryKey: ["categories"] });
    toast.success("Category added.");
  };

  const rename = async (id: string) => {
    if (!editName.trim()) return;
    const { error } = await supabase.from("categories").update({ name: editName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditId(null);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Expense Categories</h1>
        <p className="text-sm text-muted-foreground">Group your expenses. Transfers, settlements, and refunds are tracked separately by type.</p>
      </div>
      <div className="flex gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}>Add</Button>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {(cats ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              {editId === c.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                  <div className="flex">
                    <Button size="icon" variant="ghost" onClick={() => rename(c.id)}><Check className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-sm">{c.name} {c.is_default && <Badge variant="secondary" className="ml-2">Default</Badge>}</span>
                  <Button size="icon" variant="ghost" onClick={() => { setEditId(c.id); setEditName(c.name); }}><Pencil className="h-4 w-4" /></Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
