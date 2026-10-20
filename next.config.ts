import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingExcludes: {
		"/*": ["./*.{ts,tsx}", "./{app,components,lib,scripts}/**/*.{ts,tsx}"],
	},
	experimental: {
		serverActions: { bodySizeLimit: "51mb" },
		proxyClientMaxBodySize: "51mb",
	},
}

export default nextConfig
