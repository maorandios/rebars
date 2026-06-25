"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useReinforcement } from "@/context/reinforcement-context";
import { polygonBounds } from "@/lib/geometry/clipping";
import {
  compareBaseMeshOrientations,
  generateBaseMeshLayout
} from "@/lib/geometry/mesh-sheet-layout";
import type {
  BaseMeshSettings,
  CadArcEntity,
  CadCircleEntity,
  CadLineEntity,
  CadTextEntity,
  DwgUnderlay,
  MeshSheet,
  MeshZone,
  Point,
  Polygon,
  RawDeficitZone,
  SlabDesignArea,
  SlabGeometry,
  SlabOpening,
  StructuralElement
} from "@/types/structure";

const canvasPadding = 120;
const initialScale = 0.08;
const minimumScale = 0.005;
const maximumScale = 2;
const detailOffsetX = 7_000;
const meshDetailSize = {
  height: 7_500,
  width: 8_500
};
const cadTextHeight = {
  detail: 260,
  label: 220,
  small: 180,
  title: 340
};
const cadMarkerSize = 220;
const cadArrowSize = 180;
const minimumDrawnZoneSize = 500;
const minimumDesignAreaSize = 100;
const cadCanvasBackground = "#121214";
const meshBlue = "#0ea5e9";
const meshActiveBlue = "#38bdf8";
const canvasText = "#f4f4f5";
const canvasMutedText = "#d4d4d8";
const calculatedSlabLayer = "CALCULATED-SLAB";

type ZoneDraft = {
  current: Point;
  isDragging: boolean;
  start: Point;
};

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dxfUnderlayScale(underlay: DwgUnderlay) {
  return underlay.scale && underlay.scale > 0 ? underlay.scale : 1;
}

function dxfUnderlayTransformOrigin(underlay: DwgUnderlay): Point {
  return underlay.bounds
    ? {
        x: (underlay.bounds.minX + underlay.bounds.maxX) / 2,
        y: (underlay.bounds.minY + underlay.bounds.maxY) / 2
      }
    : { x: 0, y: 0 };
}

function transformDxfPoint(underlay: DwgUnderlay, point: Point): Point {
  const offset = underlay.offset ?? { x: 0, y: 0 };
  const origin = dxfUnderlayTransformOrigin(underlay);
  const underlayScale = dxfUnderlayScale(underlay);

  return {
    x: offset.x + origin.x + (point.x - origin.x) * underlayScale,
    y: offset.y + origin.y + (point.y - origin.y) * underlayScale
  };
}

function transformedDxfBounds(underlay: DwgUnderlay) {
  if (!underlay.bounds) {
    return null;
  }

  const corners = [
    { x: underlay.bounds.minX, y: underlay.bounds.minY },
    { x: underlay.bounds.maxX, y: underlay.bounds.minY },
    { x: underlay.bounds.maxX, y: underlay.bounds.maxY },
    { x: underlay.bounds.minX, y: underlay.bounds.maxY }
  ].map((point) => transformDxfPoint(underlay, point));

  return {
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y))
  };
}

function screenPx(value: number, scale: number) {
  return value / scale;
}

function drawPolygonPath(context: CanvasRenderingContext2D, polygon: Polygon) {
  if (polygon.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(polygon[0].x, polygon[0].y);

  for (const point of polygon.slice(1)) {
    context.lineTo(point.x, point.y);
  }

  context.closePath();
}

function appendPolygonPath(context: CanvasRenderingContext2D, polygon: Polygon) {
  if (polygon.length === 0) {
    return;
  }

  context.moveTo(polygon[0].x, polygon[0].y);

  for (const point of polygon.slice(1)) {
    context.lineTo(point.x, point.y);
  }

  context.closePath();
}

function clipToSlabBoundary(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry
) {
  context.beginPath();
  appendPolygonPath(context, slabGeometry.boundary);

  for (const opening of slabGeometry.openings) {
    appendPolygonPath(context, opening.polygon);
  }

  context.clip("evenodd");
}

function drawPolylinePath(
  context: CanvasRenderingContext2D,
  points: Point[],
  close = false
) {
  if (points.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }

  if (close) {
    context.closePath();
  }
}

function setDraftStroke(
  context: CanvasRenderingContext2D,
  scale: number,
  options: {
    alpha?: number;
    color: string;
    dash?: number[];
    widthPx: number;
  }
) {
  context.strokeStyle = options.color;
  context.globalAlpha = options.alpha ?? 1;
  context.lineWidth = screenPx(options.widthPx, scale);
  context.setLineDash(
    options.dash?.map((value) => screenPx(value, scale)) ?? []
  );
}

function resetDraftStroke(context: CanvasRenderingContext2D) {
  context.globalAlpha = 1;
  context.setLineDash([]);
}

function polygonCenter(polygon: Polygon): Point {
  return polygon.reduce(
    (sum, point, _, points) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length
    }),
    { x: 0, y: 0 }
  );
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  options: {
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    color?: string;
    height?: number;
    rotation?: number;
  } = {}
) {
  const lines = text.split("\n");
  const height = options.height ?? cadTextHeight.label;
  const lineHeight = height * 1.15;
  const baseline = options.baseline ?? "middle";
  const startY =
    baseline === "top"
      ? 0
      : baseline === "bottom"
        ? -(lines.length - 1) * lineHeight
        : baseline === "alphabetic"
          ? -(lines.length - 1) * lineHeight
          : -((lines.length - 1) * lineHeight) / 2;

  context.save();
  context.translate(x, y);
  context.rotate(options.rotation ?? 0);
  context.font = `${height}px Consolas, "Courier New", monospace`;
  context.fillStyle = options.color ?? canvasText;
  context.textAlign = options.align ?? "center";
  context.textBaseline = baseline;
  lines.forEach((line, index) => {
    context.fillText(line, 0, startY + index * lineHeight);
  });
  context.restore();
}

function drawCadLine(
  context: CanvasRenderingContext2D,
  line: CadLineEntity,
  scale: number,
  colorOverride?: string
) {
  drawPolylinePath(context, line.points);
  setDraftStroke(context, scale, {
    color: colorOverride ?? line.color ?? "#9b9b9b",
    dash: line.layer.includes("GRID") ? [8, 8] : undefined,
    widthPx: line.lineWeightPx ?? 1
  });
  context.stroke();
  resetDraftStroke(context);
}

function drawCadText(
  context: CanvasRenderingContext2D,
  text: CadTextEntity,
  scale: number,
  colorOverride?: string
) {
  drawText(context, text.text, text.position.x, text.position.y, scale, {
    align: text.align,
    baseline: text.baseline,
    color: colorOverride ?? text.color ?? canvasMutedText,
    height: text.heightPx ?? cadTextHeight.small,
    rotation: text.rotation,
  });
}

