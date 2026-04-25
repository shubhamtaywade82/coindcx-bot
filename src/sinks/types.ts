import type { Signal } from '../signals/types';

export interface Sink {
  readonly name: string;
  emit(signal: Signal): Promise<void>;
}
