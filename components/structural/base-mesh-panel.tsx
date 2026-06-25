"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  CheckCircle2,
  Circle,
  FileStack,
  Grid3X3,
  Layers3,
  RotateCcw
} from "lucide-react";

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
  SelectTrigger
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useReinforcement } from "@/context/reinforcement-context";
import { mockBaseMeshSettings } from "@/data/mockStructureData";
import { parseDxfToSlabGeometry } from "@/lib/dxf-parser";
import { compareBaseMeshOrientations } from "@/lib/geometry/mesh-sheet-layout";
import { removeSlabGeometryProject } from "@/lib/project-storage";
import type {
  BaseMeshSettings,
  BaseMeshSettingsUpdate,
  StrapNumericalData
} from "@/types/structure";

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

export type InspectorContext =
  | { type: "dxf" }
  | { type: "dxf-layer"; layerName: string }
  | { type: "slab" }
  | { type: "areas" }
  | { type: "area"; areaId: string }
  | { type: "mesh"; zoneId?: string };

export type DockSection = "dxf" | "slab" | "mesh" | "analysis";

type PanelProps = {
  activeDock: DockSection;
  inspectorContext: InspectorContext;
  setActiveDock: (dock: DockSection) => void;
  setInspectorContext: (context: InspectorContext) => void;
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

function parseNumberToken(value: string) {
  const parsed = Number(value.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function cm2PerMeterToMm2PerMeter(value: number) {
  return value * 100;
}

function normalizeTableRows(rawRows: unknown[][]) {
  return rawRows.map((row) =>
    row
      .flatMap((cell) => String(cell ?? "").trim().split(/\s+/))
      .filter(Boolean)
  );
}

function parseStrapNumericalRows(rawRows: unknown[][]): StrapNumericalData[] {
  const rows = normalizeTableRows(rawRows);
  const lines = rows.map((row) => row.join(" ").trim());
  const headerIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase();

    return (
      /\bel\.?\b/.test(normalized) &&
      /\bcomb\b/.test(normalized) &&
      normalized.includes("asx") &&
      normalized.includes("asy")
    );
  });

  if (headerIndex < 0) {
    throw new Error("Could not find STRAP numerical table header: El.");
  }

  const headerCells = rows[headerIndex].map((cell) => cell.toLowerCase());
  const elementIndex = headerCells.findIndex((cell) => cell === "el.");
  const combIndex = headerCells.findIndex((cell) => cell === "comb");
  const valueStartIndex =
    elementIndex >= 0 && combIndex >= 0 ? Math.max(elementIndex, combIndex) + 1 : 2;
  const byElement = new Map<string, StrapNumericalData>();

  for (const row of rows.slice(headerIndex + 1)) {
    const elementToken = row[elementIndex];
    const elementValue = elementToken ? parseNumberToken(elementToken) : null;
    const values = row
      .slice(valueStartIndex)
      .map(parseNumberToken)
      .filter((value): value is number => value !== null);

    if (elementValue === null || values.length < 4) {
      continue;
    }

    const elementId = String(Math.trunc(elementValue));
    const [asxTop, asyTop, asxBottom, asyBottom] = values
      .slice(0, 4)
      .map(cm2PerMeterToMm2PerMeter);
    const existing = byElement.get(elementId) ?? {
      elementId,
      maxAsxTop: 0,
      maxAsyTop: 0,
      maxAsxBottom: 0,
      maxAsyBottom: 0,
      maxRequiredAs: 0
    };
    const next = {
      elementId,
      maxAsxTop: Math.max(existing.maxAsxTop, asxTop),
      maxAsyTop: Math.max(existing.maxAsyTop, asyTop),
      maxAsxBottom: Math.max(existing.maxAsxBottom, asxBottom),
      maxAsyBottom: Math.max(existing.maxAsyBottom, asyBottom),
      maxRequiredAs: 0
    };

    next.maxRequiredAs = Math.max(
      next.maxAsxTop,
      next.maxAsyTop,
      next.maxAsxBottom,
      next.maxAsyBottom
    );
    byElement.set(elementId, next);
  }

  return [...byElement.values()];
}

function parseStrapNumericalText(rawText: string) {
  const parsed = Papa.parse<string[]>(rawText, {
    skipEmptyLines: true
  });

  return parseStrapNumericalRows(parsed.data);
}

function parseStrapNumericalWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    header: 1,
    raw: true
  });

  return parseStrapNumericalRows(rows);
}

