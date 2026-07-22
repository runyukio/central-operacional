import assert from "node:assert/strict";
import test from "node:test";

import { isQualityJobTitle } from "@/lib/job-title-normalization";

test("identifica cargos de Qualidade sem depender de acentos ou caixa", () => {
  for (const roleTitle of ["Qualidade", "QUALIDADE", "Quality Analyst", "Analista de Qualidade", "QA"]) {
    assert.equal(isQualityJobTitle(roleTitle), true, roleTitle);
  }
});

test("não classifica outros cargos como Qualidade", () => {
  for (const roleTitle of ["Agente", "Supervisor", "RTA", "POC", "WFM", "Trainer"]) {
    assert.equal(isQualityJobTitle(roleTitle), false, roleTitle);
  }
});
