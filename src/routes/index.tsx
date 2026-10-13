import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Company Expense Manager — Cash Book & Financial Tracking" },
      { name: "description", content: "Track company funds, daily expenses, staff advances, vendor payments, and cash & bank balances with automatic reports." },
      { property: "og:title", content: "Company Expense Manager" },
      { property: "og:description", content: "A simple digital cash book for your company: expenses, advances, vendors, accounts and downloadable reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      navigate({ to: data.user ? "/dashboard" : "/auth", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}
