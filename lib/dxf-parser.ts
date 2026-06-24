import DxfParser from "dxf-parser";
import concaveman from "concaveman";
import ArrayList from "jsts/java/util/ArrayList.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import type {
  IAttdefEntity,
  IArcEntity,
  IBlock,
  ICircleEntity,
  IDimensionEntity,
  IDxf,
  IEllipseEntity,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILwpolylineEntity,
  IMtextEntity,
  IPoint,
  IPolylineEntity,
  ISolidEntity,
  ISplineEntity,
  ITextEntity
} from "dxf-parser";

import { pointInPolygon, polygonBounds } from "@/lib/geometry/clipping";
import { polygonArea } from "@/lib/geometry/polygon-boolean";
import type {
  CadArcEntity,
  CadClosedPolylineCandidate,
  CadCircleEntity,
  CadLineEntity,
  CadTextEntity,
  DwgUnderlay,
  Polygon,
  SlabGeometry,
  SlabOpening
} from "@/types/structure";

type ClosedPolylineCandidate = {
  id: string;
  layer: string;
  polygon: Polygon;
  signedArea: number;
};

type ChainSegment = {
  end: { x: number; y: number };
  id: string;
  layer: string;
  start: { x: number; y: number };
};

type UnderlayConversion = {
  arcs: CadArcEntity[];
  circles: CadCircleEntity[];
  lines: CadLineEntity[];
  texts: CadTextEntity[];
};

type EntityTransform = {
  layer?: string;
  rotation: number;
  scale: number;
  transformPoint: (point: { x: number; y: number }) => { x: number; y: number };
};

export type ParsedDxfGeometry = {
  dxf: IDxf;
  fileName: string;
  slabGeometry: SlabGeometry;
};

const slabLayerPattern =
  /(S[-_ ]*)?(SLAB|CONCRETE|BOUNDARY|OUTLINE|FLOOR|FLOR|WALL|BEAM|STRUC|STRUCTURAL|CONSTR|BAM)/i;
const openingLayerPattern = /(OPEN|OPENING|SHAFT|VOID|HOLE|ELEV|ELEVATOR|STAIR)/i;
const slabSourceLayerPattern =
  /(A[-_ ]?FLOR|FLOOR|SLAB|CONCRETE|S[-_ ]?SLAB|S[-_ ]?FLOOR)/i;
const slabRejectLayerPattern =
  /(IDEN|TEXT|DIM|ANNO|GRID|AXIS|WALL|DETAIL|DETL|SYMB|SYMBOL|HATCH|FURN|DOOR|WINDOW)/i;
const primaryModelBoundsRejectPattern =
  /(IDEN|TEXT|DIM|ANNO|GRID|AXIS|DETAIL|DETL|SYMB|SYMBOL|HATCH|FURN|DOOR|WINDOW)/i;
const dxfUnitToMillimeters = 10;
const duplicatePointTolerance = 5 * dxfUnitToMillimeters;
const syntheticClosedNodesLayer = "AUTO-CLOSED-NODES";
const syntheticFinalSlabLayer = "WORKING-SLAB";
const arcSegmentLength = 750;

function entityId(entity: IEntity, fallback: number) {
  return String(entity.handle ?? `${entity.type}-${fallback}`);
}

function toPoint(point: IPoint): { x: number; y: number } {
  return {
    x: point.x * dxfUnitToMillimeters,
    y: -point.y * dxfUnitToMillimeters
  };
}

function toMillimeters(value: number) {
  return value * dxfUnitToMillimeters;
}

function isFinitePoint(point: { x: number; y: number }) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (
    Math.abs(a.x - b.x) <= duplicatePointTolerance &&
    Math.abs(a.y - b.y) <= duplicatePointTolerance
  );
}

function normalizePolygon(points: { x: number; y: number }[]): Polygon {
  const polygon = points.filter(isFinitePoint);
  const first = polygon[0];
  const last = polygon[polygon.length - 1];

  if (first && last && samePoint(first, last)) {
    polygon.pop();
  }

  return polygon;
}

function polylineToPolygon(entity: ILwpolylineEntity | IPolylineEntity) {
  return normalizePolygon(entity.vertices.map(toPoint));
}

function isClosedPolyline(entity: IEntity): entity is ILwpolylineEntity | IPolylineEntity {
  if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") {
    return false;
  }

  const polyline = entity as ILwpolylineEntity | IPolylineEntity;
  const polygon = polylineToPolygon(polyline);
  const first = polyline.vertices[0];
  const last = polyline.vertices[polyline.vertices.length - 1];
  const closesByPoints = first && last && samePoint(toPoint(first), toPoint(last));

  return polygon.length >= 3 && (polyline.shape || Boolean(closesByPoints));
}

function polylineToUnderlayLine(
  entity: ILwpolylineEntity | IPolylineEntity,
  index: number
): CadLineEntity {
  const polygon = normalizePolygon(entity.vertices.map(toPoint));
  const isClosed = entity.shape || samePoint(toPoint(entity.vertices[0]), toPoint(entity.vertices.at(-1)!));
  const points = isClosed && polygon[0] ? [...polygon, polygon[0]] : polygon;

  return {
    id: `DXF-${entityId(entity, index)}`,
    layer: entity.layer || "0",
    lineWeightPx: 0.8,
    points
  };
}

function normalizeAngle(angle: number) {
  if (!Number.isFinite(angle)) {
    return 0;
  }

  return Math.abs(angle) > Math.PI * 2 ? (angle * Math.PI) / 180 : angle;
}

function textRotation(rotation: number | undefined) {
  if (!rotation) {
    return 0;
  }

  return -normalizeAngle(rotation);
}

function textRotationFromDirectionVector(vector: IPoint | undefined) {
  if (!vector || (!Number.isFinite(vector.x) && !Number.isFinite(vector.y))) {
    return 0;
  }

  return -Math.atan2(vector.y ?? 0, vector.x ?? 1);
}

function textInsertionPoint(text: ITextEntity) {
  const usesAlignmentPoint = Boolean((text.halign || text.valign) && text.endPoint);

  return toPoint(usesAlignmentPoint ? text.endPoint : text.startPoint);
}

function textHorizontalAlign(halign: number | undefined): CanvasTextAlign {
  if (halign === 1 || halign === 4) {
    return "center";
  }

  if (halign === 2) {
    return "right";
  }

  return "left";
}

function textVerticalBaseline(valign: number | undefined): CanvasTextBaseline {
  if (valign === 1) {
    return "bottom";
  }

  if (valign === 2) {
    return "middle";
  }

  if (valign === 3) {
    return "top";
  }

  return "alphabetic";
}

function mtextAnchor(attachmentPoint: number | undefined): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  const attachment = attachmentPoint ?? 1;
  const column = ((attachment - 1) % 3) + 1;
  const row = Math.floor((attachment - 1) / 3) + 1;

  return {
    align: column === 1 ? "left" : column === 2 ? "center" : "right",
    baseline: row === 1 ? "top" : row === 2 ? "middle" : "bottom"
  };
}