function drawCadCircle(
  context: CanvasRenderingContext2D,
  circle: CadCircleEntity,
  scale: number,
  colorOverride?: string
) {
  context.beginPath();
  context.arc(circle.center.x, circle.center.y, circle.radius, 0, Math.PI * 2);
  setDraftStroke(context, scale, {
    color: colorOverride ?? circle.color ?? "#71717a",
    widthPx: circle.lineWeightPx ?? 0.8
  });
  context.stroke();
  resetDraftStroke(context);
}

function drawCadArc(
  context: CanvasRenderingContext2D,
  arc: CadArcEntity,
  scale: number,
  colorOverride?: string
) {
  context.beginPath();
  context.arc(
    arc.center.x,
    arc.center.y,
    arc.radius,
    arc.startAngle,
    arc.endAngle
  );
  setDraftStroke(context, scale, {
    color: colorOverride ?? arc.color ?? "#71717a",
    widthPx: arc.lineWeightPx ?? 0.8
  });
  context.stroke();
  resetDraftStroke(context);
}

function visibleUnderlayLayers(underlay: NonNullable<SlabGeometry["dwgUnderlay"]>) {
  return new Set(
    underlay.layers?.filter((layer) => layer.visible).map((layer) => layer.name) ??
      []
  );
}

function isLayerVisible(visibleLayers: Set<string>, layer: string) {
  return visibleLayers.has(layer);
}

function isCalculatedSlabVisible(slabGeometry: SlabGeometry) {
  const calculatedLayer = slabGeometry.dwgUnderlay?.layers?.find(
    (layer) => layer.name === calculatedSlabLayer
  );

  return calculatedLayer?.visible ?? true;
}

function drawOpening(
  context: CanvasRenderingContext2D,
  opening: SlabOpening,
  scale: number
) {
  const bounds = polygonBounds(opening.polygon);

  drawPolygonPath(context, opening.polygon);
  context.fillStyle = cadCanvasBackground;
  context.fill();

  drawPolygonPath(context, opening.polygon);
  context.strokeStyle = "#a1a1aa";
  context.lineWidth = screenPx(3, scale);
  context.stroke();

  context.beginPath();
  context.moveTo(bounds.minX, bounds.minY);
  context.lineTo(bounds.maxX, bounds.maxY);
  context.moveTo(bounds.maxX, bounds.minY);
  context.lineTo(bounds.minX, bounds.maxY);
  context.lineWidth = screenPx(1.8, scale);
  context.stroke();

  const center = polygonCenter(opening.polygon);
  drawText(context, opening.label, center.x, center.y, scale, {
    color: canvasText,
    height: cadTextHeight.small
  });
}

function drawDesignArea(
  context: CanvasRenderingContext2D,
  area: SlabDesignArea,
  scale: number
) {
  if (!area.visible) {
    return;
  }

  const color =
    area.purpose === "no-mesh" || area.purpose === "void"
      ? "#fbbf24"
      : area.purpose === "extra-mesh"
        ? "#a78bfa"
        : "#34d399";
  const center = polygonCenter(area.polygon);

  drawPolygonPath(context, area.polygon);
  context.fillStyle = color;
  context.globalAlpha = 0.16;
  context.fill();
  context.globalAlpha = 1;

  drawPolygonPath(context, area.polygon);
  setDraftStroke(context, scale, {
    color,
    dash: [10, 6],
    widthPx: 1.6
  });
  context.stroke();
  resetDraftStroke(context);

  drawText(context, area.label, center.x, center.y, scale, {
    color,
    height: cadTextHeight.small
  });
}

function drawDesignAreas(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  for (const area of slabGeometry.designAreas ?? []) {
    drawDesignArea(context, area, scale);
  }
}

function drawRawDeficitZone(
  context: CanvasRenderingContext2D,
  zone: RawDeficitZone,
  scale: number
) {
  context.save();
  context.beginPath();
  context.rect(zone.x, zone.y, zone.width, zone.height);
  context.fillStyle = "#ef4444";
  context.globalAlpha = 0.18;
  context.fill();
  context.globalAlpha = 1;
  setDraftStroke(context, scale, {
    color: "#f87171",
    dash: [14, 8],
    widthPx: 2
  });
  context.stroke();
  resetDraftStroke(context);
  drawText(
    context,
    `Max Needed: ${Math.round(zone.maxRequiredAs)} mm2/m`,
    zone.x + zone.width / 2,
    zone.y + zone.height / 2,
    scale,
    {
      color: "#fecaca",
      height: cadTextHeight.small
    }
  );
  context.restore();
}

function drawRawDeficitZones(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  for (const zone of slabGeometry.rawDeficitZones ?? []) {
    drawRawDeficitZone(context, zone, scale);
  }
}

function drawDxfUnderlayReference(
  context: CanvasRenderingContext2D,
  underlay: DwgUnderlay,
  scale: number,
  colorOverride?: string
) {
  if (underlay.visible === false) {
    return;
  }

  const offset = underlay.offset ?? { x: 0, y: 0 };
  const origin = dxfUnderlayTransformOrigin(underlay);
  const underlayScale = dxfUnderlayScale(underlay);
  const effectiveScale = scale * underlayScale;
  const visibleLayers = visibleUnderlayLayers(underlay);

  context.save();
  context.translate(offset.x, offset.y);
  context.translate(origin.x, origin.y);
  context.scale(underlayScale, underlayScale);
  context.translate(-origin.x, -origin.y);
  for (const line of underlay.lines) {
    if (isLayerVisible(visibleLayers, line.layer)) {
      drawCadLine(context, line, effectiveScale, colorOverride);
    }
  }

  for (const text of underlay.texts) {
    if (isLayerVisible(visibleLayers, text.layer)) {
      drawCadText(context, text, effectiveScale, colorOverride);
    }
  }

  for (const circle of underlay.circles ?? []) {
    if (isLayerVisible(visibleLayers, circle.layer)) {
      drawCadCircle(context, circle, effectiveScale, colorOverride);
    }
  }

  for (const arc of underlay.arcs ?? []) {
    if (isLayerVisible(visibleLayers, arc.layer)) {
      drawCadArc(context, arc, effectiveScale, colorOverride);
    }
  }
  context.restore();
}

