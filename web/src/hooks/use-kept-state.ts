// useState that survives switching screens: the value is kept in memory under a key
// while the app is open (not stored on the device; a full reload starts fresh).

import { useCallback, useState, type SetStateAction } from "react"

const values = new Map<string, unknown>()

export function useKeptState<T>(key: string, initial: T): [T, (value: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => (values.has(key) ? (values.get(key) as T) : initial))
  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next
        values.set(key, resolved)
        return resolved
      })
    },
    [key],
  )
  return [value, set]
}
