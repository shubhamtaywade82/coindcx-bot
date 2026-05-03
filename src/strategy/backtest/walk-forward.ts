import { mkdirSync } from 'fs';
import { join } from 'path';
import type { DataSource } from './types';
import type { BacktestSummary } from './runner';

const DAY_MS = 24 * 60 * 60_000;

export interface WalkForwardWindowResult {
  inSample: BacktestSummary;
  outOfSample: BacktestSummary;
  inSampleFromMs: number;
  inSampleToMs: number;
  outOfSampleFromMs: number;
  outOfSampleToMs: number;
  passed: boolean;
  rejectionReason?: string;
}

export interface WalkForwardResult {
  windows: WalkForwardWindowResult[];
  accepted: boolean;
  rejectionReason?: string;
}

export interface WalkForwardWindowContext {
  fromMs: number;
  toMs: number;
  phase: 'in_sample' | 'out_of_sample';
}

export interface WalkForwardBacktestContext {
  phase: 'in_sample' | 'out_of_sample';
  dataSource: DataSource;
  outCsv: string;
}

export interface WalkForwardArgs {
  fromMs: number;
  toMs: number;
  inSampleMonths: number;
  outOfSampleMonths: number;
  minOosSharpeFactor: number;
  outputDir: string;
  outputPrefix: string;
  buildDataSource: (window: WalkForwardWindowContext) => DataSource;
  runWindowBacktest: (context: WalkForwardBacktestContext) => Promise<BacktestSummary>;
}

export async function runWalkForwardValidation(args: WalkForwardArgs): Promise<WalkForwardResult> {
  mkdirSync(args.outputDir, { recursive: true });
  const inSampleMs = Math.max(1, Math.trunc(args.inSampleMonths)) * 30 * DAY_MS;
  const outOfSampleMs = Math.max(1, Math.trunc(args.outOfSampleMonths)) * 30 * DAY_MS;
  const minOosSharpeFactor = Number.isFinite(args.minOosSharpeFactor)
    ? args.minOosSharpeFactor
    : 0.5;
  const windows: WalkForwardWindowResult[] = [];
  let windowStart = args.fromMs;

  while (windowStart + inSampleMs + outOfSampleMs <= args.toMs) {
    const isFromMs = windowStart;
    const isToMs = isFromMs + inSampleMs;
    const oosFromMs = isToMs;
    const oosToMs = oosFromMs + outOfSampleMs;

    const inSampleDataSource = args.buildDataSource({
      fromMs: isFromMs,
      toMs: isToMs,
      phase: 'in_sample',
    });
    const outOfSampleDataSource = args.buildDataSource({
      fromMs: oosFromMs,
      toMs: oosToMs,
      phase: 'out_of_sample',
    });
    const inSample = await args.runWindowBacktest({
      phase: 'in_sample',
      dataSource: inSampleDataSource,
      outCsv: join(args.outputDir, `${args.outputPrefix}-is-${isFromMs}-${isToMs}.csv`),
    });
    const outOfSample = await args.runWindowBacktest({
      phase: 'out_of_sample',
      dataSource: outOfSampleDataSource,
      outCsv: join(args.outputDir, `${args.outputPrefix}-oos-${oosFromMs}-${oosToMs}.csv`),
    });

    const threshold = inSample.metrics.sharpe * minOosSharpeFactor;
    const passed = outOfSample.metrics.sharpe >= threshold;
    windows.push({
      inSample,
      outOfSample,
      inSampleFromMs: isFromMs,
      inSampleToMs: isToMs,
      outOfSampleFromMs: oosFromMs,
      outOfSampleToMs: oosToMs,
      passed,
      ...(passed
        ? {}
        : {
            rejectionReason: `OOS Sharpe ${outOfSample.metrics.sharpe.toFixed(4)} < ${minOosSharpeFactor.toFixed(2)} x IS Sharpe ${inSample.metrics.sharpe.toFixed(4)}`,
          }),
    });
    windowStart += outOfSampleMs;
  }

  const failedWindow = windows.find((window) => !window.passed);
  return {
    windows,
    accepted: windows.length > 0 && failedWindow === undefined,
    ...(failedWindow?.rejectionReason
      ? { rejectionReason: failedWindow.rejectionReason }
      : {}),
  };
}
