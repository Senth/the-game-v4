import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { removeQuestAsset, uploadQuestAsset } from "@/app/admin/asset-actions"
import { maxAssetBytes } from "@/lib/domain/assets"
import { ConfirmDialog } from "./confirm-dialog"
import { QuestAsset, type QuestAssetHandle } from "./quest-asset"

const hooks = vi.hoisted(() => ({
	states: [] as unknown[],
	refs: [] as { current: unknown }[],
	cursor: 0,
	refCursor: 0,
}))
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++
		if (!(index in hooks.states)) hooks.states[index] = initial
		return [
			hooks.states[index],
			(value: unknown) => {
				hooks.states[index] = value
			},
		]
	},
	useRef: (initial: unknown) => {
		const index = hooks.refCursor++
		hooks.refs[index] ??= { current: initial }
		return hooks.refs[index]
	},
	useImperativeHandle: (ref: { current: unknown }, create: () => unknown) => {
		ref.current = create()
	},
}))
vi.mock("@/app/admin/asset-actions", () => ({ uploadQuestAsset: vi.fn(), removeQuestAsset: vi.fn() }))
vi.mock("./confirm-dialog", async (original) => ({
	...(await original<typeof import("./confirm-dialog")>()),
	ConfirmDialog: vi.fn(() => null),
}))

const image = "/assets/3f9c1a7e-1234-5678-90ab-cdef12345678.png"
const uploaded = "/assets/8d02b4c1-1234-5678-90ab-cdef12345678.pdf"
const props = { seasonId: "season", arcId: "arc", questId: "quest", assetPath: image, onChange: vi.fn() }
const handle = { current: null as QuestAssetHandle | null }

function view(assetPath: string | null = image, locked = false) {
	hooks.cursor = 0
	hooks.refCursor = 0
	return QuestAsset({ ...props, assetPath, locked, ref: handle })
}
function html(assetPath: string | null = image) {
	return renderToStaticMarkup(view(assetPath))
}
function input() {
	return view().props.children[1]
}
function controls(assetPath: string | null = image) {
	return view(assetPath).props.children[2].props.children
}
function dialog() {
	renderToStaticMarkup(view())
	return vi.mocked(ConfirmDialog).mock.calls.at(-1)?.[0]
}
function pick(file: File) {
	const target = { files: [file], value: "selected" }
	input().props.onChange({ currentTarget: target })
	return target
}

beforeEach(() => {
	vi.clearAllMocks()
	hooks.states = []
	hooks.refs = []
	handle.current = null
	vi.mocked(uploadQuestAsset).mockReset().mockResolvedValue({ ok: true, assetPath: uploaded })
	vi.mocked(removeQuestAsset).mockReset().mockResolvedValue({ ok: true })
})

it("shows empty File row with Upload, type hint and dashed 80 by 56 tile", () => {
	const markup = html(null)
	expect(markup).toContain(">File")
	expect(markup).toContain("any file up to 50 MB")
	expect(markup).toContain("h-14 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-z2")
	expect(markup).toContain(">+</span>")
	expect(markup).toContain("No file")
	expect(markup).toContain("Upload</button>")
	expect(markup).not.toContain("Remove</button>")
})

it("shows thumbnail, shortened name, bordered Replace and quiet Remove with focus rings", () => {
	const markup = html()
	expect(markup).toContain(`src="${image}"`)
	expect(markup).toContain('alt=""')
	expect(markup).toContain("h-14 w-20 shrink-0 rounded-md object-cover")
	expect(markup).toContain("min-w-0 flex-1 truncate font-cond text-sm text-muted")
	expect(markup).toContain("3f9c1a7e.png")
	expect(markup).toContain("Replace</button>")
	expect(markup).toContain("Remove</button>")
	for (const control of controls().slice(-2)) {
		expect(control.props.className).toContain("h-11")
		expect(control.props.className).toContain("focus-visible:outline-accent")
	}
	expect(controls().at(-2).props.className).toContain("border-z2")
	expect(controls().at(-1).props.className).toContain("text-muted")
})

it("disables File controls and imperative upload while puzzle is locked", async () => {
	const element = view(image, true)
	const buttons = element.props.children[2].props.children
	expect(element.props.children[1].props.disabled).toBe(true)
	expect(buttons[2].props.disabled).toBe(true)
	expect(buttons[3].props.disabled).toBe(true)
	await handle.current?.upload(new File(["image"], "chart.png"))
	expect(uploadQuestAsset).not.toHaveBeenCalled()
})

it.each([
	["pdf", "PDF", "PDF", "PDF"],
	["mp3", "MP3", "audio", "audio"],
	["mp4", "MP4", "video", "video"],
	["zip", "ZIP", "file", "file"],
])("shows %s tile and matching confirmation", (extension, tile, removeType, confirmLabel) => {
	const assetPath = `/assets/12345678-rest.${extension}`
	expect(html(assetPath)).toContain(`>${tile}</span>`)
	expect(html(assetPath)).not.toContain("<img")
	controls(assetPath).at(-1).props.onClick()
	renderToStaticMarkup(view(assetPath))
	expect(ConfirmDialog).toHaveBeenLastCalledWith(
		expect.objectContaining({
			open: true,
			title: `Remove this ${removeType}?`,
			confirmLabel: `Remove ${confirmLabel}`,
			body: "Players stop seeing it and the file is deleted.",
		}),
		undefined,
	)
})

