import { z } from "zod";

export const toolNames = ["get_trip_overview", "get_itinerary", "get_weather", "get_budget_summary", "get_selected_hotel", "get_saved_food", "get_discovered_places", "get_trip_preferences", "find_trip_places", "find_food_options", "find_hotel_options", "add_budget_entry", "move_itinerary_activity", "replace_itinerary_activity", "create_itinerary_version", "adapt_itinerary_for_weather", "select_hotel", "save_food_selection"] as const;
export const writeTools = new Set<string>(toolNames.slice(11));
export const toolCallSchema = z.object({ id: z.string().min(1).max(150), name: z.enum(toolNames), arguments: z.record(z.string(), z.unknown()), permission: z.enum(["READ", "WRITE_CONFIRMATION_REQUIRED"]) }).strict();
export const cardSchema = z.object({ tool_name: z.enum(toolNames), data: z.record(z.string(), z.unknown()) }).strict();
export const responseSchema = z.object({ message: z.string().min(1).max(2000), cards: z.array(cardSchema).max(5), suggested_actions: z.array(z.string().max(100)).max(3), pending_call: toolCallSchema.nullable(), tool_audit: z.array(z.record(z.string(), z.unknown())).max(5), prompt_version: z.string().max(32), model_name: z.string().max(100), demo: z.boolean(), reference_date: z.iso.date().nullable().default(null) }).strict();
export const stepSchema = z.object({ continuation_id: z.string().nullable(), calls: z.array(toolCallSchema).max(5), response: responseSchema.nullable() }).strict();
export const messageBodySchema = z.object({ request_id: z.uuid(), message: z.string().trim().min(1).max(2000) }).strict();
export const emptyBodySchema = z.object({}).strict();
export const actionSchema = z.object({ id: z.uuid(), tool_name: z.enum(toolNames), arguments: z.record(z.string(), z.unknown()), snapshot: z.record(z.string(), z.unknown()), preview: z.record(z.string(), z.unknown()), status: z.enum(["pending", "confirmed", "executed", "cancelled", "expired", "failed"]), result: z.record(z.string(), z.unknown()).nullable(), expires_at: z.string() });
export type ToolCall = z.infer<typeof toolCallSchema>;
export type CompanionCard = z.infer<typeof cardSchema>;
export type CompanionResponse = z.infer<typeof responseSchema>;
export type PendingAction = z.infer<typeof actionSchema>;
export type PublicAction = Pick<PendingAction, "id" | "tool_name" | "preview" | "status" | "result" | "expires_at">;
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string; cards?: CompanionCard[]; suggested_actions?: string[]; pending_action_id?: string; reference_date?: string | null };
export type ChatState = { messages: ChatMessage[]; actions: PublicAction[] };

export function companionError(code?: string) {
  if (code?.includes("RATE_LIMITED")) return "Please wait a moment before sending another message.";
  if (code?.includes("CONTEXT_CHANGED")) return "Your trip changed. Reload and request the change again.";
  if (code?.includes("SETUP")) return "Trip chat needs a database setup update.";
  if (code?.includes("TIMEOUT")) return "That took too long. Reload to check the saved result before trying again.";
  return "We couldn't complete that request. Reload to check the saved result, then try again.";
}
