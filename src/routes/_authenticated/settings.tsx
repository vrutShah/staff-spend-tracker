import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Company Expense Manager" }] }),
  component: SettingsPage,
});

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function SettingsPage() {
  const { data: ctx } = useCompany();
  const qc = useQueryClient();
  const company = ctx?.company;
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [fyMonth, setFyMonth] = useState("4");
  const [displayName, setDisplayName] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["profile", ctx?.user?.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", ctx!.user!.id).maybeSingle()).data,
    enabled: !!ctx?.user,
  });
  const { data: audit } = useQuery({
    queryKey: ["audit", company?.id],
    queryFn: async () => (await supabase.from("audit_logs").select("*").eq("company_id", company!.id).order("created_at", { ascending: false }).limit(25)).data ?? [],
    enabled: !!company,
  });

  useEffect(() => {
    if (company) { setName(company.name); setDetails(company.details ?? ""); setFyMonth(String(company.fy_start_month)); }
  }, [company]);
  useEffect(() => { if (profile) setDisplayName(profile.display_name ?? ""); }, [profile]);

  const saveCompany = async () => {
    if (!company) return;
    const { error } = await supabase.from("companies").update({ name: name.trim(), details: details.trim() || null, fy_start_month: Number(fyMonth) }).eq("id", company.id);
    if (error) return toast.error(error.message);
    toast.success("Company details saved.");
    qc.invalidateQueries({ queryKey: ["company-context"] });
  };
  const saveProfile = async () => {
    if (!ctx?.user) return;
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() }).eq("id", ctx.user.id);
    if (error) return toast.error(error.message);
    toast.success("Profile saved.");
  };

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Your Profile</CardTitle><CardDescription>{ctx?.user?.email}</CardDescription></CardHeader>
        <CardContent className="flex gap-2">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          <Button onClick={saveProfile}>Save</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Company</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>Company Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label>Details</Label><Input value={details} onChange={(e) => setDetails(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Financial Year Starts In</Label>
            <Select value={fyMonth} onValueChange={setFyMonth}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={saveCompany}>Save Company</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Safety & Backups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>All records are stored securely in your Lovable Cloud database and only members of your company can see them.</p>
          <p>Automatic backups depend on your plan and are not guaranteed on the free tier. We recommend downloading a full CSV export from the Reports page regularly (e.g. monthly) and keeping it safe.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Audit History</CardTitle><CardDescription>Every transaction created or changed is logged here.</CardDescription></CardHeader>
        <CardContent className="divide-y p-0">
          {(audit ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>}
          {(audit ?? []).map((a) => {
            const nd = a.new_data as { type?: string; amount?: number; status?: string } | null;
            const od = a.old_data as { status?: string } | null;
            const label = a.action === "update" && od?.status === "posted" && nd?.status === "void" ? "Reversed" : a.action === "insert" ? "Created" : "Updated";
            return (
              <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
                <span>{label} {nd?.type?.replace(/_/g, " ")} · ₹{nd?.amount}</span>
                <span className="text-muted-foreground">{format(new Date(a.created_at), "dd MMM yyyy, HH:mm")}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
