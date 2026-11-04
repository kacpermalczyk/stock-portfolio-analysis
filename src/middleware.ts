import { defineMiddleware } from "astro:middleware";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";

const PROTECTED_ROUTES = ["/dashboard", "/history", "/api/portfolio"];

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = await getSessionUser(context.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route)) && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  return next();
});
