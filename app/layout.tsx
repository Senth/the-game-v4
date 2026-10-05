import type { Metadata } from "next"
import { Roboto, Roboto_Condensed, Roboto_Slab } from "next/font/google"
import "./globals.css"

const roboto = Roboto({
	weight: ["400", "500", "700"],
	subsets: ["latin", "latin-ext"],
	display: "swap",
	variable: "--font-roboto",
})

const robotoSlab = Roboto_Slab({
	weight: ["400", "600"],
	subsets: ["latin", "latin-ext"],
	display: "swap",
	variable: "--font-roboto-slab",
})

const robotoCondensed = Roboto_Condensed({
	weight: ["500", "700"],
	subsets: ["latin", "latin-ext"],
	display: "swap",
	variable: "--font-roboto-condensed",
})

export const metadata: Metadata = {
	title: "The Game",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${roboto.variable} ${robotoSlab.variable} ${robotoCondensed.variable}`}>
			<body>{children}</body>
		</html>
	)
}
