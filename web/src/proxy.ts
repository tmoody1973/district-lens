import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 renamed Middleware to Proxy (same mechanism, new filename).
//
// Public-first by design: we protect NOTHING here, so every civic read —
// district lookup, race comparison, citations, agent answers — stays fully
// open to anonymous users. The /api/saved/* routes self-gate via auth() and
// return 401 JSON when no user is signed in. Running clerkMiddleware() (without
// auth.protect) just makes auth() available everywhere; it never blocks reads.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
