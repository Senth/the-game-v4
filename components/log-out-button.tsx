export function LogOutButton() {
	return (
		<form action="/logout" method="post">
			<button
				type="submit"
				className="min-h-11 px-3 font-cond text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			>
				Log out
			</button>
		</form>
	)
}