function drawDwgUnderlay(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  const dxfReferences =
    slabGeometry.dxfUnderlays ??
    (slabGeometry.dwgUnderlay?.importedFileName ? [slabGeometry.dwgUnderlay] : []);
  const calculatedUnderlay = slabGeometry.dwgUnderlay;

  if (
    !dxfReferences.length &&
    !calculatedUnderlay &&
    !slabGeometry.strapLayerX &&
    !slabGeometry.strapLayerY
  ) {
    return;
  }

  context.save();
  context.globalAlpha = 0.38;

  for (const underlay of dxfReferences) {
    drawDxfUnderlayReference(context, underlay, scale);
  }

  context.globalAlpha = 0.7;
  if (slabGeometry.strapLayerX) {
    drawDxfUnderlayReference(context, slabGeometry.strapLayerX, scale, "#e879f9");
  }
  if (slabGeometry.strapLayerY) {
    drawDxfUnderlayReference(context, slabGeometry.strapLayerY, scale, "#fb923c");
  }

  context.globalAlpha = 0.38;
  if (calculatedUnderlay) {
    const visibleLayers = visibleUnderlayLayers(calculatedUnderlay);
    for (const line of calculatedUnderlay.lines) {
      if (
        line.layer === calculatedSlabLayer &&
        isLayerVisible(visibleLayers, line.layer)
      ) {
        drawCadLine(context, line, scale);
      }
    }
  }

  context.restore();
  resetDraftStroke(context);
}

function drawConcreteHatch(
  context: CanvasRenderingContext2D,
  polygon: Polygon,
  scale: number
) {
  const bounds = polygonBounds(polygon);
  const hatchSpacing = 320;
  const overshoot = bounds.maxY - bounds.minY + bounds.maxX - bounds.minX;

  context.save();
  drawPolygonPath(context, polygon);
  context.clip();
  context.beginPath();

  for (
    let x = bounds.minX - overshoot;
    x <= bounds.maxX + overshoot;
    x += hatchSpacing
  ) {
    context.moveTo(x, bounds.maxY + overshoot);
    context.lineTo(x + overshoot, bounds.minY);
  }

  context.strokeStyle = "#71717a";
  context.globalAlpha = 0.35;
  context.lineWidth = screenPx(0.7, scale);
  context.stroke();
  context.restore();
  context.globalAlpha = 1;
}

function drawStructuralElement(
  context: CanvasRenderingContext2D,
  element: StructuralElement,
  scale: number
) {
  drawPolygonPath(context, element.polygon);
  context.fillStyle = "#3f3f46";
  context.fill();
  drawConcreteHatch(context, element.polygon, scale);
  drawPolygonPath(context, element.polygon);
  context.strokeStyle = "#a1a1aa";
  context.lineWidth = screenPx(element.type === "column" ? 2.2 : 2, scale);
  context.stroke();
}

function drawStructuralBackground(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  for (const element of slabGeometry.structuralElements) {
    drawStructuralElement(context, element, scale);
  }
}

function drawSlabGeometry(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  const bounds = polygonBounds(slabGeometry.boundary);
  const isImportedWorkingSlab = Boolean(
    slabGeometry.dwgUnderlay && !slabGeometry.dwgUnderlay.reviewOnly
  );

  drawPolygonPath(context, slabGeometry.boundary);
  setDraftStroke(context, scale, {
    color: isImportedWorkingSlab ? meshActiveBlue : "#a1a1aa",
    widthPx: isImportedWorkingSlab ? 2.2 : 1.5
  });
  context.stroke();
  resetDraftStroke(context);

  drawText(
    context,
    `SLAB ${Math.round(bounds.maxX - bounds.minX)}x${Math.round(
      bounds.maxY - bounds.minY
    )}mm`,
    bounds.minX,
    bounds.minY - 550,
    scale,
    {
      align: "left",
      color: canvasMutedText,
      height: cadTextHeight.small
    }
  );

  for (const opening of slabGeometry.openings) {
    drawOpening(context, opening, scale);
  }
}

function drawMeshSheet(
  context: CanvasRenderingContext2D,
  sheet: MeshSheet,
  scale: number,
  opacity = 1,
  isActive = false
) {
  for (const visiblePolygon of sheet.visiblePolygons) {
    context.save();
    drawPolygonPath(context, visiblePolygon);
    context.globalAlpha = 0.12 * opacity;
    context.fillStyle = meshBlue;
    context.fill();
    context.restore();

    context.save();
    if (isActive) {
      context.shadowBlur = 10;
      context.shadowColor = meshActiveBlue;
    }
    drawPolygonPath(context, visiblePolygon);
    setDraftStroke(context, scale, {
      alpha: opacity,
      color: isActive ? meshActiveBlue : meshBlue,
      widthPx: isActive ? 1.25 : 1
    });
    context.stroke();
    resetDraftStroke(context);
    context.restore();
  }

  for (const diagonal of sheet.diagonalSegments) {
    context.beginPath();
    context.moveTo(diagonal.start.x, diagonal.start.y);
    context.lineTo(diagonal.end.x, diagonal.end.y);
    setDraftStroke(context, scale, {
      alpha: (isActive ? 0.75 : 0.5) * opacity,
      color: isActive ? meshActiveBlue : meshBlue,
      widthPx: 0.7
    });
    context.stroke();
    resetDraftStroke(context);
  }

  const labelSegment = sheet.diagonalSegments.toSorted(
    (a, b) =>
      Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) -
      Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y)
  )[0];

  if (!labelSegment) {
    return;
  }

  context.save();
  context.globalAlpha = opacity;
  drawText(
    context,
    `SHEET ${sheet.length}x${sheet.width}`,
    (labelSegment.start.x + labelSegment.end.x) / 2,
    (labelSegment.start.y + labelSegment.end.y) / 2,
    scale,
    {
      color: isActive ? canvasText : canvasMutedText,
      height: cadTextHeight.small * 0.75,
      rotation: sheet.orientation === "horizontal" ? 0 : Math.PI / 2,
    }
  );
  context.restore();
}

function drawMeshSheets(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  meshZones: MeshZone[],
  activeZoneId: string,
  scale: number
) {
  context.save();
  clipToSlabBoundary(context, slabGeometry);

  for (const zone of meshZones) {
    const layout = generateBaseMeshLayout(
      slabGeometry,
      zone.parameters,
      zone.geometry
    );
    const isActive = zone.id === activeZoneId;
    const opacity = isActive ? 1 : 0.35;

    for (const sheet of layout.sheets) {
      drawMeshSheet(context, sheet, scale, opacity, isActive);
    }
  }

  context.restore();
}

function gridOriginPoint(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings
): Point {
  const bounds = polygonBounds(slabGeometry.boundary);

  return {
    x: settings.originCorner.endsWith("right") ? bounds.maxX : bounds.minX,
    y: settings.originCorner.startsWith("bottom") ? bounds.maxY : bounds.minY
  };
}

