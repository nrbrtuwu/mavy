import { Screen, ScreenSection } from "@/components/layout"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { START_PAGES, updateSettings, useSettings, type StartPage } from "@/lib/settings"

export function SettingsScreen() {
  const settings = useSettings()
  return (
    <Screen title="Beállítások">
      <Separator />
      <ScreenSection className="pt-4">
        <h2 className="font-medium">Kezdőoldal</h2>
        <RadioGroup
          value={settings.startPage}
          onValueChange={(value) => updateSettings({ startPage: value as StartPage })}
          className="gap-0"
        >
          {START_PAGES.map((page) => (
            <Label
              key={page.value}
              htmlFor={`start-${page.value}`}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
            >
              <RadioGroupItem id={`start-${page.value}`} value={page.value} />
              <span className="flex-1 font-medium">{page.label}</span>
            </Label>
          ))}
        </RadioGroup>
      </ScreenSection>
      <Separator />
      <ScreenSection className="pt-4">
        <Label htmlFor="animated-background" className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col gap-1">
            <span className="font-medium">Animált háttér</span>
            <span className="text-xs font-normal text-muted-foreground">
              Kikapcsolva egyszerű háttér látszik. Gyengébb gépen és akkumulátoron kímélőbb.
            </span>
          </span>
          <Switch
            id="animated-background"
            checked={settings.animatedBackground}
            onCheckedChange={(checked) => updateSettings({ animatedBackground: checked })}
          />
        </Label>
      </ScreenSection>
      <Separator />
      <ScreenSection className="pt-4">
        <Label htmlFor="frequent-stations" className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col gap-1">
            <span className="font-medium">Gyakran keresett állomások</span>
            <span className="text-xs font-normal text-muted-foreground">
              A keresésben az 5 leggyakrabban választott állomás elöl. Kikapcsolva nem számolja és nem mutatja őket.
            </span>
          </span>
          <Switch
            id="frequent-stations"
            checked={settings.frequentStations}
            onCheckedChange={(checked) => updateSettings({ frequentStations: checked })}
          />
        </Label>
      </ScreenSection>
      <Separator />
      <ScreenSection className="pt-4">
        <Label htmlFor="full-screen" className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col gap-1">
            <span className="font-medium">Teljes képernyő</span>
            <span className="text-xs font-normal text-muted-foreground">
              A középső doboz kitölti a képernyőt a menüsor alatt, telefonon és gépen is
            </span>
          </span>
          <Switch
            id="full-screen"
            checked={settings.fullScreen}
            onCheckedChange={(checked) => updateSettings({ fullScreen: checked })}
          />
        </Label>
      </ScreenSection>
    </Screen>
  )
}
