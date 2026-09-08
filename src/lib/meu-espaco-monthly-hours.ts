import { calculateProductiveDifferenceMinutes, isProductiveDifferenceWithinTolerance, plannedProductiveHoursForSchedule } from "@/lib/work-hours-rules";
import type { SpaceMonthlyHoursRow, SpacePeriod } from "@/lib/meu-espaco-contract";
import { spaceShiftInProgress } from "@/lib/meu-espaco-hours";
type Schedule = { date: Date; status: string; startsAt: string | null; endsAt: string | null; shift?: { name: string } | null };
type Record = { id: string; date: Date; actualHours: number; adjustedHours: number | null; effectiveHours: number; differenceMinutes: number | null; status: string;
  schedule: (Omit<Schedule, "date"> & { deletedAt?: Date | null }) | null };
export function summarizePartnerMonth(partner: {id:string; fullName:string; wbLogin:string; lob:{name:string}}, period: SpacePeriod, today: string, records: Record[], schedules: Schedule[], captured: Map<string, number>, minuteOfDay = 0): SpaceMonthlyHoursRow {
  const row: SpaceMonthlyHoursRow = { id:partner.id,employeeId:partner.id,employeeName:partner.fullName,wbLogin:partner.wbLogin,lob:partner.lob.name,month:period.startDate.slice(0,7),
    plannedHours:0,actualHours:0,capturedHours:0,effectiveHours:0,adjustedHours:0,differenceMinutes:0,status:"Sem dados",realizedRecords:0,futureHours:0,inProgressHours:0,projectedHours:null,missingPastSlots:0 };
  const days = new Map<string, number>(); let divergent=0, pending=0, noSchedule=0, futureSlots=0;
  for (const r of records) {
    const day=r.date.toISOString().slice(0,10);
    if(day<period.startDate||day>period.endDate||day>today) continue;
    row.realizedRecords++; days.set(day, (days.get(day) ?? 0) + r.effectiveHours); row.actualHours+=r.actualHours;row.adjustedHours+=r.adjustedHours??0;
    row.effectiveHours+=r.effectiveHours;row.capturedHours+=captured.get(r.id)??0;
    const planned=r.schedule?.deletedAt ? null : plannedProductiveHoursForSchedule(r.schedule);
    const diff=planned===null?r.differenceMinutes??0:calculateProductiveDifferenceMinutes(r.effectiveHours,planned);
    row.differenceMinutes+=diff;
    if(planned===null) noSchedule++;
    else if(!isProductiveDifferenceWithinTolerance(diff)) divergent++;
    if(r.status==="ADJUSTMENT_REQUESTED") pending++;
  }
  for(const schedule of schedules){
    const day=schedule.date.toISOString().slice(0,10);
    if(day<period.startDate||day>period.endDate)continue;
    const hours=plannedProductiveHoursForSchedule(schedule); if(hours===null)continue;
    row.plannedHours+=hours;
    if(day>today){row.futureHours+=hours;futureSlots++;}
    else if(spaceShiftInProgress(schedule,today,minuteOfDay))row.inProgressHours+=Math.max(0,hours-(days.get(day)??0));
    else if(day<today&&!days.has(day))row.missingPastSlots++;
  }
  row.projectedHours=row.realizedRecords||futureSlots||row.inProgressHours>0?row.effectiveHours+row.futureHours+row.inProgressHours:null;
  row.status=pending?`${pending} ajustes pendentes`:row.missingPastSlots?`${row.missingPastSlots} dias sem horas`:noSchedule?`${noSchedule} registros sem escala válida`:divergent?`${divergent} dias com divergência`:row.realizedRecords?"Sem divergência nas horas registradas":row.inProgressHours>0?"Turno em andamento":futureSlots?"Somente projeção":"Sem dados";
  return row;
}
