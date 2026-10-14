import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	output: "standalone",
	experimental: {
		serverActions: { bodySizeLimit: "11mb" },
		proxyClientMaxBodySize: "11mb",
	},
}

export default nextConfig