function formatDimensionMeasurement(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number(value)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

function textContent(text: string, dimensionMeasurement?: string) {
  const cleaned = text
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/<>/g, dimensionMeasurement ?? "<>")
    .replace(/\\[fF][^;]*;/g, "")
    .replace(/\\[aA]\d+;/g, "")
    .replace(/\\[cChHwWtTqQ][^;]*;/g, "")
    .replace(/\\S([^;]+);/g, (_, stackedText: string) =>
      stackedText.replace(/[#^]/g, "/")
    )
    .replace(/\\P/g, "\n")
    .replace(/\\[lLoOkK]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/D=\n/g, "D=")
    .replace(/Ø\n/g, "Ø")
    .trim();

  return cleaned.replace(/^(\d+(?:\.\d+)?)\n(\d+(?:\.\d+)?)$/, "$2/$1");
}

function isNearZeroRotation(rotation: number | undefined) {
  return Math.abs(rotation ?? 0) < 0.01;
}

function dimensionTextRotation(dimension: IDimensionEntity, transform: EntityTransform) {
  const rotation = textRotation(dimension.angle) + transform.rotation;

  return Math.abs(rotation) > 0.01 ? rotation : undefined;
}

function emptyConversion(): UnderlayConversion {
  return {
    arcs: [],
    circles: [],
    lines: [],
    texts: []
  };
}

function identityTransform(): EntityTransform {
  return {
    rotation: 0,
    scale: 1,
    transformPoint: (point) => point
  };
}

function transformedLayer(entity: IEntity, transform: EntityTransform) {
  const layer = entity.layer || "0";

  return layer === "0" && transform.layer ? transform.layer : layer;
}

function rawEntityPoints(entity: IEntity): { x: number; y: number }[] {
  if (entity.type === "LINE") {
    return (entity as ILineEntity).vertices.map(toPoint).filter(isFinitePoint);
  }

  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    return (entity as ILwpolylineEntity | IPolylineEntity).vertices
      .map(toPoint)
      .filter(isFinitePoint);
  }

  if (entity.type === "CIRCLE") {
    const circle = entity as ICircleEntity;

    return circle.center ? [toPoint(circle.center)] : [];
  }

  if (entity.type === "ARC") {
    return segmentizeArc(entity as IArcEntity);
  }

  if (entity.type === "TEXT") {
    const text = entity as ITextEntity;

    return text.startPoint ? [toPoint(text.startPoint)] : [];
  }

  if (entity.type === "MTEXT") {
    const text = entity as IMtextEntity;

    return text.position ? [toPoint(text.position)] : [];
  }

  if (entity.type === "SOLID" || entity.type === "3DFACE") {
    return (entity as ISolidEntity).points?.map(toPoint).filter(isFinitePoint) ?? [];
  }

  if (entity.type === "SPLINE") {
    const spline = entity as ISplineEntity;

    return (spline.fitPoints?.length ? spline.fitPoints : spline.controlPoints)
      ?.map(toPoint)
      .filter(isFinitePoint) ?? [];
  }

  if (entity.type === "ELLIPSE") {
    return segmentizeEllipse(entity as IEllipseEntity);
  }

  return [];
}

function blockUsesAbsoluteCoordinates(block: IBlock, insert: IInsertEntity) {
  const blockPoints = block.entities.flatMap(rawEntityPoints);

  if (blockPoints.length === 0 || !insert.position) {
    return false;
  }

  const blockBounds = polygonBounds(blockPoints);
  const insertPoint = toPoint(insert.position);
  const blockCenter = {
    x: (blockBounds.minX + blockBounds.maxX) / 2,
    y: (blockBounds.minY + blockBounds.maxY) / 2
  };
  const blockSize = Math.max(
    blockBounds.maxX - blockBounds.minX,
    blockBounds.maxY - blockBounds.minY,
    1
  );
  const distanceToInsert = Math.hypot(
    blockCenter.x - insertPoint.x,
    blockCenter.y - insertPoint.y
  );
  const distanceToOrigin = Math.hypot(blockCenter.x, blockCenter.y);

  return distanceToOrigin > blockSize * 20 && distanceToInsert < blockSize * 2;
}

function createAbsoluteInsertTransform(
  parent: EntityTransform,
  insert: IInsertEntity
): EntityTransform {
  return {
    layer: insert.layer || parent.layer,
    rotation: parent.rotation,
    scale: parent.scale,
    transformPoint: parent.transformPoint
  };
}

function createInsertTransform(
  parent: EntityTransform,
  insert: IInsertEntity,
  block: IBlock
): EntityTransform {
  const rotation = textRotation(insert.rotation);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const xScale = insert.xScale || 1;
  const yScale = insert.yScale || 1;
  const blockBase = block.position ? toPoint(block.position) : { x: 0, y: 0 };
  const insertPosition = insert.position ? toPoint(insert.position) : { x: 0, y: 0 };

  return {
    layer: insert.layer || parent.layer,
    rotation: parent.rotation + rotation,
    scale: parent.scale * Math.max(Math.abs(xScale), Math.abs(yScale), 1),
    transformPoint: (point) => {
      const localX = (point.x - blockBase.x) * xScale;
      const localY = (point.y - blockBase.y) * yScale;

      return parent.transformPoint({
        x: insertPosition.x + localX * cos - localY * sin,
        y: insertPosition.y + localX * sin + localY * cos
      });
    }
  };
}

function mergeConversion(target: UnderlayConversion, source: UnderlayConversion) {
  target.arcs.push(...source.arcs);
  target.circles.push(...source.circles);
  target.lines.push(...source.lines);
  target.texts.push(...source.texts);
}

function conversionPoints(conversion: UnderlayConversion) {
  return [
    ...conversion.lines.flatMap((line) => line.points),
    ...conversion.circles.map((circle) => circle.center),
    ...conversion.arcs.map((arc) => arc.center),
    ...conversion.texts.map((text) => text.position)
  ].filter(isFinitePoint);
}

function conversionDistanceToPoint(
  conversion: UnderlayConversion,
  point: { x: number; y: number }
) {
  const points = conversionPoints(conversion);

  if (points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const bounds = polygonBounds(points);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };

  return Math.hypot(center.x - point.x, center.y - point.y);
}

function expandedBounds(bounds: {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const padding = Math.max(width, height) * 0.08;

  return {
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
    minX: bounds.minX - padding,
    minY: bounds.minY - padding
  };
}

function boundsOverlap(
  a: { maxX: number; maxY: number; minX: number; minY: number },
  b: { maxX: number; maxY: number; minX: number; minY: number }
) {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY
  );
}

function conversionOverlapsBounds(
  conversion: UnderlayConversion,
  bounds: { maxX: number; maxY: number; minX: number; minY: number }
) {
  const points = conversionPoints(conversion);

  return points.length > 0 && boundsOverlap(polygonBounds(points), bounds);
}

function primaryModelBounds(dxf: IDxf) {
  const points = dxf.entities
    .filter(
      (entity) =>
        entity.type !== "INSERT" &&
        entity.type !== "DIMENSION" &&
        entity.type !== "TEXT" &&
        entity.type !== "MTEXT" &&
        entity.type !== "ATTDEF" &&
        !primaryModelBoundsRejectPattern.test(entity.layer || "0")
    )
    .flatMap(rawEntityPoints);

  return points.length > 0 ? expandedBounds(polygonBounds(points)) : undefined;
}

function modelTextHeight(
  height: number | undefined,
  transform: EntityTransform,
  fallback = 100
) {
  return Number.isFinite(height) && height && height > 0
    ? toMillimeters(height) * transform.scale
    : toMillimeters(fallback) * transform.scale;
}

function isSlabSourceLayer(layer: string) {
  return slabSourceLayerPattern.test(layer) && !slabRejectLayerPattern.test(layer);
}

function segmentizeEllipse(ellipse: IEllipseEntity) {
  if (!ellipse.center || !ellipse.majorAxisEndPoint || !Number.isFinite(ellipse.axisRatio)) {
    return [];
  }

  const center = toPoint(ellipse.center);
  const major = toPoint(ellipse.majorAxisEndPoint);
  const majorRadius = Math.hypot(major.x, major.y);
  const minorRadius = majorRadius * Math.abs(ellipse.axisRatio || 1);
  const axisRotation = Math.atan2(major.y, major.x);
  const startAngle = normalizeAngle(ellipse.startAngle ?? 0);
  let endAngle = normalizeAngle(ellipse.endAngle ?? Math.PI * 2);

  if (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }

  const segmentCount = Math.max(24, Math.ceil((majorRadius * (endAngle - startAngle)) / arcSegmentLength));

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / segmentCount;
    const x = majorRadius * Math.cos(angle);
    const y = minorRadius * Math.sin(angle);

    return {
      x: center.x + x * Math.cos(axisRotation) - y * Math.sin(axisRotation),
      y: center.y + x * Math.sin(axisRotation) + y * Math.cos(axisRotation)
    };
  });
}

