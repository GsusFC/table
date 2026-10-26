#!/usr/bin/env node
/**
 * Muestrea la memoria de un conjunto de procesos de macOS (escenario A de
 * docs/memory-validation.md) y escribe una línea JSON por muestra.
 *
 *   node scripts/sample-memory.mjs --match <texto> --out <archivo.jsonl> [--interval 2] [--duration 0]
 *
 * --match     Fragmento de la línea de comandos (`ps -o args`) de los procesos a medir.
 * --interval  Segundos entre muestras.
 * --duration  Segundos totales; 0 hasta Ctrl+C.
 *
 * Métrica: suma de `phys_footprint` de `footprint`. Puede contar dos veces
 * memoria compartida entre procesos; se compara con la misma métrica en ambos flujos.
 * Presión: `kern.memorystatus_vm_pressure_level` (1 normal, 2 aviso, 4 crítica).
 */
import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'

const run = promisify(execFile)
const MIB = 1024 * 1024

const { values } = parseArgs({
  options: {
    match: { type: 'string' },
    out: { type: 'string' },
    interval: { type: 'string', default: '2' },
    duration: { type: 'string', default: '0' },
  },
})
if (!values.match || !values.out) {
  console.error('Uso: node scripts/sample-memory.mjs --match <texto> --out <archivo.jsonl> [--interval 2] [--duration 0]')
  process.exit(2)
}
const intervalMs = Number(values.interval) * 1000
const durationMs = Number(values.duration) * 1000

async function matchingPids(match) {
  const { stdout } = await run('ps', ['-axo', 'pid=,args='], { maxBuffer: 16 * MIB })
  return stdout
    .split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter(found => found && found[2].includes(match) && !found[2].includes('sample-memory.mjs'))
    .map(found => Number(found[1]))
}

async function footprintBytes(pids) {
  if (pids.length === 0) {
    return 0
  }
  // `footprint` falla si un proceso termina entre `ps` y la medición; se reintenta en la siguiente muestra.
  const { stdout } = await run('footprint', ['--noCategories', '-f', 'bytes', ...pids.map(String)], {
    maxBuffer: 16 * MIB,
  })
  return [...stdout.matchAll(/phys_footprint: (\d+) B/g)].reduce((sum, found) => sum + Number(found[1]), 0)
}

async function pressureLevel() {
  const { stdout } = await run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])
  return Number(stdout.trim())
}

async function swapUsedMiB() {
  const { stdout } = await run('sysctl', ['-n', 'vm.swapusage'])
  const used = stdout.match(/used = ([\d.]+)M/)
  return used ? Number(used[1]) : null
}

const samples = []
const startedAt = Date.now()
let stopping = false
process.on('SIGINT', () => {
  stopping = true
})

while (!stopping && (durationMs === 0 || Date.now() - startedAt < durationMs)) {
  const tickStart = Date.now()
  try {
    const pids = await matchingPids(values.match)
    const [bytes, pressure, swap] = await Promise.all([footprintBytes(pids), pressureLevel(), swapUsedMiB()])
    const sample = {
      ts: Date.now(),
      processes: pids.length,
      footprintMiB: Math.round((bytes / MIB) * 10) / 10,
      pressure,
      swapUsedMiB: swap,
    }
    samples.push(sample)
    appendFileSync(values.out, `${JSON.stringify(sample)}\n`)
    console.log(`${new Date(sample.ts).toLocaleTimeString('es-ES')} ${sample.processes} proc ${sample.footprintMiB} MiB presión ${sample.pressure} swap ${sample.swapUsedMiB} MiB`)
  } catch (error) {
    console.error(`muestra fallida: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
  await delay(Math.max(0, intervalMs - (Date.now() - tickStart)))
}

const footprints = samples.map(sample => sample.footprintMiB).filter(value => value > 0)
console.log(
  JSON.stringify({
    samples: samples.length,
    minMiB: Math.min(...footprints),
    maxMiB: Math.max(...footprints),
    lastMiB: footprints.at(-1) ?? null,
  }),
)
