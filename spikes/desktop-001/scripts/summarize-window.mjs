#!/usr/bin/env node
/**
 * Resume las muestras de `sample-memory.mjs` en una ventana de tiempo, para
 * comparar Table con Figma de escritorio en la misma fase.
 *
 *   node scripts/summarize-window.mjs --samples <muestras.jsonl> --from <ms epoch> --to <ms epoch> [--stable-from <ms epoch>]
 *
 * pico: máximo en [from, to]. estable: mediana en [stable-from, to] (por defecto, los últimos 30 s).
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const STABLE_WINDOW_MS = 30_000

const { values } = parseArgs({
  options: {
    samples: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    'stable-from': { type: 'string' },
  },
})
if (!values.samples || !values.from || !values.to) {
  console.error('Uso: node scripts/summarize-window.mjs --samples <muestras.jsonl> --from <ms> --to <ms> [--stable-from <ms>]')
  process.exit(2)
}
const from = Number(values.from)
const to = Number(values.to)
const stableFrom = values['stable-from'] ? Number(values['stable-from']) : to - STABLE_WINDOW_MS

const samples = readFileSync(values.samples, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line))
  .filter(sample => sample.processes > 0)
const inWindow = samples.filter(sample => sample.ts >= from && sample.ts <= to)
const stable = inWindow
  .filter(sample => sample.ts >= stableFrom)
  .map(sample => sample.footprintMiB)
  .sort((a, b) => a - b)

console.log(
  JSON.stringify(
    {
      samples: inWindow.length,
      peakMiB: inWindow.length ? Math.max(...inWindow.map(sample => sample.footprintMiB)) : null,
      stableMedianMiB: stable.length ? stable[Math.floor(stable.length / 2)] : null,
      maxProcesses: inWindow.length ? Math.max(...inWindow.map(sample => sample.processes)) : null,
      maxPressure: inWindow.length ? Math.max(...inWindow.map(sample => sample.pressure)) : null,
      swapDeltaMiB: inWindow.length > 1 ? Math.round(inWindow.at(-1).swapUsedMiB - inWindow[0].swapUsedMiB) : null,
    },
    null,
    2,
  ),
)
