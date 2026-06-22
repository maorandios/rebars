"use client";

import { useMemo } from "react";
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
import { generateBaseMeshLayout } from "@/lib/geometry/mesh-sheet-layout";
import type { BaseMeshSettings } from "@/types/structure";

const diameterOptions: BaseMeshSettings["diameter"][] = [8, 10, 12];
const spacingOptions: BaseMeshSettings["spacing"][] = [150, 200, 250];
const originOptions: BaseMeshSettings["originCorner"][] = [
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right"
];

export function BaseMeshPanel() {
  const {
    slabGeometry,
    baseMeshSettings,
    updateBaseMeshSettings,
    resetToMockData
  } = useReinforcement();
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
  const optimizedLayout = useMemo(
    () => generateBaseMeshLayout(slabGeometry, baseMeshSettings),
    [baseMeshSettings, slabGeometry]
  );

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
                value={baseMeshSettings.sheetWidth}
                onChange={(event) =>
                  updateBaseMeshSettings({
                    sheetWidth: Number(event.target.value)
                  })
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
                value={baseMeshSettings.sheetLength}
                onChange={(event) =>
                  updateBaseMeshSettings({
                    sheetLength: Number(event.target.value)
                  })
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
                value={baseMeshSettings.overlapX}
                onChange={(event) =>
                  updateBaseMeshSettings({
                    overlapX: Number(event.target.value)
                  })
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
                value={baseMeshSettings.overlapY}
                onChange={(event) =>
                  updateBaseMeshSettings({
                    overlapY: Number(event.target.value)
                  })
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
              value={baseMeshSettings.wallAnchorageDepth}
              onChange={(event) =>
                updateBaseMeshSettings({
                  wallAnchorageDepth: Number(event.target.value)
                })
              }
            />
          </div>

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
                Horizontal | אופקי
              </ToggleGroupItem>
              <ToggleGroupItem value="vertical">Vertical | אנכי</ToggleGroupItem>
            </ToggleGroup>
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
            Auto selected: {optimizedLayout.selectedOrientation} | Sheets:{" "}
            {optimizedLayout.sheetCount} | Waste:{" "}
            {(optimizedLayout.cutWasteArea / 1_000_000).toFixed(1)}m²
            <br />
            Optimized overlap X: {Math.round(optimizedLayout.optimizedOverlapX)}
            mm | Y: {Math.round(optimizedLayout.optimizedOverlapY)}mm
          </div>

          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={resetToMockData}
          >
            <RotateCcw className="h-4 w-4" />
            Reset slab geometry
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
