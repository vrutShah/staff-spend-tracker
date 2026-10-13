import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { inr, fmtDate, todayISO } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Building2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/vendors")({
  head: () => ({ meta: [{ title: "Vendors & Bills — Company Expense Manager" }] }),
  component: VendorsPage,
});

type Invoice = Tables<"vendor_invoices"> & { vendors: { name: string } | null };

function VendorsPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const qc = useQueryClient();
  const [vendorOpen, setVendorOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<(Invoice & { remaining: number }) | null>(null);

  const { data: vendors } = useQuery({
    queryKey: ["vendors", companyId],
    queryFn: async () => (await supabase.from("vendors").select("*").eq("company_id", companyId!).order("name")).data ?? [],
    enabled: !!companyId,
  });
  const { data: invoices } = useQuery({
    queryKey: ["invoices", companyId],
    queryFn: async () => ((await supabase.from("vendor_invoices").select("*, vendors(name)").eq("company_id", companyId!).order("invoice_date", { ascending: false })).data ?? []) as Invoice[],
    enabled: !!companyId,
  });
  const { data: payments } = useQuery({
    queryKey: ["vendor-payments", companyId],
    queryFn: async () => (await supabase.from("vendor_payments").select("*").eq("company_id", companyId!).order("payment_date")).data ?? [],
    enabled: !!companyId,
  });

  const rows = useMemo(
    () =>
      (invoices ?? []).map((i) => {
        const paid = (payments ?? []).filter((p) => p.invoice_id === i.id).reduce((s, p) => s + Number(p.amount), 0);
        return { ...i, paid, remaining: Math.max(0, Number(i.amount) - paid) };
      }),
    [invoices, payments],
  );

  const totalPayable = rows.reduce((s, r) => s + r.remaining, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vendors & Bills</h1>
          <p className="text-sm text-muted-foreground">
            Recording a bill tracks what you owe. Money only leaves your account when you record a payment.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setVendorOpen(true)}><Building2 className="mr-2 h-4 w-4" /> Add Vendor</Button>
          <Button onClick={() => setInvOpen(true)}><Plus className="mr-2 h-4 w-4" /> Record Bill</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Total Outstanding Payable: <span className="text-destructive tabular-nums">{inr(totalPayable)}</span></CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Invoice Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No vendor bills recorded yet.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.vendors?.name}</TableCell>
                  <TableCell>{r.invoice_no || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.invoice_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.due_date ? fmtDate(r.due_date) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(r.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{inr(r.paid)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(r.remaining)}</TableCell>
                  <TableCell>
                    {r.status === "paid" ? <Badge className="bg-success text-success-foreground">Paid</Badge>
                      : r.status === "partially_paid" ? <Badge variant="secondary">Partially Paid</Badge>
                      : <Badge variant="destructive">Unpaid</Badge>}
                  </TableCell>
                  <TableCell>{r.status !== "paid" && <Button variant="ghost" size="sm" onClick={() => setPayTarget(r)}>Pay</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Vendors</CardTitle></CardHeader>
        <CardContent>
          {(vendors ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No vendors yet.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(vendors ?? []).map((v) => {
                const owed = rows.filter((r) => r.vendor_id === v.id).reduce((s, r) => s + r.remaining, 0);
                return (
                  <div key={v.id} className="rounded-lg border p-3">
                    <p className="font-medium">{v.name}</p>
                    <p className="text-xs text-muted-foreground">{v.contact || "No contact details"}</p>
                    <p className="mt-1 text-sm">Owed: <span className="font-semibold tabular-nums">{inr(owed)}</span></p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {companyId && (
        <>
          <VendorDialog companyId={companyId} open={vendorOpen} onOpenChange={setVendorOpen} />
          <InvoiceDialog companyId={companyId} vendors={vendors ?? []} open={invOpen} onOpenChange={setInvOpen} />
          {payTarget && (
            <PayDialog companyId={companyId} invoice={payTarget} open={!!payTarget}
              onOpenChange={(v) => !v && setPayTarget(null)} onDone={() => qc.invalidateQueries()} />
          )}
        </>
      )}
    </div>
  );
}

function VendorDialog({ companyId, open, onOpenChange }: { companyId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const save = async () => {
    if (!name.trim()) return toast.error("Enter the vendor name.");
    const { error } = await supabase.from("vendors").insert({ company_id: companyId, name: name.trim(), contact: contact.trim() || null });
    if (error) return toast.error(error.message);
    toast.success("Vendor added.");
    setName(""); setContact("");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["vendors"] });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Vendor Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label>Contact (phone, email, address)</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} /></div>
          <Button className="w-full" onClick={save}>Save Vendor</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDialog({ companyId, vendors, open, onOpenChange }: { companyId: string; vendors: Tables<"vendors">[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [vendorId, setVendorId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const amt = Number(amount);
    if (!vendorId) return toast.error("Select a vendor.");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount.");
    if (busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const vendor = vendors.find((v) => v.id === vendorId);
      const { data: inv, error } = await supabase.from("vendor_invoices").insert({
        company_id: companyId, vendor_id: vendorId, invoice_no: invoiceNo.trim() || null,
        invoice_date: date, due_date: due || null, amount: amt,
      }).select().single();
      if (error) throw error;
      // Record the liability (no cash movement)
      const { error: tErr } = await supabase.from("transactions").insert({
        company_id: companyId, type: "vendor_invoice", txn_date: date, amount: amt, vendor_id: vendorId,
        reference_no: invoiceNo.trim() || null, description: `Bill from ${vendor?.name ?? "vendor"}`,
        notes: "Liability only — cash leaves only when payment is recorded.", created_by: user?.id ?? null,
      });
      if (tErr) throw tErr;
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB.");
        const path = `${companyId}/${inv.id}/${file.name}`;
        const { error: upErr } = await supabase.storage.from("receipts").upload(path, file);
        if (upErr) throw upErr;
        await supabase.from("attachments").insert({
          company_id: companyId, record_type: "vendor_invoice", record_id: inv.id, file_path: path,
          file_name: file.name, content_type: file.type, size_bytes: file.size, uploaded_by: user?.id ?? null,
        });
      }
      toast.success("Bill recorded.");
      onOpenChange(false);
      setVendorId(""); setInvoiceNo(""); setAmount(""); setDue(""); setFile(null);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the bill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Vendor Bill</DialogTitle>
          <DialogDescription>This records what you owe. It does not reduce your balance until you pay.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Invoice Number</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-2"><Label>Invoice Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Due Date</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Invoice Attachment (optional)</Label><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Bill"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ companyId, invoice, open, onOpenChange, onDone }: {
  companyId: string; invoice: Invoice & { remaining: number }; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(invoice.remaining));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: async () => (await supabase.from("accounts").select("*").eq("company_id", companyId)).data ?? [],
    enabled: open,
  });

  const save = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount.");
    if (amt > invoice.remaining + 0.001) return toast.error(`Payment cannot exceed the remaining ${inr(invoice.remaining)}.`);
    if (!accountId) return toast.error("Select the account paid from.");
    if (busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: txn, error: tErr } = await supabase.from("transactions").insert({
        company_id: companyId, type: "vendor_payment", txn_date: date, amount: amt, vendor_id: invoice.vendor_id,
        account_id: accountId, payment_method: method || null, reference_no: ref.trim() || invoice.invoice_no,
        description: `Payment to ${invoice.vendors?.name ?? "vendor"}${invoice.invoice_no ? ` (Inv ${invoice.invoice_no})` : ""}`,
        created_by: user?.id ?? null,
      }).select().single();
      if (tErr) throw tErr;
      const { error: pErr } = await supabase.from("vendor_payments").insert({
        company_id: companyId, invoice_id: invoice.id, payment_date: date, amount: amt, account_id: accountId,
        payment_method: method || null, reference_no: ref.trim() || null, transaction_id: txn.id,
      });
      if (pErr) throw pErr;
      const newRemaining = invoice.remaining - amt;
      await supabase.from("vendor_invoices").update({ status: newRemaining <= 0.001 ? "paid" : "partially_paid" }).eq("id", invoice.id);
      toast.success(newRemaining <= 0.001 ? "Bill fully paid." : "Partial payment recorded.");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {invoice.vendors?.name}</DialogTitle>
          <DialogDescription>Remaining on this bill: <strong>{inr(invoice.remaining)}</strong></DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-2"><Label>Payment Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Paid From</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label>Reference (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record Payment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
