#!/usr/bin/env node
/**
 * Cruza las muestras de `sample-memory.mjs` con los marcadores `[t001-cycle]`
 * del modo ciclos y resume el escenario A.
 *
 *   node scripts/summarize-cycles.mjs --samples <muestras.jsonl> --log <salida-de-table.txt>
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { samples: { type: 'string' }, log: { type: 'string' } } })
if (!values.samples || !values.log) {
  console.error('Uso: node scripts/summarize-cycles.mjs --samples <muestras.jsonl> --log <salida-de-table.txt>')
  process.exit(2)
}

const samples = readFileSync(values.samples, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line))
const markers = readFileSync(values.log, 'utf8')
  .split('\n')
  .map(line => line.match(/\[t001-cycle\] (\{.*\})/))
  .filter(Boolean)
  .map(found => JSON.parse(found[1]))

/** Última muestra tomada en o antes de `ts`. */
function sampleAt(ts) {
  return samples.filter(sample => sample.ts <= ts).at(-1) ?? null
}

function peakBetween(from, to) {
  const inRange = samples.filter(sample => sample.ts >= from && sample.ts <= to)
  return inRange.length === 0 ? null : Math.max(...inRange.map(sample => sample.footprintMiB))
}

function markerTs(phase, cycle) {
  return markers.find(marker => marker.phase === phase && marker.cycle === cycle)?.ts ?? null
}

const cycles = [...new Set(markers.filter(marker => marker.cycle).map(marker => marker.cycle))]
const rows = cycles.map(cycle => {
  const loadStart = markerTs('load-start', cycle)
  const conservedEnd = markerTs('conserved-end', cycle)
  const observed = markerTs('observed', cycle)
  return {
    cycle,
    loadMs: markers.find(marker => marker.phase === 'loaded' && marker.cycle === cycle)?.loadMs ?? null,
    peakMiB: loadStart && conservedEnd ? peakBetween(loadStart, conservedEnd) : null,
    conservedMiB: conservedEnd ? (sampleAt(conservedEnd)?.footprintMiB ?? null) : null,
    afterUnloadMiB: observed ? (sampleAt(observed)?.footprintMiB ?? null) : null,
  }
})

/** Pendiente por mínimos cuadrados de la memoria tras descargar, en MiB por ciclo. */
function slope(points) {
  const valid = points.filter(point => point.y !== null)
  if (valid.length < 2) {
    return null
  }
  const meanX = valid.reduce((sum, point) => sum + point.x, 0) / valid.length
  const meanY = valid.reduce((sum, point) => sum + point.y, 0) / valid.length
  const numerator = valid.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0)
  const denominator = valid.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
  return Math.round((numerator / denominator) * 10) / 10
}

const shellIdle = markers.find(marker => marker.phase === 'shell-idle')
const firstLoad = markerTs('load-start', 1)
const swapValues = samples.map(sample => sample.swapUsedMiB).filter(value => value !== null)

console.log(
  JSON.stringify(
    {
      shellIdleMiB: shellIdle && firstLoad ? (sampleAt(firstLoad)?.footprintMiB ?? null) : null,
      peakMiB: Math.max(...samples.map(sample => sample.footprintMiB)),
      residualSlopeMiBPerCycle: slope(rows.map(row => ({ x: row.cycle, y: row.afterUnloadMiB }))),
      maxPressure: Math.max(...samples.map(sample => sample.pressure)),
      swapDeltaMiB: swapValues.length > 1 ? Math.round(swapValues.at(-1) - swapValues[0]) : null,
      cycles: rows,
      outcome: markers.find(marker => marker.phase === 'done') ?? null,
    },
    null,
    2,
  ),
)
