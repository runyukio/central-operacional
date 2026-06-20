import { backfillRealtimeCycleSummaries } from "../src/lib/realtime-service";
import { prisma } from "../src/lib/prisma";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dateArg = argValue("--date");
const fromArg = argValue("--from");
const toArg = argValue("--to");

async function main() {
  const { fromCycle, toCycle } = resolveRange();
  const result = await backfillRealtimeCycleSummaries({ fromCycle, toCycle, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

function resolveRange() {
  if (dateArg) {
    return {
      fromCycle: `${dateArg} 00:00`,
      toCycle: `${addDays(dateArg, 1)} 00:00`
    };
  }

  if (!fromArg || !toArg) {
    throw new Error("Use --date YYYY-MM-DD ou informe --from \"YYYY-MM-DD HH:mm\" e --to \"YYYY-MM-DD HH:mm\".");
  }

  return { fromCycle: normalizeCycleBoundary(fromArg), toCycle: normalizeCycleBoundary(toArg) };
}

function argValue(name: string) {
  const exact = args.findIndex((arg) => arg === name);
  if (exact >= 0) return args[exact + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function normalizeCycleBoundary(value: string) {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed} 00:00` : trimmed;
}

function addDays(date: string, days: number) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("--date deve estar no formato YYYY-MM-DD.");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
