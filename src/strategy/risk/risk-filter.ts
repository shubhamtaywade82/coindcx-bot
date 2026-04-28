import type { AccountSnapshot } from '../../account/types';
import type { RiskFilter, StrategyManifest, StrategySignal } from '../types';

export class PassthroughRiskFilter implements RiskFilter {
  filter(signal: StrategySignal, _manifest: StrategyManifest, _account: AccountSnapshot): StrategySignal | null {
    return signal;
  }
}
