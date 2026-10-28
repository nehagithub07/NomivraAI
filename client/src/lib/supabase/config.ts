export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key?.startsWith("sb_publishable_")) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}

export function getSiteOrigin() {
  const value =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
