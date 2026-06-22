"use client";

import { useMemo, useState } from "react";
import { Grid3X3, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useReinforcement } from "@/context/reinforcement-context";
import { mockBaseMeshSettings } from "@/data/mockStructureData";
import { compareBaseMeshOrientations } from "@/lib/geometry/mesh-sheet-layout";
import type { BaseMeshSettings } from "@/types/structure";

const diameterOptions: BaseMeshSettings["diameter"][] = [8, 10, 12];
const spacingOptions: BaseMeshSettings["spacing"][] = [150, 200, 250];
const originOptions: BaseMeshSettings["originCorner"][] = [
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right"
];

type NumericDraftValues = {
  sheetWidth: string;
  sheetLength: string;
  overlapX: string;
  overlapY: string;
  wallAnchorageDepth: string;
};

type NumericDraftState = {
  zoneId: string;
  values: NumericDraftValues;
};

function createDraftValues(settings: BaseMeshSettings): NumericDraftValues {
  return {
    sheetWidth: String(settings.sheetWidth),
    sheetLength: String(settings.sheetLength),
    overlapX: String(settings.overlapX),
    overlapY: String(settings.overlapY),
    wallAnchorageDepth: String(settings.wallAnchorageDepth)
  };
}

function draftNumber(value: string, fallback: number) {
  const nextValue = Number(value);

  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function squareMeters(value: number) {
  return (value / 1_000_000).toFixed(1);
}

export function BaseMeshPanel() {
  const {
    slabGeometry,
    meshZones,
    activeZoneId,
    activeMeshZone,
    isDrawingZone,
    beginDrawingZone,
    setActiveZoneId,
    updateActiveMeshZoneParameters,
    resetToMockData
  } = useReinforcement();
  const activeSettings = activeMeshZone.parameters;
  const [numericDraft, setNumericDraft] = useState<NumericDraftState>(() =>
    ({
      zoneId: activeZoneId,
      values: createDraftValues(activeSettings)
    })
  );
  const visibleDraft =
    numericDraft.zoneId === activeZoneId
      ? numericDraft.values
      : createDraftValues(activeSettings);

  const activeWidth =
    activeSettings.orientation === "horizontal"
      ? activeSettings.sheetWidth
      : activeSettings.sheetLength;
  const activeLength =
    activeSettings.orientation === "horizontal"
      ? activeSettings.sheetLength
      : activeSettings.sheetWidth;
  const stepX = activeWidth - activeSettings.overlapX;
  const stepY = activeLength - activeSettings.overlapY;
  const layoutComparison = useMemo(
    () =>
      compareBaseMeshOrientations(
        slabGeometry,
        activeSettings,
        activeMeshZone.geometry
      ),
    [activeMeshZone.geometry, activeSettings, slabGeometry]
  );
  const activeLayout = layoutComparison.active;
  const recommendedLayout = layoutComparison.recommended;
  const wastePercent =
    activeLayout.rawSheetArea > 0
      ? (activeLayout.cutWasteArea / activeLayout.rawSheetArea) * 100
      : 0;
  const overrideWastePercent =
    recommendedLayout.cutWasteArea > 0
      ? ((activeLayout.cutWasteArea - recommendedLayout.cutWasteArea) /
          recommendedLayout.cutWasteArea) *
        100
      : activeLayout.cutWasteArea > recommendedLayout.cutWasteArea
        ? 100
        : 0;
  const isManualLessEconomical =
    activeSettings.orientation !== layoutComparison.recommendedOrientation &&
    activeLayout.cutWasteArea > recommendedLayout.cutWasteArea;
  const hasPendingNumericChanges =
    visibleDraft.sheetWidth !== String(activeSettings.sheetWidth) ||
    visibleDraft.sheetLength !== String(activeSettings.sheetLength) ||
    visibleDraft.overlapX !== String(activeSettings.overlapX) ||
    visibleDraft.overlapY !== String(activeSettings.overlapY) ||
    visibleDraft.wallAnchorageDepth !==
      String(activeSettings.wallAnchorageDepth);

  function updateDraftValue(field: keyof NumericDraftValues, value: string) {
    setNumericDraft((current) => ({
      zoneId: activeZoneId,
      values: {
        ...(current.zoneId === activeZoneId
          ? current.values
          : createDraftValues(activeSettings)),
        [field]: value
      }
    }));
  }

  function applyNumericDraft() {
    const nextSettings = {
      sheetWidth: draftNumber(visibleDraft.sheetWidth, activeSettings.sheetWidth),
      sheetLength: draftNumber(
        visibleDraft.sheetLength,
        activeSettings.sheetLength
      ),
      overlapX: draftNumber(visibleDraft.overlapX, activeSettings.overlapX),
      overlapY: draftNumber(visibleDraft.overlapY, activeSettings.overlapY),
      wallAnchorageDepth: draftNumber(
        visibleDraft.wallAnchorageDepth,
        activeSettings.wallAnchorageDepth
      )
    };

    setNumericDraft({
      zoneId: activeZoneId,
      values: {
        sheetWidth: String(nextSettings.sheetWidth),
        sheetLength: String(nextSettings.sheetLength),
        overlapX: String(nextSettings.overlapX),
        overlapY: String(nextSettings.overlapY),
        wallAnchorageDepth: String(nextSettings.wallAnchorageDepth)
      }
    });
    updateActiveMeshZoneParameters(nextSettings);
  }

  function resetMeshSettings() {
    setNumericDraft({
      zoneId: "ZONE-MAIN",
      values: createDraftValues(mockBaseMeshSettings)
    });
    resetToMockData();
  }

  return (
    <aside className="flex h-full min-h-[620px] flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5 text-primary" />
            Base Mesh Settings
          </CardTitle>
          <CardDescription>הגדרות רשת בסיס</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-2xl font-semibold">
                {slabGeometry.boundary.length}
              </div>
              <div className="text-muted-foreground">Boundary vertices</div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-2xl font-semibold">
                {slabGeometry.openings.length}
              </div>
              <div className="text-muted-foreground">Openings</div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>אזורי רשת</Label>
              <Button
                className="h-8 gap-1 px-2"
                variant={isDrawingZone ? "secondary" : "default"}
                onClick={beginDrawingZone}
              >
                <Plus className="h-3.5 w-3.5" />
                {isDrawingZone ? "Drawing..." : "Add Zone"}
              </Button>
            </div>
            {isDrawingZone ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs leading-5 text-blue-800">
                לחץ וגרור עם העכבר כדי להגדיר את שטח הרשת החדשה
              </div>
            ) : null}
            <div className="space-y-2">
              {meshZones.map((zone) => (
                <button
                  key={zone.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                    zone.id === activeZoneId
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                  suppressHydrationWarning
                  type="button"
                  onClick={() => setActiveZoneId(zone.id)}
                >
                  <span className="font-medium" suppressHydrationWarning>
                    {zone.name}
                  </span>
                  <span
                    className="ml-2 text-xs text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {zone.isMainZone ? "Main Zone" : zone.id}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Diameter</Label>
            <Select
              value={String(activeSettings.diameter)}
              onValueChange={(value) =>
                updateActiveMeshZoneParameters({
                  diameter: Number(value) as BaseMeshSettings["diameter"]
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {diameterOptions.map((diameter) => (
                  <SelectItem key={diameter} value={String(diameter)}>
                    {diameter} mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Spacing / Gap</Label>
            <Select
              value={String(activeSettings.spacing)}
              onValueChange={(value) =>
                updateActiveMeshZoneParameters({
                  spacing: Number(value) as BaseMeshSettings["spacing"]
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {spacingOptions.map((spacing) => (
                  <SelectItem key={spacing} value={String(spacing)}>
                    {spacing} mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sheet-width">Sheet Width</Label>
              <Input
                id="sheet-width"
                min={500}
                step={100}
                type="number"
                value={visibleDraft.sheetWidth}
                onChange={(event) =>
                  updateDraftValue("sheetWidth", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sheet-length">Sheet Length</Label>
              <Input
                id="sheet-length"
                min={1000}
                step={100}
                type="number"
                value={visibleDraft.sheetLength}
                onChange={(event) =>
                  updateDraftValue("sheetLength", event.target.value)
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="overlap-x">Overlap X</Label>
              <Input
                id="overlap-x"
                min={0}
                step={50}
                type="number"
                value={visibleDraft.overlapX}
                onChange={(event) =>
                  updateDraftValue("overlapX", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="overlap-y">Overlap Y</Label>
              <Input
                id="overlap-y"
                min={0}
                step={50}
                type="number"
                value={visibleDraft.overlapY}
                onChange={(event) =>
                  updateDraftValue("overlapY", event.target.value)
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wall-anchorage-depth">
              {"חדירה לקירות (מ\"מ)"}
            </Label>
            <Input
              id="wall-anchorage-depth"
              min={0}
              step={25}
              type="number"
              value={visibleDraft.wallAnchorageDepth}
              onChange={(event) =>
                updateDraftValue("wallAnchorageDepth", event.target.value)
              }
            />
          </div>

          <Button
            className="w-full"
            disabled={!hasPendingNumericChanges}
            onClick={applyNumericDraft}
          >
            Update Mesh Layout
          </Button>

          <div className="space-y-2">
            <Label>Origin Corner</Label>
            <Select
              value={activeSettings.originCorner}
              onValueChange={(value: BaseMeshSettings["originCorner"]) =>
                updateActiveMeshZoneParameters({ originCorner: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {originOptions.map((origin) => (
                  <SelectItem key={origin} value={origin}>
                    {origin}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Orientation Preference</Label>
            <ToggleGroup
              className="grid w-full grid-cols-2"
              value={activeSettings.orientation}
              onValueChange={(value) => {
                if (value === "horizontal" || value === "vertical") {
                  updateActiveMeshZoneParameters({ orientation: value });
                }
              }}
            >
              <ToggleGroupItem value="horizontal">
                <span>Horizontal | אופקי</span>
                {layoutComparison.recommendedOrientation === "horizontal" ? (
                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    Eco | חסכוני
                  </span>
                ) : null}
              </ToggleGroupItem>
              <ToggleGroupItem value="vertical">
                <span>Vertical | אנכי</span>
                {layoutComparison.recommendedOrientation === "vertical" ? (
                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    Eco | חסכוני
                  </span>
                ) : null}
              </ToggleGroupItem>
            </ToggleGroup>
            {isManualLessEconomical ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-800">
                כיוון זה מייצר {overrideWastePercent.toFixed(1)}% יותר פחת פלדה
                מהאופציה המומלצת.
              </div>
            ) : null}
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
            Active zone: {activeMeshZone.name}
            <br />
            Ø{activeSettings.diameter}@{activeSettings.spacing} | Sheet{" "}
            {activeSettings.sheetWidth} x {activeSettings.sheetLength}mm |
            Cover {slabGeometry.concreteCover}mm
            <br />
            Wall anchorage: {activeSettings.wallAnchorageDepth}mm
            <br />
            Active: {activeWidth} x {activeLength}mm | Step X: {stepX}mm | Step
            Y: {stepY}mm
            <br />
            Recommended: {layoutComparison.recommendedOrientation} | Active:{" "}
            {activeSettings.orientation}
            <br />
            Sheets: {activeLayout.sheetCount} | Steel area:{" "}
            {squareMeters(activeLayout.rawSheetArea)}m² | Waste:{" "}
            {squareMeters(activeLayout.cutWasteArea)}m² ({wastePercent.toFixed(1)}
            %)
            <br />
            Optimized overlap X: {Math.round(activeLayout.optimizedOverlapX)}
            mm | Y: {Math.round(activeLayout.optimizedOverlapY)}mm
          </div>

          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={resetMeshSettings}
          >
            <RotateCcw className="h-4 w-4" />
            Reset slab geometry
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
