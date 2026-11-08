import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { internalKey } from "@/lib/destinations/backend";

const key = () => createHash("sha256").update(`nomvira-trip-sharing-v1:${internalKey()}`).digest();
export const shareTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function sealShareToken(token: string, tripId: string) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(tripId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function openShareToken(sealed: string, tripId: string) {
  const bytes = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(tripId)); decipher.setAuthTag(bytes.subarray(12, 28));
  const token = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid share token");
  return token;
}
