import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { inr, fmtDate, todayISO } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/advances")({
  head: () => ({ meta: [{ title: "Staff Advances — Company Expense Manager" }] }),
  component: AdvancesPage,
});

type Advance = Tables<"staff_advances"> & { employees: { name: string } | null };

function AdvancesPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const qc = useQueryClient();
  const [empOpen, setEmpOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<Advance | null>(null);

  const { data: advances } = useQuery({
    queryKey: ["advances", companyId],
    queryFn: async () => ((await supabase.from("staff_advances").select("*, employees(name)").eq("company_id", companyId!).order("advance_date", { ascending: false })).data ?? []) as Advance[],
    enabled: !!companyId,
  });
  const { data: settlements } = useQuery({
    queryKey: ["settlements", companyId],
    queryFn: async () => (await supabase.from("advance_settlements").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const { data: employees } = useQuery({
    queryKey: ["employees", companyId],
    queryFn: async () => (await supabase.from("employees").select("*").eq("company_id", companyId!).order("name")).data ?? [],
    enabled: !!companyId,
  });

  const settledFor = (id: string) =>
    (settlements ?? []).filter((s) => s.advance_id === id)
      .reduce((x, s) => ({ bills: x.bills + Number(s.bills_amount), cash: x.cash + Number(s.cash_returned) }), { bills: 0, cash: 0 });

  const rows = useMemo(
    () =>
      (advances ?? []).map((a) => {
        const s = settledFor(a.id);
        const remaining = Math.max(0, Number(a.amount) - s.bills - s.cash);
        return { ...a, bills: s.bills, cash: s.cash, remaining };
      }),
    [advances, settlements],
  );

  const statusBadge = (s: string) =>
    s === "settled" ? <Badge className="bg-success text-success-foreground">Settled</Badge>
    : s === "partially_settled" ? <Badge variant="secondary">Partially Settled</Badge>
    : <Badge variant="destructive">Outstanding</Badge>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Staff Advances</h1>
          <p className="text-sm text-muted-foreground">Money given to employees, tracked until they submit bills or return cash.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEmpOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> Add Employee</Button>
          <Button onClick={() => setAdvOpen(true)}><Plus className="mr-2 h-4 w-4" /> Issue Advance</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Bills Submitted</TableHead>
                <TableHead className="text-right">Cash Returned</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No advances issued yet.</TableCell></TableRow>
              )}
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.employees?.name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(a.advance_date)}</TableCell>
                  <TableCell className="max-w-48 truncate">{a.purpose || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(a.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(a.bills)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(a.cash)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(a.remaining)}</TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                  <TableCell>
                    {a.status !== "settled" && (
                      <Button variant="ghost" size="sm" onClick={() => setSettleTarget(a)}>Settle</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {companyId && (
        <>
          <EmployeeDialog companyId={companyId} open={empOpen} onOpenChange={setEmpOpen} />
          <AdvanceDialog companyId={companyId} employees={employees ?? []} open={advOpen} onOpenChange={setAdvOpen} />
          {settleTarget && (
            <SettleDialog
              companyId={companyId}
              advance={settleTarget}
              remaining={rows.find((r) => r.id === settleTarget.id)?.remaining ?? 0}
              open={!!settleTarget}
              onOpenChange={(v) => !v && setSettleTarget(null)}
              onDone={() => qc.invalidateQueries()}
            />
          )}
        </>
      )}
    </div>
  );
}

function EmployeeDialog({ companyId, open, onOpenChange }: { companyId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const save = async () => {
    if (!name.trim()) return toast.error("Enter the employee's name.");
    const { error } = await supabase.from("employees").insert({ company_id: companyId, name: name.trim(), phone: phone.trim() || null });
    if (error) return toast.error(error.message);
    toast.success("Employee added.");
    setName(""); setPhone("");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["employees"] });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label>Phone (optional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <Button className="w-full" onClick={save}>Save Employee</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({ companyId, employees, open, onOpenChange }: { companyId: string; employees: Tables<"employees">[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expected, setExpected] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: async () => (await supabase.from("accounts").select("*").eq("company_id", companyId)).data ?? [],
    enabled: open,
  });

  const save = async () => {
    const amt = Number(amount);
    if (!employeeId) return toast.error("Select an employee.");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount.");
    if (!accountId) return toast.error("Select the account the money is paid from.");
    if (busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const emp = employees.find((e) => e.id === employeeId);
      const { data: txn, error: tErr } = await supabase.from("transactions").insert({
        company_id: companyId, type: "advance_issued", txn_date: date, amount: amt,
        employee_id: employeeId, account_id: accountId,
        description: `Advance to ${emp?.name ?? "employee"}${purpose ? ` — ${purpose}` : ""}`,
        created_by: user?.id ?? null,
      }).select().single();
      if (tErr) throw tErr;
      const { error: aErr } = await supabase.from("staff_advances").insert({
        company_id: companyId, employee_id: employeeId, advance_date: date, amount: amt,
        purpose: purpose.trim() || null, expected_settlement_date: expected || null, transaction_id: txn.id,
      });
      if (aErr) throw aErr;
      toast.success("Advance issued and recorded in the cash book.");
      onOpenChange(false);
      setEmployeeId(""); setAmount(""); setPurpose(""); setExpected(""); setAccountId("");
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the advance.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Staff Advance</DialogTitle>
          <DialogDescription>The amount leaves the selected account now and stays “outstanding” until settled.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Travel to client site" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Expected Settlement Date</Label><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Paid From Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Issue Advance"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettleDialog({ companyId, advance, remaining, open, onOpenChange, onDone }: {
  companyId: string; advance: Advance; remaining: number; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [bills, setBills] = useState("");
  const [cash, setCash] = useState("");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: async () => (await supabase.from("accounts").select("*").eq("company_id", companyId)).data ?? [],
    enabled: open,
  });

  const save = async () => {
    const b = Number(bills) || 0;
    const c = Number(cash) || 0;
    if (b <= 0 && c <= 0) return toast.error("Enter bills amount and/or cash returned.");
    if (b + c > remaining + 0.001) return toast.error(`Bills + cash returned (${inr(b + c)}) cannot exceed the remaining advance (${inr(remaining)}).`);
    if (c > 0 && !accountId) return toast.error("Select the account receiving the returned cash.");
    if (busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: sErr } = await supabase.from("advance_settlements").insert({
        company_id: companyId, advance_id: advance.id, settlement_date: date,
        bills_amount: b, cash_returned: c, notes: notes.trim() || null,
      });
      if (sErr) throw sErr;

      const txns: Tables<"transactions">["Insert"][] = [];
      if (b > 0) {
        txns.push({
          company_id: companyId, type: "advance_settlement", txn_date: date, amount: b,
          employee_id: advance.employee_id,
          description: `Bills settled against advance — ${advance.employees?.name ?? ""}`,
          notes: "No cash movement: money was already paid when the advance was issued.",
          created_by: user?.id ?? null,
        });
      }
      if (c > 0) {
        txns.push({
          company_id: companyId, type: "advance_cash_returned", txn_date: date, amount: c,
          employee_id: advance.employee_id, account_id: accountId,
          description: `Unused advance returned — ${advance.employees?.name ?? ""}`,
          created_by: user?.id ?? null,
        });
      }
      const { error: tErr } = await supabase.from("transactions").insert(txns);
      if (tErr) throw tErr;

      const newRemaining = remaining - b - c;
      const { error: uErr } = await supabase.from("staff_advances").update({
        status: newRemaining <= 0.001 ? "settled" : "partially_settled",
      }).eq("id", advance.id);
      if (uErr) throw uErr;

      toast.success(newRemaining <= 0.001 ? "Advance fully settled." : "Partial settlement recorded.");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the settlement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle Advance — {advance.employees?.name}</DialogTitle>
          <DialogDescription>Remaining to settle: <strong>{inr(remaining)}</strong> of {inr(advance.amount)} issued.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Settlement Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Bills Submitted (₹)</Label><Input type="number" min="0" step="0.01" value={bills} onChange={(e) => setBills(e.target.value)} placeholder="0.00" /></div>
            <div className="space-y-2"><Label>Unused Cash Returned (₹)</Label><Input type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" /></div>
          </div>
          {Number(cash) > 0 && (
            <div className="space-y-2">
              <Label>Cash Returned To Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2"><Label>Notes (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record Settlement"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
