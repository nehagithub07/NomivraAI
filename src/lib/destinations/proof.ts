import { createHmac, timingSafeEqual } from "node:crypto";

// Deliberately independent of Next for direct security tests. Import only on server.
export function signProof(payload: string, key: string) {
  if (key.length < 32) throw new Error("Internal application key is not configured.");
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

export function verifyProof(payload: string, signature: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(signature) || key.length < 32) return false;
  return timingSafeEqual(Buffer.from(signProof(payload, key), "hex"), Buffer.from(signature, "hex"));
}