export function MeshZonesPanel({
  activeDock,
  inspectorContext,
  setInspectorContext
}: PanelProps) {
  const {
    slabGeometry,
    meshZones,
    selectedDesignAreaId,
    activeDxfUnderlayId,
    addDxfUnderlay,
    deleteDxfUnderlayById,
    deleteDxfUnderlay,
    setActiveDxfUnderlayId,
    setDxfUnderlayLayerVisible,
    setDxfUnderlayScale,
    setDxfUnderlayVisible,
    setStrapLayer,
    deleteStrapLayer,
    setStrapNumericalData,
    runThreeWayAnalysis,
    generateRawDeficitZones,
    translateDxfUnderlay,
    setSelectedDesignAreaId,
    setActiveZoneId
  } = useReinforcement();
  const [expandedDxfIds, setExpandedDxfIds] = useState<Record<string, boolean>>(
    {}
  );
  const [dxfUploadStatus, setDxfUploadStatus] = useState<string | null>(null);
  const [isStrapModalOpen, setIsStrapModalOpen] = useState(false);
  const [rawStrapDxfX, setRawStrapDxfX] = useState<string | null>(null);
  const [rawStrapDxfY, setRawStrapDxfY] = useState<string | null>(null);
  const [strapFileNameX, setStrapFileNameX] = useState<string | null>(null);
  const [strapFileNameY, setStrapFileNameY] = useState<string | null>(null);
  const [strapNumericalFileName, setStrapNumericalFileName] = useState<
    string | null
  >(null);
  const [strapUploadStatus, setStrapUploadStatus] = useState<string | null>(null);
  const underlay = slabGeometry.dwgUnderlay;
  const hasActiveSlabBoundary = slabGeometry.hasActiveSlabBoundary ?? true;
  const calculatedSlabLayer = underlay?.layers?.find(
    (layer) => layer.name === "CALCULATED-SLAB"
  );
  const designAreas = slabGeometry.designAreas ?? [];
  const dxfReferences =
    slabGeometry.dxfUnderlays ??
    (underlay?.importedFileName ? [underlay] : []);
  const hasImportedDxf = dxfReferences.length > 0;
  const hasGeneratedWorkingSlab = Boolean(
    hasImportedDxf && hasActiveSlabBoundary && calculatedSlabLayer
  );
  const nonMainMeshZones = meshZones.filter((zone) => !zone.isMainZone);
  const hasMainMeshApplied = Boolean(
    hasGeneratedWorkingSlab && slabGeometry.dwgUnderlay?.reviewOnly === false
  );
  const visibleMeshZones = hasMainMeshApplied ? meshZones : nonMainMeshZones;
  const strapLayers = [
    {
      axis: "x" as const,
      color: "text-fuchsia-300",
      layer: slabGeometry.strapLayerX,
      label: "STRAP X Axis"
    },
    {
      axis: "y" as const,
      color: "text-orange-300",
      layer: slabGeometry.strapLayerY,
      label: "STRAP Y Axis"
    }
  ];
  async function handleAdditionalDxfUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    setDxfUploadStatus(`Parsing ${file.name}...`);
    try {
      const parsed = parseDxfToSlabGeometry(await file.text(), file.name);
      const nextUnderlay = parsed.slabGeometry.dwgUnderlay;

      if (!nextUnderlay) {
        setDxfUploadStatus("No DXF underlay entities were found.");
        return;
      }

      addDxfUnderlay(nextUnderlay);
      setDxfUploadStatus(`${file.name} added to the project.`);
    } catch (error) {
      setDxfUploadStatus(
        error instanceof Error ? error.message : "Failed to parse DXF file."
      );
    }
  }

  async function handleStrapFile(axis: "x" | "y", file: File | undefined) {
    if (!file) {
      return;
    }

    const rawDxf = await file.text();

    if (axis === "x") {
      setRawStrapDxfX(rawDxf);
      setStrapFileNameX(file.name);
    } else {
      setRawStrapDxfY(rawDxf);
      setStrapFileNameY(file.name);
    }
  }

  async function handleStrapNumericalFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const isWorkbook = /\.(xlsx|xls)$/i.test(file.name);
      const parsedData = isWorkbook
        ? parseStrapNumericalWorkbook(await file.arrayBuffer())
        : parseStrapNumericalText(await file.text());

      setStrapNumericalData(parsedData);
      setStrapNumericalFileName(file.name);
      setStrapUploadStatus(
        `Loaded ${parsedData.length} STRAP numerical element rows.`
      );
    } catch (error) {
      setStrapUploadStatus(
        error instanceof Error
          ? error.message
          : "Failed to parse STRAP numerical data."
      );
    }
  }

  function loadStrapFilesToCanvas() {
    try {
      if (rawStrapDxfX && strapFileNameX) {
        const parsedX = parseDxfToSlabGeometry(rawStrapDxfX, strapFileNameX);
        const underlayX = parsedX.slabGeometry.dwgUnderlay;

        if (underlayX) {
          setStrapLayer("x", {
            ...underlayX,
            importedFileName: strapFileNameX
          });
        }
      }

      if (rawStrapDxfY && strapFileNameY) {
        const parsedY = parseDxfToSlabGeometry(rawStrapDxfY, strapFileNameY);
        const underlayY = parsedY.slabGeometry.dwgUnderlay;

        if (underlayY) {
          setStrapLayer("y", {
            ...underlayY,
            importedFileName: strapFileNameY
          });
        }
      }

      setStrapUploadStatus("STRAP analysis layers loaded to canvas.");
      setIsStrapModalOpen(false);
    } catch (error) {
      setStrapUploadStatus(
        error instanceof Error ? error.message : "Failed to parse STRAP DXF files."
      );
    }
  }

  const title =
    activeDock === "dxf"
      ? "DXF Layers"
      : activeDock === "slab"
        ? "Slab View"
        : activeDock === "analysis"
          ? "אנליזה"
          : "Mesh Layers";
  const description =
    activeDock === "dxf"
      ? "Reference drawing layers and visibility targets."
      : activeDock === "slab"
        ? "Working slab and opening/design-area layers."
        : activeDock === "analysis"
          ? "Load and align STRAP X/Y analysis DXF underlays."
          : "Base mesh layers that can stack on the slab.";

  return (
    <>
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-card/80 shadow-2xl shadow-black/25 backdrop-blur-xl">
      <div className="border-b bg-background/45 p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Layers3 className="h-3.5 w-3.5 text-primary" />
          Layer View
        </div>
        <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="workflow-scrollbar flex-1 overflow-y-auto px-4 py-5">
        {!hasImportedDxf && activeDock !== "analysis" ? (
          <div className="rounded-2xl border border-dashed p-4 text-sm leading-6 text-muted-foreground">
            No DXF project is loaded. Start from the homepage and upload a DXF
            reference.
          </div>
        ) : null}

        {activeDock === "dxf" && hasImportedDxf ? (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-primary/25 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition hover:border-primary hover:bg-primary/10">
              Add another DXF
              <Input
                accept=".dxf"
                className="hidden"
                type="file"
                onChange={(event) => {
                  void handleAdditionalDxfUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {dxfUploadStatus ? (
              <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs leading-5 text-foreground">
                {dxfUploadStatus}
              </div>
            ) : null}
            {dxfReferences.map((reference) => {
              const referenceId =
                reference.id ?? reference.importedFileName ?? "dxf-reference";
              const layers = reference.layers ?? [];
              const isExpanded = expandedDxfIds[referenceId] ?? true;
              const areAllLayersHidden =
                layers.length > 0 && layers.every((layer) => !layer.visible);

              return (
                <div
                  key={referenceId}
                  className={`rounded-2xl border p-3 ${
                    activeDxfUnderlayId === referenceId
                      ? "border-primary/50 bg-primary/10"
                      : "bg-background/60"
                  }`}
                >
                  <button
                    className="flex w-full items-center gap-3 text-left"
                    type="button"
                    onClick={() => {
                      setActiveDxfUnderlayId(referenceId);
                      setExpandedDxfIds((current) => ({
                        ...current,
                        [referenceId]: !isExpanded
                      }));
                    }}
                  >
                    <FileStack className="h-5 w-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {reference.importedFileName ?? "Imported DXF"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {layers.length} layers | drag selected DXF on canvas
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isExpanded ? "Hide" : "Open"}
                    </span>
                  </button>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      className="h-8"
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setDxfUnderlayVisible(referenceId, reference.visible === false)
                      }
                    >
                      {reference.visible === false ? "Show DXF" : "Hide DXF"}
                    </Button>
                    <Button
                      className="h-8"
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        if (dxfReferences.length <= 1) {
                          deleteDxfUnderlay();
                          void removeSlabGeometryProject();
                        } else {
                          deleteDxfUnderlayById(referenceId);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                  <div className="mt-3 rounded-xl border bg-background/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label
                        className="text-xs font-medium text-muted-foreground"
                        htmlFor={`dxf-scale-${referenceId}`}
                      >
                        DXF scale
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {(reference.scale ?? 1).toLocaleString(undefined, {
                          maximumFractionDigits: 4
                        })}
                        x
                      </span>
                    </div>
                    <Input
                      className="mt-2 h-8"
                      id={`dxf-scale-${referenceId}`}
                      min={0.0001}
                      step={0.01}
                      type="number"
                      value={reference.scale ?? 1}
                      onChange={(event) => {
                        const nextScale = Number(event.target.value);

                        if (nextScale > 0) {
                          setDxfUnderlayScale(referenceId, nextScale);
                        }
                      }}
                    />
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {[0.001, 0.01, 0.1, 1, 10, 100, 1000].map((scale) => (
                        <Button
                          key={scale}
                          className="h-7 px-2 text-[11px]"
                          type="button"
                          variant="outline"
                          onClick={() => setDxfUnderlayScale(referenceId, scale)}
                        >
                          {scale}x
                        </Button>
                      ))}
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="mt-3 space-y-2">
                      <Button
                        className="h-8 w-full"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          layers.forEach((layer) =>
                            setDxfUnderlayLayerVisible(
                              referenceId,
                              layer.name,
                              areAllLayersHidden
                            )
                          )
                        }
                      >
                        {areAllLayersHidden ? "Show All Layers" : "Hide All Layers"}
                      </Button>
                      {layers.map((layer) => (
                        <label
                          key={layer.name}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-background/50 px-3 py-2 text-left transition hover:border-primary/30 hover:bg-primary/5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {layer.name}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {layer.entityCount} entities
                            </span>
                          </span>
                          <input
                            checked={layer.visible}
                            className="h-4 w-4 shrink-0 accent-sky-500"
                            type="checkbox"
                            onChange={(event) =>
                              setDxfUnderlayLayerVisible(
                                referenceId,
                                layer.name,
                                event.target.checked
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {activeDock === "analysis" ? (
          <div className="space-y-4">
            <Button
              className="h-12 w-full text-base font-semibold"
              type="button"
              onClick={() => setIsStrapModalOpen(true)}
            >
              טען קבצי STRAP
            </Button>
            {strapUploadStatus ? (
              <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs leading-5 text-foreground">
                {strapUploadStatus}
              </div>
            ) : null}
            <div className="rounded-2xl border bg-background/60 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Underlay Layers - STRAP
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Load X and Y STRAP DXF files independently, then scale and shift
                each one until it aligns with the working slab.
              </p>
            </div>
            <div className="rounded-2xl border border-red-400/25 bg-red-400/10 p-4">
              <div className="text-sm font-semibold text-foreground">
                Raw Deficit Windows
              </div>
              <p className="mt-2 text-xs leading-5 text-red-100/80">
                Hardcoded base capacity: 393. This validation pass only draws
                simple red bounding rectangles around STRAP labels above that
                value.
              </p>
              <Button
                className="mt-3 w-full"
                disabled={!slabGeometry.strapLayerX && !slabGeometry.strapLayerY}
                type="button"
                variant="secondary"
                onClick={() => {
                  const zoneCount = generateRawDeficitZones();
                  setStrapUploadStatus(
                    `Generated ${zoneCount} raw deficit window${
                      zoneCount === 1 ? "" : "s"
                    }.`
                  );
                }}
              >
                Generate Raw Deficit Zones
              </Button>
              <div className="mt-2 text-xs text-muted-foreground">
                Current zones: {slabGeometry.rawDeficitZones?.length ?? 0}
              </div>
            </div>
            <div className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-300/10 p-4">
              <div className="text-sm font-semibold text-foreground">
                3-Way Data Cross-Reference
              </div>
              <p className="mt-2 text-xs leading-5 text-fuchsia-100/80">
                Match STRAP CSV element maxima to physical DXF element polygons
                and tint only overloaded elements.
              </p>
              <Button
                className="mt-3 w-full"
                disabled={
                  (!slabGeometry.strapLayerX && !slabGeometry.strapLayerY) ||
                  !slabGeometry.strapNumericalData?.length
                }
                type="button"
                variant="secondary"
                onClick={() => {
                  const overloadedCount = runThreeWayAnalysis();
                  setStrapUploadStatus(
                    `Matched ${overloadedCount} overloaded STRAP element${
                      overloadedCount === 1 ? "" : "s"
                    }.`
                  );
                }}
              >
                בצע הצלבה הנדסית משולבת
              </Button>
              <div className="mt-2 text-xs text-muted-foreground">
                Data rows: {slabGeometry.strapNumericalData?.length ?? 0} |
                Overloaded elements:{" "}
                {slabGeometry.strapOverloadedElements?.length ?? 0}
                {" "}|
                Extra mesh zones: {slabGeometry.strapExtraMeshZones?.length ?? 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Strips:{" "}
                {slabGeometry.strapExtraMeshZones?.filter(
                  (zone) => zone.kind === "strip"
                ).length ?? 0}
                {" "}|
                Patches:{" "}
                {slabGeometry.strapExtraMeshZones?.filter(
                  (zone) => zone.kind === "patch"
                ).length ?? 0}
              </div>
              {slabGeometry.strapAnalysisDebug ? (
                <div className="mt-2 rounded-xl border border-fuchsia-300/20 bg-background/40 p-2 text-xs leading-5 text-muted-foreground">
                  DXF element labels:{" "}
                  {slabGeometry.strapAnalysisDebug.elementLabels}
                  <br />
                  Matched labels:{" "}
                  {slabGeometry.strapAnalysisDebug.matchedElementLabels}
                  <br />
                  Matched unique IDs:{" "}
                  {slabGeometry.strapAnalysisDebug.matchedUniqueIds ?? 0}
                  <br />
                  Matching mode:{" "}
                  {slabGeometry.strapAnalysisDebug.matchingMode ?? "-"}
                  <br />
                  Element grid cells:{" "}
                  {slabGeometry.strapAnalysisDebug.elementCellCandidates ?? 0}
                  <br />
                  Max CSV As:{" "}
                  {Math.round(
                    slabGeometry.strapAnalysisDebug.maxCsvRequiredAs ?? 0
                  )}
                  <br />
                  CSV rows over 393:{" "}
                  {slabGeometry.strapAnalysisDebug.overloadedCsvRows ?? 0}
                  <br />
                  Contour points over 393:{" "}
                  {slabGeometry.strapAnalysisDebug.contourDeficitPoints ?? 0}
                  <br />
                  Extra mesh zones:{" "}
                  {slabGeometry.strapAnalysisDebug.extraMeshZones ?? 0}
                  <br />
                  Inferred ID offset:{" "}
                  {slabGeometry.strapAnalysisDebug.inferredIdOffset ?? "-"}
                  <br />
                  Closed polygon candidates:{" "}
                  {slabGeometry.strapAnalysisDebug.polygonCandidates}
                  <br />
                  CSV IDs:{" "}
                  {slabGeometry.strapAnalysisDebug.sampleCsvElementIds?.join(
                    ", "
                  ) ?? "-"}
                  <br />
                  DXF IDs:{" "}
                  {slabGeometry.strapAnalysisDebug.sampleDxfElementIds?.join(
                    ", "
                  ) ?? "-"}
                  <br />
                  Common IDs:{" "}
                  {slabGeometry.strapAnalysisDebug.sampleMatchedElementIds?.join(
                    ", "
                  ) ?? "-"}
                </div>
              ) : null}
            </div>
            {strapLayers.map(({ axis, color, label, layer }) => {
              const layerId = layer?.id ?? `strap-${axis}`;
              const layers = layer?.layers ?? [];
              const areAllLayersHidden =
                layers.length > 0 && layers.every((item) => !item.visible);

              return (
                <div
                  key={axis}
                  className={`rounded-2xl border p-3 ${
                    activeDxfUnderlayId === layerId
                      ? "border-primary/50 bg-primary/10"
                      : "bg-background/60"
                  }`}
                >
                  <button
                    className="flex w-full items-start gap-3 text-left"
                    disabled={!layer}
                    type="button"
                    onClick={() => setActiveDxfUnderlayId(layerId)}
                  >
                    <FileStack className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {label}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {layer
                          ? `${layer.importedFileName ?? "STRAP DXF"} | ${layers.length} layers | drag selected layer`
                          : "No STRAP DXF loaded yet"}
                      </span>
                    </span>
                  </button>

                  {layer ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="h-8"
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            setDxfUnderlayVisible(layerId, layer.visible === false)
                          }
                        >
                          {layer.visible === false ? "Show" : "Hide"}
                        </Button>
                        <Button
                          className="h-8"
                          type="button"
                          variant="destructive"
                          onClick={() => deleteStrapLayer(axis)}
                        >
                          Delete
                        </Button>
                      </div>

                      <div className="rounded-xl border bg-background/50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Label
                            className="text-xs font-medium text-muted-foreground"
                            htmlFor={`strap-scale-${axis}`}
                          >
                            Ratio / Scale
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            {(layer.scale ?? 1).toLocaleString(undefined, {
                              maximumFractionDigits: 4
                            })}
                            x
                          </span>
                        </div>
                        <Input
                          className="mt-2 h-8"
                          id={`strap-scale-${axis}`}
                          min={0.0001}
                          step={0.01}
                          type="number"
                          value={layer.scale ?? 1}
                          onChange={(event) => {
                            const nextScale = Number(event.target.value);

                            if (nextScale > 0) {
                              setDxfUnderlayScale(layerId, nextScale);
                            }
                          }}
                        />
                        <div className="mt-2 grid grid-cols-4 gap-1">
                          {[0.001, 0.01, 0.1, 1, 10, 100, 1000].map((scale) => (
                            <Button
                              key={scale}
                              className="h-7 px-2 text-[11px]"
                              type="button"
                              variant="outline"
                              onClick={() => setDxfUnderlayScale(layerId, scale)}
                            >
                              {scale}x
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-background/50 p-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          Position Shift
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-1">
                          <Button
                            className="h-8 px-2 text-xs"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              translateDxfUnderlay(layerId, { x: -100, y: 0 })
                            }
                          >
                            X -100
                          </Button>
                          <Button
                            className="h-8 px-2 text-xs"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              translateDxfUnderlay(layerId, { x: 100, y: 0 })
                            }
                          >
                            X +100
                          </Button>
                          <Button
                            className="h-8 px-2 text-xs"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              translateDxfUnderlay(layerId, { x: 0, y: -100 })
                            }
                          >
                            Y -100
                          </Button>
                          <Button
                            className="h-8 px-2 text-xs"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              translateDxfUnderlay(layerId, { x: 0, y: 100 })
                            }
                          >
                            Y +100
                          </Button>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Offset X {Math.round(layer.offset?.x ?? 0)} | Y{" "}
                          {Math.round(layer.offset?.y ?? 0)}
                        </div>
                      </div>

                      {layers.length > 0 ? (
                        <div className="space-y-2">
                          <Button
                            className="h-8 w-full"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              layers.forEach((item) =>
                                setDxfUnderlayLayerVisible(
                                  layerId,
                                  item.name,
                                  areAllLayersHidden
                                )
                              )
                            }
                          >
                            {areAllLayersHidden ? "Show All Layers" : "Hide All Layers"}
                          </Button>
                          {layers.map((item) => (
                            <label
                              key={item.name}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-background/50 px-3 py-2 text-left transition hover:border-primary/30 hover:bg-primary/5"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-medium text-foreground">
                                  {item.name}
                                </span>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {item.entityCount} entities
                                </span>
                              </span>
                              <input
                                checked={item.visible}
                                className="h-4 w-4 shrink-0 accent-sky-500"
                                type="checkbox"
                                onChange={(event) =>
                                  setDxfUnderlayLayerVisible(
                                    layerId,
                                    item.name,
                                    event.target.checked
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {activeDock === "slab" && hasImportedDxf ? (
          <div className="space-y-3">
            <button
              className={`w-full rounded-2xl border p-4 text-left transition hover:border-primary/30 ${
                inspectorContext.type === "slab"
                  ? "border-primary/50 bg-primary/10"
                  : "bg-background/60"
              }`}
              type="button"
              onClick={() => setInspectorContext({ type: "slab" })}
            >
              <div className="flex items-start gap-3">
                {hasGeneratedWorkingSlab ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Working Slab
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {hasGeneratedWorkingSlab
                      ? `${slabGeometry.boundary.length} boundary vertices`
                      : "Not defined yet"}
                  </div>
                </div>
              </div>
            </button>

            {hasGeneratedWorkingSlab ? (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  No Mesh Areas
                </div>
                {designAreas.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                    No no-mesh areas yet. Select SLAB and use the right
                    controller to draw one.
                  </div>
                ) : null}
                {designAreas.map((area) => (
                  <button
                    key={area.id}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition hover:border-amber-300/40 hover:bg-amber-300/10 ${
                      selectedDesignAreaId === area.id ||
                      (inspectorContext.type === "area" &&
                        inspectorContext.areaId === area.id)
                        ? "border-amber-300/50 bg-amber-300/15"
                        : "bg-background/50"
                    }`}
                    type="button"
                    onClick={() => {
                      setSelectedDesignAreaId(area.id);
                      setInspectorContext({ type: "area", areaId: area.id });
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {area.label}
                      </span>
                      <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs text-amber-100">
                        no mesh
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {area.polygon.length} vertices
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeDock === "mesh" && hasImportedDxf ? (
          <div className="space-y-3">
            {!hasGeneratedWorkingSlab ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm leading-6 text-muted-foreground">
                Define the working slab before creating mesh layers.
              </div>
            ) : null}
            {hasGeneratedWorkingSlab
              ? visibleMeshZones.map((zone) => (
                  <button
                    key={zone.id}
                    className={`w-full rounded-2xl border p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/10 ${
                      inspectorContext.type === "mesh" &&
                      (inspectorContext.zoneId ?? "ZONE-MAIN") === zone.id
                        ? "border-cyan-300/50 bg-cyan-300/15"
                        : "bg-background/60"
                    }`}
                    type="button"
                    onClick={() => {
                      setActiveZoneId(zone.id);
                      setInspectorContext({ type: "mesh", zoneId: zone.id });
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {zone.name}
                      </span>
                      <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-xs text-cyan-100">
                        {zone.isMainZone ? "slab" : "area"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {zone.geometry.length} boundary vertices
                    </div>
                  </button>
                ))
              : null}
            {hasGeneratedWorkingSlab && !hasMainMeshApplied ? (
              <div className="rounded-xl border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                No main mesh yet. Use the right controller to add and configure
                the main mesh first.
              </div>
            ) : null}
            {hasGeneratedWorkingSlab && hasMainMeshApplied && nonMainMeshZones.length === 0 ? (
              <div className="rounded-xl border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                Main mesh is active. Additional mesh layers can be added later.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

    </aside>
    {isStrapModalOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
        <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-2xl shadow-black/50">
          <div className="border-b bg-background/60 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              STRAP Analysis DXF
            </div>
            <div className="mt-2 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-foreground">
                  טען קבצי STRAP
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Load X and Y analysis files as two independent canvas underlays.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsStrapModalOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-3">
            <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-fuchsia-300/40 bg-fuchsia-300/10 p-5 text-center transition hover:border-fuchsia-300 hover:bg-fuchsia-300/15">
              <FileStack className="h-8 w-8 text-fuchsia-300" />
              <span className="mt-3 text-sm font-semibold text-foreground">
                קובץ אנליזה ציר X (.dxf)
              </span>
              <span className="mt-2 max-w-full truncate text-xs text-muted-foreground">
                {strapFileNameX ?? "Choose DXF file"}
              </span>
              <Input
                accept=".dxf"
                className="hidden"
                type="file"
                onChange={(event) => {
                  void handleStrapFile("x", event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>

            <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-orange-300/40 bg-orange-300/10 p-5 text-center transition hover:border-orange-300 hover:bg-orange-300/15">
              <FileStack className="h-8 w-8 text-orange-300" />
              <span className="mt-3 text-sm font-semibold text-foreground">
                קובץ אנליזה ציר Y (.dxf)
              </span>
              <span className="mt-2 max-w-full truncate text-xs text-muted-foreground">
                {strapFileNameY ?? "Choose DXF file"}
              </span>
              <Input
                accept=".dxf"
                className="hidden"
                type="file"
                onChange={(event) => {
                  void handleStrapFile("y", event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>

            <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-300/40 bg-cyan-300/10 p-5 text-center transition hover:border-cyan-300 hover:bg-cyan-300/15">
              <FileStack className="h-8 w-8 text-cyan-300" />
              <span className="mt-3 text-sm font-semibold text-foreground">
                טען קובץ נתוני מאמצים גולמי (Excel/CSV)
              </span>
              <span className="mt-2 max-w-full truncate text-xs text-muted-foreground">
                {strapNumericalFileName ?? "Choose CSV/text export"}
              </span>
              <Input
                accept=".csv,.txt,.xls,.xlsx"
                className="hidden"
                type="file"
                onChange={(event) => {
                  void handleStrapNumericalFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="flex items-center justify-between border-t bg-background/50 p-5">
            <p className="text-xs leading-5 text-muted-foreground">
              You can load one file now and add the second later.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsStrapModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!rawStrapDxfX && !rawStrapDxfY && !strapNumericalFileName}
                type="button"
                onClick={loadStrapFilesToCanvas}
              >
                טען לקנבס
              </Button>
            </div>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

export function MeshInspectorPanel({
  inspectorContext,
  setActiveDock,
  setInspectorContext
}: PanelProps) {
  const {
    slabGeometry,
    activeZoneId,
    activeMeshZone,
    selectedDesignAreaId,
    isDrawingBoundary,
    isEditingBoundary,
    isDrawingDesignArea,
    designAreaDrawingMode,
    boundaryDraftPoints,
    designAreaDraftPoints,
    editingDesignAreaId,
    activateBaseMeshOnWorkingSlab,
    beginBoundaryEdit,
    beginBoundaryTrace,
    beginDesignAreaDraw,
    beginDesignAreaEdit,
    cancelBoundaryTrace,
    cancelDesignAreaDraw,
    deleteCalculatedSlab,
    deleteDesignArea,
    deleteDxfUnderlay,
    finishBoundaryEdit,
    finishBoundaryTrace,
    finishDesignAreaDraft,
    finishDesignAreaEdit,
    generateSlabFromVisibleLayers,
    setCalculatedSlabVisible,
    setDesignAreaVisible,
    setSelectedDesignAreaId,
    setUnderlayLayerVisible,
    updateActiveMeshZoneParameters
  } = useReinforcement();
  const underlay = slabGeometry.dwgUnderlay;
  const calculatedSlabLayer = underlay?.layers?.find(
    (layer) => layer.name === "CALCULATED-SLAB"
  );
  const designAreas = slabGeometry.designAreas ?? [];
  const selectedArea =
    inspectorContext.type === "area"
      ? designAreas.find((area) => area.id === inspectorContext.areaId)
      : designAreas.find((area) => area.id === selectedDesignAreaId);
  const selectedDxfLayer =
    inspectorContext.type === "dxf-layer"
      ? underlay?.layers?.find((layer) => layer.name === inspectorContext.layerName)
      : null;
  const hasImportedDxf = Boolean(underlay?.importedFileName);
  const hasActiveSlabBoundary = slabGeometry.hasActiveSlabBoundary ?? true;
  const hasMainMeshApplied = Boolean(
    slabGeometry.hasActiveSlabBoundary && underlay?.reviewOnly === false
  );
  const hasPendingSlabBoundary = Boolean(
    hasImportedDxf && calculatedSlabLayer && !hasActiveSlabBoundary
  );
  const canGenerateFromDraft =
    isDrawingBoundary && boundaryDraftPoints.length >= 3;
  const canGenerateWorkingSlab =
    hasImportedDxf && (hasPendingSlabBoundary || canGenerateFromDraft);
  const activeSettings = activeMeshZone.parameters;
  const [numericDraft, setNumericDraft] = useState<NumericDraftState>(() =>
    ({
      zoneId: activeZoneId,
      values: createDraftValues(activeSettings)
    })
  );
  const [isMainMeshModalOpen, setIsMainMeshModalOpen] = useState(false);
  const [mainMeshStep, setMainMeshStep] = useState(0);
  const [mainMeshDraft, setMainMeshDraft] =
    useState<BaseMeshSettings>(activeSettings);
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
  const canShowMeshParameters =
    hasMainMeshApplied || !activeMeshZone.isMainZone;
  const mainMeshDraftComparison = useMemo(
    () =>
      compareBaseMeshOrientations(
        slabGeometry,
        mainMeshDraft,
        activeMeshZone.geometry
      ),
    [activeMeshZone.geometry, mainMeshDraft, slabGeometry]
  );

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
      zoneId: activeZoneId,
      values: createDraftValues(mockBaseMeshSettings)
    });
    updateActiveMeshZoneParameters(mockBaseMeshSettings);
  }

  function openMainMeshModal() {
    setMainMeshDraft(activeSettings);
    setMainMeshStep(0);
    setIsMainMeshModalOpen(true);
  }

  function updateMainMeshDraft(patch: BaseMeshSettingsUpdate) {
    setMainMeshDraft((current) => ({ ...current, ...patch }));
  }

  function finishMainMeshModal() {
    updateActiveMeshZoneParameters(mainMeshDraft);
    const didActivate = activateBaseMeshOnWorkingSlab(mainMeshDraft);

    if (didActivate) {
      setIsMainMeshModalOpen(false);
      setMainMeshStep(0);
    }
  }

  const inspectorTitle =
    inspectorContext.type === "dxf"
      ? "DXF Reference"
      : inspectorContext.type === "dxf-layer"
        ? "DXF Layer"
        : inspectorContext.type === "slab"
          ? "Working Slab"
          : inspectorContext.type === "areas" || inspectorContext.type === "area"
            ? "Slab Areas"
            : "Mesh Layer";

  const inspectorDescription =
    inspectorContext.type === "dxf"
      ? "Layer visibility and reference controls"
      : inspectorContext.type === "dxf-layer"
        ? "Selected DXF layer controls"
        : inspectorContext.type === "slab"
          ? "Define, edit, and manage the working slab"
          : inspectorContext.type === "areas" || inspectorContext.type === "area"
            ? "No-mesh area controls"
            : "Base mesh parameters and mesh creation tools";

  return (
    <>
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      <Card className="flex h-full flex-col rounded-none border-0 bg-transparent shadow-none">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5 text-primary" />
            {inspectorTitle}
          </CardTitle>
          <CardDescription>{inspectorDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-2xl font-semibold">
                {slabGeometry.boundary.length}
              </div>
              <div className="text-muted-foreground">Boundary vertices</div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-2xl font-semibold">
                {(slabGeometry.designAreas ?? []).length}
              </div>
              <div className="text-muted-foreground">Design areas</div>
            </div>
          </div>

          {inspectorContext.type === "dxf" ? (
            <div className="space-y-4">
              {hasImportedDxf && underlay ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                    <div className="truncate font-medium text-foreground">
                      {underlay.importedFileName ?? "Imported DXF"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {underlay.layers?.length ?? 0} layers | Background reference only
                    </div>
                  </div>
                  <div className="workflow-scrollbar max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                    {(underlay.layers ?? []).map((layer) => (
                      <label
                        key={layer.name}
                        className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">
                            {layer.name}
                          </span>
                          <span className="text-muted-foreground">
                            {layer.entityCount} entities
                          </span>
                        </span>
                        <input
                          checked={layer.visible}
                          className="h-4 w-4 accent-sky-500"
                          type="checkbox"
                          onChange={(event) =>
                            setUnderlayLayerVisible(
                              layer.name,
                              event.target.checked
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      deleteDxfUnderlay();
                      setInspectorContext({ type: "dxf" });
                    }}
                  >
                    Delete DXF Reference
                  </Button>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  No DXF reference loaded. Start a project from the homepage by
                  uploading a DXF file.
                </div>
              )}
            </div>
          ) : null}

          {inspectorContext.type === "dxf-layer" ? (
            <div className="space-y-4">
              {selectedDxfLayer ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                    <div className="truncate font-medium text-foreground">
                      {selectedDxfLayer.name}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedDxfLayer.entityCount} entities
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    type="button"
                    variant={selectedDxfLayer.visible ? "secondary" : "outline"}
                    onClick={() =>
                      setUnderlayLayerVisible(
                        selectedDxfLayer.name,
                        !selectedDxfLayer.visible
                      )
                    }
                  >
                    {selectedDxfLayer.visible ? "Hide Layer" : "Show Layer"}
                  </Button>
                  <Button
                    className="w-full"
                    type="button"
                    variant="outline"
                    onClick={() => setInspectorContext({ type: "dxf" })}
                  >
                    Back to DXF File
                  </Button>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Select a DXF layer from the left panel.
                </div>
              )}
            </div>
          ) : null}

          {inspectorContext.type === "slab" ? (
            <div className="space-y-4">
              {calculatedSlabLayer ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                    <div className="font-medium text-foreground">
                      {slabGeometry.hasActiveSlabBoundary
                        ? "Working Slab Boundary"
                        : "Pending Slab Boundary"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {slabGeometry.boundary.length} boundary vertices
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={calculatedSlabLayer.visible ? "secondary" : "outline"}
                      onClick={() =>
                        setCalculatedSlabVisible(!calculatedSlabLayer.visible)
                      }
                    >
                      {calculatedSlabLayer.visible ? "Hide" : "Show"}
                    </Button>
                    <Button
                      type="button"
                      variant={isEditingBoundary ? "secondary" : "outline"}
                      onClick={() => {
                        if (isEditingBoundary) {
                          finishBoundaryEdit();
                        } else {
                          beginBoundaryEdit();
                        }
                      }}
                    >
                      {isEditingBoundary ? "Done Edit" : "Edit Points"}
                    </Button>
                  </div>
                  <Button
                    className="w-full"
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      deleteCalculatedSlab();
                      setInspectorContext({ type: "dxf" });
                    }}
                  >
                    Delete Working Slab
                  </Button>
                  {!hasActiveSlabBoundary ? (
                    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/10 p-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          Boundary trace is ready
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-200">
                          Save this trace as the working slab before adding
                          openings or mesh.
                        </p>
                      </div>
                      <Button
                        className="w-full"
                        disabled={!canGenerateWorkingSlab}
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const didGenerate = generateSlabFromVisibleLayers();
                          if (didGenerate) {
                            setActiveDock("slab");
                          }
                        }}
                      >
                        Generate Working Slab
                      </Button>
                    </div>
                  ) : null}
                  {hasActiveSlabBoundary ? (
                    <div className="rounded-2xl border bg-background/60 p-3">
                      <div className="text-sm font-semibold text-foreground">
                        Add No Mesh Area
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Define locations inside the slab where mesh should not
                        be applied.
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={
                            isDrawingDesignArea &&
                            designAreaDrawingMode === "polygon"
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => beginDesignAreaDraw("polygon")}
                        >
                          Vertex Area
                        </Button>
                        <Button
                          type="button"
                          variant={
                            isDrawingDesignArea &&
                            designAreaDrawingMode === "rectangle"
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => beginDesignAreaDraw("rectangle")}
                        >
                          Rect Area
                        </Button>
                      </div>
                      {isDrawingDesignArea ? (
                        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-2 text-xs leading-5 text-amber-100">
                          {designAreaDrawingMode === "polygon"
                            ? `Opening points: ${designAreaDraftPoints.length}`
                            : "Drag a rectangle opening on the slab."}
                          <div className="mt-2 flex gap-2">
                            {designAreaDrawingMode === "polygon" ? (
                              <Button
                                className="h-8 flex-1"
                                type="button"
                                variant="secondary"
                                onClick={finishDesignAreaDraft}
                              >
                                Finish
                              </Button>
                            ) : null}
                            <Button
                              className="h-8 flex-1"
                              type="button"
                              variant="outline"
                              onClick={cancelDesignAreaDraw}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="space-y-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  <div>
                    No working slab yet. Trace the slab boundary over the DXF,
                    then generate it as the source of truth.
                  </div>
                  <Button
                    className="w-full"
                    type="button"
                    variant={isDrawingBoundary ? "secondary" : "default"}
                    onClick={beginBoundaryTrace}
                  >
                    הגדר גבול תקרה
                  </Button>
                  {isDrawingBoundary ? (
                    <div className="rounded-xl border border-primary/30 bg-primary/10 p-2 text-xs leading-5 text-primary">
                      Boundary points: {boundaryDraftPoints.length}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                          className="h-8"
                          type="button"
                          variant="secondary"
                          onClick={finishBoundaryTrace}
                        >
                          Finish Trace
                        </Button>
                        <Button
                          className="h-8"
                          type="button"
                          variant="outline"
                          onClick={cancelBoundaryTrace}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={!canGenerateWorkingSlab}
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const didGenerate = generateSlabFromVisibleLayers();
                      if (didGenerate) {
                        setActiveDock("slab");
                      }
                    }}
                  >
                    Generate Working Slab
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {inspectorContext.type === "areas" ? (
            <div className="space-y-3">
              {designAreas.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  No no-mesh areas yet. Use the SLAB controller to draw a vertex
                  or rectangle area.
                </div>
              ) : null}
              {designAreas.map((area) => (
                <button
                  key={area.id}
                  className="w-full rounded-2xl border bg-background/60 px-3 py-3 text-left transition hover:border-amber-300/40 hover:bg-amber-300/10"
                  type="button"
                  onClick={() => {
                    setSelectedDesignAreaId(area.id);
                    setInspectorContext({ type: "area", areaId: area.id });
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {area.label}
                    </span>
                    <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs text-amber-100">
                      no mesh
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {area.polygon.length} vertices
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {inspectorContext.type === "area" ? (
            <div className="space-y-4">
              {selectedArea ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                    <div className="font-medium text-foreground">
                      {selectedArea.label}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedArea.polygon.length} vertices
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={selectedArea.visible ? "secondary" : "outline"}
                      onClick={() =>
                        setDesignAreaVisible(selectedArea.id, !selectedArea.visible)
                      }
                    >
                      {selectedArea.visible ? "Hide" : "Show"}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        editingDesignAreaId === selectedArea.id
                          ? "secondary"
                          : "outline"
                      }
                      onClick={() => {
                        if (editingDesignAreaId === selectedArea.id) {
                          finishDesignAreaEdit();
                        } else {
                          beginDesignAreaEdit(selectedArea.id);
                        }
                      }}
                    >
                      {editingDesignAreaId === selectedArea.id ? "Done" : "Edit"}
                    </Button>
                  </div>
                  <Button
                    className="w-full"
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      deleteDesignArea(selectedArea.id);
                      setInspectorContext({ type: "areas" });
                    }}
                  >
                    Delete Area
                  </Button>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Select a design area from the workflow feed.
                </div>
              )}
            </div>
          ) : null}

          {inspectorContext.type === "mesh" ? (
            <>
          <div className="space-y-3 rounded-2xl border bg-background/60 p-3">
            <div className="text-sm font-semibold text-foreground">
              Main Mesh
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Add the main mesh first. Configure diameter, spacing, sheet size,
              overlap and anchorage, then click Done to place it on the slab.
            </p>
            <div className="grid grid-cols-1 gap-2">
              {!hasActiveSlabBoundary ? (
                <div className="rounded-xl border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                  Define the working slab before adding main mesh.
                </div>
              ) : null}
              {hasActiveSlabBoundary && !hasMainMeshApplied ? (
                <Button
                  className="w-full"
                  type="button"
                  variant="secondary"
                  onClick={openMainMeshModal}
                >
                  Add Main Mesh
                </Button>
              ) : null}
            </div>
          </div>

          {canShowMeshParameters ? (
            <>
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
                <span>{activeSettings.diameter} mm</span>
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
                <span>{activeSettings.spacing} mm</span>
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
            <Label htmlFor="wall-anchorage-depth">Wall Anchorage Depth</Label>
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
                <span>{activeSettings.originCorner}</span>
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
                <span>Horizontal</span>
                {layoutComparison.recommendedOrientation === "horizontal" ? (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    Eco
                  </span>
                ) : null}
              </ToggleGroupItem>
              <ToggleGroupItem value="vertical">
                <span>Vertical</span>
                {layoutComparison.recommendedOrientation === "vertical" ? (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    Eco
                  </span>
                ) : null}
              </ToggleGroupItem>
            </ToggleGroup>
            {isManualLessEconomical ? (
              <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs leading-5 text-amber-200">
                This orientation creates {overrideWastePercent.toFixed(1)}% more
                steel waste than the recommended option.
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
            Reset mesh settings
          </Button>
            </>
          ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </aside>
    {isMainMeshModalOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
        <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-2xl shadow-black/50">
          <div className="border-b bg-background/60 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Add Main Mesh
            </div>
            <div className="mt-2 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-foreground">
                  Main slab mesh setup
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Step {mainMeshStep + 1} of 4
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsMainMeshModalOpen(false)}
              >
                Close
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["Steel", "Sheet", "Placement", "Summary"].map((label, index) => (
                <div
                  key={label}
                  className={`rounded-full px-3 py-1 text-center text-xs font-medium ${
                    mainMeshStep === index
                      ? "bg-primary text-primary-foreground"
                      : index < mainMeshStep
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-[360px] space-y-5 p-5">
            {mainMeshStep === 0 ? (
              <div className="space-y-5">
                <div>
                  <h4 className="text-lg font-semibold">Steel definition</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select the main bar diameter and spacing.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Diameter</Label>
                    <Select
                      value={String(mainMeshDraft.diameter)}
                      onValueChange={(value) =>
                        updateMainMeshDraft({
                          diameter: Number(
                            value
                          ) as BaseMeshSettings["diameter"]
                        })
                      }
                    >
                      <SelectTrigger>
                        <span>{mainMeshDraft.diameter} mm</span>
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
                      value={String(mainMeshDraft.spacing)}
                      onValueChange={(value) =>
                        updateMainMeshDraft({
                          spacing: Number(value) as BaseMeshSettings["spacing"]
                        })
                      }
                    >
                      <SelectTrigger>
                        <span>{mainMeshDraft.spacing} mm</span>
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
                </div>
              </div>
            ) : null}

            {mainMeshStep === 1 ? (
              <div className="space-y-5">
                <div>
                  <h4 className="text-lg font-semibold">Sheet geometry</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Define sheet dimensions and lap overlap.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ["sheetWidth", "Sheet Width", 500, 100],
                    ["sheetLength", "Sheet Length", 1000, 100],
                    ["overlapX", "Overlap X", 0, 50],
                    ["overlapY", "Overlap Y", 0, 50]
                  ].map(([field, label, min, step]) => (
                    <div key={field} className="space-y-2">
                      <Label htmlFor={`main-${field}`}>{label}</Label>
                      <Input
                        id={`main-${field}`}
                        min={min as number}
                        step={step as number}
                        type="number"
                        value={String(
                          mainMeshDraft[field as keyof BaseMeshSettings]
                        )}
                        onChange={(event) =>
                          updateMainMeshDraft({
                            [field]: draftNumber(
                              event.target.value,
                              mainMeshDraft[field as keyof BaseMeshSettings] as number
                            )
                          } as BaseMeshSettingsUpdate)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mainMeshStep === 2 ? (
              <div className="space-y-5">
                <div>
                  <h4 className="text-lg font-semibold">Placement rules</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Set anchorage, origin, and preferred orientation.
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="main-wall-anchorage">
                      Wall Anchorage Depth
                    </Label>
                    <Input
                      id="main-wall-anchorage"
                      min={0}
                      step={25}
                      type="number"
                      value={mainMeshDraft.wallAnchorageDepth}
                      onChange={(event) =>
                        updateMainMeshDraft({
                          wallAnchorageDepth: draftNumber(
                            event.target.value,
                            mainMeshDraft.wallAnchorageDepth
                          )
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Origin Corner</Label>
                      <Select
                        value={mainMeshDraft.originCorner}
                        onValueChange={(value: BaseMeshSettings["originCorner"]) =>
                          updateMainMeshDraft({ originCorner: value })
                        }
                      >
                        <SelectTrigger>
                          <span>{mainMeshDraft.originCorner}</span>
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
                        value={mainMeshDraft.orientation}
                        onValueChange={(value) => {
                          if (value === "horizontal" || value === "vertical") {
                            updateMainMeshDraft({ orientation: value });
                          }
                        }}
                      >
                        <ToggleGroupItem value="horizontal">
                          Horizontal
                        </ToggleGroupItem>
                        <ToggleGroupItem value="vertical">
                          Vertical
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {mainMeshStep === 3 ? (
              <div className="space-y-5">
                <div>
                  <h4 className="text-lg font-semibold">Summary</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Review the main mesh before placing it on the canvas.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Ø{mainMeshDraft.diameter}@{mainMeshDraft.spacing}
                  </div>
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Sheet {mainMeshDraft.sheetWidth} x{" "}
                    {mainMeshDraft.sheetLength} mm
                  </div>
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Overlap {mainMeshDraft.overlapX} / {mainMeshDraft.overlapY} mm
                  </div>
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Anchorage {mainMeshDraft.wallAnchorageDepth} mm
                  </div>
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Origin {mainMeshDraft.originCorner}
                  </div>
                  <div className="rounded-2xl border bg-background/60 p-3">
                    Orientation {mainMeshDraft.orientation}
                  </div>
                </div>
                <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-sm leading-6 text-foreground">
                  Estimated sheets: {mainMeshDraftComparison.active.sheetCount} |
                  Waste:{" "}
                  {squareMeters(mainMeshDraftComparison.active.cutWasteArea)}m²
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t bg-background/50 p-5">
            <Button
              disabled={mainMeshStep === 0}
              type="button"
              variant="outline"
              onClick={() => setMainMeshStep((step) => Math.max(0, step - 1))}
            >
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsMainMeshModalOpen(false)}
              >
                Cancel
              </Button>
              {mainMeshStep < 3 ? (
                <Button
                  type="button"
                  onClick={() => setMainMeshStep((step) => Math.min(3, step + 1))}
                >
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={finishMainMeshModal}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
