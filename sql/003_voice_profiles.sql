BEGIN;
CREATE TABLE IF NOT EXISTS public.hana_voice_profiles (
 tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 profile JSONB,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,user_id)
);
ALTER TABLE public.hana_voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hana_voice_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_tenant ON public.hana_voice_profiles;
CREATE POLICY voice_tenant ON public.hana_voice_profiles
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',TRUE),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',TRUE),'')::uuid);
COMMIT;
