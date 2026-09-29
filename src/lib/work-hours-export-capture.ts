import type { RealtimeHoursShiftActivityRequest } from "./realtime-hours-service";

// A work-hour page is small, but its underlying heartbeat history is not.
// Never query the cross product of hundreds of people and an entire month.
export const workHourExportCaptureBatchSize = 20;

export async function loadWorkHourExportCapture(
  requests: RealtimeHoursShiftActivityRequest[],
  load: (requests: RealtimeHoursShiftActivityRequest[]) => Promise<Map<string, number>>
) {
  const byDate = new Map<string, RealtimeHoursShiftActivityRequest[]>();
  for (const request of requests) {
    const date = request.shiftDate.toISOString().slice(0, 10);
    const group = byDate.get(date) ?? [];
    group.push(request);
    byDate.set(date, group);
  }
  const result = new Map<string, number>();
  for (const group of byDate.values()) {
    for (let offset = 0; offset < group.length; offset += workHourExportCaptureBatchSize) {
      // Deliberately sequential: parallel raw capture queries multiply peak memory.
      const hours = await load(group.slice(offset, offset + workHourExportCaptureBatchSize));
      for (const [key, value] of hours) result.set(key, value);
    }
  }
  return result;
}
