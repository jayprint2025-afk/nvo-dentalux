import { restoreValidatedOwnerProfile } from "./ValidatedOwnerProfile";
import { CampPlusSpeakerExtractor } from "./CampPlusSpeakerExtractor";
import { VoiceProfileRecorder } from "./VoiceProfileRecorder";
import { VoiceProfileStore, voiceProfileKey } from "./VoiceProfileStore";
import type { VoiceProfile, VoiceProfileScope, VoiceProfileVerification } from "./types";

const EMBEDDING_SIZE = 192;
const REQUIRED_SAMPLES = 5;

// V45 uses a consensus across the enrolled samples instead of trusting one
// centroid and one hard 0.75 cut. This is intentionally robust to one bad
// enrollment (the field logs contained one ~0.16 outlier) while still requiring
// agreement with multiple owner samples, so a single accidental high match from
// TV/another speaker cannot open the gate.
const OWNER_CENTROID_FLOOR = 0.58;
const OWNER_CONSENSUS_FLOOR = 0.54;
const OWNER_TOP3_FLOOR = 0.56;
const OWNER_REQUIRED_MATCHES = 2;
const DISPLAY_REQUIRED = 0.60;

export class VoiceProfileService {
  private readonly store = new VoiceProfileStore();
  private readonly recorder = new VoiceProfileRecorder();
  private readonly extractor = new CampPlusSpeakerExtractor();

  async load(scope: VoiceProfileScope, options: { useValidatedOwnerPreset?: boolean } = {}): Promise<VoiceProfile | null> {
    let profile = await this.store.get(scope);
    if (!profile) return null;
    if (options.useValidatedOwnerPreset) {
      const restored = await restoreValidatedOwnerProfile(profile);
      if (restored !== profile) await this.store.put(restored);
      profile = restored;
    }
    const compatible = this.isCompatible(profile);
    if (compatible) return profile;
    return { ...profile, engineVersion: "campplus-v44", enabled: true, samples: [], centroid: [], acceptanceThreshold: DISPLAY_REQUIRED };
  }

