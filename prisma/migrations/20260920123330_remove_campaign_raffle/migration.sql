-- Retire only the raffle after deploying the application without its handlers.
-- Keep Billing campaigns, partner profiles and all other operational data.
-- Export the three raffle tables and their audit records before applying.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DELETE FROM "Notification"
WHERE "entity" IN ('RaffleCampaign', 'RaffleDistribution', 'RaffleTicketAssignment')
   OR "href" = '/campanha'
   OR "href" LIKE '/campanha/%'
   OR "href" LIKE '/campanha?%';

DELETE FROM "AuditLog"
WHERE "entity" IN ('RaffleCampaign', 'RaffleDistribution', 'RaffleTicketAssignment');

-- Children first; RESTRICT fails safely if an unexpected external dependency exists.
DROP TABLE "RaffleTicketAssignment" RESTRICT;
DROP TABLE "RaffleDistribution" RESTRICT;
DROP TABLE "RaffleCampaign" RESTRICT;

COMMIT;
