import type { APIRoute } from "astro";
import { createOwnerSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

const SIGN_IN_ERROR_URL = "/auth/signin?error=login_failed";

function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = formText(form.get("email"));
  const password = formText(form.get("password"));

  const token = await createOwnerSession(email, password);
  if (!token) return context.redirect(SIGN_IN_ERROR_URL);

  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !import.meta.env.DEV,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return context.redirect("/dashboard");
};
