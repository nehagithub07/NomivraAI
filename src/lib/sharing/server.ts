import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient as createAnonymousClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { supabaseFetch } from "@/lib/supabase/fetch";
import { buildExportDocument } from "@/lib/exports/server";
import { exportDocumentSchema, shareCommandSchema, shareDocument, shareOptionsSchema, type ShareOptions } from "@/lib/exports/validation";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof } from "@/lib/destinations/proof";
import { openShareToken, sealShareToken, shareTokenHash } from "./tokens";

type DB = SupabaseClient<Database>;
export type ShareState = { available: boolean; active: boolean; url: string | null; expiresAt: string | null; revision: string | null; options: ShareOptions | null };
const unavailable: ShareState = { available: false, active: false, url: null, expiresAt: null, revision: null, options: null };
function shareFailure(error: { code?: string }) {
  return new TravelError("SHARE_UNAVAILABLE", error.code === "40001" ? "Sharing changed in another tab. Reload before creating a link." : "Sharing is unavailable. Reload to check the link before trying again.", error.code === "40001" ? 409 : 503);
}
function publicState(row: Database["public"]["Tables"]["trip_shares"]["Row"] | null): ShareState {
  if (!row) return { ...unavailable, available: true };
  const active = !!row.token_hash && !!row.expires_at && Date.parse(row.expires_at) > Date.now();
  let url: string | null = null;
  try {
    const origin = getSiteOrigin();
    const token = active && row.token_cipher ? openShareToken(row.token_cipher, row.trip_id) : null;
    if (origin && token && shareTokenHash(token) === row.token_hash) url = `${origin}/share/${token}`;
  } catch { /* Key rotation: retain revoke controls and require a new link. */ }
  const parsedOptions = shareOptionsSchema.safeParse(row.options);
  return { available: true, active, url, expiresAt: row.expires_at, revision: row.revision, options: parsedOptions.success ? parsedOptions.data : null };
}
export async function getShareState(db: DB, tripId: string, userId: string): Promise<ShareState> {
  const { data, error } = await db.from("trip_shares").select("*").eq("trip_id", tripId).eq("owner_id", userId).maybeSingle();
  return error ? unavailable : publicState(data);
}
export async function executeShareCommand(db: DB, tripId: string, userId: string, input: z.infer<typeof shareCommandSchema>) {
  const command = shareCommandSchema.parse(input);
  const trip = await loadOwnedItineraryTrip(db, tripId, userId);
  if (command.action === "revoke") {
    const result = await db.rpc("revoke_trip_share", { p_trip_id: trip.id });
    if (result.error) throw shareFailure(result.error);
  } else {
    if (!getSiteOrigin()) throw new TravelError("SHARE_UNAVAILABLE", "Sharing needs the application URL configured.");
    const { data: existing, error } = await db.from("trip_shares").select("*").eq("trip_id", tripId).eq("owner_id", userId).maybeSingle();
    if (error) throw shareFailure(error);
    if (existing?.request_id === command.requestId && existing.token_hash) return publicState(existing);
    const document = JSON.stringify(shareDocument(await buildExportDocument(db, trip), command.options));
    const token = randomBytes(32).toString("base64url");
    const payload = JSON.stringify({
      kind: "trip_share", user_id: userId, trip_id: trip.id, trip_updated_at: trip.updated_at,
      expires_at: Math.floor(Date.now() / 1000) + 180, request_id: command.requestId, revision: command.revision,
      options: command.options, token_hash: shareTokenHash(token), token_cipher: sealShareToken(token, trip.id),
      share_expires_at: new Date(Date.now() + Number(command.expiresInDays) * 86400000 - 1000).toISOString(),
      document_hash: createHash("sha256").update(document).digest("hex"),
    });
    const result = await db.rpc("create_trip_share", { p_payload: payload, p_signature: signProof(payload, internalKey()), p_document: document });
    if (result.error) throw shareFailure(result.error);
  }
  const state = await getShareState(db, tripId, userId);
  if (!state.available) throw shareFailure({});
  return state;
}

export async function getSharedTrip(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const config = getSupabaseConfig();
  if (!config) throw new TravelError("SHARE_UNAVAILABLE", "Shared trip is temporarily unavailable.");
  // A cookie-free anonymous client. Public rendering never reads profiles or sessions.
  const db = createAnonymousClient<Database>(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: supabaseFetch },
  });
  const result = await db.rpc("get_shared_trip", { p_token: token }).abortSignal(AbortSignal.timeout(8000));
  if (result.error) throw new TravelError("SHARE_UNAVAILABLE", "Shared trip is temporarily unavailable.");
  if (result.data === null) return null;
  const parsed = exportDocumentSchema.safeParse(result.data);
  if (!parsed.success) throw new TravelError("SHARE_UNAVAILABLE", "Shared trip is temporarily unavailable.");
  return parsed.data;
}
