INSERT INTO "RequestType" ("id", "name", "area", "slaHours", "requiresApproval")
VALUES ('reqtype_paired_day_off_swap', 'Troca Casada', 'WFM', 24, true)
ON CONFLICT ("name") DO NOTHING;
