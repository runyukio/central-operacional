import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { join } from "node:path";
import type { Snapshot } from "./domain";
import { chartSpec, paintChart } from "./charts";
import { createWord } from "./word";

export async function renderQualityWord(snapshot: Snapshot, origin: string) {
  GlobalFonts.registerFromPath(join(process.cwd(), "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff"), "Quality Inter");
  const images = {} as Record<"CD" | "ACCOUNTS", Uint8Array>;
  for (const section of ["CD", "ACCOUNTS"] as const) {
    const canvas = createCanvas(1200, 390);
    paintChart(canvas.getContext("2d") as unknown as CanvasRenderingContext2D, 1200, 390, chartSpec(snapshot, section));
    images[section] = new Uint8Array(canvas.toBuffer("image/png"));
  }
  return createWord(snapshot, origin, images);
}
