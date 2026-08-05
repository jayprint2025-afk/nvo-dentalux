export type VoiceProfileScope = {
  tenantId: string;
  userId: string;
  branchKey: string;
};

export type VoiceFingerprint = {
  values: number[];
  durationMs: number;
  sampleRate: number;
};

export type VoiceProfileSample = {
  id: string;
  createdAt: string;
  fingerprint: VoiceFingerprint;
  audio: Blob;
};

export type VoiceProfile = {
  key: string;
  scope: VoiceProfileScope;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  samples: VoiceProfileSample[];
  centroid: number[];
  acceptanceThreshold: number;
};

export type VoiceProfileVerification = {
  matched: boolean;
  similarity: number;
  requiredSimilarity: number;
};
