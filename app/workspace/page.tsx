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
import {
  loadLegacySessionProject,
  loadSlabGeometryProject,
  removeSlabGeometryProject,
  saveSlabGeometryProject
} from "@/lib/project-storage";

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

    let isCancelled = false;

    async function restoreProject() {
      try {
        const storedProject =
          (await loadSlabGeometryProject()) ?? loadLegacySessionProject();

        if (!isCancelled && storedProject) {
          importSlabGeometry(storedProject);
        }
      } catch {
        await removeSlabGeometryProject();
      }
    }

    void restoreProject();

    return () => {
      isCancelled = true;
    };
  }, [importSlabGeometry, slabGeometry.dwgUnderlay?.importedFileName]);

  useEffect(() => {
    if (!slabGeometry.dxfUnderlays?.length) {
      return;
    }

    void saveSlabGeometryProject(slabGeometry).catch((error) => {
      console.warn("Project autosave failed", error);
    });
  }, [slabGeometry]);

  const handleDockChange = (dock: DockSection) => {
    setActiveDock(dock);
    setInspectorContext(
      dock === "dxf"
        ? { type: "dxf" }
        : dock === "constraints"
          ? { type: "slab" }
          : { type: "mesh" }
    );
  };

  const dockItems: { id: DockSection; label: string }[] = [
    { id: "dxf", label: "1-2 Data" },
    { id: "constraints", label: "3 Constraints" },
    { id: "analysis", label: "4-5 Heatmap" },
    { id: "reinforcement", label: "6 Reinforcement" }
  ];

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
        {activeDock === "constraints" || activeDock === "reinforcement" ? (
          <MeshInspectorPanel
            activeDock={activeDock}
            inspectorContext={inspectorContext}
            setActiveDock={setActiveDock}
            setInspectorContext={setInspectorContext}
          />
        ) : null}
      </div>
      <nav className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center">
        <div className="pointer-events-auto grid grid-cols-4 overflow-hidden rounded-2xl border border-primary/20 bg-card/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {dockItems.map((dock) => (
            <button
              key={dock.id}
              className={`min-w-28 rounded-xl px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition ${
                activeDock === dock.id
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              type="button"
              onClick={() => handleDockChange(dock.id)}
            >
              {dock.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
