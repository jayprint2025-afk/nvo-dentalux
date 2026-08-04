export type EventMap = object;
export type EventListener<TPayload> = (payload: TPayload) => void;
export type Unsubscribe = () => void;

export class TypedEventBus<TEvents extends EventMap> {
  readonly #listeners = new Map<keyof TEvents, Set<EventListener<unknown>>>();

  public on<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): Unsubscribe {
    const listeners = this.#listeners.get(event) ?? new Set<EventListener<unknown>>();
    listeners.add(listener as EventListener<unknown>);
    this.#listeners.set(event, listeners);
    return () => this.off(event, listener);
  }

  public once<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  public off<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): void {
    const listeners = this.#listeners.get(event);
    listeners?.delete(listener as EventListener<unknown>);
    if (listeners?.size === 0) this.#listeners.delete(event);
  }

  public emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  public clear(): void {
    this.#listeners.clear();
  }
}
