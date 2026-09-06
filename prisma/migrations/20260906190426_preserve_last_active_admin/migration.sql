-- Protect every writer (including imports) from removing the last active ADMIN.
CREATE OR REPLACE FUNCTION public.protect_last_active_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD."status"::text <> 'ACTIVE' OR OLD."deletedAt" IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public."Role" WHERE id = OLD."roleId" AND name = 'ADMIN') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."status"::text = 'ACTIVE' AND NEW."deletedAt" IS NULL
       AND EXISTS (SELECT 1 FROM public."Role" WHERE id = NEW."roleId" AND name = 'ADMIN') THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Same transaction lock as application-level validation. Recheck after waiting.
  PERFORM pg_advisory_xact_lock(732104, 1);
  IF NOT EXISTS (
    SELECT 1 FROM public."User" u JOIN public."Role" r ON r.id = u."roleId"
    WHERE u.id <> OLD.id AND u.status::text = 'ACTIVE' AND u."deletedAt" IS NULL AND r.name = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'O sistema deve manter pelo menos um administrador ativo.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;

CREATE TRIGGER preserve_last_active_admin
BEFORE UPDATE OF "status", "roleId", "deletedAt" OR DELETE ON public."User"
FOR EACH ROW EXECUTE FUNCTION public.protect_last_active_admin();
REVOKE ALL ON FUNCTION public.protect_last_active_admin() FROM PUBLIC;
