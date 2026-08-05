import type { MicrophoneOwner } from "./types";

export class F1AudioResourceManager {
  private owner: MicrophoneOwner = "none";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;

  get microphoneOwner(): MicrophoneOwner { return this.owner; }
  claim(owner: Exclude<MicrophoneOwner, "none">): void {
    if (this.owner !== "none" && this.owner !== owner) throw new Error(`Micrófono ocupado por ${this.owner}`);
    this.owner = owner;
  }
  release(owner: Exclude<MicrophoneOwner, "none">): void { if (this.owner === owner) this.owner = "none"; }
  attachRealtime(pc: RTCPeerConnection, dc: RTCDataChannel, stream: MediaStream, audio: HTMLAudioElement): void {
    this.claim("realtime"); this.pc = pc; this.dc = dc; this.stream = stream; this.remoteAudio = audio;
  }
  async closeRealtime(): Promise<void> {
    const dc = this.dc; const pc = this.pc; const stream = this.stream; const audio = this.remoteAudio;
    this.dc = null; this.pc = null; this.stream = null; this.remoteAudio = null;
    try { dc?.close(); } catch {}
    try { pc?.getSenders().forEach(sender => sender.track?.stop()); } catch {}
    try { stream?.getTracks().forEach(track => track.stop()); } catch {}
    try { pc?.close(); } catch {}
    if (audio) { try { audio.pause(); audio.srcObject = null; } catch {} }
    this.release("realtime");
    await Promise.resolve();
  }
  async assertStreamStopped(stream: MediaStream | null): Promise<void> {
    if (!stream) return;
    await Promise.resolve();
    const live = stream.getTracks().filter(track => track.readyState !== "ended");
    if (live.length) throw new Error(`Quedaron ${live.length} pistas de audio activas`);
  }
}
