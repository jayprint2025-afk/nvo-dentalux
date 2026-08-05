import { F1AudioResourceManager } from "./F1AudioResourceManager";
import type { F1RealtimeClientOptions, RealtimeToolCall } from "./types";

export class F1RealtimeClient {
  private readonly resources = new F1AudioResourceManager();
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private greetingPending = true;
  private closed = false;
  private readonly executedCalls = new Set<string>();

  constructor(private readonly options: F1RealtimeClientOptions) {}
  get microphoneOwner() { return this.resources.microphoneOwner; }

  async connect(): Promise<void> {
    if (this.pc) return;
    const token = this.options.getToken();
    if (!token) throw new Error("Inicia sesión nuevamente para usar la voz.");
    this.closed = false; this.greetingPending = true; this.executedCalls.clear();
    const pc = new RTCPeerConnection(); this.pc = pc;
    const audio = document.createElement("audio"); audio.autoplay = true;
    pc.ontrack = event => { audio.srcObject = event.streams[0] || null; };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.stream = stream;
    const microphoneTrack = stream.getAudioTracks()[0] || null;
    if (microphoneTrack) microphoneTrack.enabled = false;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const dc = pc.createDataChannel("oai-events"); this.dc = dc;
    this.resources.attachRealtime(pc, dc, stream, audio);
    dc.onmessage = event => { void this.handleMessage(event.data); };
    dc.onclose = () => { if (!this.closed) this.options.callbacks.onClosed(); };
    const opened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Timeout abriendo DataChannel Realtime")), 10000);
      dc.onopen = () => { window.clearTimeout(timer); resolve(); };
      dc.onerror = () => { window.clearTimeout(timer); reject(new Error("No fue posible abrir DataChannel Realtime")); };
    });
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const response = await fetch(`${this.options.apiBase}/api/f1/realtime/call?branch_key=${encodeURIComponent(this.options.branchKey)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp", "x-sucursal": this.options.branchKey },
      body: offer.sdp || "",
    });
    if (!response.ok) throw new Error((await response.text()) || `Realtime HTTP ${response.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    await opened;
    this.options.callbacks.onConnected();
    this.send({ type: "response.create", response: { modalities: ["audio", "text"], instructions: "Di únicamente: Te escucho. No agregues ninguna otra palabra." } });
  }

  private send(payload: unknown): void {
    if (!this.dc || this.dc.readyState !== "open") throw new Error("DataChannel Realtime no está abierto");
    this.dc.send(JSON.stringify(payload));
  }
  private async handleMessage(raw: string): Promise<void> {
    let payload: any; try { payload = JSON.parse(raw); } catch { return; }
    const type = String(payload?.type || "");
    if (type === "input_audio_buffer.speech_started") this.options.callbacks.onUserSpeechStarted();
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(payload.transcript || "").trim(); if (text) this.options.callbacks.onUserTranscript(text);
    }
    if (type === "response.created") this.options.callbacks.onAssistantSpeechStarted();
    if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") this.options.callbacks.onAssistantTranscriptDelta(String(payload.delta || ""));
    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const text = String(payload.transcript || "").trim(); if (text) this.options.callbacks.onAssistantTranscriptDone(text);
    }
    if (type === "response.output_item.done" && payload.item?.type === "function_call") await this.handleTool(payload.item);
    if (type === "response.done") {
      for (const item of payload.response?.output || []) if (item?.type === "function_call") await this.handleTool(item);
      if (this.greetingPending) {
        this.greetingPending = false;
        const track = this.stream?.getAudioTracks()[0]; if (track) track.enabled = true;
        this.options.callbacks.onGreetingDone();
      } else this.options.callbacks.onResponseDone();
    }
    if (type === "error") this.options.callbacks.onError(new Error(payload.error?.message || "Error en Realtime"));
  }
  private async handleTool(item: any): Promise<void> {
    const call: RealtimeToolCall = { name: String(item?.name || ""), callId: String(item?.call_id || item?.id || ""), argumentsJson: String(item?.arguments || "{}") };
    if (!call.name || !call.callId || this.executedCalls.has(call.callId)) return;
    this.executedCalls.add(call.callId);
    let output: unknown;
    try { output = await this.options.callbacks.onToolCall(call); } catch (error) { output = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    if (!this.dc || this.dc.readyState !== "open") return;
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) } });
    this.send({ type: "response.create" });
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    await this.resources.closeRealtime();
    this.pc = null; this.dc = null; this.stream = null; this.executedCalls.clear();
  }
}
