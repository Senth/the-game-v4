import type { SessionData } from "./session"

const publicPaths = ["/login", "/logout", "/register", "/board", "/icon.svg", "/favicon.ico"]
const publicPrefixes = ["/assets/", "/_next/"]

const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/")

export function routeFor(pathname: string, session: SessionData | null): string | null {
	if (publicPaths.includes(pathname) || publicPrefixes.some((prefix) => pathname.startsWith(prefix))) return null
	if (!session) return "/login"
	if (session.kind === "team") return isAdminPath(pathname) ? "/" : null
	return isAdminPath(pathname) ? null : "/admin"
}
