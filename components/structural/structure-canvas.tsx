"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useReinforcement } from "@/context/reinforcement-context";
import { polygonBounds } from "@/lib/geometry/clipping";
import { generateBaseMeshLayout } from "@/lib/geometry/mesh-sheet-layout";
import type {
  BaseMeshSettings,
  CadLineEntity,
  CadTextEntity,
  MeshSheet,
  MeshZone,
  Point,
  Polygon,
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

type ZoneDraft = {
  current: Point;
  isDragging: boolean;
  start: Point;
};

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
  context.save();
  context.translate(x, y);
  context.rotate(options.rotation ?? 0);
  context.font = `${options.height ?? cadTextHeight.label}px Consolas, "Courier New", monospace`;
  context.fillStyle = options.color ?? "#333333";
  context.textAlign = options.align ?? "center";
  context.textBaseline = options.baseline ?? "middle";
  context.fillText(text, 0, 0);
  context.restore();
}

function drawCadLine(
  context: CanvasRenderingContext2D,
  line: CadLineEntity,
  scale: number
) {
  drawPolylinePath(context, line.points);
  setDraftStroke(context, scale, {
    color: line.color ?? "#9b9b9b",
    dash: line.layer.includes("GRID") ? [8, 8] : undefined,
    widthPx: line.lineWeightPx ?? 1
  });
  context.stroke();
  resetDraftStroke(context);
}

function drawCadText(
  context: CanvasRenderingContext2D,
  text: CadTextEntity,
  scale: number
) {
  drawText(context, text.text, text.position.x, text.position.y, scale, {
    color: text.color ?? "#555555",
    height: text.heightPx ? text.heightPx * 20 : cadTextHeight.small,
    rotation: text.rotation,
  });
}

function drawOpening(
  context: CanvasRenderingContext2D,
  opening: SlabOpening,
  scale: number
) {
  const bounds = polygonBounds(opening.polygon);

  drawPolygonPath(context, opening.polygon);
  context.fillStyle = "#ffffff";
  context.fill();

  drawPolygonPath(context, opening.polygon);
  context.strokeStyle = "#000000";
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
    height: cadTextHeight.small
  });
}

