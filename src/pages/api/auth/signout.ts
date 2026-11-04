import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "@/lib/auth";

export const POST: APIRoute = (context) => {
  context.cookies.delete(SESSION_COOKIE, { path: "/" });
  return context.redirect("/auth/signin");
};
