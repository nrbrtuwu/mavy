import type { ReactNode } from "react"
import { Route as RouteIcon, Search, Settings, Star, TrainFront } from "lucide-react"
import { cn } from "cn"

import { AnimatedBackground } from "@/components/background"
import { Button } from "@/components/ui/button"
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
                // Phones: icon only, 44px square tap target. Wider screens: icon + label.
                className="size-11 px-0 sm:h-9 sm:w-auto sm:px-3"
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
      {/* Settings are deliberately low-key: a small link at the bottom of every page. */}
      <footer className="mx-auto flex max-w-2xl justify-center px-4 pt-4 pb-8">
        <a
          href={href.settings()}
          className="inline-flex min-h-11 items-center gap-1.5 px-3 text-xs text-muted-foreground/70 hover:text-muted-foreground"
        >
          <Settings className="size-3.5" aria-hidden />
          Beállítások
        </a>
      </footer>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** Placeholder rows while a list loads. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-label="Betöltés…">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-14 w-full")} />
      ))}
    </div>
  )
}
