import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "Enter a valid email address.")
  .email("Enter a valid email address.");
const name = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Use 80 characters or fewer.");
const newPassword = z.string().min(8, "Use at least 8 characters.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export const signupSchema = z
  .object({
    firstName: name,
    lastName: name,
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don’t match.",
  });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don’t match.",
  });

export type AuthField =
  "firstName" | "lastName" | "email" | "password" | "confirmPassword";
export type AuthState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<AuthField, string[]>>;
};
export type AuthMode = "login" | "signup" | "forgot" | "reset";
export const initialAuthState: AuthState = { status: "idle" };

export function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  return domain
    ? `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}••••@${domain}`
    : "your email address";
}
