import { expect, type Page, test } from "@playwright/test"

async function login(page: Page, name: string, password: string) {
	await page.goto(`${process.env.E2E_BASE_URL}/login`)
	await page.getByLabel("Name", { exact: true }).fill(name)
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).not.toHaveURL(/\/login$/)
}

async function saveField(page: Page, label: string | RegExp, value: string) {
	const field = page.getByLabel(label, { exact: true }).filter({ visible: true })
	await field.fill(value)
	await field.blur()
	await expect(page.getByRole("banner").getByRole("status")).toHaveText("Saved")
}

test("admin authors a game, team solves it, admin retains hint history", async ({ page: admin, browser }) => {
	await login(admin, "e2e-admin", "e2e-admin-pass")
	await expect(admin).toHaveURL(/\/admin$/)
	await admin.getByRole("button", { name: "+ New season", exact: true }).click()
	await admin.getByLabel("New season", { exact: true }).filter({ visible: true }).fill("E2E Night")
	await admin.getByRole("button", { name: "Create", exact: true }).click()
	await expect(admin).toHaveURL(/\/admin\/seasons\/[^/]+$/)
	await admin.getByRole("button", { name: "+ Arc", exact: true }).click()
	await saveField(admin, "Arc title", "E2E Arc")
	await admin.getByRole("button", { name: "Done", exact: true }).click()
	await expect(admin.getByRole("button", { name: "Shuffle quests in E2E Arc" })).toHaveAttribute(
		"aria-pressed",
		"false",
	)

	const quests = [
		{ title: "Alpha", answer: "lighthouse", points: "10", hint: "Look up" },
		{ title: "Beta", answer: "harbour", points: "20", hint: "Look out to sea" },
	]
	for (const quest of quests) {
		const previousURL = admin.url()
		await admin.getByRole("button", { name: "+ Quest", exact: true }).click()
		await expect(admin).not.toHaveURL(previousURL)
		await expect(admin.getByLabel(/Display title/)).toHaveValue("")
		await saveField(admin, /Display title/, quest.title)
		await saveField(admin, /Content/, `Solve ${quest.title}.`)
		await admin.getByPlaceholder("Add answer").fill(quest.answer)
		await admin.getByPlaceholder("Add answer").press("Enter")
		await expect(admin.getByRole("banner").getByRole("status")).toHaveText("Saved")
		await saveField(admin, "Points", quest.points)
		await admin.getByRole("button", { name: "+ Add hint", exact: true }).click()
		await saveField(admin, "Hint text", quest.hint)
		await saveField(admin, "Hint points", "5")
		await admin.getByRole("button", { name: "Done", exact: true }).click()
	}

	await admin.getByRole("link", { name: /^Teams/ }).click()
	await admin.getByLabel("Team name", { exact: true }).fill("E2E Team")
	await admin.getByLabel("Password", { exact: true }).fill("e2e-pass")
	await admin.getByRole("button", { name: "Add", exact: true }).click()
	const teamLink = admin.getByRole("main").getByRole("link", { name: /E2E Team/ })
	await expect(teamLink).toBeVisible()
	await admin.getByRole("button", { name: "Start now", exact: true }).click()
	await expect(admin.getByRole("button", { name: "End game", exact: true })).toBeVisible()
	await expect(admin.getByRole("dialog")).not.toBeVisible()

	const teamContext = await browser.newContext()
	try {
		const team = await teamContext.newPage()
		await login(team, "E2E Team", "e2e-pass")
		await expect(team.getByRole("heading", { name: "Alpha", exact: true })).toBeVisible()
		await team.getByRole("button", { name: /Hold to decrypt/ }).hover()
		await team.mouse.down()
		try {
			await expect(team.getByText("Look up", { exact: true })).toBeVisible()
		} finally {
			await team.mouse.up()
		}
		await team.getByLabel("Your answer", { exact: true }).fill("nope")
		await team.getByRole("button", { name: "Send", exact: true }).click()
		await expect(team.getByText('"nope" is not it.', { exact: true })).toBeVisible()
		for (const quest of quests) {
			await expect(team.getByRole("heading", { name: quest.title, exact: true })).toBeVisible()
			await team.getByLabel("Your answer", { exact: true }).fill(quest.answer)
			await team.getByRole("button", { name: "Send", exact: true }).click()
		}
		await expect(team.getByRole("heading", { name: "You solved every quest.", exact: true })).toBeVisible()
	} finally {
		await teamContext.close()
	}

	await teamLink.click()
	const stats = admin.getByRole("region", { name: "Team stats" })
	await expect(stats.getByText("25p", { exact: true })).toBeVisible()
	await expect(stats.getByText("−5p from hints", { exact: true })).toBeVisible()
	const alphaHistory = admin.getByRole("main").getByRole("listitem").filter({ hasText: "Alpha" })
	await expect(alphaHistory.getByText("H1", { exact: true })).toBeVisible()
	await expect(alphaHistory.getByText("Look up", { exact: true })).toBeVisible()
	await expect(alphaHistory.getByText("−5p", { exact: true })).toBeVisible()
})
