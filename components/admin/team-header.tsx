import Link from "next/link"

export function TeamHeader({ seasonId, name }: { seasonId: string; name: string }) {
	return (
		<>
			<header className="flex min-h-12 items-center border-b border-z1 px-1 font-cond lg:hidden">
				<Link
					href={`/admin/seasons/${seasonId}/teams`}
					className="flex min-h-11 shrink-0 items-center px-3 text-link hover:underline active:text-head focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
				>
					‹ Teams
				</Link>
				<h1 className="min-w-0 flex-1 truncate pr-4 font-head text-head">{name}</h1>
			</header>
			<h2 className="mb-4 hidden truncate px-4 pt-6 font-head text-2xl text-head lg:block">{name}</h2>
		</>
	)
}