  async addEnrollmentSample(scope: VoiceProfileScope, displayName: string): Promise<VoiceProfile> {
    const blob = await this.recorder.record(3500);
    const fingerprint = await this.extractor.fromBlob(blob);
    const current = await this.store.get(scope);
    const now = new Date().toISOString();
    const compatible = current?.engineVersion === "campplus-v44"
      ? (current.samples ?? []).filter((sample) => sample.fingerprint.values.length === EMBEDDING_SIZE)
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
      centroid: this.robustCentroid(samples.map((sample) => sample.fingerprint.values)),
      acceptanceThreshold: DISPLAY_REQUIRED,
    };
    await this.store.put(profile);
    return profile;
  }

  async test(scope: VoiceProfileScope): Promise<VoiceProfileVerification> {
    const profile = await this.requireProfile(scope);
    const blob = await this.recorder.record(3500);
    const fingerprint = await this.extractor.fromBlob(blob);
    const decision = this.verifyFingerprint(profile, fingerprint.values);
    return { matched: decision.accepted, similarity: decision.similarity, requiredSimilarity: DISPLAY_REQUIRED };
  }

  async verifyWakeSamples(scope: VoiceProfileScope, samples: Float32Array, sampleRate: number): Promise<any> {
    const profile = await this.store.get(scope);
    if (!profile || !profile.enabled || !this.isCompatible(profile)) {
      return { accepted: false, similarity: 0, requiredSimilarity: DISPLAY_REQUIRED, profileRequired: true };
    }
    const fingerprint = await this.extractor.fromSamples(samples, sampleRate);
    const decision = this.verifyFingerprint(profile, fingerprint.values);
    console.info("[HANA V45][CAMPPLUS_OWNER]", decision);
    return {
      ...decision,
      displayName: profile.displayName,
      requiredSimilarity: DISPLAY_REQUIRED,
      profileRequired: true,
    };
  }

  async update(profile: VoiceProfile, patch: Partial<Pick<VoiceProfile, "displayName" | "enabled" | "acceptanceThreshold">>): Promise<VoiceProfile> {
    const next: VoiceProfile = {
      ...profile,
      ...patch,
      displayName: String(patch.displayName ?? profile.displayName).trim() || "Usuario",
      // Keep the stored value stable for old UI code, but V45's actual decision is
      // multi-sample consensus and cannot be weakened to a one-number bypass.
      acceptanceThreshold: DISPLAY_REQUIRED,
      updatedAt: new Date().toISOString(),
    };
    await this.store.put(next);
    return next;
  }

  async remove(scope: VoiceProfileScope): Promise<void> { await this.store.delete(scope); }

  private isCompatible(profile: VoiceProfile): boolean {
    const compatible = profile.samples?.filter((sample) => sample.fingerprint.values.length === EMBEDDING_SIZE) ?? [];
    return profile.engineVersion === "campplus-v44" && compatible.length >= REQUIRED_SAMPLES;
  }

  private async requireProfile(scope: VoiceProfileScope): Promise<VoiceProfile> {
    const profile = await this.store.get(scope);
    if (!profile || !this.isCompatible(profile)) throw new Error("Se requieren al menos 5 muestras CAMPPlus del propietario.");
    return profile;
  }

  private verifyFingerprint(profile: VoiceProfile, candidate: number[]) {
    const vectors = profile.samples
      .map((sample) => sample.fingerprint.values)
      .filter((values) => values.length === EMBEDDING_SIZE);
    const centroid = this.robustCentroid(vectors);
    const centroidSimilarity = this.extractor.similarity(candidate, centroid);
    const sampleSimilarities = vectors
      .map((values) => this.extractor.similarity(candidate, values))
      .sort((a, b) => b - a);
    const top = sampleSimilarities.slice(0, Math.min(3, sampleSimilarities.length));
    const top3Mean = top.reduce((sum, value) => sum + value, 0) / Math.max(1, top.length);
    const matchingSamples = sampleSimilarities.filter((value) => value >= OWNER_CONSENSUS_FLOOR).length;
    const secondBest = sampleSimilarities[1] ?? 0;

    // Both conditions matter: global owner similarity + agreement with at least
    // two independent enrollment samples. This rejects a one-off TV/impostor hit.
    const accepted = centroidSimilarity >= OWNER_CENTROID_FLOOR &&
      top3Mean >= OWNER_TOP3_FLOOR &&
      secondBest >= OWNER_CONSENSUS_FLOOR &&
      matchingSamples >= OWNER_REQUIRED_MATCHES;

    // Human-facing score blends robust centroid and repeated-sample evidence.
    const similarity = 0.6 * centroidSimilarity + 0.4 * top3Mean;
    return {
      accepted,
      similarity,
      centroidSimilarity,
      top3Mean,
      matchingSamples,
      requiredMatches: OWNER_REQUIRED_MATCHES,
      sampleSimilarities,
    };
  }

  private robustCentroid(vectors: number[][]): number[] {
    const valid = vectors.filter((v) => v.length === EMBEDDING_SIZE);
    if (!valid.length) return [];
    if (valid.length <= REQUIRED_SAMPLES) return this.extractor.centroid(valid);

    // Rank each enrollment by how well it agrees with the other enrollments.
    // Keep the most coherent set; one accidental/noisy recording cannot drag the
    // owner centroid down for every future wake attempt.
    const ranked = valid.map((vector, index) => {
      const sims = valid
        .map((other, j) => j === index ? -1 : this.extractor.similarity(vector, other))
        .filter((v) => v >= 0)
        .sort((a, b) => b - a);
      const peers = sims.slice(0, Math.min(4, sims.length));
      const agreement = peers.reduce((sum, v) => sum + v, 0) / Math.max(1, peers.length);
      return { vector, agreement };
    }).sort((a, b) => b.agreement - a.agreement);

    const keep = ranked.slice(0, Math.max(REQUIRED_SAMPLES, Math.ceil(valid.length * 0.75)));
    return this.extractor.centroid(keep.map((entry) => entry.vector));
  }
}
