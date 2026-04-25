import type { Sink } from './types';
import type { Signal } from '../signals/types';

export class StdoutSink implements Sink {
  readonly name = 'stdout';
  constructor(private readonly write: (line: string) => void = (l) => { process.stdout.write(l); }) {}
  async emit(signal: Signal): Promise<void> {
    this.write(JSON.stringify(signal) + '\n');
  }
}