function drawGridOriginMarker(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  scale: number
) {
  const origin = gridOriginPoint(slabGeometry, settings);
  const markerSize = cadMarkerSize;

  context.save();
  context.beginPath();
  context.moveTo(origin.x - markerSize, origin.y);
  context.lineTo(origin.x + markerSize, origin.y);
  context.moveTo(origin.x, origin.y - markerSize);
  context.lineTo(origin.x, origin.y + markerSize);
  context.strokeStyle = meshActiveBlue;
  context.lineWidth = screenPx(1.4, scale);
  context.stroke();
  context.beginPath();
  context.arc(origin.x, origin.y, cadMarkerSize / 3, 0, Math.PI * 2);
  context.fillStyle = meshActiveBlue;
  context.fill();
  drawText(context, "GRID 0,0", origin.x + markerSize * 2, origin.y, scale, {
    align: "left",
    color: meshActiveBlue,
    height: cadTextHeight.small
  });
  context.restore();
}

function meshDetailOrigin(slabGeometry: SlabGeometry): Point {
  const bounds = polygonBounds(slabGeometry.boundary);

  return {
    x: bounds.maxX + detailOffsetX,
    y: bounds.minY + 1_500
  };
}

function drawArrowLine(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  scale: number,
  color = canvasMutedText
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const arrowSize = cadArrowSize;

  drawPolylinePath(context, [start, end]);
  setDraftStroke(context, scale, { color, widthPx: 1 });
  context.stroke();

  for (const point of [start, end]) {
    const direction = point === start ? angle + Math.PI : angle;

    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(
      point.x - Math.cos(direction - Math.PI / 7) * arrowSize,
      point.y - Math.sin(direction - Math.PI / 7) * arrowSize
    );
    context.moveTo(point.x, point.y);
    context.lineTo(
      point.x - Math.cos(direction + Math.PI / 7) * arrowSize,
      point.y - Math.sin(direction + Math.PI / 7) * arrowSize
    );
    context.stroke();
  }

  resetDraftStroke(context);
}

function drawMeshDetailCallout(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  scale: number
) {
  const origin = meshDetailOrigin(slabGeometry);
  const frame: Polygon = [
    origin,
    { x: origin.x + meshDetailSize.width, y: origin.y },
    {
      x: origin.x + meshDetailSize.width,
      y: origin.y + meshDetailSize.height
    },
    { x: origin.x, y: origin.y + meshDetailSize.height }
  ];
  const boxOrigin = {
    x: origin.x + 1_250,
    y: origin.y + 1_500
  };
  const boxWidth = 4_800;
  const boxHeight = 2_800;
  const meshBox: Polygon = [
    boxOrigin,
    { x: boxOrigin.x + boxWidth, y: boxOrigin.y },
    { x: boxOrigin.x + boxWidth, y: boxOrigin.y + boxHeight },
    { x: boxOrigin.x, y: boxOrigin.y + boxHeight }
  ];

  drawPolygonPath(context, frame);
  setDraftStroke(context, scale, { color: canvasMutedText, widthPx: 1.2 });
  context.stroke();
  resetDraftStroke(context);

  drawText(context, "MESH A - רשת א'", origin.x + 450, origin.y + 450, scale, {
    align: "left",
    color: canvasText,
    height: cadTextHeight.title
  });
  drawText(
    context,
    `BASE MESH Ø${settings.diameter}@${settings.spacing}mm`,
    origin.x + 450,
    origin.y + 850,
    scale,
    { align: "left", color: canvasText, height: cadTextHeight.label }
  );

  drawPolygonPath(context, meshBox);
  setDraftStroke(context, scale, { color: meshBlue, widthPx: 1.2 });
  context.stroke();

  for (
    let x = boxOrigin.x + settings.spacing;
    x < boxOrigin.x + boxWidth;
    x += settings.spacing
  ) {
    drawPolylinePath(context, [
      { x, y: boxOrigin.y },
      { x, y: boxOrigin.y + boxHeight }
    ]);
    context.stroke();
  }

  for (
    let y = boxOrigin.y + settings.spacing;
    y < boxOrigin.y + boxHeight;
    y += settings.spacing
  ) {
    drawPolylinePath(context, [
      { x: boxOrigin.x, y },
      { x: boxOrigin.x + boxWidth, y }
    ]);
    context.stroke();
  }

  resetDraftStroke(context);

  drawArrowLine(
    context,
    { x: boxOrigin.x, y: boxOrigin.y + boxHeight + 700 },
    { x: boxOrigin.x + boxWidth, y: boxOrigin.y + boxHeight + 700 },
    scale
  );
  drawText(
    context,
    `${settings.sheetWidth}mm SHEET WIDTH`,
    boxOrigin.x + boxWidth / 2,
    boxOrigin.y + boxHeight + 1_050,
    scale,
    { color: canvasText, height: cadTextHeight.label }
  );
  drawArrowLine(
    context,
    { x: boxOrigin.x + boxWidth + 700, y: boxOrigin.y },
    { x: boxOrigin.x + boxWidth + 700, y: boxOrigin.y + boxHeight },
    scale
  );
  drawText(
    context,
    `${settings.sheetLength}mm SHEET LENGTH`,
    boxOrigin.x + boxWidth + 1_050,
    boxOrigin.y + boxHeight / 2,
    scale,
    {
      color: canvasText,
      height: cadTextHeight.label,
      rotation: Math.PI / 2
    }
  );

  drawText(
    context,
    "1:1 MM VECTOR DETAIL | DXF READY",
    origin.x + 450,
    origin.y + meshDetailSize.height - 550,
    scale,
    { align: "left", color: canvasMutedText, height: cadTextHeight.small }
  );
}

function rectangleFromPoints(start: Point, end: Point): Polygon {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

function drawZoneDraft(
  context: CanvasRenderingContext2D,
  draft: ZoneDraft | null,
  scale: number
) {
  if (!draft) {
    return;
  }

  const polygon = rectangleFromPoints(draft.start, draft.current);

  drawPolygonPath(context, polygon);
  setDraftStroke(context, scale, {
    color: meshActiveBlue,
    dash: [10, 6],
    widthPx: 1.5
  });
  context.stroke();
  resetDraftStroke(context);
}

function drawBoundaryTrace(
  context: CanvasRenderingContext2D,
  points: Point[],
  snapPoint: Point | null,
  scale: number
) {
  if (points.length > 0) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (const point of points.slice(1)) {
      context.lineTo(point.x, point.y);
    }

    if (snapPoint) {
      context.lineTo(snapPoint.x, snapPoint.y);
    }

    setDraftStroke(context, scale, {
      color: "#f4f4f5",
      dash: [12, 8],
      widthPx: 2
    });
    context.stroke();
    resetDraftStroke(context);
  }

  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, screenPx(5, scale), 0, Math.PI * 2);
    context.fillStyle = "#f4f4f5";
    context.fill();
  }

  if (snapPoint) {
    context.beginPath();
    context.arc(snapPoint.x, snapPoint.y, screenPx(7, scale), 0, Math.PI * 2);
    context.fillStyle = meshActiveBlue;
    context.fill();
  }
}

