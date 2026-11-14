// Downloads MÁV's train badge font MNR2007 from its ticket site into web/public/fonts/.
// The font belongs to MÁV and has no licence for redistribution, so it is not kept in git
// (see .gitignore); run this once per checkout: `bun run fetch-font`, then `bun run build`.
// Without the file the app shows plain text badges instead (see TrainBadge).

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

const URL = "https://jegy.mav.hu/PlaceReservationIcons/Graphic/Carriages/fonts/MNR2007.ttf"
const OUT = join(import.meta.dir, "..", "web", "public", "fonts", "MNR2007.ttf")
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

const res = await fetch(URL, { headers: { "User-Agent": UA } })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} from ${URL}`)
  process.exit(1)
}
const bytes = new Uint8Array(await res.arrayBuffer())
// A TrueType font starts with 00 01 00 00; anything else (an error page …) is not saved.
const isTrueType = bytes.length > 1000 && bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0
if (!isTrueType) {
  console.error(`Not a TrueType font (${bytes.length} bytes) from ${URL}; nothing saved.`)
  process.exit(1)
}
await mkdir(dirname(OUT), { recursive: true })
await Bun.write(OUT, bytes)
console.log(`Saved ${bytes.length} bytes to ${OUT}. Run \`bun run build\` to include it.`)
