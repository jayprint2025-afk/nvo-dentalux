BEGIN;
CREATE TABLE IF NOT EXISTS public.hana_whatsapp_cron_runs (
 tenant_id UUID NOT NULL REFERENCES public.tenants(id),branch_key TEXT NOT NULL,send_date DATE NOT NULL,
 status TEXT NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,
 sent INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,branch_key,send_date)
);
ALTER TABLE public.hana_whatsapp_cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hana_whatsapp_cron_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_tenant ON public.hana_whatsapp_cron_runs;
CREATE POLICY cron_tenant ON public.hana_whatsapp_cron_runs USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
