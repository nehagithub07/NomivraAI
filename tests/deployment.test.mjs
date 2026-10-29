import test from "node:test";
import assert from "node:assert/strict";
import { deploymentErrors } from "../scripts/check-deployment.mjs";

const configured = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
  NEXT_PUBLIC_SITE_URL: "https://nomvira-test.vercel.app",
  NOMVIRA_API_URL: "https://nomvira-test.onrender.com",
  NOMVIRA_INTERNAL_API_KEY: "test-internal-application-key-never-real",
};

test("deployment accepts separate HTTPS services and requires every setting", () => {
  assert.deepEqual(deploymentErrors(configured), []);
  for (const name of Object.keys(configured)) {
    const env = { ...configured }; delete env[name];
    assert.ok(deploymentErrors(env).some(error => error.includes(name)));
  }
});

test("deployment rejects localhost, insecure URLs, credentials and callback paths", () => {
  for (const value of ["http://localhost:3000", "https://127.0.0.1", "https://[::1]", "http://nomvira-test.onrender.com", "https://user:PRIVATE@example.net", "https://nomvira-test.onrender.com/api/v1", "https://nomvira-test.vercel.app?token=PRIVATE", "https://YOUR_PROJECT.vercel.app"]) {
    for (const name of ["NEXT_PUBLIC_SITE_URL", "NOMVIRA_API_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      const errors = deploymentErrors({ ...configured, [name]: value });
      assert.ok(errors.some(error => error.includes(name)));
      assert.ok(!errors.join(" ").includes("PRIVATE"));
    }
  }
  assert.ok(deploymentErrors({ ...configured, NOMVIRA_API_URL: configured.NEXT_PUBLIC_SITE_URL }).length);
});

test("deployment rejects exposed provider keys and service-role keys without printing their values", () => {
  for (const name of ["NEXT_PUBLIC_NOMVIRA_INTERNAL_API_KEY", "NEXT_PUBLIC_STAYAPI_API_KEY", "NEXT_PUBLIC_GEOAPIFY_API_KEY", "NEXT_PUBLIC_GEMINI_API_KEY", "NEXT_PUBLIC_GOOGLE_API_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_SECRET_KEY"]) {
    const errors = deploymentErrors({ ...configured, [name]: "PRIVATE_DO_NOT_LOG" });
    assert.ok(errors.some(error => error.includes(name)));
    assert.ok(!errors.join(" ").includes("PRIVATE_DO_NOT_LOG"));
  }
  assert.ok(deploymentErrors({ ...configured, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_PRIVATE" }).length);
  for (const value of ["short", "<replace-with-a-long-private-key>", "PRIVATE_WITH_SPACE ".repeat(3)]) {
    const errors = deploymentErrors({ ...configured, NOMVIRA_INTERNAL_API_KEY: value });
    assert.ok(errors.length);
    assert.ok(!errors.join(" ").includes(value));
  }
});