function drawDesignAreaDraft(
  context: CanvasRenderingContext2D,
  points: Point[],
  snapPoint: Point | null,
  rectangleDraft: ZoneDraft | null,
  scale: number
) {
  if (rectangleDraft) {
    drawPolygonPath(context, rectangleFromPoints(rectangleDraft.start, rectangleDraft.current));
    context.fillStyle = "rgba(251, 191, 36, 0.12)";
    context.fill();
    setDraftStroke(context, scale, {
      color: "#fbbf24",
      dash: [10, 6],
      widthPx: 1.8
    });
    context.stroke();
    resetDraftStroke(context);
  }

  if (points.length > 0) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (const point of points.slice(1)) {
      context.lineTo(point.x, point.y);
    }

    if (snapPoint) {
      context.lineTo(snapPoint.x, snapPoint.y);
    }

    setDraftStroke(context, scale, {
      color: "#fbbf24",
      dash: [12, 8],
      widthPx: 2
    });
    context.stroke();
    resetDraftStroke(context);
  }

  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, screenPx(5, scale), 0, Math.PI * 2);
    context.fillStyle = "#fbbf24";
    context.fill();
  }

  if (snapPoint) {
    context.beginPath();
    context.arc(snapPoint.x, snapPoint.y, screenPx(7, scale), 0, Math.PI * 2);
    context.fillStyle = "#f59e0b";
    context.fill();
  }
}

function drawBoundaryEditHandles(
  context: CanvasRenderingContext2D,
  boundary: Polygon,
  scale: number
) {
  if (boundary.length === 0) {
    return;
  }

  drawPolylinePath(context, [...boundary, boundary[0]]);
  setDraftStroke(context, scale, {
    color: meshActiveBlue,
    dash: [8, 6],
    widthPx: 1.8
  });
  context.stroke();
  resetDraftStroke(context);

  for (const [index, point] of boundary.entries()) {
    context.beginPath();
    context.arc(point.x, point.y, screenPx(7, scale), 0, Math.PI * 2);
    context.fillStyle = index === 0 ? "#f4f4f5" : meshActiveBlue;
    context.fill();
    context.strokeStyle = "#020617";
    context.lineWidth = screenPx(2, scale);
    context.stroke();
  }
}

function drawDesignAreaEditHandles(
  context: CanvasRenderingContext2D,
  area: SlabDesignArea,
  scale: number
) {
  drawPolylinePath(context, [...area.polygon, area.polygon[0]]);
  setDraftStroke(context, scale, {
    color: "#fbbf24",
    dash: [8, 6],
    widthPx: 1.8
  });
  context.stroke();
  resetDraftStroke(context);

  for (const point of area.polygon) {
    context.beginPath();
    context.arc(point.x, point.y, screenPx(7, scale), 0, Math.PI * 2);
    context.fillStyle = "#fbbf24";
    context.fill();
    context.strokeStyle = "#020617";
    context.lineWidth = screenPx(2, scale);
    context.stroke();
  }
}

