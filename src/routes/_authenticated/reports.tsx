import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, fetchTransactions } from "@/lib/company";
import { inr, fmtDate, toISO, todayISO, fyRange, prevFyRange } from "@/lib/format";
import { accountDelta, buildSummary, txnTypeLabel, TXN_TYPES, type Txn } from "@/lib/finance";
import { downloadCSV, downloadExcel, printReport, tableHtml } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format, startOfWeek, startOfMonth, subDays, subMonths, endOfMonth } from "date-fns";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Company Expense Manager" }] }),
  component: ReportsPage,
});

function presets(fyStartMonth: number) {
  const today = new Date();
  const fy = fyRange(fyStartMonth);
  const pfy = prevFyRange(fyStartMonth);
  return [
    { key: "today", label: "Today", from: toISO(today), to: toISO(today) },
    { key: "yesterday", label: "Yesterday", from: toISO(subDays(today, 1)), to: toISO(subDays(today, 1)) },
    { key: "week", label: "This Week", from: toISO(startOfWeek(today, { weekStartsOn: 1 })), to: toISO(today) },
    { key: "month", label: "This Month", from: toISO(startOfMonth(today)), to: toISO(today) },
    { key: "lastmonth", label: "Last Month", from: toISO(startOfMonth(subMonths(today, 1))), to: toISO(endOfMonth(subMonths(today, 1))) },
    { key: "fy", label: "This Financial Year", from: toISO(fy.start), to: toISO(today) },
    { key: "prevfy", label: "Previous Financial Year", from: toISO(pfy.start), to: toISO(pfy.end) },
  ];
}

