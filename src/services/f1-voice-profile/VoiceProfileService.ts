import { VoiceFingerprintExtractor } from "./VoiceFingerprintExtractor";
import { VoiceProfileRecorder } from "./VoiceProfileRecorder";
import { VoiceProfileStore, voiceProfileKey } from "./VoiceProfileStore";
import type {
  VoiceProfile,
  VoiceProfileScope,
  VoiceProfileVerification,
} from "./types";

export class VoiceProfileService {
  private readonly store = new VoiceProfileStore();
  private readonly recorder = new VoiceProfileRecorder();
  private readonly extractor = new VoiceFingerprintExtractor();

  async load(scope: VoiceProfileScope): Promise<VoiceProfile | null> {
    return this.store.get(scope);
  }

  async addEnrollmentSample(
    scope: VoiceProfileScope,
    displayName: string,
  ): Promise<VoiceProfile> {
    const blob = await this.recorder.record();
    const fingerprint = await this.extractor.fromBlob(blob);
    const current = await this.store.get(scope);
    const now = new Date().toISOString();

    const samples = [
      ...(current?.samples ?? []),
      {
        id: crypto.randomUUID(),
        createdAt: now,
        fingerprint,
        audio: blob,
      },
    ].slice(-10);

    const profile: VoiceProfile = {
      key: voiceProfileKey(scope),
      scope,
      displayName: String(displayName || "Usuario").trim() || "Usuario",
      enabled: true,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      samples,
      centroid: this.extractor.centroid(
        samples.map((sample) => sample.fingerprint.values),
      ),
      acceptanceThreshold: current?.acceptanceThreshold ?? 0.88,
    };

    await this.store.put(profile);
    return profile;
  }

  async test(scope: VoiceProfileScope): Promise<VoiceProfileVerification> {
    const profile = await this.store.get(scope);
    if (!profile || profile.samples.length < 3 || !profile.centroid.length) {
      throw new Error("Registra al menos 3 muestras antes de probar tu voz.");
    }

    const blob = await this.recorder.record();
    const fingerprint = await this.extractor.fromBlob(blob);
    const similarity = this.extractor.similarity(
      fingerprint.values,
      profile.centroid,
    );

    return {
      matched: similarity >= profile.acceptanceThreshold,
      similarity,
      requiredSimilarity: profile.acceptanceThreshold,
    };
  }

  async verifyWakeSamples(
    scope: VoiceProfileScope,
    samples: Float32Array,
    sampleRate: number,
  ): Promise<{ accepted: boolean; displayName?: string; similarity: number; requiredSimilarity: number; profileRequired: boolean }> {
    const profile = await this.store.get(scope);
    if (!profile || !profile.enabled) {
      return { accepted: true, similarity: 0, requiredSimilarity: 0, profileRequired: false };
    }
    if (profile.samples.length < 3 || !profile.centroid.length) {
      return { accepted: false, displayName: profile.displayName, similarity: 0, requiredSimilarity: profile.acceptanceThreshold, profileRequired: true };
    }
    const fingerprint = this.extractor.fromSamples(samples, sampleRate);
    const similarity = this.extractor.similarity(fingerprint.values, profile.centroid);
    return {
      accepted: similarity >= profile.acceptanceThreshold,
      displayName: profile.displayName,
      similarity,
      requiredSimilarity: profile.acceptanceThreshold,
      profileRequired: true,
    };
  }

  async update(
    profile: VoiceProfile,
    patch: Partial<Pick<VoiceProfile, "displayName" | "enabled" | "acceptanceThreshold">>,
  ): Promise<VoiceProfile> {
    const next: VoiceProfile = {
      ...profile,
      ...patch,
      displayName:
        String(patch.displayName ?? profile.displayName).trim() || "Usuario",
      acceptanceThreshold: Math.max(
        0.7,
        Math.min(
          Number(patch.acceptanceThreshold ?? profile.acceptanceThreshold),
          0.99,
        ),
      ),
      updatedAt: new Date().toISOString(),
    };

    await this.store.put(next);
    return next;
  }

  async remove(scope: VoiceProfileScope): Promise<void> {
    await this.store.delete(scope);
  }
}