function convertEntityToUnderlay(
  dxf: IDxf,
  entity: IEntity,
  index: number,
  transform: EntityTransform = identityTransform(),
  depth = 0
): UnderlayConversion {
  const converted = emptyConversion();
  const layer = transformedLayer(entity, transform);
  const id = `DXF-${entityId(entity, index)}`;

  if (entity.type === "LINE") {
    const line = entity as ILineEntity;

    converted.lines.push({
      id,
      layer,
      lineWeightPx: 0.8,
      points: line.vertices.map(toPoint).filter(isFinitePoint).map(transform.transformPoint)
    });
    return converted;
  }

  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    const line = polylineToUnderlayLine(entity as ILwpolylineEntity | IPolylineEntity, index);

    converted.lines.push({
      ...line,
      layer,
      points: line.points.map(transform.transformPoint)
    });
    return converted;
  }

  if (entity.type === "CIRCLE") {
    const circle = entity as ICircleEntity;

    converted.circles.push({
      center: transform.transformPoint(toPoint(circle.center)),
      id,
      layer,
      lineWeightPx: 0.8,
      radius: toMillimeters(circle.radius) * transform.scale
    });
    return converted;
  }

  if (entity.type === "ARC") {
    const points = segmentizeArc(entity as IArcEntity).map(transform.transformPoint);

    if (points.length >= 2) {
      converted.lines.push({
      id,
      layer,
      lineWeightPx: 0.8,
        points
      });
    }
    return converted;
  }

  if (entity.type === "TEXT") {
    const text = entity as ITextEntity;

    converted.texts.push({
      align: textHorizontalAlign(text.halign),
      baseline: textVerticalBaseline(text.valign),
      heightPx: modelTextHeight(text.textHeight, transform),
      id,
      layer,
      position: transform.transformPoint(textInsertionPoint(text)),
      rotation: textRotation(text.rotation) + transform.rotation,
      text: textContent(text.text)
    });
    return converted;
  }

  if (entity.type === "MTEXT") {
    const text = entity as IMtextEntity;
    const anchor = mtextAnchor(text.attachmentPoint);

    converted.texts.push({
      align: anchor.align,
      baseline: anchor.baseline,
      heightPx: modelTextHeight(text.height, transform),
      id,
      layer,
      position: transform.transformPoint(toPoint(text.position)),
      rotation:
        (text.rotation
          ? textRotation(text.rotation)
          : textRotationFromDirectionVector(text.directionVector)) +
        transform.rotation,
      text: textContent(text.text)
    });
    return converted;
  }

  if (entity.type === "ATTDEF") {
    const text = entity as IAttdefEntity;

    if (!text.invisible && text.text && text.startPoint) {
      converted.texts.push({
        align: textHorizontalAlign(text.horizontalJustification),
        baseline: textVerticalBaseline(text.verticalJustification),
        heightPx: modelTextHeight(text.textHeight, transform),
        id,
        layer,
        position: transform.transformPoint(toPoint(text.startPoint)),
        rotation: textRotation(text.rotation) + transform.rotation,
        text: textContent(text.text)
      });
    }
    return converted;
  }

  if (entity.type === "SOLID" || entity.type === "3DFACE") {
    const solid = entity as ISolidEntity;
    const points = solid.points?.map(toPoint).filter(isFinitePoint).map(transform.transformPoint) ?? [];

    if (points.length >= 3) {
      converted.lines.push({
        id,
        layer,
        lineWeightPx: 0.8,
        points: [...points, points[0]]
      });
    }
    return converted;
  }

  if (entity.type === "SPLINE") {
    const spline = entity as ISplineEntity;
    const points = (spline.fitPoints?.length ? spline.fitPoints : spline.controlPoints)
      ?.map(toPoint)
      .filter(isFinitePoint)
      .map(transform.transformPoint) ?? [];

    if (points.length >= 2) {
      converted.lines.push({
        id,
        layer,
        lineWeightPx: 0.8,
        points: spline.closed && points[0] ? [...points, points[0]] : points
      });
    }
    return converted;
  }

  if (entity.type === "ELLIPSE") {
    const points = segmentizeEllipse(entity as IEllipseEntity).map(transform.transformPoint);

    if (points.length >= 2) {
      converted.lines.push({
        id,
        layer,
        lineWeightPx: 0.8,
        points
      });
    }
    return converted;
  }

  if (entity.type === "INSERT" && depth < 8) {
    const insert = entity as IInsertEntity;
    const block = insert.name ? dxf.blocks?.[insert.name] : undefined;

    if (block?.entities?.length) {
      const convertBlock = (nextTransform: EntityTransform) => {
        const blockConversion = emptyConversion();

        block.entities.forEach((blockEntity, blockIndex) => {
          mergeConversion(
            blockConversion,
            convertEntityToUnderlay(
              dxf,
              blockEntity,
              Number(`${index}${blockIndex}`),
              nextTransform,
              depth + 1
            )
          );
        });

        return blockConversion;
      };
      const relativeConversion = convertBlock(
        createInsertTransform(transform, insert, block)
      );
      const absoluteConversion = convertBlock(
        createAbsoluteInsertTransform(transform, insert)
      );
      const insertPoint = insert.position
        ? transform.transformPoint(toPoint(insert.position))
        : undefined;

      if (!insertPoint) {
        return blockUsesAbsoluteCoordinates(block, insert)
          ? absoluteConversion
          : relativeConversion;
      }

      return conversionDistanceToPoint(absoluteConversion, insertPoint) <
        conversionDistanceToPoint(relativeConversion, insertPoint)
        ? absoluteConversion
        : relativeConversion;
    }
  }

  if (entity.type === "DIMENSION" && depth < 8) {
    const dimension = entity as IDimensionEntity;
    const dimensionMeasurement =
      formatDimensionMeasurement(dimension.actualMeasurement);
    const inheritedDimensionRotation = dimension
      ? dimensionTextRotation(dimension, transform)
      : undefined;
    const block = dimension.block ? dxf.blocks?.[dimension.block] : undefined;

    if (block?.entities?.length) {
      const nextTransform = { ...transform, layer };

      block.entities.forEach((blockEntity, blockIndex) => {
        const child = convertEntityToUnderlay(
          dxf,
          blockEntity,
          Number(`${index}${blockIndex}`),
          nextTransform,
          depth + 1
        );

        converted.arcs.push(...child.arcs);
        converted.circles.push(...child.circles);
        converted.lines.push(...child.lines);
        converted.texts.push(
          ...child.texts.map((text) => ({
            ...text,
            rotation:
              inheritedDimensionRotation !== undefined &&
              isNearZeroRotation(text.rotation)
                ? inheritedDimensionRotation
                : text.rotation,
            text: dimensionMeasurement
              ? textContent(text.text, dimensionMeasurement)
              : text.text
          }))
        );
      });

      return converted;
    }
  }

  if (entity.type === "DIMENSION") {
    const dimension = entity as IDimensionEntity;
    const text =
      dimension.text && dimension.text !== "<>"
        ? dimension.text
        : formatDimensionMeasurement(dimension.actualMeasurement);

    if (dimension.linearOrAngularPoint1 && dimension.linearOrAngularPoint2) {
      converted.lines.push({
        id: `${id}-LINE`,
        layer,
        lineWeightPx: 0.7,
        points: [
          transform.transformPoint(toPoint(dimension.linearOrAngularPoint1)),
          transform.transformPoint(toPoint(dimension.linearOrAngularPoint2))
        ]
      });
    }

    if (text && dimension.middleOfText) {
      converted.texts.push({
        align: "center",
        baseline: "middle",
        heightPx: modelTextHeight(undefined, transform),
        id: `${id}-TEXT`,
        layer,
        position: transform.transformPoint(toPoint(dimension.middleOfText)),
        rotation: dimensionTextRotation(dimension, transform),
        text: textContent(text, formatDimensionMeasurement(dimension.actualMeasurement))
      });
    }

    return converted;
  }

  return converted;
}

