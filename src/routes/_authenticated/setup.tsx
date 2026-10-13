import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { DEFAULT_CATEGORIES } from "@/lib/finance";
import { todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/setup")({
  head: () => ({ meta: [{ title: "Company Setup — Company Expense Manager" }] }),
  component: SetupWizard,
});

function SetupWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [cashName, setCashName] = useState("Office Cash");
  const [cashOpening, setCashOpening] = useState("0");
  const [bankName, setBankName] = useState("Company Bank Account");
  const [bankOpening, setBankOpening] = useState("0");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("Please enter your company name.");
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: company, error: cErr } = await supabase
        .from("companies")
        .insert({ name: name.trim(), details: details.trim() || null, created_by: user.id })
        .select()
        .single();
      if (cErr) throw cErr;

      const { error: mErr } = await supabase
        .from("company_memberships")
        .insert({ company_id: company.id, user_id: user.id, role: "owner" });
      if (mErr) throw mErr;

      const accounts = [
        { company_id: company.id, name: cashName.trim() || "Office Cash", type: "cash" as const, opening_balance: Number(cashOpening) || 0, opening_balance_date: todayISO() },
        { company_id: company.id, name: bankName.trim() || "Company Bank Account", type: "bank" as const, opening_balance: Number(bankOpening) || 0, opening_balance_date: todayISO() },
      ];
      const { data: accts, error: aErr } = await supabase.from("accounts").insert(accounts).select();
      if (aErr) throw aErr;

      // Record opening balances as transactions so all balances derive from records
      const openingTxns = (accts ?? [])
        .filter((a) => Number(a.opening_balance) !== 0)
        .map((a) => ({
          company_id: company.id,
          type: "opening_balance" as const,
          amount: Number(a.opening_balance),
          account_id: a.id,
          txn_date: a.opening_balance_date,
          description: `Opening balance — ${a.name}`,
          created_by: user.id,
        }));
      if (openingTxns.length) {
        const { error: tErr } = await supabase.from("transactions").insert(openingTxns);
        if (tErr) throw tErr;
      }

      const { error: catErr } = await supabase
        .from("categories")
        .insert(DEFAULT_CATEGORIES.map((n) => ({ company_id: company.id, name: n, is_default: true })));
      if (catErr) throw catErr;

      await qc.invalidateQueries({ queryKey: ["company-context"] });
      toast.success("Your company is set up. Welcome!");
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setup failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set Up Your Company</CardTitle>
          <CardDescription>
            This takes less than a minute. Your financial year is set to April 1 – March 31 (you can change it later in Settings).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="cname">Company Name *</Label>
            <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Trading Co." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cdetails">Company Details (address, GST, etc. — optional)</Label>
            <Input id="cdetails" value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cash Account Name</Label>
              <Input value={cashName} onChange={(e) => setCashName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Current Cash in Hand (₹)</Label>
              <Input type="number" min="0" step="0.01" value={cashOpening} onChange={(e) => setCashOpening(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bank Account Name</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Current Bank Balance (₹)</Label>
              <Input type="number" min="0" step="0.01" value={bankOpening} onChange={(e) => setBankOpening(e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Default expense categories (office supplies, travel, food, etc.) will be added automatically — you can edit them anytime.
          </p>
          <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
            {busy ? "Setting up…" : "Create My Company"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
