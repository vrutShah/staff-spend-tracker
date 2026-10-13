import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { User } from "@supabase/supabase-js";

export interface CompanyContext {
  user: User | null;
  company: Tables<"companies"> | null;
  membership: Tables<"company_memberships"> | null;
}

export function useCompany() {
  return useQuery({
    queryKey: ["company-context"],
    queryFn: async (): Promise<CompanyContext> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { user: null, company: null, membership: null };
      const { data: memberships } = await supabase
        .from("company_memberships")
        .select("*, companies(*)")
        .eq("user_id", user.id);
      const m = memberships?.[0] ?? null;
      return {
        user,
        membership: m,
        company: (m?.companies as Tables<"companies"> | null) ?? null,
      };
    },
    staleTime: 60_000,
  });
}

/** Fetch all posted+void transactions for a company, oldest first. */
export async function fetchTransactions(companyId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("company_id", companyId)
    .order("txn_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
