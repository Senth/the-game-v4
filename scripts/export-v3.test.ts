import { Timestamp } from "firebase-admin/firestore"
import { describe, expect, it } from "vitest"
import { parseV3Export } from "@/lib/domain/v3-import"
import fixture from "../test/fixtures/v3-export.json"
import { parseExportArgs, serializeV3Documents } from "./export-v3"

describe("export:v3", () => {
	it("round-trips every fixture season through the exporter and importer", () => {
		const documents = Object.entries(fixture.game_seasons)
			.filter(([id]) => id !== "__collections__")
			.map(([id, document]) => ({ id, data: () => document }))
		const serialized = serializeV3Documents(documents)
		const parsed = parseV3Export({ game_seasons: serialized })

		expect(parsed.map(({ season }) => season._id)).toEqual(documents.map(({ id }) => id))
		expect(parsed).toHaveLength(documents.length)
	})

	it("serializes timestamp documents into the phase 2 parser format", () => {
		const start = new Date("2023-10-20T18:00:00.000Z")
		const end = new Date("2023-10-20T18:15:00.000Z")
		const document = fixture.game_seasons["cipher-2023"]
		const serialized = serializeV3Documents([
			{
				id: "cipher-2023",
				data: () => ({ ...document, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }),
			},
		])

		expect(serialized["cipher-2023"]).toMatchObject({
			start: { __datatype__: "timestamp", value: { _seconds: 1697824800 } },
			end: { __datatype__: "timestamp", value: { _seconds: 1697825700 } },
		})
		const [parsed] = parseV3Export({ game_seasons: serialized })
		expect(parsed?.season).toMatchObject({
			_id: "cipher-2023",
			title: "Cipher Night 2023",
			start,
			end,
			lengthMinutes: 90,
			shuffleArcs: true,
		})
		expect(parsed?.season.arcs[0]?.quests[0]?.internalTitle).toBe("Keeper's script")
	})

	it("parses required arguments and defaults collection name", () => {
		expect(parseExportArgs(["--project", "example-project", "--out", "seasons.json"])).toEqual({
			collection: "game_seasons",
			output: "seasons.json",
			projectId: "example-project",
		})
	})
})
