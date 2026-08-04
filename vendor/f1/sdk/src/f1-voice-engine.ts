import { AudioEngine } from "@cliniqone/audio-engine";
import { VadEngine } from "@cliniqone/vad";
import { WakeDetector } from "@cliniqone/wake-detector";
import { TypedEventBus, type EventListener, type Unsubscribe } from "./events/typed-event-bus.js";
import { NoopLogger } from "./logging/noop-logger.js";
import { PipelineCoordinator } from "./pipeline/pipeline-coordinator.js";
import type { F1VoiceEngineError, F1VoiceEngineEventMap } from "./types/events.js";
import type { EngineDiagnostics, F1VoiceEngineConfig, F1VoiceEngineDependencies, F1VoiceEngineState } from "./types/sdk.js";

export class F1VoiceEngine {
  readonly #events=new TypedEventBus<F1VoiceEngineEventMap>();
  readonly #audio: import("./types/sdk.js").AudioPort;
  readonly #vad: import("./types/sdk.js").VadPort;
  readonly #wake: import("./types/sdk.js").WakeDetectorPort;
  readonly #pipeline: PipelineCoordinator;
  readonly #logger: import("./types/sdk.js").LoggerPort;
  readonly #clock: import("./types/sdk.js").ClockPort;
  readonly #diagnosticsEnabled:boolean;
  readonly #subscriptions:Array<()=>void>=[];
  #state:F1VoiceEngineState="idle";
  #startPromise:Promise<void>|undefined;
  #stopPromise:Promise<void>|undefined;
  #startedAtMs:number|undefined;
  #framesReceived=0; #speechFrames=0; #inferenceCount=0; #wakeCount=0; #processingErrors=0;

  constructor(dependencies:F1VoiceEngineDependencies,config:F1VoiceEngineConfig={}){
    this.#logger=dependencies.logger??new NoopLogger();
    this.#clock=dependencies.clock??{now:()=>Date.now()};
    this.#audio=dependencies.audio??(new AudioEngine() as unknown as import("./types/sdk.js").AudioPort);
    this.#vad=dependencies.vad??new VadEngine(config.vad);
    this.#wake=dependencies.wakeDetector??(new WakeDetector(dependencies.wakeModel,config.wakeDetector) as unknown as import("./types/sdk.js").WakeDetectorPort);
    this.#pipeline=new PipelineCoordinator(this.#vad,this.#wake,this.#logger);
    this.#diagnosticsEnabled=config.diagnostics??false;
    this.#bindEvents();
  }
  get state():F1VoiceEngineState{return this.#state;}
  on<K extends keyof F1VoiceEngineEventMap>(event:K,listener:EventListener<F1VoiceEngineEventMap[K]>):Unsubscribe{return this.#events.on(event,listener);}
  once<K extends keyof F1VoiceEngineEventMap>(event:K,listener:EventListener<F1VoiceEngineEventMap[K]>):Unsubscribe{return this.#events.once(event,listener);}
  off<K extends keyof F1VoiceEngineEventMap>(event:K,listener:EventListener<F1VoiceEngineEventMap[K]>):void{this.#events.off(event,listener);}
  async start():Promise<void>{
    if(this.#state==="running")return;
    if(this.#state==="disposed")throw this.#error("DISPOSED","F1VoiceEngine has been disposed.");
    if(this.#startPromise)return this.#startPromise;
    this.#startPromise=this.#startInternal();
    try{await this.#startPromise;}finally{this.#startPromise=undefined;}
  }
  pause():void{if(this.#state!=="running")return;this.#transition("paused");}
  resume():void{if(this.#state!=="paused")return;this.#transition("running");}
  async stop():Promise<void>{
    if(this.#state==="idle")return;
    if(this.#state==="disposed")return;
    if(this.#stopPromise)return this.#stopPromise;
    this.#stopPromise=this.#stopInternal();
    try{await this.#stopPromise;}finally{this.#stopPromise=undefined;}
  }
  async dispose():Promise<void>{
    if(this.#state==="disposed")return;
    await this.stop(); await this.#wake.dispose();
    for(const off of this.#subscriptions.splice(0))off();
    this.#transition("disposed"); this.#events.clear();
  }
  getDiagnostics():EngineDiagnostics{return {framesReceived:this.#framesReceived,speechFrames:this.#speechFrames,inferenceCount:this.#inferenceCount,wakeCount:this.#wakeCount,processingErrors:this.#processingErrors,...(this.#startedAtMs===undefined?{}:{startedAtMs:this.#startedAtMs}),uptimeMs:this.#startedAtMs===undefined?0:Math.max(0,this.#clock.now()-this.#startedAtMs)};}
  async #startInternal():Promise<void>{
    this.#transition("starting"); this.#resetMetrics();
    try{await this.#wake.start(); await this.#audio.start(); this.#startedAtMs=this.#clock.now(); this.#transition("running");}
    catch(cause){try{await this.#audio.stop();}catch{} const error=this.#error("INITIALIZATION_FAILED","F1 Voice Engine failed to start.",cause);this.#transition("failed");this.#events.emit("error",error);throw error;}
  }
  async #stopInternal():Promise<void>{
    this.#transition("stopping");
    try{await this.#audio.stop();await this.#pipeline.drain();this.#pipeline.reset();this.#startedAtMs=undefined;this.#transition("idle");}
    catch(cause){const error=this.#error("AUDIO_PIPELINE_FAILED","F1 Voice Engine failed to stop cleanly.",cause);this.#transition("failed");this.#events.emit("error",error);throw error;}
  }
  #bindEvents():void{
    this.#subscriptions.push(this.#audio.on("frame",(frame)=>{if(this.#state!=="running"&&this.#state!=="starting")return;this.#framesReceived++;this.#events.emit("frame",frame);void this.#pipeline.process(frame).then(({vad,wake})=>{this.#events.emit("vad",vad);if(vad.isSpeech)this.#speechFrames++;if(wake.status==="scored")this.#inferenceCount++;this.#emitDiagnostics();}).catch((cause)=>{this.#processingErrors++;const error=this.#error("PROCESSING_FAILED","A voice frame could not be processed.",cause);this.#events.emit("error",error);this.#emitDiagnostics();});}));
    this.#subscriptions.push(this.#audio.on("error",(cause)=>{const error=this.#error("AUDIO_PIPELINE_FAILED","Audio engine emitted an error.",cause);this.#events.emit("error",error);}));
    this.#subscriptions.push(this.#wake.on("wake",(event)=>{this.#wakeCount++;this.#events.emit("wake",event);this.#emitDiagnostics();}));
    this.#subscriptions.push(this.#wake.on("score",(event)=>this.#events.emit("score",event)));
    this.#subscriptions.push(this.#wake.on("error",(cause)=>this.#events.emit("error",this.#error("PROCESSING_FAILED","Wake detector emitted an error.",cause))));
  }
  #emitDiagnostics():void{if(this.#diagnosticsEnabled)this.#events.emit("diagnostics",this.getDiagnostics());}
  #resetMetrics():void{this.#framesReceived=0;this.#speechFrames=0;this.#inferenceCount=0;this.#wakeCount=0;this.#processingErrors=0;this.#startedAtMs=undefined;}
  #transition(current:F1VoiceEngineState):void{if(this.#state===current)return;const previous=this.#state;this.#state=current;this.#events.emit("statechange",{previous,current});}
  #error(code:F1VoiceEngineError["code"],message:string,cause?:unknown):F1VoiceEngineError{return cause===undefined?{code,message}:{code,message,cause};}
}
