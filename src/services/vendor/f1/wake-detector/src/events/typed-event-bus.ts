export type EventListener<T> = (event: T) => void;
export type Unsubscribe = () => void;

export class TypedEventBus<TEventMap extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof TEventMap, Set<EventListener<unknown>>>();

  public on<TKey extends keyof TEventMap>(event: TKey, listener: EventListener<TEventMap[TKey]>): Unsubscribe {
    const listeners = this.#listeners.get(event) ?? new Set<EventListener<unknown>>();
    listeners.add(listener as EventListener<unknown>);
    this.#listeners.set(event, listeners);
    return () => this.off(event, listener);
  }

  public once<TKey extends keyof TEventMap>(event: TKey, listener: EventListener<TEventMap[TKey]>): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  public off<TKey extends keyof TEventMap>(event: TKey, listener: EventListener<TEventMap[TKey]>): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    listeners.delete(listener as EventListener<unknown>);
    if (listeners.size === 0) this.#listeners.delete(event);
  }

  public emit<TKey extends keyof TEventMap>(event: TKey, payload: TEventMap[TKey]): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  public clear(): void {
    this.#listeners.clear();
  }
}
