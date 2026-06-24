import type {
  BaseMeshSettings,
  DwgUnderlay,
  MeshZone,
  Polygon,
  SlabGeometry,
  StructuralElement
} from "@/types/structure";

function rectangle(x: number, y: number, width: number, height: number): Polygon {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
}

function coreWalls(
  idPrefix: string,
  label: string,
  opening: { x: number; y: number; width: number; height: number },
  thickness: number
): StructuralElement[] {
  return [
    {
      id: `${idPrefix}-W`,
      label: `${label} West Shear Wall`,
      type: "core_wall",
      polygon: rectangle(opening.x - thickness, opening.y, thickness, opening.height)
    },
    {
      id: `${idPrefix}-E`,
      label: `${label} East Shear Wall`,
      type: "core_wall",
      polygon: rectangle(opening.x + opening.width, opening.y, thickness, opening.height)
    },
    {
      id: `${idPrefix}-N`,
      label: `${label} North Shear Wall`,
      type: "core_wall",
      polygon: rectangle(
        opening.x - thickness,
        opening.y - thickness,
        opening.width + thickness * 2,
        thickness
      )
    },
    {
      id: `${idPrefix}-S`,
      label: `${label} South Shear Wall`,
      type: "core_wall",
      polygon: rectangle(
        opening.x - thickness,
        opening.y + opening.height,
        opening.width + thickness * 2,
        thickness
      )
    }
  ];
}

const elevatorOpening = {
  x: 11_800,
  y: 5_600,
  width: 3_200,
  height: 4_200
};

const stairOpening = {
  x: 17_200,
  y: 5_800,
  width: 4_400,
  height: 4_800
};

const perimeterWallThickness = 400;

const perimeterWalls: StructuralElement[] = [
  {
    id: "PW-SOUTH",
    label: "South Perimeter Wall",
    type: "perimeter_wall",
    polygon: rectangle(0, 0, 30_000, perimeterWallThickness)
  },
  {
    id: "PW-EAST",
    label: "East Perimeter Wall",
    type: "perimeter_wall",
    polygon: rectangle(
      30_000 - perimeterWallThickness,
      0,
      perimeterWallThickness,
      17_000
    )
  },
  {
    id: "PW-NORTH",
    label: "North Perimeter Wall",
    type: "perimeter_wall",
    polygon: rectangle(
      2_000,
      17_000 - perimeterWallThickness,
      28_000,
      perimeterWallThickness
    )
  },
  {
    id: "PW-WEST",
    label: "West Perimeter Wall",
    type: "perimeter_wall",
    polygon: rectangle(0, 0, perimeterWallThickness, 15_000)
  },
  {
    id: "PW-STEP-H",
    label: "Step-Back Perimeter Wall",
    type: "perimeter_wall",
    polygon: rectangle(
      0,
      15_000 - perimeterWallThickness,
      2_000,
      perimeterWallThickness
    )
  },
  {
    id: "PW-STEP-V",
    label: "Step-Back Return Wall",
    type: "perimeter_wall",
    polygon: rectangle(
      2_000,
      15_000,
      perimeterWallThickness,
      2_000
    )
  }
];

const columns: StructuralElement[] = [
  {
    id: "COL-A3",
    label: "Column A3",
    type: "column",
    polygon: rectangle(5_800, 3_900, 400, 600)
  },
  {
    id: "COL-B5",
    label: "Column B5",
    type: "column",
    polygon: rectangle(9_800, 11_300, 600, 400)
  },
  {
    id: "COL-C7",
    label: "Column C7",
    type: "column",
    polygon: rectangle(22_700, 3_900, 400, 600)
  },
  {
    id: "COL-D8",
    label: "Column D8",
    type: "column",
    polygon: rectangle(25_800, 12_300, 600, 400)
  },
  {
    id: "COL-E4",
    label: "Column E4",
    type: "column",
    polygon: rectangle(14_800, 13_200, 400, 600)
  },
  {
    id: "COL-F2",
    label: "Column F2",
    type: "column",
    polygon: rectangle(4_000, 8_200, 600, 400)
  }
];

