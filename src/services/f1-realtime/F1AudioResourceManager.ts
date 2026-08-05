import type { MicrophoneOwner } from "./types";

export class F1AudioResourceManager {
  private owner: MicrophoneOwner = "none";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;

  get microphoneOwner(): MicrophoneOwner {
    return this.owner;
  }

  attachRealtime(
    pc: RTCPeerConnection,
    dc: RTCDataChannel,
    stream: MediaStream,
    remoteAudio: HTMLAudioElement,
  ): void {
    if (this.owner !== "none") {
      throw new Error(`Micrófono ocupado por ${this.owner}`);
    }
    this.owner = "realtime";
    this.pc = pc;
    this.dc = dc;
    this.stream = stream;
    this.remoteAudio = remoteAudio;
  }

  async closeRealtime(): Promise<void> {
    const dc = this.dc;
    const pc = this.pc;
    const stream = this.stream;
    const remoteAudio = this.remoteAudio;

    this.dc = null;
    this.pc = null;
    this.stream = null;
    this.remoteAudio = null;

    try { dc?.close(); } catch {}
    try { pc?.getSenders().forEach((sender) => sender.track?.stop()); } catch {}
    try { stream?.getTracks().forEach((track) => track.stop()); } catch {}
    try { pc?.close(); } catch {}

    if (remoteAudio) {
      try {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.removeAttribute("src");
        remoteAudio.load();
      } catch {}
    }

    this.owner = "none";
    await Promise.resolve();

    const liveTracks = stream?.getTracks().filter((track) => track.readyState !== "ended") ?? [];
    if (liveTracks.length > 0) {
      throw new Error(`Realtime dejó ${liveTracks.length} pistas activas`);
    }
  }
}