export function StructureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoneDraftRef = useRef<ZoneDraft | null>(null);
  const designAreaRectangleDraftRef = useRef<ZoneDraft | null>(null);
  const editingVertexIndexRef = useRef<number | null>(null);
  const hasFitViewRef = useRef(false);
  const panRef = useRef({ x: canvasPadding, y: canvasPadding });
  const scaleRef = useRef(initialScale);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    panX: canvasPadding,
    panY: canvasPadding
  });
  const dxfDragRef = useRef<{
    id: string | null;
    lastPoint: Point | null;
  }>({
    id: null,
    lastPoint: null
  });
  const [viewScale, setViewScale] = useState(initialScale);
  const [canvasSize, setCanvasSize] = useState({ height: 1, width: 1 });
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const {
    slabGeometry,
    meshZones,
    activeZoneId,
    activeMeshZone,
    activeDxfUnderlayId,
    isDrawingZone,
    isDrawingBoundary,
    isEditingBoundary,
    editingDesignAreaId,
    isDrawingDesignArea,
    designAreaDrawingMode,
    boundaryDraftPoints,
    designAreaDraftPoints,
    addBoundaryTracePoint,
    addDesignAreaDraftPoint,
    cancelDrawingZone,
    commitDesignAreaPolygon,
    commitDrawnMeshZone,
    finishBoundaryTrace,
    finishDesignAreaDraft,
    setActiveDxfUnderlayId,
    translateDxfUnderlay,
    updateCalculatedBoundaryPoint,
    updateDesignAreaPoint,
    updateActiveMeshZoneParameters
  } = useReinforcement();
  const layoutComparison = useMemo(
    () =>
      compareBaseMeshOrientations(
        slabGeometry,
        activeMeshZone.parameters,
        activeMeshZone.geometry
      ),
    [activeMeshZone.geometry, activeMeshZone.parameters, slabGeometry]
  );

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = cadCanvasBackground;
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (!hasFitViewRef.current) {
      const bounds = polygonBounds(slabGeometry.boundary);
      const fitScale = Math.min(
        (canvas.width - 80) / (bounds.maxX - bounds.minX),
        (canvas.height - 80) / (bounds.maxY - bounds.minY)
      );
      const nextScale = Math.max(minimumScale, Math.min(0.18, fitScale));

      scaleRef.current = nextScale;
      panRef.current = {
        x:
          (canvas.width - (bounds.maxX - bounds.minX) * nextScale) / 2 -
          bounds.minX * nextScale,
        y:
          (canvas.height - (bounds.maxY - bounds.minY) * nextScale) / 2 -
          bounds.minY * nextScale
      };
      setViewScale(nextScale);
      hasFitViewRef.current = true;
    }

    context.setTransform(
      scaleRef.current,
      0,
      0,
      scaleRef.current,
      panRef.current.x,
      panRef.current.y
    );
    drawDwgUnderlay(context, slabGeometry, scaleRef.current);
    drawStructuralBackground(context, slabGeometry, scaleRef.current);
    if (slabGeometry.hasActiveSlabBoundary ?? true) {
      if (slabGeometry.dwgUnderlay?.reviewOnly) {
        if (slabGeometry.hasActiveSlabBoundary) {
          const areaMeshZones = meshZones.filter((zone) => !zone.isMainZone);

          if (areaMeshZones.length > 0) {
            drawMeshSheets(
              context,
              slabGeometry,
              areaMeshZones,
              activeZoneId,
              scaleRef.current
            );
          }
          if (isCalculatedSlabVisible(slabGeometry) || isEditingBoundary) {
            drawSlabGeometry(context, slabGeometry, scaleRef.current);
          }
          drawDesignAreas(context, slabGeometry, scaleRef.current);
          drawRawDeficitZones(context, slabGeometry, scaleRef.current);
          const editingDesignArea = (slabGeometry.designAreas ?? []).find(
            (area) => area.id === editingDesignAreaId
          );

          if (editingDesignArea) {
            drawDesignAreaEditHandles(
              context,
              editingDesignArea,
              scaleRef.current
            );
          }
        }
        drawBoundaryTrace(
          context,
          boundaryDraftPoints,
          snapPoint,
          scaleRef.current
        );
        drawDesignAreaDraft(
          context,
          designAreaDraftPoints,
          snapPoint,
          designAreaRectangleDraftRef.current,
          scaleRef.current
        );
        drawZoneDraft(context, zoneDraftRef.current, scaleRef.current);
        return;
      }

      drawMeshSheets(
        context,
        slabGeometry,
        meshZones,
        activeZoneId,
        scaleRef.current
      );
      if (isCalculatedSlabVisible(slabGeometry) || isEditingBoundary) {
        drawSlabGeometry(context, slabGeometry, scaleRef.current);
      }
      if (isEditingBoundary) {
        drawBoundaryEditHandles(
          context,
          slabGeometry.boundary,
          scaleRef.current
        );
      }
      drawDesignAreas(context, slabGeometry, scaleRef.current);
      drawRawDeficitZones(context, slabGeometry, scaleRef.current);
      const editingDesignArea = (slabGeometry.designAreas ?? []).find(
        (area) => area.id === editingDesignAreaId
      );

      if (editingDesignArea) {
        drawDesignAreaEditHandles(context, editingDesignArea, scaleRef.current);
      }
      drawGridOriginMarker(
        context,
        slabGeometry,
        activeMeshZone.parameters,
        scaleRef.current
      );
      drawMeshDetailCallout(
        context,
        slabGeometry,
        activeMeshZone.parameters,
        scaleRef.current
      );
    }
    drawBoundaryTrace(context, boundaryDraftPoints, snapPoint, scaleRef.current);
    drawDesignAreaDraft(
      context,
      designAreaDraftPoints,
      snapPoint,
      designAreaRectangleDraftRef.current,
      scaleRef.current
    );
    drawZoneDraft(context, zoneDraftRef.current, scaleRef.current);
  }, [
    activeMeshZone.parameters,
    activeZoneId,
    boundaryDraftPoints,
    editingDesignAreaId,
    isEditingBoundary,
    designAreaDraftPoints,
    meshZones,
    slabGeometry,
    snapPoint
  ]);

  const zoomViewport = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const worldCenter = {
        x: (centerX - panRef.current.x) / scaleRef.current,
        y: (centerY - panRef.current.y) / scaleRef.current
      };
      const nextScale = Math.max(
        minimumScale,
        Math.min(maximumScale, scaleRef.current * factor)
      );

      scaleRef.current = nextScale;
      panRef.current = {
        x: centerX - worldCenter.x * nextScale,
        y: centerY - worldCenter.y * nextScale
      };
      setViewScale(nextScale);
      renderCanvas();
    },
    [renderCanvas]
  );

  const fitViewport = useCallback(() => {
    hasFitViewRef.current = false;
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(1, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(1, Math.floor(entry.contentRect.height));

      hasFitViewRef.current = false;
      setCanvasSize({ height: nextHeight, width: nextWidth });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isEditingBoundary) {
      hasFitViewRef.current = false;
    }
  }, [isEditingBoundary, slabGeometry.boundary]);

  useEffect(() => {
    renderCanvas();
  }, [canvasSize, renderCanvas, viewScale]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const eventToWorldPoint = (event: PointerEvent): Point => {
      const rect = container.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      return {
        x: (localX - panRef.current.x) / scaleRef.current,
        y: (localY - panRef.current.y) / scaleRef.current
      };
    };

    const snapToDxfVertex = (worldPoint: Point) => {
      const snapRadius = screenPx(15, scaleRef.current);
      const references =
        slabGeometry.dxfUnderlays ??
        (slabGeometry.dwgUnderlay?.importedFileName
          ? [slabGeometry.dwgUnderlay]
          : []);
      const snapReferences = [
        ...references,
        slabGeometry.strapLayerX,
        slabGeometry.strapLayerY
      ].filter((reference): reference is DwgUnderlay => Boolean(reference));
      let closest: Point | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const reference of snapReferences) {
        if (reference.visible === false) {
          continue;
        }
        for (const vertex of reference.dxfVertices ?? []) {
          const offsetVertex = transformDxfPoint(reference, vertex);
          const nextDistance = distance(worldPoint, offsetVertex);

          if (nextDistance < closestDistance) {
            closest = offsetVertex;
            closestDistance = nextDistance;
          }
        }
      }

      return closest && closestDistance <= snapRadius ? closest : null;
    };

    const activeDxfUnderlayAt = (worldPoint: Point) => {
      const underlay = [
        ...(slabGeometry.dxfUnderlays ?? []),
        slabGeometry.strapLayerX,
        slabGeometry.strapLayerY
      ].find((reference) => reference?.id === activeDxfUnderlayId);

      if (!underlay?.bounds || underlay.visible === false) {
        return null;
      }

      const bounds = transformedDxfBounds(underlay);

      return bounds &&
        worldPoint.x >= bounds.minX &&
        worldPoint.x <= bounds.maxX &&
        worldPoint.y >= bounds.minY &&
        worldPoint.y <= bounds.maxY
        ? underlay
        : null;
    };

    const boundaryVertexAt = (worldPoint: Point) => {
      const hitRadius = screenPx(12, scaleRef.current);
      let closestIndex: number | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const [index, vertex] of slabGeometry.boundary.entries()) {
        const nextDistance = distance(worldPoint, vertex);

        if (nextDistance < closestDistance) {
          closestIndex = index;
          closestDistance = nextDistance;
        }
      }

      return closestDistance <= hitRadius ? closestIndex : null;
    };

    const designAreaVertexAt = (worldPoint: Point) => {
      if (!editingDesignAreaId) {
        return null;
      }

      const area = (slabGeometry.designAreas ?? []).find(
        (designArea) => designArea.id === editingDesignAreaId
      );
      const hitRadius = screenPx(12, scaleRef.current);
      let closestIndex: number | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const [index, vertex] of area?.polygon.entries() ?? []) {
        const nextDistance = distance(worldPoint, vertex);

        if (nextDistance < closestDistance) {
          closestIndex = index;
          closestDistance = nextDistance;
        }
      }

      return closestDistance <= hitRadius ? closestIndex : null;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const worldBeforeZoom = {
        x: (localX - panRef.current.x) / scaleRef.current,
        y: (localY - panRef.current.y) / scaleRef.current
      };
      const nextScale = Math.max(
        minimumScale,
        Math.min(
          maximumScale,
          scaleRef.current * (event.deltaY > 0 ? 0.9 : 1.1)
        )
      );

      scaleRef.current = nextScale;
      setViewScale(nextScale);
      panRef.current = {
        x: localX - worldBeforeZoom.x * nextScale,
        y: localY - worldBeforeZoom.y * nextScale
      };
      renderCanvas();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        event.preventDefault();

        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic/test pointer events may not have an active pointer capture.
        }

        dragRef.current = {
          isDragging: true,
          startX: event.clientX,
          startY: event.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y
        };
        return;
      }

      if (isDrawingZone) {
        if (event.button !== 0) {
          return;
        }

        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic/test pointer events may not have an active pointer capture.
        }

        const worldPoint = eventToWorldPoint(event);

        zoneDraftRef.current = {
          current: worldPoint,
          isDragging: true,
          start: worldPoint
        };
        renderCanvas();
        return;
      }

      if (isDrawingDesignArea) {
        if (event.button !== 0) {
          return;
        }

        if (designAreaDrawingMode === "rectangle") {
          try {
            container.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic/test pointer events may not have an active pointer capture.
          }

          const worldPoint = eventToWorldPoint(event);

          designAreaRectangleDraftRef.current = {
            current: worldPoint,
            isDragging: true,
            start: worldPoint
          };
          renderCanvas();
          return;
        }

        const snappedPoint = snapToDxfVertex(eventToWorldPoint(event));

        if (!snappedPoint) {
          return;
        }

        const firstPoint = designAreaDraftPoints[0];

        if (
          firstPoint &&
          designAreaDraftPoints.length >= 3 &&
          distance(firstPoint, snappedPoint) <= screenPx(15, scaleRef.current)
        ) {
          finishDesignAreaDraft();
          setSnapPoint(null);
        } else {
          addDesignAreaDraftPoint(snappedPoint);
          setSnapPoint(snappedPoint);
        }

        renderCanvas();
        return;
      }

      if (isEditingBoundary) {
        if (event.button !== 0) {
          return;
        }

        const vertexIndex = boundaryVertexAt(eventToWorldPoint(event));

        if (vertexIndex === null) {
          return;
        }

        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic/test pointer events may not have an active pointer capture.
        }

        editingVertexIndexRef.current = vertexIndex;
        return;
      }

      if (editingDesignAreaId) {
        if (event.button !== 0) {
          return;
        }

        const vertexIndex = designAreaVertexAt(eventToWorldPoint(event));

        if (vertexIndex === null) {
          return;
        }

        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic/test pointer events may not have an active pointer capture.
        }

        editingVertexIndexRef.current = vertexIndex;
        return;
      }

      if (isDrawingBoundary) {
        if (event.button !== 0) {
          return;
        }

        const snappedPoint = snapToDxfVertex(eventToWorldPoint(event));

        if (!snappedPoint) {
          return;
        }

        const firstPoint = boundaryDraftPoints[0];

        if (
          firstPoint &&
          boundaryDraftPoints.length >= 3 &&
          distance(firstPoint, snappedPoint) <= screenPx(15, scaleRef.current)
        ) {
          finishBoundaryTrace();
          setSnapPoint(null);
        } else {
          addBoundaryTracePoint(snappedPoint);
          setSnapPoint(snappedPoint);
        }

        renderCanvas();
        return;
      }

      if (activeDxfUnderlayId && event.button === 0) {
        const worldPoint = eventToWorldPoint(event);
        const activeUnderlay = activeDxfUnderlayAt(worldPoint);

        if (!activeUnderlay?.id) {
          return;
        }

        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic/test pointer events may not have an active pointer capture.
        }

        setActiveDxfUnderlayId(activeUnderlay.id);
        dxfDragRef.current = {
          id: activeUnderlay.id,
          lastPoint: worldPoint
        };
        return;
      }

      // Left click is reserved for future picking; zone selection stays sidebar-only.
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (dxfDragRef.current.id && dxfDragRef.current.lastPoint) {
        const worldPoint = eventToWorldPoint(event);
        const delta = {
          x: worldPoint.x - dxfDragRef.current.lastPoint.x,
          y: worldPoint.y - dxfDragRef.current.lastPoint.y
        };

        translateDxfUnderlay(dxfDragRef.current.id, delta);
        dxfDragRef.current.lastPoint = worldPoint;
        renderCanvas();
        return;
      }

      if (isDrawingDesignArea && designAreaRectangleDraftRef.current?.isDragging) {
        designAreaRectangleDraftRef.current = {
          ...designAreaRectangleDraftRef.current,
          current: eventToWorldPoint(event)
        };
        renderCanvas();
        return;
      }

      if (editingVertexIndexRef.current !== null) {
        const worldPoint = eventToWorldPoint(event);
        const nextPoint = snapToDxfVertex(worldPoint) ?? worldPoint;

        if (editingDesignAreaId) {
          updateDesignAreaPoint(
            editingDesignAreaId,
            editingVertexIndexRef.current,
            nextPoint
          );
        } else {
          updateCalculatedBoundaryPoint(editingVertexIndexRef.current, nextPoint);
        }
        renderCanvas();
        return;
      }

      if (isDrawingZone && zoneDraftRef.current?.isDragging) {
        zoneDraftRef.current = {
          ...zoneDraftRef.current,
          current: eventToWorldPoint(event)
        };
        renderCanvas();
        return;
      }

      if (dragRef.current.isDragging) {
        panRef.current = {
          x: dragRef.current.panX + event.clientX - dragRef.current.startX,
          y: dragRef.current.panY + event.clientY - dragRef.current.startY
        };
        renderCanvas();
        return;
      }

      if (isDrawingBoundary || isDrawingDesignArea) {
        setSnapPoint(snapToDxfVertex(eventToWorldPoint(event)));
        renderCanvas();
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (isDrawingDesignArea && designAreaRectangleDraftRef.current?.isDragging) {
        const draft = designAreaRectangleDraftRef.current;
        const width = Math.abs(draft.current.x - draft.start.x);
        const height = Math.abs(draft.current.y - draft.start.y);

        designAreaRectangleDraftRef.current = null;

        if (width >= minimumDesignAreaSize && height >= minimumDesignAreaSize) {
          commitDesignAreaPolygon(rectangleFromPoints(draft.start, draft.current));
        }

        renderCanvas();
        try {
          container.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may not exist for synthetic/test events.
        }
        return;
      }

      if (editingVertexIndexRef.current !== null) {
        editingVertexIndexRef.current = null;

        try {
          container.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may not exist for synthetic/test events.
        }
        renderCanvas();
        return;
      }

      if (isDrawingZone && zoneDraftRef.current?.isDragging) {
        const draft = zoneDraftRef.current;
        const width = Math.abs(draft.current.x - draft.start.x);
        const height = Math.abs(draft.current.y - draft.start.y);

        zoneDraftRef.current = null;

        if (width >= minimumDrawnZoneSize && height >= minimumDrawnZoneSize) {
          commitDrawnMeshZone(rectangleFromPoints(draft.start, draft.current));
        } else {
          cancelDrawingZone();
        }

        renderCanvas();
        try {
          container.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may not exist for synthetic/test events.
        }
        return;
      }

      if (dxfDragRef.current.id) {
        dxfDragRef.current = {
          id: null,
          lastPoint: null
        };
        try {
          container.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may not exist for synthetic/test events.
        }
        renderCanvas();
        return;
      }

      if (!dragRef.current.isDragging) {
        return;
      }

      try {
        container.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may not exist for synthetic/test events.
      }
      dragRef.current.isDragging = false;
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("contextmenu", handleContextMenu);
    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerUp);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    addBoundaryTracePoint,
    addDesignAreaDraftPoint,
    activeDxfUnderlayId,
    boundaryDraftPoints,
    cancelDrawingZone,
    commitDesignAreaPolygon,
    commitDrawnMeshZone,
    editingDesignAreaId,
    finishBoundaryTrace,
    finishDesignAreaDraft,
    isDrawingBoundary,
    isDrawingDesignArea,
    isEditingBoundary,
    isDrawingZone,
    meshZones,
    designAreaDraftPoints,
    designAreaDrawingMode,
    slabGeometry.boundary,
    slabGeometry.designAreas,
    slabGeometry.dxfUnderlays,
    slabGeometry.dwgUnderlay,
    slabGeometry.dwgUnderlay?.dxfVertices,
    slabGeometry.rawDeficitZones,
    slabGeometry.strapLayerX,
    slabGeometry.strapLayerY,
    renderCanvas,
    setActiveDxfUnderlayId,
    translateDxfUnderlay,
    updateCalculatedBoundaryPoint,
    updateDesignAreaPoint
  ]);

  return (
    <div className="relative h-full overflow-hidden bg-[#121214]">
      <div
        className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-4 rounded-full border bg-background/80 px-4 py-2 text-xs text-foreground shadow-lg backdrop-blur"
        suppressHydrationWarning
      >
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border px-2 py-1 text-sm leading-none transition hover:bg-muted"
            suppressHydrationWarning
            type="button"
            onClick={() => zoomViewport(0.88)}
          >
            -
          </button>
          <span className="min-w-14 text-center text-muted-foreground">
            {Math.round(viewScale * 100)}%
          </span>
          <button
            className="rounded-md border px-2 py-1 text-sm leading-none transition hover:bg-muted"
            suppressHydrationWarning
            type="button"
            onClick={() => zoomViewport(1.14)}
          >
            +
          </button>
        </div>
        <button
          className="rounded-md border px-3 py-1 font-medium transition hover:bg-muted"
          suppressHydrationWarning
          type="button"
          onClick={fitViewport}
        >
          Fit
        </button>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">ECO</span>
          {(["horizontal", "vertical"] as const).map((orientation) => (
            <button
              key={orientation}
              className={`rounded-md border px-2 py-1 font-medium transition ${
                activeMeshZone.parameters.orientation === orientation
                  ? "border-primary bg-primary/15 text-primary"
                  : "hover:bg-muted"
              }`}
              suppressHydrationWarning
              type="button"
              onClick={() => updateActiveMeshZoneParameters({ orientation })}
            >
              {orientation === "horizontal" ? "H" : "V"}
              {layoutComparison.recommendedOrientation === orientation ? (
                <span className="ml-1 text-[10px] text-sky-300">Eco</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className={`h-full w-full touch-none ${
          isDrawingZone || isDrawingBoundary || isEditingBoundary
          || editingDesignAreaId
          || isDrawingDesignArea
            ? "cursor-crosshair"
            : "cursor-default"
        }`}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          height={canvasSize.height}
          width={canvasSize.width}
        />
      </div>
      {isDrawingZone ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 max-w-md -translate-x-1/2 rounded-md border border-primary/30 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-sm backdrop-blur">
          לחץ וגרור עם העכבר כדי להגדיר את שטח הרשת החדשה
        </div>
      ) : null}
      {isDrawingBoundary ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-md border border-primary/30 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-sm backdrop-blur">
          <span>לחץ על נקודות DXF כדי להגדיר את גבול התקרה</span>
          <button
            className="pointer-events-auto rounded-md border px-2 py-1 text-xs"
            suppressHydrationWarning
            type="button"
            onClick={finishBoundaryTrace}
          >
            סיום הגדרה
          </button>
        </div>
      ) : null}
      {isEditingBoundary ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 max-w-md -translate-x-1/2 rounded-md border border-primary/30 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-sm backdrop-blur">
          Drag blue boundary points to adjust the calculated slab
        </div>
      ) : null}
      {editingDesignAreaId ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 max-w-md -translate-x-1/2 rounded-md border border-amber-400/30 bg-background/90 px-4 py-2 text-sm font-medium text-amber-300 shadow-sm backdrop-blur">
          Drag amber area points to edit the no-mesh area
        </div>
      ) : null}
      {isDrawingDesignArea ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 max-w-md -translate-x-1/2 rounded-md border border-amber-400/30 bg-background/90 px-4 py-2 text-sm font-medium text-amber-300 shadow-sm backdrop-blur">
          {designAreaDrawingMode === "rectangle"
            ? "Drag a rectangular no-mesh area."
            : "Click DXF vertices to trace a no-mesh area, then finish."}
        </div>
      ) : null}
    </div>
  );
}
