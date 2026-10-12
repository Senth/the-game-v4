import type { ReactNode } from "react"
import { LogOutButton } from "@/components/log-out-button"
import { AutosaveHeader, SaveStatus } from "./save-status"

export function AdminFrame({
	title,
	status,
	menu,
	phoneHeader,
	preview,
	children,
}: {
	title: ReactNode
	status?: ReactNode
	menu: ReactNode
	phoneHeader: ReactNode
	preview?: ReactNode
	children: ReactNode
}) {
	return (
		<div className="flex min-h-dvh flex-col lg:h-dvh">
			<AutosaveHeader className="hidden h-14 shrink-0 items-center gap-4 border-b px-4 font-cond text-sm lg:flex">
				<h1 className="min-w-0 truncate font-head text-lg text-head">{title}</h1>
				{status}
				<div className="ml-auto flex shrink-0 items-center gap-4">
					<SaveStatus />
					<LogOutButton />
				</div>
			</AutosaveHeader>
			<div className="lg:hidden">{phoneHeader}</div>
			<div className="flex min-h-0 flex-1">
				<aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-z1 lg:block">{menu}</aside>
				<main className="min-w-0 flex-1 lg:overflow-y-auto">{children}</main>
				{preview && (
					<aside className="hidden w-92 shrink-0 overflow-y-auto border-l border-z1 px-6 pt-6 lg:block">
						{preview}
					</aside>
				)}
			</div>
		</div>
	)
}
