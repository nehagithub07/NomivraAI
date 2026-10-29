import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const template = value => /YOUR_|REPLACE_|[<>]/i.test(value);
function productionOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "example.com"].includes(url.hostname) &&
      !url.hostname.endsWith(".localhost") && !url.hostname.endsWith(".example") &&
      url.pathname === "/" && !url.search && !url.hash && !template(value);
  } catch { return false; }
}

// Validate names/categories only. Never include environment values in diagnostics.
export function deploymentErrors(env) {
  const errors = [];
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL", "NOMVIRA_API_URL"]) {
    if (!productionOrigin(env[name])) errors.push(`${name} must be your deployed HTTPS origin, without a path, query or credentials.`);
  }
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publicKey?.startsWith("sb_publishable_") || template(publicKey)) errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.");
  const internalKey = env.NOMVIRA_INTERNAL_API_KEY;
  if (!internalKey || internalKey.length < 32 || /\s/.test(internalKey) || template(internalKey)) errors.push("NOMVIRA_INTERNAL_API_KEY must be a private random value of at least 32 characters, matching FastAPI and the database.");
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /INTERNAL|STAYAPI|GEOAPIFY|GEMINI|GOOGLE_API_KEY|SERVICE_ROLE|SECRET/i.test(name)) errors.push(`Remove ${name}: private keys must not use NEXT_PUBLIC_.`);
  }
  if (env.NOMVIRA_API_URL && env.NOMVIRA_API_URL === env.NEXT_PUBLIC_SITE_URL) errors.push("NOMVIRA_API_URL must point to FastAPI on Render, not the Next.js application.");
  return errors;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  nextEnv.loadEnvConfig(process.cwd(), false);
  const errors = deploymentErrors(process.env);
  if (errors.length) {
    console.error("Deployment configuration needs attention:");
    errors.forEach(error => console.error(`- ${error}`));
    process.exitCode = 1;
  } else console.log("Deployment environment checks passed. Verify the matching database secret and Supabase redirect URLs before release.");
}