const mockDwgUnderlay: DwgUnderlay = {
  lines: [
    {
      id: "DWG-GRID-X-01",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 0, y: 4_000 },
        { x: 30_000, y: 4_000 }
      ]
    },
    {
      id: "DWG-GRID-X-02",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 0, y: 8_500 },
        { x: 30_000, y: 8_500 }
      ]
    },
    {
      id: "DWG-GRID-X-03",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 0, y: 13_000 },
        { x: 30_000, y: 13_000 }
      ]
    },
    {
      id: "DWG-GRID-Y-01",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 5_000, y: 0 },
        { x: 5_000, y: 17_000 }
      ]
    },
    {
      id: "DWG-GRID-Y-02",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 10_000, y: 0 },
        { x: 10_000, y: 17_000 }
      ]
    },
    {
      id: "DWG-GRID-Y-03",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 15_000, y: 0 },
        { x: 15_000, y: 17_000 }
      ]
    },
    {
      id: "DWG-GRID-Y-04",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 20_000, y: 0 },
        { x: 20_000, y: 17_000 }
      ]
    },
    {
      id: "DWG-GRID-Y-05",
      layer: "A-GRID",
      color: "#b8b8b8",
      lineWeightPx: 0.8,
      points: [
        { x: 25_000, y: 0 },
        { x: 25_000, y: 17_000 }
      ]
    }
  ],
  texts: [
    {
      id: "DWG-TITLE",
      layer: "A-ANNO",
      color: "#777777",
      heightPx: 11,
      position: { x: 1_200, y: -700 },
      text: "DWG UNDERLAY - ARCHITECTURAL GRID"
    },
    {
      id: "DWG-GRID-LABEL-A",
      layer: "A-ANNO",
      color: "#777777",
      heightPx: 10,
      position: { x: 5_000, y: -300 },
      text: "A"
    },
    {
      id: "DWG-GRID-LABEL-B",
      layer: "A-ANNO",
      color: "#777777",
      heightPx: 10,
      position: { x: 10_000, y: -300 },
      text: "B"
    },
    {
      id: "DWG-GRID-LABEL-C",
      layer: "A-ANNO",
      color: "#777777",
      heightPx: 10,
      position: { x: 15_000, y: -300 },
      text: "C"
    }
  ]
};

export const mockSlabGeometry: SlabGeometry = {
  concreteCover: 30,
  boundary: [
    { x: 0, y: 0 },
    { x: 30_000, y: 0 },
    { x: 30_000, y: 17_000 },
    { x: 2_000, y: 17_000 },
    { x: 2_000, y: 15_000 },
    { x: 0, y: 15_000 }
  ],
  meshBoundary: [
    { x: 30, y: 30 },
    { x: 29_970, y: 30 },
    { x: 29_970, y: 16_970 },
    { x: 2_030, y: 16_970 },
    { x: 2_030, y: 14_970 },
    { x: 30, y: 14_970 }
  ],
  meshInteriorBoundary: [
    { x: perimeterWallThickness, y: perimeterWallThickness },
    { x: 30_000 - perimeterWallThickness, y: perimeterWallThickness },
    { x: 30_000 - perimeterWallThickness, y: 17_000 - perimeterWallThickness },
    { x: 2_000 + perimeterWallThickness, y: 17_000 - perimeterWallThickness },
    { x: 2_000 + perimeterWallThickness, y: 15_000 - perimeterWallThickness },
    { x: perimeterWallThickness, y: 15_000 - perimeterWallThickness }
  ],
  designAreas: [],
  openings: [
    {
      id: "OP-ELEV-01",
      label: "Elevator Shaft",
      wallThickness: 250,
      polygon: rectangle(
        elevatorOpening.x,
        elevatorOpening.y,
        elevatorOpening.width,
        elevatorOpening.height
      )
    },
    {
      id: "OP-STAIR-01",
      label: "Stairwell",
      wallThickness: 250,
      polygon: rectangle(
        stairOpening.x,
        stairOpening.y,
        stairOpening.width,
        stairOpening.height
      )
    }
  ],
  structuralElements: [
    ...perimeterWalls,
    ...coreWalls("CW-ELEV", "Elevator Core", elevatorOpening, 250),
    ...coreWalls("CW-STAIR", "Stair Core", stairOpening, 250),
    ...columns
  ],
  dwgUnderlay: mockDwgUnderlay
};

export const mockBaseMeshSettings: BaseMeshSettings = {
  diameter: 10,
  spacing: 200,
  sheetWidth: 2500,
  sheetLength: 6000,
  overlapX: 300,
  overlapY: 300,
  originCorner: "bottom-left",
  gridOffsetX: 0,
  gridOffsetY: 0,
  orientation: "horizontal",
  wallAnchorageDepth: 200
};

export const mockMeshZones: MeshZone[] = [
  {
    id: "ZONE-MAIN",
    name: "אזור ראשי",
    isMainZone: true,
    geometry: mockSlabGeometry.boundary,
    parameters: mockBaseMeshSettings
  }
];

export const mockStructureData = {
  metadata: {
    projectName: "Realistic 30m Structural Slab",
    standard: "IS-466",
    units: "mm"
  },
  slabGeometry: mockSlabGeometry,
  meshZones: mockMeshZones,
  activeZoneId: mockMeshZones[0].id
};
