import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { TXN_TYPES, PAYMENT_METHODS } from "@/lib/finance";
import { todayISO } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

// Which fields each transaction type needs
const FIELDS: Record<string, { category?: boolean; employee?: boolean; vendor?: boolean; account?: boolean; transferTo?: boolean; method?: boolean; counterparty?: string }> = {
  funds_received: { account: true, method: true, counterparty: "Received From" },
  expense: { category: true, account: true, method: true, counterparty: "Paid To" },
  advance_issued: { employee: true, account: true, method: true },
  advance_settlement: { employee: true, category: true },
  vendor_invoice: { vendor: true, category: true },
  vendor_payment: { vendor: true, account: true, method: true },
  refund_received: { account: true, method: true, counterparty: "Received From" },
  advance_cash_returned: { employee: true, account: true, method: true },
  funds_returned: { account: true, method: true, counterparty: "Returned To" },
  cash_deposit: { account: true, transferTo: true, method: true },
  cash_withdrawal: { account: true, transferTo: true, method: true },
  transfer: { account: true, transferTo: true },
  opening_balance: { account: true },
};

export function TransactionForm({
  companyId,
  open,
  onOpenChange,
  presetType,
  editTxn,
}: {
  editTxn?: Tables<"transactions"> | null;
  companyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetType?: string;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState(presetType ?? "expense");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && editTxn) {
      const t = editTxn;
      setType(t.type); setDate(t.txn_date); setAmount(String(t.amount));
      setCategoryId(t.category_id ?? ""); setDescription(t.description ?? ""); setCounterparty(t.counterparty ?? "");
      setEmployeeId(t.employee_id ?? ""); setVendorId(t.vendor_id ?? ""); setAccountId(t.account_id ?? "");
      setTransferAccountId(t.transfer_account_id ?? ""); setMethod(t.payment_method ?? "");
      setReferenceNo(t.reference_no ?? ""); setNotes(t.notes ?? ""); setFile(null);
    } else if (open) {
      setType(presetType ?? "expense");
      setDate(todayISO());
      setAmount(""); setCategoryId(""); setDescription(""); setCounterparty("");
      setEmployeeId(""); setVendorId(""); setAccountId(""); setTransferAccountId("");
      setMethod(""); setReferenceNo(""); setNotes(""); setFile(null);
    }
  }, [open, presetType, editTxn]);

  const { data: lookups } = useQuery({
    queryKey: ["txn-lookups", companyId],
    queryFn: async () => {
      const [cats, emps, vends, accts] = await Promise.all([
        supabase.from("categories").select("*").eq("company_id", companyId).order("name"),
        supabase.from("employees").select("*").eq("company_id", companyId).order("name"),
        supabase.from("vendors").select("*").eq("company_id", companyId).order("name"),
        supabase.from("accounts").select("*").eq("company_id", companyId).order("name"),
      ]);
      return {
        categories: (cats.data ?? []) as Tables<"categories">[],
        employees: (emps.data ?? []) as Tables<"employees">[],
        vendors: (vends.data ?? []) as Tables<"vendors">[],
        accounts: (accts.data ?? []) as Tables<"accounts">[],
      };
    },
    enabled: open,
  });

  const f = FIELDS[type] ?? {};
  const accounts = lookups?.accounts ?? [];

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount.");
    if (f.account && !accountId) return toast.error("Select an account.");
    if (f.transferTo && !transferAccountId) return toast.error("Select the destination account.");
    if (f.transferTo && transferAccountId === accountId) return toast.error("Source and destination accounts must differ.");
    if (f.employee && !employeeId) return toast.error("Select an employee.");
    if (f.vendor && !vendorId) return toast.error("Select a vendor.");
    if (busy) return; // prevent duplicate submissions
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const payload = {
          company_id: companyId,
          type: type as Tables<"transactions">["type"],
          txn_date: date,
          amount: amt,
          category_id: categoryId || null,
          description: description.trim() || null,
          counterparty: counterparty.trim() || null,
          employee_id: employeeId || null,
          vendor_id: vendorId || null,
          account_id: accountId || null,
          transfer_account_id: transferAccountId || null,
          payment_method: method || null,
          reference_no: referenceNo.trim() || null,
          notes: notes.trim() || null,
        };
      const { data: txn, error } = editTxn
        ? await supabase.from("transactions").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editTxn.id).select().single()
        : await supabase.from("transactions").insert({ ...payload, created_by: user?.id ?? null }).select().single();
      if (error) throw error;

      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error("Receipt file must be under 10 MB.");
        const path = `${companyId}/${txn.id}/${file.name}`;
        const { error: upErr } = await supabase.storage.from("receipts").upload(path, file);
        if (upErr) throw upErr;
        await supabase.from("attachments").insert({
          company_id: companyId,
          record_type: "transaction",
          record_id: txn.id,
          file_path: path,
          file_name: file.name,
          content_type: file.type,
          size_bytes: file.size,
          uploaded_by: user?.id ?? null,
        });
      }

      await qc.invalidateQueries();
      toast.success(editTxn ? "Transaction updated." : "Transaction saved.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the transaction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editTxn ? "Edit Transaction" : "Add Transaction"}</DialogTitle>
          <DialogDescription>Only the fields needed for the selected type are shown.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Transaction Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TXN_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Amount (₹)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          {f.category && (
            <div className="space-y-2">
              <Label>Expense Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {(lookups?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {f.employee && (
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {(lookups?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(lookups?.employees ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No employees yet — add them from the Staff Advances page.</p>
              )}
            </div>
          )}
          {f.vendor && (
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {(lookups?.vendors ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(lookups?.vendors ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No vendors yet — add them from the Vendors page.</p>
              )}
            </div>
          )}
          {f.counterparty && (
            <div className="space-y-2">
              <Label>{f.counterparty}</Label>
              <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {f.account && (
              <div className="space-y-2">
                <Label>{f.transferTo ? "From Account" : "Account"}</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {f.transferTo && (
              <div className="space-y-2">
                <Label>To Account</Label>
                <Select value={transferAccountId} onValueChange={setTransferAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {f.method && (
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Description / Purpose</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Reference Number (optional)</Label>
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Receipt / Invoice (optional)</Label>
              <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save Transaction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
