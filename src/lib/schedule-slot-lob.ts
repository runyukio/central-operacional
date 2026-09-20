type LobReference = { id: string; name: string };

/** A saved slot owns its LOB. The registry is only a fallback for legacy slots without a LOB. */
export function resolveScheduleSlotLob(slotLobId: string | null | undefined, employeeLob: LobReference, names: ReadonlyMap<string, string>) {
  if (slotLobId) return { lobId: slotLobId, lob: names.get(slotLobId) ?? "LOB não encontrada", lobSource: "slot" as const };
  return { lobId: employeeLob.id, lob: employeeLob.name, lobSource: "cadastro" as const };
}

/** Omitted fields preserve the slot; an explicit value must resolve to exactly one registered LOB. */
export function editedScheduleSlotLobId(requested: string | undefined, savedLobId: string | null | undefined, employeeLobId: string, lobs: LobReference[]) {
  if (requested === undefined) return savedLobId ?? employeeLobId;
  const key = requested.trim().toLocaleLowerCase("pt-BR");
  const matches = key ? lobs.filter((lob) => lob.name.trim().toLocaleLowerCase("pt-BR") === key) : [];
  if (matches.length !== 1) throw new Error("Selecione uma LOB cadastrada e válida para o slot do cronograma.");
  return matches[0].id;
}
