"use client";

import { useEffect, useState } from "react";
import { apiJson, FormInput } from "./shared";

type SwapFields = { partnerEmployeeId: string; currentDayOffDate: string; desiredDayOffDate: string; acknowledgement: boolean };
type PartnerOption = { id: string; name: string; wbLogin: string; lob: string; shift: string };

export function PairedSwapFields({ value, onChange }: { value: SwapFields; onChange: (patch: Partial<SwapFields>) => void }) {
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiJson<{ data: PartnerOption[] }>("/api/requests/swap-partners")
      .then(result => { if (active) setPartners(result.data); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível consultar os parceiros."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-3 md:col-span-2">
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">Troque folgas com alguém da mesma LOB e do mesmo turno. Os dois parceiros aceitam, depois o supervisor do solicitante aprova e o WFM faz a aprovação final.</p>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-muted">Parceiro da troca</span>
        <select disabled={loading || Boolean(error)} value={value.partnerEmployeeId} onChange={event => onChange({ partnerEmployeeId: event.target.value, acknowledgement: false })} className="h-11 w-full rounded-lg border border-border bg-white px-3 outline-none">
          <option value="">{loading ? "Carregando parceiros..." : "Selecione um parceiro"}</option>
          {partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name} • {partner.wbLogin} • {partner.lob} • {partner.shift}</option>)}
        </select>
      </label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : !loading && !partners.length ? <p className="text-sm text-muted">Nenhum parceiro ativo disponível na mesma LOB e turno.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <FormInput type="date" label="Sua folga atual (você trabalhará)" value={value.currentDayOffDate} onChange={date => onChange({ currentDayOffDate: date, acknowledgement: false })} />
        <FormInput type="date" label="Folga do parceiro (você folgará)" value={value.desiredDayOffDate} onChange={date => onChange({ desiredDayOffDate: date, acknowledgement: false })} />
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-blue-100 p-3 text-sm text-blue-800">
        <input type="checkbox" checked={value.acknowledgement} onChange={event => onChange({ acknowledgement: event.target.checked })} />
        Aceito esta troca de folgas. Ela será aplicada após o aceite do outro parceiro e as aprovações do supervisor e do WFM.
      </label>
    </div>
  );
}
