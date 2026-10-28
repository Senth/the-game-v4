import { Fragment } from "react"
import type { Phone } from "@/lib/domain/schemas"

export function TeamPhones({ phones, now }: { phones: Pick<Phone, "name" | "lastSeenAt">[]; now: Date }) {
	const isHere = (phone: Pick<Phone, "lastSeenAt">) => now.getTime() - phone.lastSeenAt.getTime() <= 600_000
	const ordered = [...phones].sort(
		(left, right) => Number(!isHere(left)) - Number(!isHere(right)) || left.name.localeCompare(right.name),
	)
	return (
		<section aria-label="Phones" className="border-b border-z1 px-4 py-3">
			<div className="flex items-baseline justify-between">
				<p className="font-cond uppercase tracking-wider text-xs text-muted">Phones</p>
				<span className="font-cond text-xs text-muted">{phones.length} phones</span>
			</div>
			{ordered.length ? (
				<p className="mt-1 font-cond text-sm">
					{ordered.map((phone, index) => (
						<Fragment key={phone.name}>
							{index > 0 && " · "}
							<span className={isHere(phone) ? "text-ink" : "text-muted"}>
								{phone.name}
								{isHere(phone) ? "" : " away"}
							</span>
						</Fragment>
					))}
				</p>
			) : (
				<p className="mt-1 font-cond text-sm text-muted">No phones yet</p>
			)}
		</section>
	)
}
