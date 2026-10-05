import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		globalSetup: ["test/mongo.global.ts"],
		exclude: [...configDefaults.exclude, ".tmp/**", ".next/**"],
	},
})