function createUnderlay(
  dxf: IDxf,
  fileName: string,
  candidates: ClosedPolylineCandidate[],
  finalSlab: ClosedPolylineCandidate | null,
  options: { includeGeneratedSlab?: boolean } = {}
): DwgUnderlay {
  const lines: CadLineEntity[] = [];
  const texts: CadTextEntity[] = [];
  const circles: CadCircleEntity[] = [];
  const arcs: CadArcEntity[] = [];
  const modelBounds = primaryModelBounds(dxf);

  dxf.entities.forEach((entity, index) => {
    const converted = convertEntityToUnderlay(dxf, entity, index);

    if (
      entity.type === "INSERT" &&
      modelBounds &&
      !conversionOverlapsBounds(converted, modelBounds)
    ) {
      return;
    }

    lines.push(...converted.lines.filter((line) => line.points.length >= 2));
    texts.push(...converted.texts);
    circles.push(...converted.circles.filter((circle) => circle.radius > 0));
    arcs.push(...converted.arcs.filter((arc) => arc.radius > 0));
  });

  if (options.includeGeneratedSlab) {
    lines.push(...createGeneratedClosedGeometryLines(dxf, candidates));
    lines.push(...createGeneratedSlabSourceLines(dxf));
  }
  if (options.includeGeneratedSlab && finalSlab) {
    lines.push({
      id: `${syntheticFinalSlabLayer}-BOUNDARY`,
      layer: syntheticFinalSlabLayer,
      color: "#38bdf8",
      lineWeightPx: 2,
      points: [...finalSlab.polygon, finalSlab.polygon[0]]
    });
  }

  const dxfVertices = collectDxfVertices(lines);

  const layerCounts = createDxfLayerMap(dxf);
  const sourceLayerNames = new Set([
    ...Object.keys(dxf.tables?.layer?.layers ?? {}),
    ...(dxf.entities ?? []).map((entity) => entity.layer || "0")
  ]);

  for (const entity of [...lines, ...texts, ...circles, ...arcs]) {
    if (sourceLayerNames.has(entity.layer)) {
      continue;
    }

    const currentLayer = layerCounts.get(entity.layer);

    layerCounts.set(entity.layer, {
      entityCount: (currentLayer?.entityCount ?? 0) + 1,
      visible: currentLayer?.visible ?? true
    });
  }

  return {
    arcs,
    bounds: calculateUnderlayBounds({ arcs, circles, lines, texts }),
    circles,
    closedPolylines: [
      ...candidates.map(toCadClosedPolyline),
      ...(finalSlab ? [toCadClosedPolyline(finalSlab)] : [])
    ],
    dxfVertices,
    importedFileName: fileName,
    layers: [...layerCounts.entries()]
      .map(([name, layer]) => ({
        entityCount: layer.entityCount,
        name,
        visible: layer.visible
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    lines,
    reviewOnly: true,
    texts
  };
}

function collectDxfVertices(lines: CadLineEntity[]) {
  const vertices = new Map<string, { x: number; y: number }>();
  const snapTolerance = 1;

  for (const line of lines) {
    for (const point of line.points) {
      if (!isFinitePoint(point)) {
        continue;
      }

      const key = `${Math.round(point.x / snapTolerance)}:${Math.round(
        point.y / snapTolerance
      )}`;

      if (!vertices.has(key)) {
        vertices.set(key, point);
      }
    }
  }

  return [...vertices.values()];
}

function createDxfLayerMap(dxf: IDxf) {
  const layers = new Map<string, { entityCount: number; visible: boolean }>();
  const tableLayers = dxf.tables?.layer?.layers ?? {};

  for (const [name, layer] of Object.entries(tableLayers)) {
    layers.set(name, {
      entityCount: 0,
      visible: layer.visible !== false
    });
  }

  for (const entity of dxf.entities ?? []) {
    const layerName = entity.layer || "0";
    const currentLayer = layers.get(layerName);

    layers.set(layerName, {
      entityCount: (currentLayer?.entityCount ?? 0) + 1,
      visible: currentLayer?.visible ?? true
    });
  }

  return layers;
}

function toCadClosedPolyline(
  candidate: ClosedPolylineCandidate
): CadClosedPolylineCandidate {
  return {
    area: Math.abs(candidate.signedArea),
    id: candidate.id,
    layer: candidate.layer,
    polygon: candidate.polygon
  };
}

function calculateUnderlayBounds(underlay: {
  arcs: CadArcEntity[];
  circles: CadCircleEntity[];
  lines: CadLineEntity[];
  texts: CadTextEntity[];
}) {
  const points = [
    ...underlay.lines.flatMap((line) => line.points),
    ...underlay.texts.map((text) => text.position),
    ...underlay.circles.flatMap((circle) => [
      { x: circle.center.x - circle.radius, y: circle.center.y - circle.radius },
      { x: circle.center.x + circle.radius, y: circle.center.y + circle.radius }
    ]),
    // Arc extents are approximated as the parent circle for robust first-fit.
    ...underlay.arcs.flatMap((arc) => [
      { x: arc.center.x - arc.radius, y: arc.center.y - arc.radius },
      { x: arc.center.x + arc.radius, y: arc.center.y + arc.radius }
    ])
  ].filter(isFinitePoint);

  if (points.length === 0) {
    return undefined;
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function isGeometryAssemblyLayer(layer: string) {
  return slabLayerPattern.test(layer) || openingLayerPattern.test(layer);
}

function canUseLayerForFallbackAssembly(layer: string) {
  return Boolean(layer);
}

function createSegment(
  start: { x: number; y: number },
  end: { x: number; y: number },
  layer: string,
  id: string
): ChainSegment | null {
  if (!isFinitePoint(start) || !isFinitePoint(end) || samePoint(start, end)) {
    return null;
  }

  return { end, id, layer, start };
}

function collectChainSegments(
  dxf: IDxf,
  options: { includeAllDrawableLayers?: boolean } = {}
): ChainSegment[] {
  const segments: ChainSegment[] = [];

  dxf.entities.forEach((entity, entityIndex) => {
    const layer = entity.layer || "0";

    const canUseLayer = options.includeAllDrawableLayers
      ? canUseLayerForFallbackAssembly(layer)
      : isGeometryAssemblyLayer(layer);

    if (!canUseLayer) {
      return;
    }

    if (entity.type === "LINE") {
      const line = entity as ILineEntity;
      const start = line.vertices[0] ? toPoint(line.vertices[0]) : null;
      const end = line.vertices[1] ? toPoint(line.vertices[1]) : null;
      const segment =
        start && end
          ? createSegment(start, end, layer, `CHAIN-${entityId(entity, entityIndex)}`)
          : null;

      if (segment) {
        segments.push(segment);
      }
      return;
    }

    if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") {
      return;
    }

    const polyline = entity as ILwpolylineEntity | IPolylineEntity;
    const points = normalizePolygon(polyline.vertices.map(toPoint));
    const closes =
      polyline.shape ||
      Boolean(
        polyline.vertices[0] &&
          polyline.vertices.at(-1) &&
          samePoint(toPoint(polyline.vertices[0]), toPoint(polyline.vertices.at(-1)!))
      );
    const segmentPoints = closes && points[0] ? [...points, points[0]] : points;

    for (let index = 0; index < segmentPoints.length - 1; index += 1) {
      const segment = createSegment(
        segmentPoints[index],
        segmentPoints[index + 1],
        layer,
        `CHAIN-${entityId(entity, entityIndex)}-${index}`
      );

      if (segment) {
        segments.push(segment);
      }
    }
  });

  return segments;
}

function buildClosedLoopsForLayer(
  layer: string,
  segments: ChainSegment[]
): ClosedPolylineCandidate[] {
  const loops: ClosedPolylineCandidate[] = [];

  if (segments.length < 3) {
    return loops;
  }

  const nodes: { edges: number[]; point: { x: number; y: number } }[] = [];
  const graphSegments = segments.map((segment) => {
    const startNode = findOrCreateSnappedNode(nodes, segment.start);
    const endNode = findOrCreateSnappedNode(nodes, segment.end);

    return { ...segment, endNode, startNode };
  });

  graphSegments.forEach((segment, index) => {
    nodes[segment.startNode].edges.push(index);
    nodes[segment.endNode].edges.push(index);
  });

  for (const component of connectedSegmentComponents(graphSegments, nodes)) {
    const componentNodeEdgeCounts = new Map<number, number>();

    for (const edgeIndex of component) {
      const segment = graphSegments[edgeIndex];

      componentNodeEdgeCounts.set(
        segment.startNode,
        (componentNodeEdgeCounts.get(segment.startNode) ?? 0) + 1
      );
      componentNodeEdgeCounts.set(
        segment.endNode,
        (componentNodeEdgeCounts.get(segment.endNode) ?? 0) + 1
      );
    }

    const isSimpleClosedLoop = [...componentNodeEdgeCounts.values()].every(
      (edgeCount) => edgeCount === 2
    );

    if (!isSimpleClosedLoop) {
      continue;
    }

    const polygon = orderSimpleLoop(component, graphSegments, nodes);

    if (!polygon) {
      continue;
    }

    const signedArea = polygonArea(polygon);

    if (polygon.length >= 3 && Math.abs(signedArea) > 10) {
      loops.push({
        id: `DXF-CHAIN-${layer}-${loops.length + 1}`,
        layer,
        polygon,
        signedArea
      });
    }
  }

  return loops;
}

function findOrCreateSnappedNode(
  nodes: { edges: number[]; point: { x: number; y: number } }[],
  point: { x: number; y: number }
) {
  const existingIndex = nodes.findIndex((node) => samePoint(node.point, point));

  if (existingIndex >= 0) {
    return existingIndex;
  }

  nodes.push({ edges: [], point });
  return nodes.length - 1;
}

function connectedSegmentComponents(
  segments: (ChainSegment & { endNode: number; startNode: number })[],
  nodes: { edges: number[]; point: { x: number; y: number } }[]
) {
  const components: number[][] = [];
  const seen = new Set<number>();

  for (let index = 0; index < segments.length; index += 1) {
    if (seen.has(index)) {
      continue;
    }

    const component: number[] = [];
    const stack = [index];
    seen.add(index);

    while (stack.length > 0) {
      const edgeIndex = stack.pop()!;
      const segment = segments[edgeIndex];

      component.push(edgeIndex);

      for (const nodeIndex of [segment.startNode, segment.endNode]) {
        for (const adjacentEdge of nodes[nodeIndex].edges) {
          if (!seen.has(adjacentEdge)) {
            seen.add(adjacentEdge);
            stack.push(adjacentEdge);
          }
        }
      }
    }

    components.push(component);
  }

  return components;
}

function orderSimpleLoop(
  component: number[],
  segments: (ChainSegment & { endNode: number; startNode: number })[],
  nodes: { edges: number[]; point: { x: number; y: number } }[]
) {
  const componentEdges = new Set(component);
  const startEdgeIndex = component[0];
  const startEdge = segments[startEdgeIndex];
  const startNode = startEdge.startNode;
  let currentNode = startEdge.endNode;
  let previousEdgeIndex = startEdgeIndex;
  const polygon = [nodes[startNode].point, nodes[currentNode].point];

  for (let guard = 0; guard <= component.length; guard += 1) {
    if (currentNode === startNode) {
      return normalizePolygon(polygon);
    }

    const nextEdgeIndex = nodes[currentNode].edges.find(
      (edgeIndex) => componentEdges.has(edgeIndex) && edgeIndex !== previousEdgeIndex
    );

    if (nextEdgeIndex === undefined) {
      return null;
    }

    const nextEdge = segments[nextEdgeIndex];
    const nextNode =
      nextEdge.startNode === currentNode ? nextEdge.endNode : nextEdge.startNode;

    previousEdgeIndex = nextEdgeIndex;
    currentNode = nextNode;
    polygon.push(nodes[currentNode].point);
  }

  return null;
}

function createLineChainCandidates(
  dxf: IDxf,
  options: { includeAllDrawableLayers?: boolean } = {}
): ClosedPolylineCandidate[] {
  const segmentsByLayer = new Map<string, ChainSegment[]>();

  for (const segment of collectChainSegments(dxf, options)) {
    segmentsByLayer.set(segment.layer, [
      ...(segmentsByLayer.get(segment.layer) ?? []),
      segment
    ]);
  }

  return [...segmentsByLayer.entries()].flatMap(([layer, segments]) =>
    buildClosedLoopsForLayer(layer, segments)
  );
}

function collectCloseNodeSegments(dxf: IDxf) {
  const segments = collectChainSegments(dxf, { includeAllDrawableLayers: true });
  const nodes: { edges: number[]; point: { x: number; y: number } }[] = [];
  const graphSegments = segments.map((segment) => {
    const startNode = findOrCreateSnappedNode(nodes, segment.start);
    const endNode = findOrCreateSnappedNode(nodes, segment.end);

    return { ...segment, endNode, startNode };
  });

  graphSegments.forEach((segment, index) => {
    nodes[segment.startNode].edges.push(index);
    nodes[segment.endNode].edges.push(index);
  });

  return graphSegments.filter(
    (segment) =>
      nodes[segment.startNode].edges.length >= 2 &&
      nodes[segment.endNode].edges.length >= 2
  );
}

function createGeneratedClosedGeometryLines(
  dxf: IDxf,
  candidates: ClosedPolylineCandidate[]
): CadLineEntity[] {
  if (candidates.length > 0) {
    return candidates.map((candidate, index) => ({
      id: `${syntheticClosedNodesLayer}-LOOP-${index + 1}`,
      layer: syntheticClosedNodesLayer,
      color: "#f59e0b",
      lineWeightPx: 1.4,
      points: [...candidate.polygon, candidate.polygon[0]]
    }));
  }

  return collectCloseNodeSegments(dxf).map((segment, index) => ({
    id: `${syntheticClosedNodesLayer}-SEG-${index + 1}`,
    layer: syntheticClosedNodesLayer,
    color: "#fbbf24",
    lineWeightPx: 1.1,
    points: [segment.start, segment.end]
  }));
}

function createGeneratedSlabSourceLines(dxf: IDxf): CadLineEntity[] {
  const paths = collectAllLineworkPaths(dxf);

  return paths.map((path, index) => ({
    id: `${syntheticFinalSlabLayer}-SRC-${index + 1}`,
    layer: syntheticFinalSlabLayer,
    color: "#0ea5e9",
    lineWeightPx: 0.55,
    points: path
  }));
}

function createClosedPolylineCandidates(dxf: IDxf): ClosedPolylineCandidate[] {
  return dxf.entities
    .filter(isClosedPolyline)
    .map((entity, index) => {
      const polygon = polylineToPolygon(entity);

      return {
        id: `DXF-POLY-${entityId(entity, index)}`,
        layer: entity.layer || "0",
        polygon,
        signedArea: polygonArea(polygon)
      };
    })
    .filter((candidate) => Math.abs(candidate.signedArea) > 10);
}

function convexHull(points: { x: number; y: number }[]): Polygon {
  const uniquePoints = [...new Map(
    points
      .filter(isFinitePoint)
      .map((point) => [`${Math.round(point.x)}:${Math.round(point.y)}`, point])
  ).values()].sort((a, b) => a.x - b.x || a.y - b.y);

  if (uniquePoints.length <= 3) {
    return uniquePoints;
  }

  const cross = (
    origin: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) =>
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x);
  const lower: { x: number; y: number }[] = [];

  for (const point of uniquePoints) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }

    lower.push(point);
  }

  const upper: { x: number; y: number }[] = [];

  for (const point of uniquePoints.toReversed()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }

    upper.push(point);
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function concaveOutline(points: { x: number; y: number }[]): Polygon {
  const uniquePoints = [...new Map(
    points
      .filter(isFinitePoint)
      .map((point) => [`${Math.round(point.x)}:${Math.round(point.y)}`, point])
  ).values()];

  if (uniquePoints.length < 4) {
    return uniquePoints;
  }

  const hull = concaveman(
    uniquePoints.map((point) => [point.x, point.y]),
    1.2,
    25
  );

  return normalizePolygon(hull.map(([x, y]) => ({ x, y })));
}

function createSyntheticFallbackCandidate(
  dxf: IDxf
): ClosedPolylineCandidate | null {
  const points = collectCloseNodeSegments(dxf).flatMap((segment) => [
    segment.start,
    segment.end
  ]);
  const polygon = convexHull(points);
  const signedArea = polygonArea(polygon);

  if (polygon.length < 3 || Math.abs(signedArea) <= 10) {
    return null;
  }

  return {
    id: `${syntheticClosedNodesLayer}-HULL`,
    layer: syntheticClosedNodesLayer,
    polygon,
    signedArea
  };
}

function segmentizeArc(arc: IArcEntity) {
  if (!arc.center || !Number.isFinite(arc.radius) || arc.radius <= 0) {
    return [];
  }

  const center = toPoint(arc.center);
  const radius = toMillimeters(arc.radius);
  const startAngle = normalizeAngle(arc.startAngle);
  let endAngle = normalizeAngle(arc.endAngle);

  if (endAngle < startAngle) {
    endAngle += Math.PI * 2;
  }

  const angleLength = Math.max(0, endAngle - startAngle);
  const segmentCount = Math.max(
    8,
    Math.ceil((radius * angleLength) / arcSegmentLength)
  );

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + (angleLength * index) / segmentCount;

    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y - Math.sin(angle) * radius
    };
  });
}

