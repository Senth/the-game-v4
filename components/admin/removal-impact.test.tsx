import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { RemovalImpact } from "./removal-impact"

function render(impact: Parameters<typeof RemovalImpact>[0]["impact"]) {
	return renderToStaticMarkup(
		<RemovalImpact
			impact={impact}
			onItLabel="On it now · skips it with 0 points"
			notReachedLabel="Not reached · leaves their order"
			solvedLabel={(count) => `${count} teams solved it and keep their points.`}
		/>,
	)
}

const counts: [Parameters<typeof RemovalImpact>[0]["impact"], string][] = [
	[{ kind: "deleteQuest", onIt: [], notReached: [], solved: 2 }, "No team is affected"],
	[{ kind: "deleteQuest", onIt: ["Ninjas"], notReached: [], solved: 0 }, "1 team affected"],
	[{ kind: "deleteQuest", onIt: ["Ninjas"], notReached: ["Lagom"], solved: 0 }, "2 teams affected"],
]

it.each(counts)("counts affected teams as %s", (impact, count) => {
	expect(render(impact)).toContain(count)
})

it("omits empty outcome groups and zero-solved footnotes", () => {
	const html = render({ kind: "deleteQuest", onIt: [], notReached: ["Lagom"], solved: 0 })
	expect(html).toContain("Not reached · leaves their order")
	expect(html).not.toContain("On it now · skips it with 0 points")
	expect(html).not.toContain("solved it")
	const none = render({ kind: "deleteQuest", onIt: [], notReached: [], solved: 0 })
	expect(none).not.toContain("On it now")
	expect(none).not.toContain("Not reached")
})
