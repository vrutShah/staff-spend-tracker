import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, fetchTransactions } from "@/lib/company";
import { inr, todayISO } from "@/lib/format";
import { accountDelta } from "@/lib/finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ArrowLeftRight, Wallet, Landmark } from "lucide-react";
import { toast } from "sonner";
import { TransactionForm } from "@/components/TransactionForm";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts — Company Expense Manager" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "bank">("cash");
  const [opening, setOpening] = useState("0");

  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: async () => (await supabase.from("accounts").select("*").eq("company_id", companyId!).order("created_at")).data ?? [],
    enabled: !!companyId,
  });
  const { data: txns } = useQuery({
    queryKey: ["transactions", companyId],
    queryFn: () => fetchTransactions(companyId!),
    enabled: !!companyId,
  });

  const stats = (id: string) => {
    let inn = 0, out = 0;
    for (const t of txns ?? []) {
      const d = accountDelta(t, id);
      if (d > 0) inn += d; else out -= d;
    }
    return { inn, out, balance: inn - out };
  };

  const create = async () => {
    if (!name.trim() || !companyId) return toast.error("Enter an account name.");
    const { data: { user } } = await supabase.auth.getUser();
    const { data: acct, error } = await supabase.from("accounts").insert({
      company_id: companyId, name: name.trim(), type, opening_balance: Number(opening) || 0, opening_balance_date: todayISO(),
    }).select().single();
    if (error) return toast.error(error.message);
    if (Number(opening) > 0) {
      await supabase.from("transactions").insert({
        company_id: companyId, type: "opening_balance", amount: Number(opening), account_id: acct.id,
        description: `Opening balance — ${acct.name}`, created_by: user?.id ?? null,
      });
    }
    toast.success("Account created.");
    setAddOpen(false); setName(""); setOpening("0");
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cash & Bank Accounts</h1>
          <p className="text-sm text-muted-foreground">Transfers move money between accounts without counting as income or expense.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Account</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(accounts ?? []).map((a) => {
          const s = stats(a.id);
          const Icon = a.type === "bank" ? Landmark : Wallet;
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{a.name}</CardTitle>
                <Icon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-2xl font-bold tabular-nums">{inr(s.balance)}</p>
                <p className="text-muted-foreground">Type: <span className="capitalize">{a.type}</span> · Opening: {inr(a.opening_balance)}</p>
                <p>Money In: <span className="font-medium tabular-nums text-success">{inr(s.inn)}</span></p>
                <p>Money Out: <span className="font-medium tabular-nums text-destructive">{inr(s.out)}</span></p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Account Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Petty Cash" /></div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "cash" | "bank")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank">Bank</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Opening Balance (₹)</Label><Input type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
            <Button className="w-full" onClick={create}>Create Account</Button>
          </div>
        </DialogContent>
      </Dialog>

      {companyId && <TransactionForm companyId={companyId} open={transferOpen} onOpenChange={setTransferOpen} presetType="transfer" />}
    </div>
  );
}