function cleanLineworkPath(points: { x: number; y: number }[]) {
  return points.filter(isFinitePoint).reduce<{ x: number; y: number }[]>(
    (cleanedPoints, point) => {
      const previousPoint = cleanedPoints.at(-1);

      if (!previousPoint || !samePoint(previousPoint, point)) {
        cleanedPoints.push(point);
      }

      return cleanedPoints;
    },
    []
  );
}

function collectAllLineworkPaths(
  dxf: IDxf,
  options: { slabOnly?: boolean } = {}
): { x: number; y: number }[][] {
  const paths: { x: number; y: number }[][] = [];

  dxf.entities.forEach((entity) => {
    if (options.slabOnly && !isSlabSourceLayer(entity.layer || "0")) {
      return;
    }

    if (entity.type === "LINE") {
      const points = cleanLineworkPath(
        (entity as ILineEntity).vertices.map(toPoint)
      );

      if (points.length >= 2) {
        paths.push(points.slice(0, 2));
      }
      return;
    }

    if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      const polyline = entity as ILwpolylineEntity | IPolylineEntity;
      const points = cleanLineworkPath(polyline.vertices.map(toPoint));

      if (points.length >= 2) {
        paths.push(points);
      }
      return;
    }

    if (entity.type === "ARC") {
      const points = cleanLineworkPath(segmentizeArc(entity as IArcEntity));

      if (points.length >= 2) {
        paths.push(points);
      }
    }
  });

  return paths;
}

