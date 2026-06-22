"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useReinforcement } from "@/context/reinforcement-context";
import { polygonBounds } from "@/lib/geometry/clipping";
import { generateBaseMeshLayout } from "@/lib/geometry/mesh-sheet-layout";
import type {
  BaseMeshSettings,
  MeshSheet,
  Point,
  Polygon,
  SlabGeometry,
  SlabOpening,
  StructuralElement
} from "@/types/structure";

const canvasPadding = 120;
const initialScale = 0.08;

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
    rotation?: number;
    size?: number;
  } = {}
) {
  context.save();
  context.translate(x, y);
  context.rotate(options.rotation ?? 0);
  context.font = `${screenPx(options.size ?? 11, scale)}px Consolas, "Courier New", monospace`;
  context.fillStyle = options.color ?? "#333333";
  context.textAlign = options.align ?? "center";
  context.textBaseline = options.baseline ?? "middle";
  context.fillText(text, 0, 0);
  context.restore();
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
  drawText(context, opening.label, center.x, center.y, scale, { size: 10 });
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
  context.strokeStyle = "#666666";
  context.lineWidth = screenPx(1.5, scale);
  context.stroke();

  for (const opening of slabGeometry.openings) {
    drawOpening(context, opening, scale);
  }
}

function drawMeshSheet(
  context: CanvasRenderingContext2D,
  sheet: MeshSheet,
  scale: number
) {
  for (const visiblePolygon of sheet.visiblePolygons) {
    drawPolygonPath(context, visiblePolygon);
    context.strokeStyle = "#00ff00";
    context.lineWidth = screenPx(1, scale);
    context.stroke();
  }

  for (const diagonal of sheet.diagonalSegments) {
    context.beginPath();
    context.moveTo(diagonal.start.x, diagonal.start.y);
    context.lineTo(diagonal.end.x, diagonal.end.y);
    context.strokeStyle = "#00aa00";
    context.globalAlpha = 0.55;
    context.lineWidth = screenPx(0.7, scale);
    context.stroke();
    context.globalAlpha = 1;
  }

  const labelSegment = sheet.diagonalSegments.toSorted(
    (a, b) =>
      Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) -
      Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y)
  )[0];

  if (!labelSegment) {
    return;
  }

  drawText(
    context,
    `${sheet.length}/${sheet.width}`,
    (labelSegment.start.x + labelSegment.end.x) / 2,
    (labelSegment.start.y + labelSegment.end.y) / 2,
    scale,
    {
      color: "#008000",
      rotation: sheet.orientation === "horizontal" ? 0 : Math.PI / 2,
      size: 10
    }
  );
}

function drawMeshSheets(
  context: CanvasRenderingContext2D,
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  scale: number
) {
  const layout = generateBaseMeshLayout(slabGeometry, settings);

  for (const sheet of layout.sheets) {
    drawMeshSheet(context, sheet, scale);
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
  const markerSize = screenPx(9, scale);

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
  context.arc(origin.x, origin.y, screenPx(3, scale), 0, Math.PI * 2);
  context.fillStyle = "#0057ff";
  context.fill();
  drawText(context, "GRID 0,0", origin.x + markerSize * 2, origin.y, scale, {
    align: "left",
    color: "#0057ff",
    size: 9
  });
  context.restore();
}

export function StructureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const { slabGeometry, baseMeshSettings } = useReinforcement();

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
      const nextScale = Math.max(0.025, Math.min(0.24, fitScale));

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
    drawStructuralBackground(context, slabGeometry, scaleRef.current);
    drawMeshSheets(context, slabGeometry, baseMeshSettings, scaleRef.current);
    drawSlabGeometry(context, slabGeometry, scaleRef.current);
      drawGridOriginMarker(
        context,
        slabGeometry,
        baseMeshSettings,
        scaleRef.current
      );
  }, [baseMeshSettings, slabGeometry]);

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
        0.025,
        Math.min(0.24, scaleRef.current * (event.deltaY > 0 ? 0.9 : 1.1))
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
      container.setPointerCapture(event.pointerId);
      dragRef.current = {
        isDragging: true,
        startX: event.clientX,
        startY: event.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
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
      if (!dragRef.current.isDragging) {
        return;
      }

      container.releasePointerCapture(event.pointerId);
      dragRef.current.isDragging = false;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerUp);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [renderCanvas]);

  return (
    <div className="relative h-full min-h-[620px] overflow-hidden rounded-xl border bg-white">
      <div ref={containerRef} className="h-full w-full touch-none cursor-grab">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          height={canvasSize.height}
          width={canvasSize.width}
        />
      </div>
      <div className="pointer-events-none absolute left-4 top-4 rounded-md border bg-white/90 px-3 py-2 text-xs text-muted-foreground shadow-sm">
        Slab geometry engine | mouse wheel zoom | drag pan | sheet layout clips
        at boundary and openings
      </div>
    </div>
  );
}
