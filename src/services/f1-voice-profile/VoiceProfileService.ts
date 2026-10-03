import { CampPlusSpeakerExtractor } from "./CampPlusSpeakerExtractor";
import { VoiceProfileRecorder } from "./VoiceProfileRecorder";
import { VoiceProfileStore, voiceProfileKey } from "./VoiceProfileStore";
import type { VoiceProfile, VoiceProfileScope, VoiceProfileVerification } from "./types";

const V44_EMBEDDING_SIZE = 192;
const V44_REQUIRED_SAMPLES = 5;
// Calibration 2026-10-02: owner close ~0.80-0.84; highest observed impostor ~0.703.
// 0.75 keeps a measurable safety margin. Far-field owner samples below this value
// fail closed rather than allowing the observed impostor overlap.
const V44_OWNER_THRESHOLD = 0.75;

export class VoiceProfileService {
  private readonly store = new VoiceProfileStore();
  private readonly recorder = new VoiceProfileRecorder();
  private readonly extractor = new CampPlusSpeakerExtractor();

  async load(scope: VoiceProfileScope): Promise<VoiceProfile | null> {
    const profile = await this.store.get(scope);
    if (!profile) return null;

    // V44 migration view: never present V43 samples as CAMPPlus enrollment.
    // Keep the legacy record untouched until the first new V44 sample is saved,
    // but expose a clean 0/5 profile to the UI and to the wake gate.
    const compatible =
      profile.engineVersion === "campplus-v44" &&
      profile.centroid?.length === V44_EMBEDDING_SIZE &&
      profile.samples.every((sample) => sample.fingerprint.values.length === V44_EMBEDDING_SIZE);

    if (compatible) return profile;

    return {
      ...profile,
      engineVersion: "campplus-v44",
      enabled: true,
      samples: [],
      centroid: [],
      acceptanceThreshold: V44_OWNER_THRESHOLD,
    };
  }

  async addEnrollmentSample(scope: VoiceProfileScope, displayName: string): Promise<VoiceProfile> {
    const blob = await this.recorder.record(3500);
    const fingerprint = await this.extractor.fromBlob(blob);
    const current = await this.store.get(scope);
    const now = new Date().toISOString();

    // V44 deliberately invalidates every legacy profile, even if an older
    // fingerprint happened to have the same vector length.
    const compatible = current?.engineVersion === "campplus-v44"
      ? (current.samples ?? []).filter((sample) => sample.fingerprint.values.length === V44_EMBEDDING_SIZE)
      : [];
    const samples = [...compatible, { id: crypto.randomUUID(), createdAt: now, fingerprint, audio: blob }].slice(-10);
    const profile: VoiceProfile = {
      key: voiceProfileKey(scope), scope,
      engineVersion: "campplus-v44",
      displayName: String(displayName || "Usuario").trim() || "Usuario",
      enabled: true,
      createdAt: compatible.length ? (current?.createdAt ?? now) : now,
      updatedAt: now,
      samples,
      centroid: this.extractor.centroid(samples.map((sample) => sample.fingerprint.values)),
      acceptanceThreshold: compatible.length ? Math.max(V44_OWNER_THRESHOLD, current?.acceptanceThreshold ?? 0) : V44_OWNER_THRESHOLD,
    };
    await this.store.put(profile);
    return profile;
  }

  async test(scope: VoiceProfileScope): Promise<VoiceProfileVerification> {
    const profile = await this.requireV44Profile(scope);
    const blob = await this.recorder.record(3500);
    const fingerprint = await this.extractor.fromBlob(blob);
    const similarity = this.extractor.similarity(fingerprint.values, profile.centroid);
    const requiredSimilarity = Math.max(V44_OWNER_THRESHOLD, profile.acceptanceThreshold);
    return { matched: similarity >= requiredSimilarity, similarity, requiredSimilarity };
  }

  async verifyWakeSamples(scope: VoiceProfileScope, samples: Float32Array, sampleRate: number): Promise<any> {
    const profile = await this.store.get(scope);
    if (!profile || !profile.enabled || profile.engineVersion !== "campplus-v44") return { accepted: false, similarity: 0, requiredSimilarity: V44_OWNER_THRESHOLD, profileRequired: true };
    const compatible = profile.samples.filter((sample) => sample.fingerprint.values.length === V44_EMBEDDING_SIZE);
    if (compatible.length < V44_REQUIRED_SAMPLES || profile.centroid.length !== V44_EMBEDDING_SIZE) {
      return { accepted: false, displayName: profile.displayName, similarity: 0, requiredSimilarity: V44_OWNER_THRESHOLD, profileRequired: true };
    }

    const fingerprint = await this.extractor.fromSamples(samples, sampleRate);
    const similarity = this.extractor.similarity(fingerprint.values, profile.centroid);
    const sampleSimilarities = compatible.map((sample) => this.extractor.similarity(fingerprint.values, sample.fingerprint.values)).sort((a, b) => b - a);
    const required = Math.max(V44_OWNER_THRESHOLD, profile.acceptanceThreshold);
    const accepted = similarity >= required;

    console.info("[HANA V44][CAMPPLUS_OWNER]", { accepted, similarity, required, sampleSimilarities });
    return { accepted, displayName: profile.displayName, similarity, requiredSimilarity: required, profileRequired: true, sampleSimilarities };
  }

  async update(profile: VoiceProfile, patch: Partial<Pick<VoiceProfile, "displayName" | "enabled" | "acceptanceThreshold">>): Promise<VoiceProfile> {
    const next: VoiceProfile = {
      ...profile, ...patch,
      displayName: String(patch.displayName ?? profile.displayName).trim() || "Usuario",
      acceptanceThreshold: Math.max(V44_OWNER_THRESHOLD, Math.min(Number(patch.acceptanceThreshold ?? profile.acceptanceThreshold), 0.95)),
      updatedAt: new Date().toISOString(),
    };
    await this.store.put(next); return next;
  }

  async remove(scope: VoiceProfileScope): Promise<void> { await this.store.delete(scope); }

  private async requireV44Profile(scope: VoiceProfileScope): Promise<VoiceProfile> {
    const profile = await this.store.get(scope);
    const compatible = profile?.samples.filter((sample) => sample.fingerprint.values.length === V44_EMBEDDING_SIZE) ?? [];
    if (!profile || profile.engineVersion !== "campplus-v44" || compatible.length < V44_REQUIRED_SAMPLES || profile.centroid.length !== V44_EMBEDDING_SIZE) {
      throw new Error("V44 requiere 5 muestras nuevas del propietario para CAMPPlus.");
    }
    return profile;
  }
}
