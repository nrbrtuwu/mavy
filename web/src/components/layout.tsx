import { createContext, useContext, useEffect, type ReactNode } from "react"
import { ArrowLeft, Route as RouteIcon, Search, Settings, Star } from "lucide-react"
import { AppLogo } from "@/components/app-logo"
import { cn } from "cn"

import { AnimatedBackground } from "@/components/background"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useEdgeSwipeBack } from "@/hooks/use-edge-swipe-back"
import { href, navigateBack } from "@/lib/router"
import { useSettings } from "@/lib/settings"

export type Section ="favorites" | "station" | "route" | "settings" | null

const NAV = [
  { section: "route", label: "Útvonal", href: href.routeForm(), icon: RouteIcon },
  { section: "station", label: "Állomás", href: href.stations(), icon: Search },
  { section: "favorites", label: "Kedvencek", href: href.favorites(), icon: Star },
  { section: "settings", label: "Beállítások", href: href.settings(), icon: Settings },
] as const

export function AppShell({
  section,
  backHref,
  children,
}: {
  section: Section
  /** Where Back goes without an earlier app page; null on top-level pages (no Back button). */
  backHref: string | null
  children: ReactNode
}) {
  const { animatedBackground, fullScreen } = useSettings()

  // Edge swipe in the iPhone home-screen app: the previous page (any screen), or the parent.
  useEdgeSwipeBack(() => navigateBack(backHref))

  // Full screen: the page behind the box is the box's grey too (index.css, html.full-screen).
  useEffect(() => {
    document.documentElement.classList.toggle("full-screen", fullScreen)
    document.documentElement.style.backgroundColor = "" // index.html's first-paint colour; CSS from here on
  }, [fullScreen])

  // The page itself must stay at the top (only #app-scroll scrolls). Fingers cannot scroll
  // it (overflow: hidden), but iOS may nudge it, e.g. when the keyboard opens: snap back.
  useEffect(() => {
    const snap = () => {
      if (window.scrollY !== 0 && !isTypingInField()) window.scrollTo(0, 0)
    }
    window.addEventListener("scroll", snap, { passive: true })
    document.addEventListener("focusout", snap)
    return () => {
      window.removeEventListener("scroll", snap)
      document.removeEventListener("focusout", snap)
    }
  }, [])

  return (
    <>
      {/* Off in settings, or hidden behind the full-screen box: not mounted, so no WebGL work. */}
      {animatedBackground && !fullScreen && <AnimatedBackground />}
      {/*
        The page itself does not scroll (see index.css). This column fills the visible screen
        (h-dvh): navbar, then the screen's box (fixed height, scrolls inside, see Screen).
        `absolute` rather than `fixed` so Safari does not take it as a bottom-edge element to
        tint its toolbar with.
      */}
      <div
        id={APP_SCROLL_ID}
        className={cn(
          "absolute inset-x-0 top-0 isolate flex h-dvh flex-col overflow-hidden",
          // Full screen: the box reaches the bottom edge and pads the home-indicator area itself.
          !fullScreen && "pb-[env(safe-area-inset-bottom)]",
        )}
      >
      {/*
        Solid navbar in the box's grey (--card), reaching under the status bar. iPhone home-screen
        apps (iOS 26.1+) paint the status bar strip themselves and blur/fade it over anything
        see-through; with a solid header, status-bar-style "default" and theme-color / manifest
        theme_color set to this same colour (index.html, manifest), the strip is one solid grey.
      */}
      <header className="ios-top-pad relative z-10 shrink-0 border-b bg-card pt-[env(safe-area-inset-top)]">
        <div className={cn("mx-auto flex h-14 items-center gap-2 px-4", !fullScreen && "max-w-2xl")}>
          <a href={href.start()} className="mr-auto flex items-center gap-2 font-semibold">
            <AppLogo />
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
      {/*
        The screen's box is as tall as its content (at most the free space) and centred.
        Full screen (setting): it fills all the space under the navbar, edge to edge.
      */}
      <main
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col",
          fullScreen
            ? "*:flex-1 *:rounded-none *:pb-[env(safe-area-inset-bottom)] *:ring-0"
            : "max-w-2xl justify-center gap-4 p-4",
        )}
      >
        {/* Screen shows the Back button in its box's top right corner. */}
        <BackContext.Provider value={backHref}>{children}</BackContext.Provider>
      </main>
      </div>
    </>
  )
}

/** Where the current screen's Back goes (see AppShell's backHref); null = no Back button. */
const BackContext = createContext<string | null>(null)

/** The element the app scrolls in (the page itself does not scroll). */
export const APP_SCROLL_ID = "app-scroll"

/** While typing, iOS may shift the page to keep the field visible above the keyboard: allow it. */
function isTypingInField(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}

/**
 * One box per screen: title, description and actions on top, the screen's content below,
 * so no text sits directly on the animated background. The box is as tall as its content and
 * centred below the navbar; when the content is longer than the free space, the box fills it,
 * its title stays put and only the content scrolls inside.
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
  const backHref = useContext(BackContext)
  return (
    // Content height, shrinking to the free space when longer (then the body scrolls inside).
    <Card className="min-h-0 gap-0 py-0">
      <div className="flex shrink-0 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {backHref !== null && (
            <Button
              variant="outline"
              size="icon"
              // 44px tap target, like the navbar buttons.
              className="size-11 shrink-0"
              onClick={() => navigateBack(backHref)}
              aria-label="Vissza"
              title="Vissza"
            >
              <ArrowLeft aria-hidden />
            </Button>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children && (
        <div data-screen-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      )}
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
    <Card className="min-h-0 gap-3 overflow-hidden p-4" aria-label="Betöltés…">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </Card>
  )
}
