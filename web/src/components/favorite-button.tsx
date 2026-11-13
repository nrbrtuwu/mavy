import { Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { favId, toggleFavorite, useFavorites, type Favorite } from "@/lib/favorites"

export function FavoriteButton({ favorite }: { favorite: Favorite }) {
  const favorites = useFavorites()
  const on = favorites.some((f) => favId(f) === favId(favorite))
  return (
    <Button variant={on ? "secondary" : "outline"} aria-pressed={on} onClick={() => toggleFavorite(favorite)}>
      <Star className={on ? "fill-current" : undefined} aria-hidden />
      {on ? "Kedvenc" : "Kedvencekhez"}
    </Button>
  )
}
