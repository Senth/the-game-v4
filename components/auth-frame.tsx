import type { ReactNode } from "react"

export function AuthFrame({ subtitle, children }: { subtitle?: ReactNode; children: ReactNode }) {
	return (
		<main className="flex min-h-dvh flex-col justify-center px-4">
			<div className="mx-auto w-full max-w-sm">
				<header className="mb-11 text-center">
					<h1 className="font-head text-3xl font-medium text-head">The Game</h1>
					{subtitle && <p className="mt-2 font-cond text-sm text-muted">{subtitle}</p>}
				</header>
				{children}
			</div>
		</main>
	)
}