function drawDwgUnderlay(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  scale: number
) {
  if (!slabGeometry.dwgUnderlay) {
    return;
  }

  context.save();
  context.globalAlpha = 0.85;

  for (const line of slabGeometry.dwgUnderlay.lines) {
    drawCadLine(context, line, scale);
  }

  for (const text of slabGeometry.dwgUnderlay.texts) {
    drawCadText(context, text, scale);
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

  context.strokeStyle = "#9a9a9a";
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
  context.fillStyle = "#d3d3d3";
  context.fill();
  drawConcreteHatch(context, element.polygon, scale);
  drawPolygonPath(context, element.polygon);
  context.strokeStyle = "#444444";
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
  drawPolygonPath(context, slabGeometry.boundary);
  setDraftStroke(context, scale, { color: "#666666", widthPx: 1.5 });
  context.stroke();
  resetDraftStroke(context);

  for (const opening of slabGeometry.openings) {
    drawOpening(context, opening, scale);
  }
}

function drawMeshSheet(
  context: CanvasRenderingContext2D,
  sheet: MeshSheet,
  scale: number,
  opacity = 1
) {
  for (const visiblePolygon of sheet.visiblePolygons) {
    drawPolygonPath(context, visiblePolygon);
    setDraftStroke(context, scale, {
      alpha: opacity,
      color: "#00ff00",
      widthPx: 1
    });
    context.stroke();
    resetDraftStroke(context);
  }

  for (const diagonal of sheet.diagonalSegments) {
    context.beginPath();
    context.moveTo(diagonal.start.x, diagonal.start.y);
    context.lineTo(diagonal.end.x, diagonal.end.y);
    setDraftStroke(context, scale, {
      alpha: 0.55 * opacity,
      color: "#00aa00",
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
    `${sheet.length}/${sheet.width}`,
    (labelSegment.start.x + labelSegment.end.x) / 2,
    (labelSegment.start.y + labelSegment.end.y) / 2,
    scale,
    {
      color: "#008000",
      height: cadTextHeight.small,
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
  for (const [index, zone] of meshZones.entries()) {
    const exclusionPolygons = meshZones
      .slice(index + 1)
      .map((nextZone) => nextZone.geometry);
    const layout = generateBaseMeshLayout(
      slabGeometry,
      zone.parameters,
      zone.geometry,
      exclusionPolygons
    );
    const opacity = zone.id === activeZoneId ? 1 : 0.45;

    for (const sheet of layout.sheets) {
      drawMeshSheet(context, sheet, scale, opacity);
    }
  }
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
  context.strokeStyle = "#0057ff";
  context.lineWidth = screenPx(1.4, scale);
  context.stroke();
  context.beginPath();
  context.arc(origin.x, origin.y, cadMarkerSize / 3, 0, Math.PI * 2);
  context.fillStyle = "#0057ff";
  context.fill();
  drawText(context, "GRID 0,0", origin.x + markerSize * 2, origin.y, scale, {
    align: "left",
    color: "#0057ff",
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
  color = "#333333"
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
  setDraftStroke(context, scale, { color: "#111111", widthPx: 1.2 });
  context.stroke();
  resetDraftStroke(context);

  drawText(context, "MESH A - רשת א'", origin.x + 450, origin.y + 450, scale, {
    align: "left",
    color: "#111111",
    height: cadTextHeight.title
  });
  drawText(
    context,
    `BASE MESH Ø${settings.diameter}@${settings.spacing}mm`,
    origin.x + 450,
    origin.y + 850,
    scale,
    { align: "left", color: "#111111", height: cadTextHeight.label }
  );

  drawPolygonPath(context, meshBox);
  setDraftStroke(context, scale, { color: "#00aa00", widthPx: 1.2 });
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
    { color: "#111111", height: cadTextHeight.label }
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
      color: "#111111",
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
    { align: "left", color: "#555555", height: cadTextHeight.small }
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
    color: "#0057ff",
    dash: [10, 6],
    widthPx: 1.5
  });
  context.stroke();
  resetDraftStroke(context);
}

export function StructureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoneDraftRef = useRef<ZoneDraft | null>(null);
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
  const [viewScale, setViewScale] = useState(initialScale);
  const [canvasSize, setCanvasSize] = useState({ height: 1, width: 1 });
  const {
    slabGeometry,
    meshZones,
    activeZoneId,
    activeMeshZone,
    isDrawingZone,
    cancelDrawingZone,
    commitDrawnMeshZone,
  } = useReinforcement();

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
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
    drawMeshSheets(
      context,
      slabGeometry,
      meshZones,
      activeZoneId,
      scaleRef.current
    );
    drawSlabGeometry(context, slabGeometry, scaleRef.current);
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
    drawZoneDraft(context, zoneDraftRef.current, scaleRef.current);
  }, [activeMeshZone.parameters, activeZoneId, meshZones, slabGeometry]);

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

      // Left click is reserved for future picking; zone selection stays sidebar-only.
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isDrawingZone && zoneDraftRef.current?.isDragging) {
        zoneDraftRef.current = {
          ...zoneDraftRef.current,
          current: eventToWorldPoint(event)
        };
        renderCanvas();
        return;
      }

      if (!dragRef.current.isDragging) {
        return;
      }

      panRef.current = {
        x: dragRef.current.panX + event.clientX - dragRef.current.startX,
        y: dragRef.current.panY + event.clientY - dragRef.current.startY
      };
      renderCanvas();
    };

    const handlePointerUp = (event: PointerEvent) => {
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
    cancelDrawingZone,
    commitDrawnMeshZone,
    isDrawingZone,
    meshZones,
    renderCanvas
  ]);

  return (
    <div className="relative h-full min-h-[620px] overflow-hidden rounded-xl border bg-white">
      <div
        ref={containerRef}
        className={`h-full w-full touch-none ${
          isDrawingZone ? "cursor-crosshair" : "cursor-default"
        }`}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          height={canvasSize.height}
          width={canvasSize.width}
        />
      </div>
      <div className="pointer-events-none absolute left-4 top-4 rounded-md border bg-white/90 px-3 py-2 text-xs text-muted-foreground shadow-sm">
        CAD viewport | mm model-space drawing | zoom camera only | DWG
        underlay + mesh layout + detail callouts
      </div>
      {isDrawingZone ? (
        <div className="pointer-events-none absolute left-1/2 top-20 max-w-md -translate-x-1/2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900 shadow-sm">
          לחץ וגרור עם העכבר כדי להגדיר את שטח הרשת החדשה
        </div>
      ) : null}
    </div>
  );
}
