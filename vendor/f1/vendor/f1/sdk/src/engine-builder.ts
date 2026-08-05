import type { WakeModelPort } from "@cliniqone/wake-detector";
import { F1VoiceEngine } from "./f1-voice-engine.js";
import type { F1VoiceEngineConfig, F1VoiceEngineDependencies } from "./types/sdk.js";
export class EngineBuilder {
  #config:F1VoiceEngineConfig={}; #dependencies:Partial<F1VoiceEngineDependencies>={};
  withConfig(config:F1VoiceEngineConfig):this{this.#config=config;return this;}
  withWakeModel(wakeModel:WakeModelPort):this{this.#dependencies={...this.#dependencies,wakeModel};return this;}
  withDependencies(dependencies:Partial<F1VoiceEngineDependencies>):this{this.#dependencies={...this.#dependencies,...dependencies};return this;}
  build():F1VoiceEngine{if(!this.#dependencies.wakeModel)throw new Error("A WakeModelPort is required until the production model is bundled in Sprint 6.");return new F1VoiceEngine(this.#dependencies as F1VoiceEngineDependencies,this.#config);}
}
