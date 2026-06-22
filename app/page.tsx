"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Database,
  Download,
  FileStack,
  FileText,
  RotateCcw,
  Upload
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
import { Separator } from "@/components/ui/separator";
import { useReinforcement } from "@/context/reinforcement-context";

type UploadSlot = {
  id: string;
  title: string;
  description: string;
  accept: string;
  icon: typeof FileText;
};

const uploadSlots: UploadSlot[] = [
  {
    id: "forces",
    title: "CSV Forces",
    description: "Placeholder for FEM force output and design envelopes.",
    accept: ".csv",
    icon: FileText
  },
  {
    id: "mesh",
    title: "TXT Geometry Mesh",
    description: "Placeholder for node, element, and slab boundary data.",
    accept: ".txt",
    icon: Database
  },
  {
    id: "background",
    title: "DWG Architectural Background",
    description: "Placeholder for reference layout and drawing context.",
    accept: ".dwg,.dxf",
    icon: FileStack
  }
];

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [loadedFiles, setLoadedFiles] = useState<Record<string, string>>({});
  const { slabGeometry, baseMeshSettings, resetToMockData, exportConfiguration } =
    useReinforcement();

  const handleMockUpload = (slotId: string, filename: string) => {
    resetToMockData();
    setLoadedFiles((current) => ({ ...current, [slotId]: filename }));
  };

  const handleExport = (filename: string) => {
    downloadJson(filename, exportConfiguration());
  };

  return (
    <main className="min-h-screen engineering-grid">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground shadow-sm">
              Phase 1 MVP | Local mock-data workflow
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                Structural Reinforcement Automation
              </h1>
              <p className="text-lg text-muted-foreground">
                Load a mock asymmetric slab, inspect openings, and test the
                automatic base mesh clipping engine in the PixiJS CAD viewport.
              </p>
            </div>
          </div>
          <Card className="w-full lg:w-[360px]">
            <CardHeader>
              <CardTitle className="text-lg">Mock Slab Status</CardTitle>
              <CardDescription>
                The slab geometry model is loaded locally.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
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
              <Button asChild className="col-span-2 justify-between">
                <Link href="/workspace">
                  Continue with mock data
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader>
              <CardTitle>File Upload Dashboard</CardTitle>
              <CardDescription>
                Uploads are intentionally mocked for Phase 1. Choosing any file
                reloads the local slab geometry dataset.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {uploadSlots.map((slot) => {
                const Icon = slot.icon;

                return (
                  <button
                    key={slot.id}
                    type="button"
                    className="group flex min-h-[260px] flex-col justify-between rounded-xl border border-dashed bg-background/80 p-5 text-left transition hover:border-primary hover:bg-primary/5"
                    onClick={() => inputRefs.current[slot.id]?.click()}
                  >
                    <span>
                      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-6 w-6" />
                      </span>
                      <span className="block text-lg font-semibold">
                        {slot.title}
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                        {slot.description}
                      </span>
                    </span>
                    <span className="space-y-3">
                      <span className="block rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        {loadedFiles[slot.id] ?? "No file selected"}
                      </span>
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                        <Upload className="h-4 w-4" />
                        Select file
                      </span>
                    </span>
                    <Input
                      ref={(node) => {
                        inputRefs.current[slot.id] = node;
                      }}
                      aria-label={slot.title}
                      className="hidden"
                      type="file"
                      accept={slot.accept}
                      onChange={(event) => {
                        const file = event.target.files?.[0];

                        if (file) {
                          handleMockUpload(slot.id, file.name);
                        }
                      }}
                    />
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Phase 1 Controls</CardTitle>
              <CardDescription>
                Temporary controls for exercising the slab/base mesh model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Start Workspace</Label>
                <Button asChild className="w-full justify-between">
                  <Link href="/workspace">
                    Open slab mesh workspace
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  No uploads needed. This opens the PixiJS workspace using the
                  asymmetric slab and base mesh settings already loaded in
                  memory.
                </p>
              </div>

              <Separator />

              <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                Base mesh: Ø{baseMeshSettings.diameter}@
                {baseMeshSettings.spacing} | Sheet{" "}
                {baseMeshSettings.sheetWidth} x {baseMeshSettings.sheetLength}
                mm | Cover {slabGeometry.concreteCover}mm
              </div>

              <div className="space-y-3">
                <Label>Export Placeholders</Label>
                <Button
                  className="w-full justify-start gap-2"
                  variant="outline"
                  onClick={() => handleExport("slab-geometry-placeholder.json")}
                >
                  <Download className="h-4 w-4" />
                  Export Slab Geometry
                </Button>
                <Button
                  className="w-full justify-start gap-2"
                  variant="outline"
                  onClick={() => handleExport("base-mesh-placeholder.json")}
                >
                  <Download className="h-4 w-4" />
                  Download Base Mesh JSON
                </Button>
              </div>

              <Separator />

              <Button
                className="w-full justify-start gap-2"
                variant="secondary"
                onClick={() => {
                  resetToMockData();
                  setLoadedFiles({});
                }}
              >
                <RotateCcw className="h-4 w-4" />
                Reset Mock Data
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
