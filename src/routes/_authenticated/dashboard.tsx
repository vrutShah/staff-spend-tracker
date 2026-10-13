import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, fetchTransactions } from "@/lib/company";
import { inr, fmtDate } from "@/lib/format";
import { accountBalance, companyDelta, txnTypeLabel, type Txn } from "@/lib/finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, TrendingUp, TrendingDown, Wallet, Landmark, HandCoins, Truck } from "lucide-react";
import { TransactionForm } from "@/components/TransactionForm";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, parseISO, subMonths, startOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Company Expense Manager" },
      { name: "description", content: "Company funds, expenses, cash and bank balances at a glance." },
    ],
  }),
  component: Dashboard,
});

const CHART_COLORS = ["#0e7490", "#047857", "#b45309", "#6d28d9", "#be185d", "#1d4ed8", "#a16207", "#0f766e", "#9f1239", "#374151", "#7c2d12"];

function Dashboard() {
  const { data: ctx } = useCompany();
  const companyId = ctx?.company?.id;
  const [addOpen, setAddOpen] = useState(false);

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
  const { data: advances } = useQuery({
    queryKey: ["advances", companyId],
    queryFn: async () => (await supabase.from("staff_advances").select("*, employees(name)").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const { data: settlements } = useQuery({
    queryKey: ["settlements", companyId],
    queryFn: async () => (await supabase.from("advance_settlements").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const { data: invoices } = useQuery({
    queryKey: ["invoices", companyId],
    queryFn: async () => (await supabase.from("vendor_invoices").select("*, vendors(name)").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const { data: payments } = useQuery({
    queryKey: ["vendor-payments", companyId],
    queryFn: async () => (await supabase.from("vendor_payments").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });

  const stats = useMemo(() => {
    const t = (txns ?? []).filter((x) => x.status === "posted");
    const sum = (type: string) => t.filter((x) => x.type === type).reduce((s, x) => s + Number(x.amount), 0);
    const fundsReceived = sum("funds_received");
    const expensesIncurred = sum("expense") + sum("advance_settlement") + sum("vendor_invoice");
    const expensesPaid = sum("expense") + sum("vendor_payment");
    const fundsReturned = sum("funds_returned");

    const cashAccounts = (accounts ?? []).filter((a) => a.type === "cash");
    const bankAccounts = (accounts ?? []).filter((a) => a.type === "bank");
    const cashBalance = cashAccounts.reduce((s, a) => s + accountBalance(t, a.id, 0), 0);
    const bankBalance = bankAccounts.reduce((s, a) => s + accountBalance(t, a.id, 0), 0);

    const outstandingAdvances = (advances ?? [])
      .filter((a) => a.status !== "settled")
      .reduce((s, a) => {
        const settled = (settlements ?? []).filter((st) => st.advance_id === a.id)
          .reduce((x, st) => x + Number(st.bills_amount) + Number(st.cash_returned), 0);
        return s + Math.max(0, Number(a.amount) - settled);
      }, 0);

    const outstandingPayables = (invoices ?? [])
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => {
        const paid = (payments ?? []).filter((p) => p.invoice_id === i.id).reduce((x, p) => x + Number(p.amount), 0);
        return s + Math.max(0, Number(i.amount) - paid);
      }, 0);

    return { fundsReceived, expensesIncurred, expensesPaid, fundsReturned, cashBalance, bankBalance, outstandingAdvances, outstandingPayables };
  }, [txns, accounts, advances, settlements, invoices, payments]);

  const monthlyChart = useMemo(() => {
    const t = (txns ?? []).filter((x) => x.status === "posted" && x.type === "expense");
    const months: { month: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = startOfMonth(subMonths(new Date(), i));
      const key = format(m, "yyyy-MM");
      months.push({
        month: format(m, "MMM yy"),
        total: t.filter((x) => x.txn_date.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0),
      });
    }
    return months;
  }, [txns]);

  const categoryChart = useMemo(() => {
    const t = (txns ?? []).filter((x) => x.status === "posted" && x.type === "expense" && x.category_id);
    const byCat = new Map<string, number>();
    for (const x of t) byCat.set(x.category_id!, (byCat.get(x.category_id!) ?? 0) + Number(x.amount));
    return [...byCat.entries()].map(([id, total]) => ({ name: id, total })).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [txns]);

  const { data: categories } = useQuery({
    queryKey: ["categories", companyId],
    queryFn: async () => (await supabase.from("categories").select("*").eq("company_id", companyId!)).data ?? [],
    enabled: !!companyId,
  });
  const catName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "Other";

  const recent = useMemo(() => [...(txns ?? [])].reverse().slice(0, 10), [txns]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{ctx?.company?.name}</p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="lg">
          <Plus className="mr-2 h-4 w-4" /> Add Transaction
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Available Cash" value={stats.cashBalance} icon={Wallet} tone="neutral" />
        <StatCard title="Bank Balance" value={stats.bankBalance} icon={Landmark} tone="neutral" />
        <StatCard title="Total Available" value={stats.cashBalance + stats.bankBalance} icon={TrendingUp} tone="primary" />
        <StatCard title="Total Funds Received" value={stats.fundsReceived} icon={TrendingUp} tone="success" />
        <StatCard title="Expenses Incurred" value={stats.expensesIncurred} icon={TrendingDown} tone="destructive" />
        <StatCard title="Expenses Paid" value={stats.expensesPaid} icon={TrendingDown} tone="destructive" />
        <StatCard title="Outstanding Staff Advances" value={stats.outstandingAdvances} icon={HandCoins} tone="warning" />
        <StatCard title="Outstanding Vendor Bills" value={stats.outstandingPayables} icon={Truck} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Expenses (last 6 months)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart}>
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="total" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Expense Category Breakdown</CardTitle></CardHeader>
          <CardContent className="h-64">
            {categoryChart.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No expenses recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryChart.map((c) => ({ ...c, name: catName(c.name) }))} dataKey="total" nameKey="name" innerRadius={50} outerRadius={80}>
                    {categoryChart.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => inr(Number(v))} />
                  <Legend fontSize={12} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Transactions</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet. Click “Add Transaction” to record your first entry.</p>
          ) : (
            <div className="divide-y">
              {recent.map((t) => (
                <RecentRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {companyId && <TransactionForm companyId={companyId} open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof Wallet; tone: "neutral" | "primary" | "success" | "destructive" | "warning" }) {
  const color =
    tone === "success" ? "text-success" :
    tone === "destructive" ? "text-destructive" :
    tone === "warning" ? "text-chart-4" :
    tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{inr(value)}</p>
        </div>
        <Icon className={`h-5 w-5 ${color} opacity-60`} />
      </CardContent>
    </Card>
  );
}

function RecentRow({ t }: { t: Txn }) {
  const d = companyDelta(t);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.description || txnTypeLabel(t.type)}</p>
        <p className="text-xs text-muted-foreground">
          {fmtDate(parseISO(t.txn_date))} · {txnTypeLabel(t.type)}
          {t.status === "void" && <Badge variant="destructive" className="ml-2">Reversed</Badge>}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground"}`}>
        {d > 0 ? "+" : d < 0 ? "−" : ""}{inr(Math.abs(d))}
      </p>
    </div>
  );
}
