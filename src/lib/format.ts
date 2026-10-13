import { format, parseISO } from "date-fns";

export const inr = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));

export const fmtDate = (d: string | Date) =>
  format(typeof d === "string" ? parseISO(d) : d, "dd MMM yyyy");

export const todayISO = () => format(new Date(), "yyyy-MM-dd");

export const toISO = (d: Date) => format(d, "yyyy-MM-dd");

/** Financial year range (default April 1 – March 31) containing `ref`. */
export function fyRange(fyStartMonth: number, ref = new Date()) {
  const year = ref.getFullYear();
  const month = ref.getMonth() + 1;
  const startYear = month >= fyStartMonth ? year : year - 1;
  const start = new Date(startYear, fyStartMonth - 1, 1);
  const end = new Date(startYear + 1, fyStartMonth - 1, 0);
  return { start, end };
}

export function prevFyRange(fyStartMonth: number, ref = new Date()) {
  const { start } = fyRange(fyStartMonth, ref);
  const prevStart = new Date(start.getFullYear() - 1, fyStartMonth - 1, 1);
  const prevEnd = new Date(start.getFullYear(), fyStartMonth - 1, 0);
  return { start: prevStart, end: prevEnd };
}
