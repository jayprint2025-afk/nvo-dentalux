BEGIN;
CREATE TABLE IF NOT EXISTS public.hana_usage_plans (
 tenant_id UUID NOT NULL REFERENCES public.tenants(id), period TEXT NOT NULL,
 included_mxn NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(included_mxn>=0),
 monthly_rent_mxn NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(monthly_rent_mxn>=0),
 markup_pct NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK(markup_pct BETWEEN 0 AND 500),
 usd_mxn NUMERIC(18,6) CHECK(usd_mxn>0),
 rates JSONB NOT NULL DEFAULT '{}'::jsonb,
 configured BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,period)
);
CREATE TABLE IF NOT EXISTS public.hana_usage_events (
 id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES public.tenants(id),
 event_key TEXT NOT NULL, period TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 provider TEXT NOT NULL, channel TEXT NOT NULL, source TEXT NOT NULL,
 model TEXT, status TEXT NOT NULL, counters JSONB NOT NULL DEFAULT '{}'::jsonb,
 cost_usd NUMERIC(24,12), cost_mxn NUMERIC(24,12),
 rating JSONB NOT NULL DEFAULT '{}'::jsonb,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(tenant_id,event_key)
);
CREATE INDEX IF NOT EXISTS hana_usage_month ON public.hana_usage_events(tenant_id,period);
CREATE TABLE IF NOT EXISTS public.hana_usage_sessions (
 tenant_id UUID NOT NULL REFERENCES public.tenants(id), call_id TEXT NOT NULL,
 period TEXT NOT NULL, status TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,call_id)
);
ALTER TABLE public.hana_usage_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hana_usage_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hana_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hana_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hana_usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hana_usage_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_tenant ON public.hana_usage_plans;
CREATE POLICY usage_tenant ON public.hana_usage_plans USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
DROP POLICY IF EXISTS usage_tenant ON public.hana_usage_events;
CREATE POLICY usage_tenant ON public.hana_usage_events USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
DROP POLICY IF EXISTS usage_tenant ON public.hana_usage_sessions;
CREATE POLICY usage_tenant ON public.hana_usage_sessions USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
