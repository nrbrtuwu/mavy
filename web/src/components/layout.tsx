import type { ReactNode } from "react"
import { Route as RouteIcon, Search, Settings, Star, TrainFront } from "lucide-react"
import { cn } from "cn"

import { AnimatedBackground } from "@/components/background"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { href } from "@/lib/router"
import { useSettings } from "@/lib/settings"

export type Section = "favorites" | "station" | "route" | null

const NAV = [
  { section: "route", label: "Útvonal", href: href.routeForm(), icon: RouteIcon },
  { section: "station", label: "Állomás", href: href.stations(), icon: Search },
  { section: "favorites", label: "Kedvencek", href: href.favorites(), icon: Star },
] as const

export function AppShell({ section, children }: { section: Section; children: ReactNode }) {
  const { animatedBackground } = useSettings()
  return (
    <div className="min-h-svh pb-[env(safe-area-inset-bottom)]">
      {/* Off in settings: not mounted at all, so no WebGL work. The page background shows. */}
      {animatedBackground && <AnimatedBackground />}
      <header className="sticky top-0 z-10 border-b bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <a href={href.start()} className="mr-auto flex items-center gap-2 font-semibold">
            <TrainFront className="size-5" aria-hidden />
            Mávy
          </a>
          <nav className="flex gap-1" aria-label="Fő menü">
            {NAV.map((item) => (
              <Button
                key={item.section}
                asChild
                variant={section === item.section ? "secondary" : "ghost"}
                size="sm"
                // All items the same size. Phones: 44px icon-only squares. Wider: icon + label, equal width.
                className="size-11 px-0 sm:h-9 sm:w-32"
              >
                <a
                  href={item.href}
                  aria-label={item.label}
                  title={item.label}
                  aria-current={section === item.section ? "page" : undefined}
                >
                  <item.icon aria-hidden />
                  <span className="sr-only sm:not-sr-only">{item.label}</span>
                </a>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">{children}</main>
      {/* Settings are deliberately low-key: a small boxed link at the bottom of every page. */}
      <footer className="mx-auto flex max-w-2xl justify-center px-4 pt-2 pb-8">
        <Button asChild variant="outline" size="sm" className="h-11 bg-card text-xs text-muted-foreground">
          <a href={href.settings()}>
            <Settings aria-hidden />
            Beállítások
          </a>
        </Button>
      </footer>
    </div>
  )
}

/**
 * One box per screen: title, description and actions on top, the screen's content below,
 * so no text sits directly on the animated background.
 */
export function Screen({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  )
}

/** Padded block inside a Screen. */
export function ScreenSection({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-3 px-4 pb-4", className)}>{children}</div>
}

/** Divided list inside a Screen, running edge to edge. */
export function ScreenList({ children }: { children: ReactNode }) {
  return <ul className="divide-y border-t">{children}</ul>
}

/** Placeholder while a screen loads, in the same box shape. */
export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="gap-3 p-4" aria-label="Betöltés…">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </Card>
  )
}
