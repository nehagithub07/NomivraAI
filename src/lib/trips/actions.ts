"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createTripFormSchema, tripSubmissionContextSchema, type CreateTripResult } from "./validation";
import { todayInTimeZone } from "./dates";
import { mapTripFormToDatabase } from "./mapping";
import { internalKey } from "@/lib/destinations/backend";
import { verifyProof } from "@/lib/destinations/proof";
import { resolvedDestinationSchema } from "@/lib/destinations/validation";
import { tripSaveFailure } from "./save-errors";

const failure: CreateTripResult = {
  status: "error",
  message: "We couldn't create your trip. Your information is still here — please try again.",
};

function reportCreateFailure(stage: "context" | "rpc" | "response" | "unexpected", error?: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  const candidate = error && typeof error === "object" ? error : {};
  const code = "code" in candidate && typeof candidate.code === "string" &&
    /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(candidate.code) ? candidate.code : "UNKNOWN";
  // Database messages/details may contain user input. Log only a stage and code.
  console.error("[trips.create] Save failed", JSON.stringify({ stage, code }));
}

export async function createTrip(payload: unknown, context: unknown): Promise<CreateTripResult> {
  const calendar = tripSubmissionContextSchema.safeParse(context);
  if (!calendar.success) { reportCreateFailure("context"); return failure; }
  const values = createTripFormSchema(todayInTimeZone(calendar.data.timeZone)).safeParse(payload);
  if (!values.success) return {
    status: "error", message: "Check the highlighted details before creating your trip.",
    fieldErrors: values.error.flatten().fieldErrors,
  };

  let tripId: string;
  try {
    // Reuse the verified Step 4 identity. Ownership is never accepted in payload.
    const user = await getCurrentUser();
    if (!user) return {
      status: "error", sessionExpired: true,
      message: "Your session has expired. Sign in in another tab, then return here to create your trip. Your information is still here.",
    };
    const proof = values.data.destinationProof;
    const signedSchema = z.object({ kind: z.literal("destination"), user_id: z.literal(user.id),
      expires_at: z.number().int().min(Math.floor(Date.now() / 1000)),
      resolved_at: z.number().int(), destination: resolvedDestinationSchema });
    let validProof = false;
    try { validProof = !!proof && verifyProof(proof.payload, proof.signature, internalKey()) && signedSchema.safeParse(JSON.parse(proof.payload)).success; }
    catch { validProof = false; }
    if (!validProof || !proof) return { status: "error", message: "Please select your destination again to confirm its details.",
      fieldErrors: { destination: ["Select your destination again before creating this trip."] } };
    const supabase = await createClient({ writable: true });
    // The restricted RPC verifies the proof and independently derives auth.uid().
    const { data, error } = await supabase.rpc("create_resolved_trip", {
      p_form: mapTripFormToDatabase(values.data, calendar.data.timeZone),
      p_payload: proof.payload, p_signature: proof.signature,
    });
    if (error) { reportCreateFailure("rpc", error); return tripSaveFailure(error); }
    if (!z.uuid().safeParse(data).success) { reportCreateFailure("response"); return failure; }
    tripId = data!;
  } catch (error) {
    reportCreateFailure("unexpected", error);
    return failure;
  }
  revalidatePath("/trips");
  revalidatePath("/");
  return { status: "success", tripId };
}
