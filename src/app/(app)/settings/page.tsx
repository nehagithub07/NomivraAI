import type { Metadata } from "next";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { PreferencesMemory } from "@/components/nomvira/memory/preferences-memory";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMemoryState } from "@/lib/memory/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await createClient();
  const [state, trips] = await Promise.all([
    getMemoryState(db, user.id),
    db.from("trips").select("id,destination_name").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Make a little space for your preferences."
      />
      <PreferencesMemory initialState={state} trips={trips.data ?? []} />
    </>
  );
}
