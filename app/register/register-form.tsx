"use client"

import { useActionState, useState } from "react"
import { buttonClass, inputClass, labelClass } from "@/components/auth-form"
import { type RegisterState, register } from "./actions"

export function RegisterForm() {
	const [state, action, pending] = useActionState<RegisterState, FormData>(register, {})
	const [visible, setVisible] = useState(false)
	return (
		<form action={action} className="space-y-5">
			<label className="block">
				<span className={labelClass}>Team name</span>
				<input
					name="name"
					required
					maxLength={30}
					defaultValue={state.name}
					autoComplete="username"
					autoCorrect="off"
					spellCheck={false}
					className={inputClass}
				/>
			</label>
			<div>
				<label htmlFor="password" className={labelClass}>
					Password
				</label>
				<div className="relative">
					<input
						id="password"
						name="password"
						type={visible ? "text" : "password"}
						required
						minLength={4}
						autoComplete="new-password"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						className={`${inputClass} pr-16`}
					/>
					<button
						type="button"
						onClick={() => setVisible(!visible)}
						aria-pressed={visible}
						aria-label="Show password"
						className="absolute top-0 right-0 h-11 min-w-11 rounded-md px-3 font-cond text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-accent"
					>
						{visible ? "Hide" : "Show"}
					</button>
				</div>
			</div>
			{state.error && (
				<p role="alert" className="font-cond text-sm text-warn">
					{state.error}
				</p>
			)}
			<button type="submit" disabled={pending} className={buttonClass}>
				{pending ? "Creating…" : "Create team"}
			</button>
		</form>
	)
}
