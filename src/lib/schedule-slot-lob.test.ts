import assert from "node:assert/strict";
import test from "node:test";
import { editedScheduleSlotLobId, resolveScheduleSlotLob } from "./schedule-slot-lob";

const lobs = [{ id: "ads", name: "ADS" }, { id: "cec", name: "CEC" }];
const names = new Map(lobs.map((lob) => [lob.id, lob.name]));

test("stored slot LOB takes precedence in either direction after a registry transfer", () => {
  assert.deepEqual(resolveScheduleSlotLob("ads", lobs[1], names), { lobId: "ads", lob: "ADS", lobSource: "slot" });
  assert.deepEqual(resolveScheduleSlotLob("cec", lobs[0], names), { lobId: "cec", lob: "CEC", lobSource: "slot" });
});
test("only legacy slots without a LOB fall back to the registry", () => {
  assert.deepEqual(resolveScheduleSlotLob(null, lobs[1], names), { lobId: "cec", lob: "CEC", lobSource: "cadastro" });
  assert.equal(resolveScheduleSlotLob("deleted-lob", lobs[0], names).lob, "LOB não encontrada");
});
test("saving another field preserves the slot and new slots use the registry default", () => {
  assert.equal(editedScheduleSlotLobId(undefined, "ads", "cec", []), "ads");
  assert.equal(editedScheduleSlotLobId(undefined, undefined, "cec", []), "cec");
});
test("explicit edits resolve the chosen LOB ID instead of silently using the registry", () => {
  assert.equal(editedScheduleSlotLobId(" cEc ", "ads", "ads", lobs), "cec");
  assert.equal(editedScheduleSlotLobId("ADS", "ads", "cec", lobs), "ads");
});
test("empty, unknown and ambiguous LOB names cannot change a slot", () => {
  for (const value of ["", "  ", "Todos", "Unknown"]) assert.throws(() => editedScheduleSlotLobId(value, "ads", "cec", lobs), /LOB cadastrada/);
  assert.throws(() => editedScheduleSlotLobId("ADS", "ads", "cec", [...lobs, { id: "other", name: "ads" }]), /LOB cadastrada/);
});
