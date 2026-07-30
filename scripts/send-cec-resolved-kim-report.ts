import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const {
    getCecResolvedHourlyReport,
    renderCecResolvedKimReport,
    sendCecResolvedReportToKim
  } = await import("../src/lib/realtime-cec-kim-report");
  const dateArg = process.argv.find((argument) => argument.startsWith("--date="))?.slice("--date=".length);
  const outputArg = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
  const shouldSend = process.argv.includes("--send");

  const report = await getCecResolvedHourlyReport(dateArg);
  const image = renderCecResolvedKimReport(report, {
    deliveryLabel: process.argv.includes("--test") ? "TEST · LIVE DATA" : undefined
  });

  let outputPath = "";
  if (outputArg) {
    outputPath = resolve(outputArg);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, image);
  }

  const sent = shouldSend ? await sendCecResolvedReportToKim(image, report) : null;
  console.log(JSON.stringify({
    success: true,
    realData: true,
    date: report.dateKey,
    updatedThroughHour: report.updatedThroughHour,
    totalResolved: report.totalResolved,
    activeAgents: report.activeAgents,
    imageBytes: image.length,
    outputPath,
    sent
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
