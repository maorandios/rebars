"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FileStack, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useReinforcement } from "@/context/reinforcement-context";
import { parseDxfToSlabGeometry } from "@/lib/dxf-parser";
import { saveSlabGeometryProject } from "@/lib/project-storage";

export default function DashboardPage() {
  const router = useRouter();
  const { importSlabGeometry } = useReinforcement();
  const [status, setStatus] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  async function handleDxfUpload(file: File | undefined) {
    if (!file || isParsing) {
      return;
    }

    setIsParsing(true);
    setStatus(`Parsing ${file.name}...`);

    try {
      const fileText = await file.text();
      const parsed = parseDxfToSlabGeometry(fileText, file.name);

      importSlabGeometry(parsed.slabGeometry);
      await saveSlabGeometryProject(parsed.slabGeometry);
      setStatus("DXF loaded. Opening workspace...");
      router.push("/workspace");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to parse DXF file."
      );
    } finally {
      setIsParsing(false);
    }
  }

  return (
    <main className="min-h-screen engineering-grid">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 max-w-3xl text-center">
          <div className="mx-auto mb-5 inline-flex rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-sm text-primary shadow-sm">
            Start Project
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Upload a DXF reference to start
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            The DXF stays as the background reference. In the workspace you will
            define the working slab, add openings, and apply base mesh layers.
          </p>
        </div>

        <Card className="w-full max-w-2xl border-primary/15 bg-card/90 shadow-2xl shadow-black/30 backdrop-blur">
          <CardHeader>
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileStack className="h-6 w-6" />
            </div>
            <CardTitle>DXF Reference</CardTitle>
            <CardDescription>
              Upload the architectural or structural drawing you want to trace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/25 bg-background/70 p-8 text-center transition hover:border-primary hover:bg-primary/5">
              {isParsing ? (
                <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
              ) : (
                <Upload className="mb-4 h-8 w-8 text-primary" />
              )}
              <span className="text-lg font-semibold text-foreground">
                {isParsing ? "Parsing DXF..." : "Choose DXF file"}
              </span>
              <span className="mt-2 text-sm leading-6 text-muted-foreground">
                This is the only way to enter the workspace.
              </span>
              <Input
                accept=".dxf"
                className="hidden"
                disabled={isParsing}
                type="file"
                onChange={(event) => {
                  void handleDxfUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>

            {status ? (
              <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4 text-sm leading-6 text-foreground">
                {status}
              </div>
            ) : null}

            <Button className="w-full justify-between" disabled type="button">
              Workspace opens after DXF upload
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