it.each(["png", "svg"])("shows thumbnail for image kind .%s", (extension) => {
	const assetPath = `/assets/12345678-rest.${extension}`
	expect(html(assetPath)).toContain(`src="${assetPath}"`)
	expect(html(assetPath)).not.toContain(">SVG</span>")
})

it("keeps short filenames short and opens unrestricted hidden picker", () => {
	expect(html("/assets/log.png")).toContain(">log.png</span>")
	expect(input().props.type).toBe("file")
	expect(input().props.className).toBe("hidden")
	expect(input().props["aria-label"]).toBe("Upload quest file")
	expect(input().props.accept).toBeUndefined()
	const click = vi.fn()
	input().props.ref.current = { click }
	controls().at(-2).props.onClick()
	controls(null).at(-2).props.onClick()
	expect(click).toHaveBeenCalledTimes(2)
})

it.each([[new File([new Uint8Array(maxAssetBytes + 1)], "scan.pdf"), "scan.pdf is 50.0 MB. The limit is 50 MB."]])(
	"rejects invalid client file before action and announces exact error",
	async (file, error) => {
		view()
		await handle.current?.upload(file)
		expect(uploadQuestAsset).not.toHaveBeenCalled()
		expect(props.onChange).not.toHaveBeenCalled()
		expect(html()).toContain('role="alert" class="mt-1.5 font-cond text-xs text-warn"')
		expect(html()).toContain(error)
	},
)

it("passes SVG and arbitrary files to server validation", async () => {
	view()
	await handle.current?.upload(new File(["<svg/>"], "map.svg"))
	await handle.current?.upload(new File(["<html/>"], "page.html"))
	expect(uploadQuestAsset).toHaveBeenCalledTimes(2)
})

it("disables both controls while uploading, ignores duplicate requests and reports success", async () => {
	let finish!: (result: { ok: true; assetPath: string }) => void
	vi.mocked(uploadQuestAsset).mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve
		}),
	)
	view()
	const file = new File(["png bytes"], "map.png")
	const uploading = handle.current?.upload(file)
	expect(html()).toContain("Uploading…</button>")
	for (const control of controls().slice(-2)) expect(control.props.disabled).toBe(true)
	await handle.current?.upload(file)
	expect(uploadQuestAsset).toHaveBeenCalledOnce()
	const args = vi.mocked(uploadQuestAsset).mock.calls[0]
	expect(args?.slice(0, 3)).toEqual(["season", "arc", "quest"])
	expect(args?.[3].get("file")).toBe(file)
	expect(props.onChange).not.toHaveBeenCalled()
	finish({ ok: true, assetPath: uploaded })
	await uploading
	expect(props.onChange).toHaveBeenCalledExactlyOnceWith(uploaded)
	expect(html()).not.toContain("Uploading…")
})

it("resets picker after each pick, including choosing same file again", async () => {
	const file = new File(["bytes"], "map.png")
	expect(pick(file).value).toBe("")
	await vi.waitFor(() => expect(props.onChange).toHaveBeenCalledOnce())
	expect(pick(file).value).toBe("")
	await vi.waitFor(() => expect(props.onChange).toHaveBeenCalledTimes(2))
})

it.each(["returned", "thrown"])(
	"shows %s upload failure without changing current asset and permits retry",
	async (kind) => {
		if (kind === "returned")
			vi.mocked(uploadQuestAsset).mockResolvedValueOnce({
				ok: false,
				error: "Upload failed",
			})
		else vi.mocked(uploadQuestAsset).mockRejectedValueOnce(new Error("offline"))
		view()
		const file = new File(["bytes"], "map.png")
		await handle.current?.upload(file)
		expect(html()).toContain(kind === "returned" ? "Upload failed" : "Not saved, retry")
		expect(props.onChange).not.toHaveBeenCalled()
		expect(html()).toContain(`src="${image}"`)
		await handle.current?.upload(file)
		expect(props.onChange).toHaveBeenCalledWith(uploaded)
		expect(html()).not.toContain('role="alert"')
	},
)

it("shows drop errors in same accessible slot", () => {
	view()
	handle.current?.setError("Drop one file at a time.")
	expect(html()).toContain('role="alert"')
	expect(html()).toContain("Drop one file at a time.")
})

it("confirms image removal, allows cancellation, then clears asset only after success", async () => {
	controls().at(-1).props.onClick()
	const confirmation = dialog()
	expect(confirmation).toMatchObject({ open: true, title: "Remove this image?", confirmLabel: "Remove image" })
	expect(removeQuestAsset).not.toHaveBeenCalled()
	confirmation?.onClose()
	expect(dialog()?.open).toBe(false)
	controls().at(-1).props.onClick()
	dialog()?.onConfirm()
	expect(removeQuestAsset).toHaveBeenCalledExactlyOnceWith("season", "arc", "quest")
	for (const control of controls().slice(-2)) expect(control.props.disabled).toBe(true)
	await vi.waitFor(() => expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null))
})

it.each(["returned", "thrown"])("keeps current file and announces %s remove failure", async (kind) => {
	if (kind === "returned") vi.mocked(removeQuestAsset).mockResolvedValueOnce({ ok: false, error: "Quest missing" })
	else vi.mocked(removeQuestAsset).mockRejectedValueOnce(new Error("offline"))
	controls().at(-1).props.onClick()
	dialog()?.onConfirm()
	await vi.waitFor(() => expect(html()).toContain(kind === "returned" ? "Quest missing" : "Not saved, retry"))
	expect(props.onChange).not.toHaveBeenCalled()
	expect(html()).toContain(`src="${image}"`)
	expect(controls().at(-1).props.disabled).toBe(false)
})
