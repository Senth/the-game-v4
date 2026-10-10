import { headers } from "next/headers"
import QRCode from "qrcode"
import { joinToken } from "@/lib/auth/join"
import type { Team } from "@/lib/domain/schemas"
import { TeamQrControls } from "./team-qr-controls"

export async function TeamQr({ team }: { team: Team }) {
	const requestHeaders = await headers()
	const host = requestHeaders.get("host")
	if (!host) throw new Error("Host header is required for team join links")
	const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
	const url = new URL(`/join/${encodeURIComponent(joinToken(team))}`, `${protocol}://${host}`).href
	const svg = await QRCode.toString(url, {
		type: "svg",
		width: 224,
		color: { dark: "#05080d", light: "#c5c7d8" },
	})
	return <TeamQrControls url={url} svg={svg} />
}
