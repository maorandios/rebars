"use client";

import { useEffect, useState } from "react";
import {
  type DockSection,
  type InspectorContext,
  MeshInspectorPanel,
  MeshZonesPanel
} from "@/components/structural/base-mesh-panel";
import { StructureCanvas } from "@/components/structural/structure-canvas";
import { useReinforcement } from "@/context/reinforcement-context";
import type { SlabGeometry } from "@/types/structure";

const importedProjectStorageKey = "rebars.importedSlabGeometry";

export default function WorkspacePage() {
  const { slabGeometry, importSlabGeometry } = useReinforcement();
  const [activeDock, setActiveDock] = useState<DockSection>("dxf");
  const [inspectorContext, setInspectorContext] = useState<InspectorContext>({
    type: "dxf"
  });

  useEffect(() => {
    if (slabGeometry.dwgUnderlay?.importedFileName) {
      return;
    }

    const storedProject = window.sessionStorage.getItem(importedProjectStorageKey);

    if (!storedProject) {
      return;
    }

    try {
      importSlabGeometry(JSON.parse(storedProject) as SlabGeometry);
    } catch {
      window.sessionStorage.removeItem(importedProjectStorageKey);
    }
  }, [importSlabGeometry, slabGeometry.dwgUnderlay?.importedFileName]);

  useEffect(() => {
    if (!slabGeometry.dxfUnderlays?.length) {
      return;
    }

    window.sessionStorage.setItem(
      importedProjectStorageKey,
      JSON.stringify(slabGeometry)
    );
  }, [slabGeometry]);

  const handleDockChange = (dock: DockSection) => {
    setActiveDock(dock);
    setInspectorContext(
      dock === "dxf"
        ? { type: "dxf" }
        : dock === "slab"
          ? { type: "slab" }
          : { type: "mesh" }
    );
  };

  return (
    <main
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
      suppressHydrationWarning
    >
      <div className="flex min-h-0 flex-1">
        <MeshZonesPanel
          activeDock={activeDock}
          inspectorContext={inspectorContext}
          setActiveDock={setActiveDock}
          setInspectorContext={setInspectorContext}
        />
        <section className="relative h-full min-w-0 flex-1 pb-20">
          <StructureCanvas />
        </section>
        {activeDock !== "dxf" ? (
          <MeshInspectorPanel
            activeDock={activeDock}
            inspectorContext={inspectorContext}
            setActiveDock={setActiveDock}
            setInspectorContext={setInspectorContext}
          />
        ) : null}
      </div>
      <nav className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center">
        <div className="pointer-events-auto grid grid-cols-3 overflow-hidden rounded-2xl border border-primary/20 bg-card/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {(["dxf", "slab", "mesh"] as DockSection[]).map((dock) => (
            <button
              key={dock}
              className={`min-w-28 rounded-xl px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition ${
                activeDock === dock
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              type="button"
              onClick={() => handleDockChange(dock)}
            >
              {dock}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