function ReportsPage() {
  const { data: ctx } = useCompany();
  const company = ctx?.company;
  const companyId = company?.id;
  const fyStart = company?.fy_start_month ?? 4;

  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(presets(fyStart).find((p) => p.key === "month")!.from);
  const [to, setTo] = useState(todayISO());
  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [receiptFilter, setReceiptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("posted");
  const [generated, setGenerated] = useState(false);

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
  const { data: categories } = useQuery({
    queryKey: ["categories", companyId],
    queryFn: async () => (await supabase.from("categories").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const { data: attachments } = useQuery({
    queryKey: ["attachments", companyId],
    queryFn: async () => (await supabase.from("attachments").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = presets(fyStart).find((x) => x.key === key);
    if (p) { setFrom(p.from); setTo(p.to); }
  };

  const generate = () => {
    if (to < from) return toast.error("The end date cannot be earlier than the start date.");
    setGenerated(true);
  };

  const report = useMemo(() => {
    if (!generated || !txns) return null;
    const inPeriod = (t: Txn) => t.txn_date >= from && t.txn_date <= to;
    const statusOk = (t: Txn) => (statusFilter === "all" ? true : t.status === statusFilter);

    // Summary (always combined, posted only)
    const summary = buildSummary(txns, from, to);
    const cashIds = new Set((accounts ?? []).filter((a) => a.type === "cash").map((a) => a.id));
    const bankIds = new Set((accounts ?? []).filter((a) => a.type === "bank").map((a) => a.id));
    let cashBal = 0, bankBal = 0;
    for (const a of accounts ?? []) {
      const bal = txns.filter((t) => t.status === "posted" && t.txn_date <= to)
        .reduce((s, t) => s + accountDelta(t, a.id), 0);
      if (cashIds.has(a.id)) cashBal += bal; else if (bankIds.has(a.id)) bankBal += bal;
    }

    // Opening balance for the statement
    const deltaFor = (t: Txn) =>
      accountFilter === "all"
        ? (["transfer", "cash_deposit", "cash_withdrawal"].includes(t.type) ? 0 : statusOk(t) && t.status === "posted" ? companyDeltaLocal(t) : 0)
        : accountDelta({ ...t, status: statusOk(t) ? t.status : "void" }, accountFilter);
    const opening = txns.filter((t) => t.txn_date < from && t.status === "posted").reduce((s, t) => s + deltaFor({ ...t, status: "posted" }), 0);

    // Detailed statement with filters
    let rows = txns.filter((t) => inPeriod(t) && statusOk(t));
    if (typeFilter !== "all") rows = rows.filter((t) => t.type === typeFilter);
    if (catFilter !== "all") rows = rows.filter((t) => t.category_id === catFilter);
    if (accountFilter !== "all") rows = rows.filter((t) => t.account_id === accountFilter || t.transfer_account_id === accountFilter);
    if (methodFilter !== "all") rows = rows.filter((t) => t.payment_method === methodFilter);
    if (receiptFilter !== "all") {
      const withR = new Set((attachments ?? []).map((a) => a.record_id));
      rows = rows.filter((t) => (receiptFilter === "attached" ? withR.has(t.id) : !withR.has(t.id)));
    }

    let bal = opening;
    const statement = rows.map((t) => {
      const d = deltaFor(t);
      bal += d;
      return { t, inn: d > 0 ? d : 0, out: d < 0 ? -d : 0, balance: bal };
    });

    return { summary, statement, opening, cashBal, bankBal, filtered: typeFilter !== "all" || catFilter !== "all" || methodFilter !== "all" || receiptFilter !== "all" || statusFilter !== "all" };
  }, [generated, txns, accounts, categories, attachments, from, to, typeFilter, catFilter, accountFilter, methodFilter, receiptFilter, statusFilter]);

  const acctName = (id: string | null) => accounts?.find((a) => a.id === id)?.name ?? "—";
  const catName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? "—";
  const periodLabel = `${fmtDate(from)} to ${fmtDate(to)}`;

  const summaryRows = (s: NonNullable<typeof report>["summary"]): [string, number][] => [
    ["Opening Balance (start of period)", s.openingBalance],
    ["Company Funds Received", s.fundsReceived],
    ["Expenses Incurred (incl. bills & invoices)", s.expensesIncurred],
    ["Expenses Actually Paid", s.expensesPaid],
    ["Staff Advances Issued", s.advancesIssued],
    ["Advance Settlements (bills)", s.advanceSettlements],
    ["Refunds Received", s.refundsReceived],
    ["Unused Advance Money Returned", s.advanceCashReturned],
    ["Funds Returned to Company", s.fundsReturned],
    ["Vendor Bills Recorded", s.vendorInvoices],
    ["Vendor Payments Made", s.vendorPayments],
    ["Closing Cash Balance", report?.cashBal ?? 0],
    ["Closing Bank Balance", report?.bankBal ?? 0],
    ["Combined Closing Balance", s.closingBalance],
  ];

  const stmtHeaders = ["Date", "Description", "Category", "Type", "Paid To / Received From", "Account", "Money In", "Money Out", "Balance", "Method", "Reference", "Receipt"];
  const stmtRows = () =>
    (report?.statement ?? []).map(({ t, inn, out, balance }) => [
      fmtDate(t.txn_date), t.description || txnTypeLabel(t.type), catName(t.category_id), txnTypeLabel(t.type),
      t.counterparty || "—", acctName(t.account_id), inn ? inr(inn) : "", out ? inr(out) : "", inr(balance),
      t.payment_method || "—", t.reference_no || "—",
      attachments?.some((a) => a.record_id === t.id) ? "Attached" : "Missing",
    ]);

  const exportCSV = () => {
    if (!report || report.statement.length === 0) return toast.error("No transactions match — nothing to export.");
    downloadCSV(`cashbook-${from}-to-${to}.csv`, stmtHeaders, stmtRows());
  };
  const exportExcel = () => {
    if (!report || report.statement.length === 0) return toast.error("No transactions match — nothing to export.");
    downloadExcel(`report-${from}-to-${to}.xls`, `${company?.name ?? "Company"} — Report ${periodLabel}`, stmtHeaders, stmtRows());
  };
  const exportPDF = () => {
    if (!report) return;
    const summaryHtml = tableHtml(["Item", "Amount"], summaryRows(report.summary).map(([k, v]) => [k, inr(v)]), [1]);
    const detailHtml = report.statement.length
      ? tableHtml(stmtHeaders, stmtRows(), [6, 7, 8])
      : "<p>No transactions match the selected filters.</p>";
    printReport(
      `${company?.name ?? "Company"} — Financial Report`,
      `Period: ${periodLabel}`,
      `<h3>Summary</h3>${summaryHtml}<h3>Detailed Statement</h3>${detailHtml}`,
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Pick a period, generate, then download or print.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {presets(fyStart).map((p) => (
              <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => applyPreset(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} />
            </div>
            <Button onClick={generate} size="lg">Generate Report</Button>
            <Button variant="ghost" onClick={() => { setTypeFilter("all"); setCatFilter("all"); setAccountFilter("all"); setMethodFilter("all"); setReceiptFilter("all"); setStatusFilter("posted"); }}>
              Reset Filters
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {TXN_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={receiptFilter} onValueChange={setReceiptFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Receipt" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Receipt: All</SelectItem>
                <SelectItem value="attached">Receipt Attached</SelectItem>
                <SelectItem value="missing">Receipt Missing</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="posted">Posted Only</SelectItem>
                <SelectItem value="void">Reversed Only</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {generated && report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Reporting period: <span className="text-primary">{periodLabel}</span></p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV}><Download className="mr-1 h-4 w-4" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="mr-1 h-4 w-4" /> Excel</Button>
              <Button variant="outline" size="sm" onClick={exportPDF}><FileText className="mr-1 h-4 w-4" /> PDF / Print</Button>
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  {summaryRows(report.summary).map(([label, value]) => (
                    <TableRow key={label}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{inr(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Detailed Statement
                {report.filtered && <span className="ml-2 text-sm font-normal text-muted-foreground">(filtered — balance shown is the filtered subtotal, not the full account balance)</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {report.statement.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No transactions match the selected period and filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead>
                      <TableHead>Account</TableHead><TableHead className="text-right">Money In</TableHead>
                      <TableHead className="text-right">Money Out</TableHead><TableHead className="text-right">Balance</TableHead>
                      <TableHead>Method</TableHead><TableHead>Ref</TableHead><TableHead>Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={6} className="font-medium">Opening Balance</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{inr(report.opening)}</TableCell>
                      <TableCell colSpan={3}></TableCell>
                    </TableRow>
                    {report.statement.map(({ t, inn, out, balance }) => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(t.txn_date)}</TableCell>
                        <TableCell className="max-w-48 truncate">{t.description || txnTypeLabel(t.type)}</TableCell>
                        <TableCell className="whitespace-nowrap">{txnTypeLabel(t.type)}</TableCell>
                        <TableCell className="whitespace-nowrap">{acctName(t.account_id)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{inn ? inr(inn) : ""}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{out ? inr(out) : ""}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{inr(balance)}</TableCell>
                        <TableCell>{t.payment_method || "—"}</TableCell>
                        <TableCell>{t.reference_no || "—"}</TableCell>
                        <TableCell>{attachments?.some((a) => a.record_id === t.id) ? "✓" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {generated && !report && <p className="text-sm text-muted-foreground">Loading…</p>}
    </div>
  );
}

function companyDeltaLocal(t: Txn): number {
  const amt = Number(t.amount);
  switch (t.type) {
    case "funds_received": case "refund_received": case "advance_cash_returned": case "opening_balance": return amt;
    case "expense": case "advance_issued": case "vendor_payment": case "funds_returned": return -amt;
    default: return 0;
  }
}
