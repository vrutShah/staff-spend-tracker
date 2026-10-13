import type { Tables } from "@/integrations/supabase/types";

export type Txn = Tables<"transactions">;

export const TXN_TYPES = [
  { value: "funds_received", label: "Company Funds Received", group: "in" },
  { value: "expense", label: "Company Expense", group: "out" },
  { value: "advance_issued", label: "Staff Advance Issued", group: "out" },
  { value: "advance_settlement", label: "Advance Settlement (Bills)", group: "none" },
  { value: "vendor_invoice", label: "Vendor Invoice Recorded", group: "none" },
  { value: "vendor_payment", label: "Vendor Payment Made", group: "out" },
  { value: "refund_received", label: "Refund Received", group: "in" },
  { value: "advance_cash_returned", label: "Unused Advance Returned", group: "in" },
  { value: "funds_returned", label: "Funds Returned to Company", group: "out" },
  { value: "cash_deposit", label: "Cash Deposited into Bank", group: "transfer" },
  { value: "cash_withdrawal", label: "Cash Withdrawn from Bank", group: "transfer" },
  { value: "transfer", label: "Transfer Between Accounts", group: "transfer" },
  { value: "opening_balance", label: "Opening Balance", group: "in" },
] as const;

export const txnTypeLabel = (t: string) =>
  TXN_TYPES.find((x) => x.value === t)?.label ?? t;

export const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"];

export const DEFAULT_CATEGORIES = [
  "Office Supplies",
  "Computer & IT Equipment",
  "Travel & Transportation",
  "Food & Refreshments",
  "Staff Advances",
  "Repairs & Maintenance",
  "Vendor & Supplier Purchases",
  "Courier & Shipping",
  "Telephone & Internet",
  "Accommodation",
  "Other Expenses",
];

/**
 * Signed effect of a transaction on one account's balance.
 * Positive = money in, negative = money out, 0 = no cash movement.
 */
export function accountDelta(t: Txn, accountId: string): number {
  if (t.status !== "posted") return 0;
  const amt = Number(t.amount);
  const isSource = t.account_id === accountId;
  const isDest = t.transfer_account_id === accountId;
  switch (t.type) {
    case "funds_received":
    case "refund_received":
    case "advance_cash_returned":
    case "opening_balance":
      return isSource ? amt : 0;
    case "expense":
    case "advance_issued":
    case "vendor_payment":
    case "funds_returned":
      return isSource ? -amt : 0;
    case "cash_deposit": // cash -> bank
    case "cash_withdrawal": // bank -> cash
    case "transfer":
      if (isSource) return -amt;
      if (isDest) return amt;
      return 0;
    default: // advance_settlement, vendor_invoice: no cash movement
      return 0;
  }
}

/** Money in/out for a transaction from the combined company perspective. */
export function companyDelta(t: Txn): number {
  if (t.status !== "posted") return 0;
  const amt = Number(t.amount);
  switch (t.type) {
    case "funds_received":
    case "refund_received":
    case "advance_cash_returned":
    case "opening_balance":
      return amt;
    case "expense":
    case "advance_issued":
    case "vendor_payment":
    case "funds_returned":
      return -amt;
    default:
      return 0; // transfers & non-cash entries don't change combined balance
  }
}

export function accountBalance(txns: Txn[], accountId: string, opening: number): number {
  return txns.reduce((sum, t) => sum + accountDelta(t, accountId), opening);
}

export interface ReportSummary {
  openingBalance: number;
  fundsReceived: number;
  expensesIncurred: number;
  expensesPaid: number;
  advancesIssued: number;
  advanceSettlements: number;
  refundsReceived: number;
  advanceCashReturned: number;
  fundsReturned: number;
  vendorInvoices: number;
  vendorPayments: number;
  closingBalance: number;
}

const posted = (t: Txn) => t.status === "posted";
const inRange = (t: Txn, from: string, to: string) => t.txn_date >= from && t.txn_date <= to;
const before = (t: Txn, from: string) => t.txn_date < from;
const sum = (xs: Txn[]) => xs.reduce((s, t) => s + Number(t.amount), 0);
const ofType = (xs: Txn[], type: string) => xs.filter((t) => t.type === type);

/** Combined-company summary for a date range (inclusive). */
export function buildSummary(all: Txn[], from: string, to: string): ReportSummary {
  const p = all.filter(posted);
  const openingBalance = p.filter((t) => before(t, from)).reduce((s, t) => s + companyDelta(t), 0);
  const r = p.filter((t) => inRange(t, from, to));
  const fundsReceived = sum(ofType(r, "funds_received"));
  const expensesIncurred =
    sum(ofType(r, "expense")) + sum(ofType(r, "advance_settlement")) + sum(ofType(r, "vendor_invoice"));
  const expensesPaid = sum(ofType(r, "expense")) + sum(ofType(r, "vendor_payment"));
  const advancesIssued = sum(ofType(r, "advance_issued"));
  const advanceSettlements = sum(ofType(r, "advance_settlement"));
  const refundsReceived = sum(ofType(r, "refund_received"));
  const advanceCashReturned = sum(ofType(r, "advance_cash_returned"));
  const fundsReturned = sum(ofType(r, "funds_returned"));
  const vendorInvoices = sum(ofType(r, "vendor_invoice"));
  const vendorPayments = sum(ofType(r, "vendor_payment"));
  const closingBalance = r.reduce((s, t) => s + companyDelta(t), openingBalance);
  return {
    openingBalance,
    fundsReceived,
    expensesIncurred,
    expensesPaid,
    advancesIssued,
    advanceSettlements,
    refundsReceived,
    advanceCashReturned,
    fundsReturned,
    vendorInvoices,
    vendorPayments,
    closingBalance,
  };
}
