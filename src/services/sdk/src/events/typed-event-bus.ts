export type EventListener<T> = (payload: T) => void;
export type Unsubscribe = () => void;
export class TypedEventBus<TEvents extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof TEvents, Set<EventListener<unknown>>>();
  on<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): Unsubscribe {
    let set=this.#listeners.get(event); if(!set){set=new Set();this.#listeners.set(event,set);}
    set.add(listener as EventListener<unknown>); return ()=>this.off(event,listener);
  }
  once<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): Unsubscribe {
    const off=this.on(event,(payload)=>{off();listener(payload);}); return off;
  }
  off<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): void { this.#listeners.get(event)?.delete(listener as EventListener<unknown>); }
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void { for(const listener of [...(this.#listeners.get(event)??[])]) listener(payload); }
  clear(): void { this.#listeners.clear(); }
}
