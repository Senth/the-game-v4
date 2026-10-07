"use client"

import { useActionState } from "react"
import { type LoginState, login } from "./actions"

const label = "mb-1.5 block font-cond text-xs uppercase tracking-wider text-muted"
const input = "h-11 w-full rounded-md border border-z2 bg-field px-3 outline-hidden focus:border-accent"

export function LoginForm() {
	const [state, action, pending] = useActionState<LoginState, FormData>(login, {})
	return (
		<form action={action} className="space-y-5">
			<label className="block">
				<span className={label}>Name</span>
				<input
					name="name"
					required
					defaultValue={state.name}
					autoComplete="username"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					className={input}
				/>
			</label>
			<label className="block">
				<span className={label}>Password</span>
				<input name="password" type="password" required autoComplete="current-password" className={input} />
			</label>
			{state.error && (
				<p role="alert" className="font-cond text-sm text-warn">
					{state.error}
				</p>
			)}
			<button
				type="submit"
				disabled={pending}
				className="h-12 w-full rounded-md bg-accent font-cond text-lg font-bold text-white hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
			>
				{pending ? "Logging in…" : "Log in"}
			</button>
		</form>
	)
}
