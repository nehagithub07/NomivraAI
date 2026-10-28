import type { User } from "@supabase/supabase-js";

export type UserIdentity = {
  displayName: string;
  firstName: string;
  initials: string;
  avatarUrl: string | null;
};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 100) : "";

export function getUserIdentity(
  user: Pick<User, "email" | "user_metadata">,
): UserIdentity {
  const metadata: Record<string, unknown> = user.user_metadata;
  const given = text(metadata.first_name) || text(metadata.given_name);
  const family = text(metadata.last_name) || text(metadata.family_name);
  const full = text(metadata.full_name) || text(metadata.name);
  const displayName =
    [given, family].filter(Boolean).join(" ") ||
    full ||
    user.email?.split("@")[0] ||
    "Traveler";
  const firstName = given || full.split(/\s+/)[0] || "Traveler";
  const initials =
    displayName === "Traveler"
      ? ""
      : displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => Array.from(part)[0])
          .join("")
          .toUpperCase();
  let avatarUrl: string | null = null;
  try {
    const avatar = new URL(text(metadata.avatar_url) || text(metadata.picture));
    if (
      avatar.protocol === "https:" &&
      (avatar.hostname === "googleusercontent.com" ||
        avatar.hostname.endsWith(".googleusercontent.com")) &&
      !avatar.username &&
      !avatar.password
    )
      avatarUrl = avatar.href;
  } catch {
    /* Initials remain the fallback. */
  }
  return { displayName, firstName, initials, avatarUrl };
}
