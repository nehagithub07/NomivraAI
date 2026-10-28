import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath, isProtectedPath } from "../src/lib/auth/redirect.ts";
import {
  loginSchema,
  signupSchema,
  resetPasswordSchema,
  forgotPasswordSchema,
  maskEmail,
} from "../src/lib/auth/validation.ts";
import { getUserIdentity } from "../src/lib/auth/identity.ts";
import { recoveryResult } from "../src/lib/auth/recovery-result.ts";

test("internal redirects preserve app paths and discard credential query parameters", () => {
  assert.equal(
    safeNextPath("/trips/new?destination=Tokyo"),
    "/trips/new?destination=Tokyo",
  );
  assert.equal(
    safeNextPath(
      "/saved?code=secret&token_hash=secret&view=list#access_token=secret",
    ),
    "/saved?view=list",
  );
  assert.equal(safeNextPath("/trips/123"), "/trips/123");
});

test("redirects reject foreign origins, encoded authority tricks, controls, and auth loops", () => {
  for (const value of [
    null,
    undefined,
    ["/trips"],
    "",
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "/\\evil.example",
    "/%5cevil.example",
    "/%2f%2fevil.example",
    "/%252f%252fevil.example",
    "/trips\r\nlocation: https://evil.example",
    "/%00trips",
    "/login",
    "/signup",
    "/auth/callback",
    "/reset-password",
    "/trips/../../login",
    "/%",
    "/not-an-app-route",
  ])
    assert.equal(safeNextPath(value), "/", String(value));
});

test("route protection respects path segment boundaries", () => {
  for (const value of [
    "/",
    "/trips",
    "/trips/new",
    "/trips/123",
    "/explore",
    "/companion",
    "/saved",
    "/settings",
    "/help",
  ])
    assert.equal(isProtectedPath(value), true);
  for (const value of [
    "/trips-other",
    "/login",
    "/signup",
    "/auth/confirm",
    "/destinations/kyoto.svg",
    "/_next/static/a.js",
    "/design-system",
  ])
    assert.equal(isProtectedPath(value), false);
});

test("login validates email and requires a password without applying signup policy", () => {
  assert.equal(
    loginSchema.safeParse({ email: "person@example.com", password: "old" })
      .success,
    true,
  );
  assert.equal(
    loginSchema.safeParse({ email: "invalid", password: "" }).success,
    false,
  );
  assert.equal(
    forgotPasswordSchema.safeParse({ email: "  person@example.com  " }).data
      .email,
    "person@example.com",
  );
});

test("signup trims names, requires both, limits length, and validates matching passwords", () => {
  const valid = {
    firstName: "  A  ",
    lastName: "  Traveler  ",
    email: "person@example.com",
    password: "password with spaces ",
    confirmPassword: "password with spaces ",
  };
  const parsed = signupSchema.parse(valid);
  assert.equal(parsed.firstName, "A");
  assert.equal(parsed.lastName, "Traveler");
  assert.equal(parsed.password, valid.password);
  assert.equal(
    signupSchema.safeParse({ ...valid, firstName: " " }).success,
    false,
  );
  assert.equal(
    signupSchema.safeParse({ ...valid, lastName: "x".repeat(81) }).success,
    false,
  );
  assert.equal(
    signupSchema.safeParse({ ...valid, password: "short" }).success,
    false,
  );
  const mismatch = signupSchema.safeParse({
    ...valid,
    confirmPassword: "different",
  });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.error.issues[0].path[0], "confirmPassword");
});

test("password updates require a matching password of at least eight characters", () => {
  assert.equal(
    resetPasswordSchema.safeParse({
      password: "abcdefgh",
      confirmPassword: "abcdefgh",
    }).success,
    true,
  );
  assert.equal(
    resetPasswordSchema.safeParse({
      password: "abcdefg",
      confirmPassword: "abcdefg",
    }).success,
    false,
  );
  assert.equal(
    resetPasswordSchema.safeParse({
      password: "abcdefgh",
      confirmPassword: "different",
    }).success,
    false,
  );
});

test("email verification hints mask the local part", () => {
  assert.equal(maskEmail("kartavya@example.com"), "ka••••@example.com");
  assert.equal(maskEmail("a@example.com"), "a••••@example.com");
});

test("password recovery never distinguishes missing, unconfirmed, and existing accounts", () => {
  const success = recoveryResult(null);
  for (const code of [
    "user_not_found",
    "email_not_confirmed",
    "email_exists",
    "user_already_exists",
  ])
    assert.deepEqual(recoveryResult({ code }), success);
  assert.equal(recoveryResult({ status: 429 }).status, "error");
  assert.equal(recoveryResult({ status: 503 }).status, "error");
});

test("identity uses verified user metadata with safe fallbacks and Google-only image hosts", () => {
  assert.deepEqual(
    getUserIdentity({
      email: "someone@example.com",
      user_metadata: {
        first_name: " Maya ",
        last_name: "Rao",
        avatar_url: "https://lh3.googleusercontent.com/a/avatar",
      },
    }),
    {
      displayName: "Maya Rao",
      firstName: "Maya",
      initials: "MR",
      avatarUrl: "https://lh3.googleusercontent.com/a/avatar",
    },
  );
  assert.equal(
    getUserIdentity({ email: "someone@example.com", user_metadata: {} })
      .displayName,
    "someone",
  );
  assert.equal(
    getUserIdentity({ email: "someone@example.com", user_metadata: {} })
      .firstName,
    "Traveler",
  );
  assert.equal(getUserIdentity({ user_metadata: {} }).displayName, "Traveler");
  assert.equal(
    getUserIdentity({
      user_metadata: {
        name: "Maya Rao",
        picture: "https://evil.example/avatar",
      },
    }).avatarUrl,
    null,
  );
  assert.equal(
    getUserIdentity({ user_metadata: { name: "Maya Rao" } }).firstName,
    "Maya",
  );
});
