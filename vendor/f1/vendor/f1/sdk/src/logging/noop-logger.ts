import type { LoggerPort } from "../types/sdk.js";
export class NoopLogger implements LoggerPort {
  debug(_message:string,_context?:Readonly<Record<string,unknown>>):void{}
  info(_message:string,_context?:Readonly<Record<string,unknown>>):void{}
  warn(_message:string,_context?:Readonly<Record<string,unknown>>):void{}
  error(_message:string,_context?:Readonly<Record<string,unknown>>):void{}
}
