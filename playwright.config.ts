import { defineConfig } from "@playwright/test"

export default defineConfig({
	testDir: "e2e",
	globalSetup: "./e2e/global-setup.ts",
	globalTimeout: 60_000,
	outputDir: ".tmp/e2e/results",
	reporter: "list",
	workers: 1,
	retries: 0,
	use: { browserName: "chromium", headless: true },
})
