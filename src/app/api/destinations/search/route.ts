import { callTravelApi, internalKey } from "@/lib/destinations/backend";
import { travelRoute } from "@/lib/destinations/bff";
import { signProof } from "@/lib/destinations/proof";
import { destinationSearchRequestSchema, destinationSearchResponseSchema } from "@/lib/destinations/validation";

export async function GET(request: Request) {
  return travelRoute(request, destinationSearchRequestSchema, async (query, userId) => {
    const result = await callTravelApi("destinations/search", query, destinationSearchResponseSchema);
    const now = Math.floor(Date.now() / 1000);
    return { destinations: result.destinations.map((destination) => {
      const payload = JSON.stringify({ kind: "destination", user_id: userId, resolved_at: now, expires_at: now + 86400, destination });
      return { ...destination, proof: { payload, signature: signProof(payload, internalKey()) } };
    }) };
  });
}
