import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, ArrowLeftRight, BookOpen, HandCoins, Truck,
  Landmark, FileBarChart, Tags, Settings, LogOut, Wallet, Menu,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
  },
  component: AppShell,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/cash-book", label: "Cash Book", icon: BookOpen },
  { to: "/advances", label: "Staff Advances", icon: HandCoins },
  { to: "/vendors", label: "Vendors & Bills", icon: Truck },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AppShell() {
  const { data, isLoading } = useCompany();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const needsSetup = !isLoading && !data?.company && pathname !== "/setup";
  useEffect(() => {
    if (needsSetup) navigate({ to: "/setup", replace: true });
  }, [needsSetup, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading your company…</p>
      </div>
    );
  }

  // First-run: no company yet -> setup wizard (redirect handled in effect above)
  if (needsSetup) return null;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={() => setOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            pathname === to && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{data?.company?.name ?? "Expense Manager"}</p>
            <p className="text-xs text-muted-foreground">Company Cash Book</p>
          </div>
        </div>
        {nav}
        <div className="border-t p-3">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card p-3 md:hidden">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setOpen(!open)}>
              <Menu className="h-5 w-5" />
            </Button>
            <span className="text-sm font-semibold">{data?.company?.name ?? "Expense Manager"}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        {open && <div className="border-b bg-card md:hidden">{nav}</div>}
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
