"use client";

import { useMemo, useState } from "react";
import { Grid3X3, RotateCcw } from "lucide-react";

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
    baseMeshSettings,
    updateBaseMeshSettings,
    resetToMockData
  } = useReinforcement();
  const [numericDraft, setNumericDraft] = useState<NumericDraftValues>(() =>
    createDraftValues(baseMeshSettings)
  );
  const activeWidth =
    baseMeshSettings.orientation === "horizontal"
      ? baseMeshSettings.sheetWidth
      : baseMeshSettings.sheetLength;
  const activeLength =
    baseMeshSettings.orientation === "horizontal"
      ? baseMeshSettings.sheetLength
      : baseMeshSettings.sheetWidth;
  const stepX = activeWidth - baseMeshSettings.overlapX;
  const stepY = activeLength - baseMeshSettings.overlapY;
  const layoutComparison = useMemo(
    () => compareBaseMeshOrientations(slabGeometry, baseMeshSettings),
    [baseMeshSettings, slabGeometry]
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
    baseMeshSettings.orientation !== layoutComparison.recommendedOrientation &&
    activeLayout.cutWasteArea > recommendedLayout.cutWasteArea;
  const hasPendingNumericChanges =
    numericDraft.sheetWidth !== String(baseMeshSettings.sheetWidth) ||
    numericDraft.sheetLength !== String(baseMeshSettings.sheetLength) ||
    numericDraft.overlapX !== String(baseMeshSettings.overlapX) ||
    numericDraft.overlapY !== String(baseMeshSettings.overlapY) ||
    numericDraft.wallAnchorageDepth !==
      String(baseMeshSettings.wallAnchorageDepth);

  function updateDraftValue(field: keyof NumericDraftValues, value: string) {
    setNumericDraft((current) => ({ ...current, [field]: value }));
  }

  function applyNumericDraft() {
    const nextSettings = {
      sheetWidth: draftNumber(numericDraft.sheetWidth, baseMeshSettings.sheetWidth),
      sheetLength: draftNumber(
        numericDraft.sheetLength,
        baseMeshSettings.sheetLength
      ),
      overlapX: draftNumber(numericDraft.overlapX, baseMeshSettings.overlapX),
      overlapY: draftNumber(numericDraft.overlapY, baseMeshSettings.overlapY),
      wallAnchorageDepth: draftNumber(
        numericDraft.wallAnchorageDepth,
        baseMeshSettings.wallAnchorageDepth
      )
    };

    setNumericDraft({
      sheetWidth: String(nextSettings.sheetWidth),
      sheetLength: String(nextSettings.sheetLength),
      overlapX: String(nextSettings.overlapX),
      overlapY: String(nextSettings.overlapY),
      wallAnchorageDepth: String(nextSettings.wallAnchorageDepth)
    });
    updateBaseMeshSettings(nextSettings);
  }

  function resetMeshSettings() {
    setNumericDraft(createDraftValues(mockBaseMeshSettings));
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

          <div className="space-y-2">
            <Label>Diameter</Label>
            <Select
              value={String(baseMeshSettings.diameter)}
              onValueChange={(value) =>
                updateBaseMeshSettings({
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
              value={String(baseMeshSettings.spacing)}
              onValueChange={(value) =>
                updateBaseMeshSettings({
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
                value={numericDraft.sheetWidth}
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
                value={numericDraft.sheetLength}
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
                value={numericDraft.overlapX}
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
                value={numericDraft.overlapY}
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
              value={numericDraft.wallAnchorageDepth}
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
              value={baseMeshSettings.originCorner}
              onValueChange={(value: BaseMeshSettings["originCorner"]) =>
                updateBaseMeshSettings({ originCorner: value })
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="grid-offset-x">Grid Offset X (mm)</Label>
              <Input
                id="grid-offset-x"
                step={50}
                type="number"
                value={baseMeshSettings.gridOffsetX}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);

                  if (Number.isFinite(nextValue)) {
                    updateBaseMeshSettings({ gridOffsetX: nextValue });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grid-offset-y">Grid Offset Y (mm)</Label>
              <Input
                id="grid-offset-y"
                step={50}
                type="number"
                value={baseMeshSettings.gridOffsetY}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);

                  if (Number.isFinite(nextValue)) {
                    updateBaseMeshSettings({ gridOffsetY: nextValue });
                  }
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Orientation Preference</Label>
            <ToggleGroup
              className="grid w-full grid-cols-2"
              value={baseMeshSettings.orientation}
              onValueChange={(value) => {
                if (value === "horizontal" || value === "vertical") {
                  updateBaseMeshSettings({ orientation: value });
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
            Ø{baseMeshSettings.diameter}@{baseMeshSettings.spacing} | Sheet{" "}
            {baseMeshSettings.sheetWidth} x {baseMeshSettings.sheetLength}mm |
            Cover {slabGeometry.concreteCover}mm
            <br />
            Wall anchorage: {baseMeshSettings.wallAnchorageDepth}mm
            <br />
            Active: {activeWidth} x {activeLength}mm | Step X: {stepX}mm | Step
            Y: {stepY}mm
            <br />
            Grid offset: X {baseMeshSettings.gridOffsetX}mm | Y{" "}
            {baseMeshSettings.gridOffsetY}mm
            <br />
            Recommended: {layoutComparison.recommendedOrientation} | Active:{" "}
            {baseMeshSettings.orientation}
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
