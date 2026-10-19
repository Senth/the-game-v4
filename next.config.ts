import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingExcludes: {
		"/*": ["./*.{ts,tsx}", "./{app,components,lib,scripts}/**/*.{ts,tsx}"],
	},
	experimental: {
		serverActions: { bodySizeLimit: "11mb" },
		proxyClientMaxBodySize: "11mb",
	},
}

export default nextConfig
