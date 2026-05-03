export interface RuntimeWorker {
  readonly id: string;
  start(): void;
  stop(): void;
}
