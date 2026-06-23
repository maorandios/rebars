import DxfParser from "dxf-parser";
import concaveman from "concaveman";
import ArrayList from "jsts/java/util/ArrayList.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import type {
  IArcEntity,
  ICircleEntity,
  IDxf,
  IEntity,
  ILineEntity,
  ILwpolylineEntity,
  IMtextEntity,
  IPoint,
  IPolylineEntity,
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

export type ParsedDxfGeometry = {
  dxf: IDxf;
  fileName: string;
  slabGeometry: SlabGeometry;
};

const slabLayerPattern =
  /(S[-_ ]*)?(SLAB|CONCRETE|BOUNDARY|OUTLINE|FLOOR|FLOR|WALL|BEAM|STRUC|STRUCTURAL|CONSTR|BAM)/i;
const openingLayerPattern = /(OPEN|OPENING|SHAFT|VOID|HOLE|ELEV|ELEVATOR|STAIR)/i;
const defaultHiddenLayerPattern = /(TEXT|DIM|ANNO|GRID|AXIS)/i;
const slabSourceLayerPattern =
  /(A[-_ ]?FLOR|FLOOR|SLAB|CONCRETE|S[-_ ]?SLAB|S[-_ ]?FLOOR)/i;
const slabRejectLayerPattern =
  /(IDEN|TEXT|DIM|ANNO|GRID|AXIS|WALL|DETAIL|DETL|SYMB|SYMBOL|HATCH|FURN|DOOR|WINDOW)/i;
const duplicatePointTolerance = 5;
const syntheticClosedNodesLayer = "AUTO-CLOSED-NODES";
const syntheticFinalSlabLayer = "SLAB";
const arcSegmentLength = 750;

function entityId(entity: IEntity, fallback: number) {
  return String(entity.handle ?? `${entity.type}-${fallback}`);
}

function toPoint(point: IPoint): { x: number; y: number } {
  return {
    x: point.x,
    y: point.y
  };
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

  return normalizeAngle(rotation);
}

function textContent(text: string) {
  return text
    .replace(/\\[fF].*?;/g, "")
    .replace(/\\P/g, "\n")
    .replace(/[{}\\]/g, "");
}

function isSlabSourceLayer(layer: string) {
  return slabSourceLayerPattern.test(layer) && !slabRejectLayerPattern.test(layer);
}

function entityToUnderlay(
  entity: IEntity,
  index: number
): {
  arc?: CadArcEntity;
  circle?: CadCircleEntity;
  line?: CadLineEntity;
  text?: CadTextEntity;
} {
  const layer = entity.layer || "0";
  const id = `DXF-${entityId(entity, index)}`;

  if (entity.type === "LINE") {
    const line = entity as ILineEntity;

    return {
      line: {
        id,
        layer,
        lineWeightPx: 0.8,
        points: line.vertices.map(toPoint).filter(isFinitePoint)
      }
    };
  }

  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    return {
      line: polylineToUnderlayLine(entity as ILwpolylineEntity | IPolylineEntity, index)
    };
  }

  if (entity.type === "CIRCLE") {
    const circle = entity as ICircleEntity;

    return {
      circle: {
        center: toPoint(circle.center),
        id,
        layer,
        lineWeightPx: 0.8,
        radius: circle.radius
      }
    };
  }

  if (entity.type === "ARC") {
    const arc = entity as IArcEntity;

    return {
      arc: {
        center: toPoint(arc.center),
        endAngle: normalizeAngle(arc.endAngle),
        id,
        layer,
        lineWeightPx: 0.8,
        radius: arc.radius,
        startAngle: normalizeAngle(arc.startAngle)
      }
    };
  }

  if (entity.type === "TEXT") {
    const text = entity as ITextEntity;

    return {
      text: {
        heightPx: text.textHeight ? Math.max(8, text.textHeight / 20) : 10,
        id,
        layer,
        position: toPoint(text.startPoint),
        rotation: textRotation(text.rotation),
        text: textContent(text.text)
      }
    };
  }

  if (entity.type === "MTEXT") {
    const text = entity as IMtextEntity;

    return {
      text: {
        heightPx: text.height ? Math.max(8, text.height / 20) : 10,
        id,
        layer,
        position: toPoint(text.position),
        rotation: textRotation(text.rotation),
        text: textContent(text.text)
      }
    };
  }

  return {};
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

  dxf.entities.forEach((entity, index) => {
    const converted = entityToUnderlay(entity, index);

    if (converted.line && converted.line.points.length >= 2) {
      lines.push(converted.line);
    }

    if (converted.text) {
      texts.push(converted.text);
    }

    if (converted.circle && converted.circle.radius > 0) {
      circles.push(converted.circle);
    }

    if (converted.arc && converted.arc.radius > 0) {
      arcs.push(converted.arc);
    }
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

  const layerCounts = new Map<string, number>();

  for (const entity of [...lines, ...texts, ...circles, ...arcs]) {
    layerCounts.set(entity.layer, (layerCounts.get(entity.layer) ?? 0) + 1);
  }

  return {
    arcs,
    bounds: calculateUnderlayBounds({ arcs, circles, lines, texts }),
    circles,
    closedPolylines: [
      ...candidates.map(toCadClosedPolyline),
      ...(finalSlab ? [toCadClosedPolyline(finalSlab)] : [])
    ],
    importedFileName: fileName,
    layers: [...layerCounts.entries()]
      .map(([name, entityCount]) => ({
        entityCount,
        name,
        visible: !defaultHiddenLayerPattern.test(name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    lines,
    reviewOnly: true,
    texts
  };
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
  return !defaultHiddenLayerPattern.test(layer);
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

  const startAngle = normalizeAngle(arc.startAngle);
  let endAngle = normalizeAngle(arc.endAngle);

  if (endAngle < startAngle) {
    endAngle += Math.PI * 2;
  }

  const angleLength = Math.max(0, endAngle - startAngle);
  const segmentCount = Math.max(
    8,
    Math.ceil((arc.radius * angleLength) / arcSegmentLength)
  );

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + (angleLength * index) / segmentCount;

    return {
      x: arc.center.x + Math.cos(angle) * arc.radius,
      y: arc.center.y + Math.sin(angle) * arc.radius
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
      dwgUnderlay: underlay,
      hasActiveSlabBoundary: false,
      openings: [],
      structuralElements: []
    }
  };
}
