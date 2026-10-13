import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, fetchTransactions } from "@/lib/company";
import { inr, fmtDate } from "@/lib/format";
import { companyDelta, txnTypeLabel, TXN_TYPES, type Txn } from "@/lib/finance";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Paperclip, Pencil, Trash2 } from "lucide-react";
import { TransactionForm } from "@/components/TransactionForm";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Company Expense Manager" }] }),
  component: TransactionsPage,
});

function TransactionsPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [voidTarget, setVoidTarget] = useState<Txn | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [editTarget, setEditTarget] = useState<Txn | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Txn | null>(null);

  const deleteTxn = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    // Unlink records that reference this transaction, remove receipts, then delete
    await supabase.from("staff_advances").update({ transaction_id: null }).eq("transaction_id", id);
    await supabase.from("vendor_payments").update({ transaction_id: null }).eq("transaction_id", id);
    const atts = attachments?.filter((a) => a.record_type === "transaction" && a.record_id === id) ?? [];
    if (atts.length) {
      await supabase.storage.from("receipts").remove(atts.map((a) => a.file_path));
      await supabase.from("attachments").delete().in("id", atts.map((a) => a.id));
    }
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Transaction deleted.");
    setDeleteTarget(null);
    qc.invalidateQueries();
  };

  const { data: txns } = useQuery({
    queryKey: ["transactions", companyId],
    queryFn: () => fetchTransactions(companyId!),
    enabled: !!companyId,
  });
  const { data: attachments } = useQuery({
    queryKey: ["attachments", companyId],
    queryFn: async () => (await supabase.from("attachments").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });

  const filtered = useMemo(() => {
    let list = [...(txns ?? [])].reverse();
    if (typeFilter !== "all") list = list.filter((t) => t.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        [t.description, t.counterparty, t.reference_no, t.notes].some((v) => v?.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [txns, search, typeFilter]);

  const hasReceipt = (id: string) => attachments?.some((a) => a.record_type === "transaction" && a.record_id === id);

  const openReceipt = async (id: string) => {
    const att = attachments?.find((a) => a.record_type === "transaction" && a.record_id === id);
    if (!att) return;
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(att.file_path, 300);
    if (error || !data) return toast.error("Could not open the receipt.");
    window.open(data.signedUrl, "_blank");
  };

  const voidTxn = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) return toast.error("Please give a reason for the reversal.");
    const { error } = await supabase
      .from("transactions")
      .update({ status: "void", void_reason: voidReason.trim(), updated_at: new Date().toISOString() })
      .eq("id", voidTarget.id);
    if (error) return toast.error(error.message);
    toast.success("Transaction reversed. It no longer affects balances, but remains in the audit history.");
    setVoidTarget(null);
    setVoidReason("");
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add Transaction</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search description, person, reference…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TXN_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No transactions match.</TableCell></TableRow>
              )}
              {filtered.map((t) => {
                const d = companyDelta(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(t.txn_date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{txnTypeLabel(t.type)}</TableCell>
                    <TableCell className="max-w-56 truncate">{t.description || t.counterparty || "—"}</TableCell>
                    <TableCell>{t.reference_no || "—"}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : ""}`}>
                      {inr(t.amount)}
                    </TableCell>
                    <TableCell>
                      {t.status === "void" ? <Badge variant="destructive">Reversed</Badge> : <Badge variant="secondary">Posted</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {hasReceipt(t.id) && (
                        <Button variant="ghost" size="icon" title="View receipt" onClick={() => openReceipt(t.id)}>
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      )}
                      {t.status === "posted" && (
                        <Button variant="ghost" size="sm" onClick={() => setVoidTarget(t)}>Reverse</Button>
                      )}
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditTarget(t)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {companyId && <TransactionForm companyId={companyId} open={addOpen} onOpenChange={setAddOpen} />}
      {companyId && <TransactionForm companyId={companyId} open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)} editTxn={editTarget} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              The transaction of {deleteTarget && inr(deleteTarget.amount)} and its receipt will be removed. A copy stays in the audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteTxn} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!voidTarget} onOpenChange={(v) => !v && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              The transaction of {voidTarget && inr(voidTarget.amount)} will stop affecting balances, but it stays in the records with your reason — nothing is silently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Reason for reversal</Label>
            <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Entered wrong amount" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={voidTxn}>Reverse Transaction</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