function coordinatesFromPoints(points: { x: number; y: number }[]) {
  return points.map((point) => new Coordinate(point.x, point.y));
}

function polygonFromJstsGeometry(geometry: {
  getExteriorRing?: () => { getCoordinates: () => { x: number; y: number }[] };
  getCoordinates?: () => { x: number; y: number }[];
}): Polygon {
  const coordinates =
    geometry.getExteriorRing?.().getCoordinates() ?? geometry.getCoordinates?.() ?? [];

  return normalizePolygon(coordinates.map((coordinate) => ({
    x: coordinate.x,
    y: coordinate.y
  })));
}

function polygonizeLineworkPaths(
  paths: { x: number; y: number }[][]
): ClosedPolylineCandidate | null {
  const geometryFactory = new GeometryFactory();
  const lineStrings = new ArrayList([]);

  for (const path of paths) {
    if (path.length < 2) {
      continue;
    }

    lineStrings.add(geometryFactory.createLineString(coordinatesFromPoints(path)));
  }

  if (lineStrings.array.length === 0) {
    return null;
  }

  try {
    const nodedLinework = UnaryUnionOp.union(lineStrings);
    const polygonizer = new Polygonizer();

    polygonizer.add(nodedLinework);

    const polygons = polygonizer.getPolygons().array
      .map((geometry: { getArea: () => number }) => geometry)
      .filter((geometry: { getArea: () => number }) => geometry.getArea() > 10);

    if (polygons.length === 0) {
      return null;
    }

    const polygonList = new ArrayList([]);

    for (const polygon of polygons) {
      polygonList.add(polygon);
    }

    const unionedPolygons = UnaryUnionOp.union(polygonList) as {
      getArea: () => number;
      getGeometryN?: (index: number) => Parameters<typeof polygonFromJstsGeometry>[0];
      getNumGeometries?: () => number;
    } & Parameters<typeof polygonFromJstsGeometry>[0];
    const geometryCount = unionedPolygons.getNumGeometries?.() ?? 1;
    const exteriorGeometry =
      geometryCount > 1
        ? Array.from({ length: geometryCount }, (_, index) =>
            unionedPolygons.getGeometryN?.(index)
          )
            .filter(
              (
                geometry
              ): geometry is Parameters<typeof polygonFromJstsGeometry>[0] & {
                getArea: () => number;
              } => Boolean(geometry)
            )
            .toSorted((a, b) => b.getArea() - a.getArea())[0]
        : unionedPolygons;

    if (!exteriorGeometry) {
      return null;
    }

    const polygon = polygonFromJstsGeometry(exteriorGeometry);
    const signedArea = polygonArea(polygon);

    if (polygon.length < 3 || Math.abs(signedArea) <= 10) {
      return null;
    }

    return {
      id: `${syntheticFinalSlabLayer}-POLYGONIZED`,
      layer: syntheticFinalSlabLayer,
      polygon,
      signedArea
    };
  } catch {
    return null;
  }
}

