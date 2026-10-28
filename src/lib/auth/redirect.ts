export const AUTHENTICATED_HOME = "/";
const protectedRoots = [
  "/trips",
  "/explore",
  "/companion",
  "/saved",
  "/settings",
  "/help",
];

export function isProtectedPath(pathname: string) {
  return (
    pathname === "/" ||
    protectedRoots.some(
      (root) => pathname === root || pathname.startsWith(`${root}/`),
    )
  );
}

export function safeNextPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return AUTHENTICATED_HOME;
  try {
    let decoded = value;
    for (let index = 0; index < 3; index++) {
      if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//"))
        return AUTHENTICATED_HOME;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//"))
      return AUTHENTICATED_HOME;
    const url = new URL(value, "https://nomvira.invalid");
    if (
      url.origin !== "https://nomvira.invalid" ||
      !isProtectedPath(url.pathname)
    )
      return AUTHENTICATED_HOME;
    for (const key of [
      "code",
      "token",
      "token_hash",
      "access_token",
      "refresh_token",
      "error_description",
      "sb_flow_id",
    ])
      url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  } catch {
    return AUTHENTICATED_HOME;
  }
}
