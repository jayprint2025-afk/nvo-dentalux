import { SherpaKeywordModel } from "./sherpa-keyword-model.js";
import { SherpaWasmKeywordEngine } from "./sherpa-wasm-keyword-engine.js";

export function createHanaSherpaWakeModel() {
  const engine=new SherpaWasmKeywordEngine({
    assetBaseUrl:"/models/sherpa-hana",
    keywordsScore:2.0,
    keywordsThreshold:0.10,
  });
  return new SherpaKeywordModel(engine,{keyword:"Oye Hana",hitScore:1});
}