function createBoundaryCandidates(dxf: IDxf): ClosedPolylineCandidate[] {
  const structuralCandidates = [
    ...createClosedPolylineCandidates(dxf),
    ...createLineChainCandidates(dxf)
  ];
  const hasStructuralLoop = structuralCandidates.some((candidate) =>
    isGeometryAssemblyLayer(candidate.layer)
  );
  const candidates = hasStructuralLoop
    ? structuralCandidates
    : [
        ...structuralCandidates,
        ...createLineChainCandidates(dxf, { includeAllDrawableLayers: true })
      ];
  const syntheticCandidates = [
    ...candidates.map((candidate, index) => ({
      ...candidate,
      id: `${syntheticClosedNodesLayer}-${index + 1}`,
      layer: syntheticClosedNodesLayer
    })),
    ...(candidates.length === 0
      ? [createSyntheticFallbackCandidate(dxf)].filter(
          (candidate): candidate is ClosedPolylineCandidate => Boolean(candidate)
        )
      : [])
  ];
  const allCandidates = [...candidates, ...syntheticCandidates];
  const seen = new Set<string>();

  return allCandidates.filter((candidate) => {
    const center = polygonCenter(candidate.polygon);
    const key = [
      candidate.layer,
      Math.round(Math.abs(candidate.signedArea)),
      Math.round(center.x),
      Math.round(center.y)
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function polygonCenter(polygon: Polygon) {
  const bounds = polygonBounds(polygon);

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function chooseOpenings(
  slab: ClosedPolylineCandidate,
  candidates: ClosedPolylineCandidate[]
): SlabOpening[] {
  if (slab.layer === syntheticFinalSlabLayer) {
    return candidates
      .filter((candidate) => openingLayerPattern.test(candidate.layer))
      .filter((candidate) => {
        const center = polygonCenter(candidate.polygon);

        return pointInPolygon(center, slab.polygon);
      })
      .map((candidate, index) => ({
        id: `DXF-OPENING-${String(index + 1).padStart(2, "0")}`,
        label: candidate.layer,
        polygon: candidate.polygon
      }));
  }

  const slabArea = Math.abs(slab.signedArea);
  const internalCandidates = candidates.filter((candidate) => {
    if (candidate.id === slab.id) {
      return false;
    }

    const center = polygonCenter(candidate.polygon);

    return (
      Math.abs(candidate.signedArea) < slabArea * 0.35 &&
      pointInPolygon(center, slab.polygon)
    );
  });
  const explicitOpenings = internalCandidates.filter((candidate) =>
    openingLayerPattern.test(candidate.layer)
  );
  const selectedOpenings =
    explicitOpenings.length > 0 ? explicitOpenings : internalCandidates;

  return selectedOpenings.map((candidate, index) => ({
    id: `DXF-OPENING-${String(index + 1).padStart(2, "0")}`,
    label: openingLayerPattern.test(candidate.layer)
      ? candidate.layer
      : `Opening ${index + 1}`,
    polygon: candidate.polygon
  }));
}

function fallbackBoundaryFromUnderlay(underlay: DwgUnderlay): Polygon {
  const bounds = underlay.bounds;

  if (!bounds) {
    return [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 1_000, y: 1_000 },
      { x: 0, y: 1_000 }
    ];
  }

  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

function chooseOpeningsFromClosedPolylines(
  slab: CadClosedPolylineCandidate,
  candidates: CadClosedPolylineCandidate[]
): SlabOpening[] {
  const internalCandidates = candidates.filter((candidate) => {
    if (candidate.id === slab.id) {
      return false;
    }

    const center = polygonCenter(candidate.polygon);

    return (
      candidate.area < slab.area * 0.35 && pointInPolygon(center, slab.polygon)
    );
  });
  const explicitOpenings = internalCandidates.filter((candidate) =>
    openingLayerPattern.test(candidate.layer)
  );
  const selectedOpenings =
    explicitOpenings.length > 0 ? explicitOpenings : internalCandidates;

  return selectedOpenings.map((candidate, index) => ({
    id: `DXF-OPENING-${String(index + 1).padStart(2, "0")}`,
    label: openingLayerPattern.test(candidate.layer)
      ? candidate.layer
      : `Opening ${index + 1}`,
    polygon: candidate.polygon
  }));
}

export function slabGeometryFromBoundaryLayer(
  current: SlabGeometry,
  layerName: string
): SlabGeometry | null {
  const candidates = current.dwgUnderlay?.closedPolylines ?? [];
  const selected = candidates
    .filter((candidate) => candidate.layer === layerName)
    .toSorted((a, b) => b.area - a.area)[0];

  if (!selected) {
    return null;
  }

  return {
    ...current,
    boundary: selected.polygon,
    designAreas: current.designAreas ?? [],
    hasActiveSlabBoundary: true,
    meshBoundary: undefined,
    meshInteriorBoundary: undefined,
    openings: chooseOpeningsFromClosedPolylines(selected, candidates),
    structuralElements: []
  };
}

function generatedSlabLinesFromPaths(paths: { x: number; y: number }[][]) {
  return paths.map((path, index) => ({
    id: `${syntheticFinalSlabLayer}-ACTIVE-${index + 1}`,
    layer: syntheticFinalSlabLayer,
    color: "#0ea5e9",
    lineWeightPx: 0.75,
    points: path
  }));
}

export function slabGeometryFromVisibleUnderlayLayers(
  current: SlabGeometry
): SlabGeometry | null {
  const underlay = current.dwgUnderlay;

  if (!underlay?.layers) {
    return null;
  }

  const visibleLayers = new Set(
    underlay.layers
      .filter((layer) => layer.visible)
      .map((layer) => layer.name)
      .filter(
        (layerName) =>
          layerName !== syntheticFinalSlabLayer &&
          layerName !== syntheticClosedNodesLayer
      )
  );
  const sourcePaths = underlay.lines
    .filter((line) => visibleLayers.has(line.layer))
    .map((line) => cleanLineworkPath(line.points))
    .filter((path) => path.length >= 2);

  if (sourcePaths.length === 0) {
    return null;
  }

  const polygonizedBoundary = polygonizeLineworkPaths(sourcePaths);
  const fallbackPolygon = concaveOutline(sourcePaths.flat());
  const fallbackArea = polygonArea(fallbackPolygon);
  const fallbackBoundary =
    fallbackPolygon.length >= 3 && Math.abs(fallbackArea) > 10
      ? {
          id: `${syntheticFinalSlabLayer}-ACTIVE-CONCAVE`,
          layer: syntheticFinalSlabLayer,
          polygon: fallbackPolygon,
          signedArea: fallbackArea
        }
      : null;
  const finalSlab = polygonizedBoundary ?? fallbackBoundary;

  if (!finalSlab) {
    return null;
  }

  const generatedLines = generatedSlabLinesFromPaths(sourcePaths);
  const retainedLines = underlay.lines.filter(
    (line) => line.layer !== syntheticFinalSlabLayer
  );
  const layerCounts = new Map<string, number>();

  for (const entity of [
    ...retainedLines,
    ...generatedLines,
    ...(underlay.texts ?? []),
    ...(underlay.circles ?? []),
    ...(underlay.arcs ?? [])
  ]) {
    layerCounts.set(entity.layer, (layerCounts.get(entity.layer) ?? 0) + 1);
  }

  return {
    ...current,
    boundary: finalSlab.polygon,
    dwgUnderlay: {
      ...underlay,
      closedPolylines: [
        ...(underlay.closedPolylines ?? []).filter(
          (candidate) => candidate.layer !== syntheticFinalSlabLayer
        ),
        toCadClosedPolyline(finalSlab)
      ],
      layers: [...layerCounts.entries()]
        .map(([name, entityCount]) => ({
          entityCount,
          name,
          visible: name === syntheticFinalSlabLayer
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lines: [...retainedLines, ...generatedLines],
      reviewOnly: true
    },
    designAreas: current.designAreas ?? [],
    hasActiveSlabBoundary: true,
    meshBoundary: undefined,
    meshInteriorBoundary: undefined,
    openings: chooseOpenings(finalSlab, []),
    structuralElements: []
  };
}

export function parseDxfToSlabGeometry(
  fileText: string,
  fileName: string
): ParsedDxfGeometry {
  const parser = new DxfParser();
  const dxf = parser.parseSync(fileText);

  if (!dxf) {
    throw new Error("DXF parser returned an empty document.");
  }

  const candidates = createBoundaryCandidates(dxf);
  const underlay = createUnderlay(dxf, fileName, candidates, null);

  return {
    dxf,
    fileName,
    slabGeometry: {
      boundary: fallbackBoundaryFromUnderlay(underlay),
      concreteCover: 30,
      designAreas: [],
      dwgUnderlay: underlay,
      hasActiveSlabBoundary: false,
      openings: [],
      structuralElements: []
    }
  };
}
