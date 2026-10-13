import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, fetchTransactions } from "@/lib/company";
import { inr, fmtDate } from "@/lib/format";
import { accountDelta, txnTypeLabel } from "@/lib/finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/cash-book")({
  head: () => ({ meta: [{ title: "Cash Book — Company Expense Manager" }] }),
  component: CashBookPage,
});

function CashBookPage() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const [accountId, setAccountId] = useState("all");

  const { data: txns } = useQuery({
    queryKey: ["transactions", companyId],
    queryFn: () => fetchTransactions(companyId!),
    enabled: !!companyId,
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: async () => (await supabase.from("accounts").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });

  const acctName = (id: string | null) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    const posted = (txns ?? []).filter((t) => t.status === "posted");
    let balance = 0;
    const out: { t: (typeof posted)[number]; inn: number; out: number; balance: number }[] = [];
    for (const t of posted) {
      let d: number;
      if (accountId === "all") {
        // Combined view: skip transfers entirely (they don't change combined balance)
        if (t.type === "transfer" || t.type === "cash_deposit" || t.type === "cash_withdrawal") continue;
        d = 0;
        if (["funds_received", "refund_received", "advance_cash_returned", "opening_balance"].includes(t.type)) d = Number(t.amount);
        if (["expense", "advance_issued", "vendor_payment", "funds_returned"].includes(t.type)) d = -Number(t.amount);
        if (d === 0) continue; // non-cash entries (invoices, settlements) excluded from cash book
      } else {
        d = accountDelta(t, accountId);
        if (d === 0) continue;
      }
      balance += d;
      out.push({ t, inn: d > 0 ? d : 0, out: d < 0 ? -d : 0, balance });
    }
    return out;
  }, [txns, accountId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cash Book</h1>
          <p className="text-sm text-muted-foreground">Money In and Money Out, with a running balance. No accounting knowledge needed.</p>
        </div>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accounts (Combined)</SelectItem>
            {(accounts ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Closing Balance: <span className="tabular-nums">{inr(rows.at(-1)?.balance ?? 0)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Money In (₹)</TableHead>
                <TableHead className="text-right">Money Out (₹)</TableHead>
                <TableHead className="text-right">Balance (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No cash movements recorded yet.</TableCell></TableRow>
              )}
              {rows.map(({ t, inn, out, balance }) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(t.txn_date)}</TableCell>
                  <TableCell className="max-w-64 truncate">{t.description || txnTypeLabel(t.type)}</TableCell>
                  <TableCell>{t.reference_no || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{acctName(t.account_id)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-success">{inn ? inr(inn) : ""}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-destructive">{out ? inr(out) : ""}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
