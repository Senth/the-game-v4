import Link from "next/link"

export default function NotFound() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center bg-z0 px-4 text-center">
			<p className="text-muted">Page not found.</p>
			<Link
				href="/"
				className="mt-3 inline-flex h-11 items-center px-3 font-cond text-link hover:underline active:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			>
				Back to the game ›
			</Link>
		</main>
	)
}
