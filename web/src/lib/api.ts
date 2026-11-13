// Calls to the Mávy server. Handles the service worker's offline copies and the optional password gate.

export class ApiError extends Error {
  status: number
  code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Added by api() when the service worker answered from its cache because the network failed. */
export interface Offline {
  _savedAt?: string | null
}

export async function api<T>(path: string, signal?: AbortSignal): Promise<T & Offline> {
  const res = await fetch(path, { signal, headers: { accept: "application/json" } })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // not JSON
  }
  const code = (body as { error?: string } | null)?.error ?? null
  if (res.status === 401) {
    // Optional password gate: not logged in (or the password changed).
    window.location.assign("login")
    throw new ApiError(401, code, "unauthorized")
  }
  if (!res.ok) throw new ApiError(res.status, code, `HTTP ${res.status}`)
  const data = body as T & Offline
  if (res.headers.get("x-mavy-offline") === "1" && data && typeof data === "object") {
    data._savedAt = res.headers.get("x-mavy-saved-at")
  }
  return data
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "offline") return "Nincs kapcsolat a szerverrel, és ehhez az oldalhoz nincs mentett adat."
    if (err.code === "no_timetable") return "Még nincs betöltve menetrend. A szerveren futtasd: bun run import-gtfs"
    if (err.code === "unknown_station") return "Nincs ilyen állomás."
    if (err.code === "unknown_train") return "Nincs ilyen vonat."
    if (err.status === 400) return "Hibás kérés."
    return `Szerverhiba (${err.status}).`
  }
  return "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot."
}
