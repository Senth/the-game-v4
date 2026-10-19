import { getDb } from "@/lib/db/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
	try {
		await (await getDb()).command({ ping: 1 })
		return Response.json({ ok: true })
	} catch (error) {
		console.error("MongoDB health check failed", error)
		return Response.json({ ok: false }, { status: 503 })
	}
}
