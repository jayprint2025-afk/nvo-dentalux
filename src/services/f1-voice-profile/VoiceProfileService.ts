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
      return { accepted: false, similarity: 0, requiredSimilarity: 0, profileRequired: true };
    }
    if (profile.samples.length < 3 || !profile.centroid.length) {
      return { accepted: false, displayName: profile.displayName, similarity: 0, requiredSimilarity: profile.acceptanceThreshold, profileRequired: true };
    }
    const fingerprint = this.extractor.fromSamples(samples, sampleRate);
    const similarity = this.extractor.similarity(fingerprint.values, profile.centroid);

    // V42 CONSISTENT OWNER:
    // The old gate trusted only centroid similarity. In our real tests an
    // unregistered WAV reached ~88.23%, while the owner ranged ~89-95%.
    // Add a second LOCAL identity signal: consistency against the individual
    // enrollment samples. This does not call OpenAI.
    const sampleSimilarities = profile.samples
      .map((sample) => this.extractor.similarity(
        fingerprint.values,
        sample.fingerprint.values,
      ))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a);

    const sortedAscending = [...sampleSimilarities].sort((a, b) => a - b);
    const middle = Math.floor(sortedAscending.length / 2);
    const medianSimilarity = sortedAscending.length
      ? (sortedAscending.length % 2
        ? sortedAscending[middle]
        : (sortedAscending[middle - 1] + sortedAscending[middle]) / 2)
      : 0;

    const required = profile.acceptanceThreshold;
    // Allow normal owner variation around the centroid, but require that the
    // candidate resembles a majority of the actual registered samples.
    const perSampleFloor = Math.max(0.84, required - 0.025);
    const requiredMatches = Math.max(2, Math.ceil(sampleSimilarities.length * 0.60));
    const matchingSamples = sampleSimilarities.filter(
      (value) => value >= perSampleFloor,
    ).length;

    const accepted =
      similarity >= required &&
      medianSimilarity >= perSampleFloor &&
      matchingSamples >= requiredMatches;

    console.info("[HANA V42][OWNER_CONSISTENCY]", {
      accepted,
      centroidSimilarity: similarity,
      required,
      medianSimilarity,
      perSampleFloor,
      matchingSamples,
      requiredMatches,
      sampleSimilarities,
    });

    return {
      accepted,
      displayName: profile.displayName,
      similarity,
      requiredSimilarity: required,
      profileRequired: true,
      medianSimilarity,
      matchingSamples,
      requiredMatches,
      sampleSimilarities,
    } as any;
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
