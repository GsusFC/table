import { describe, expect, it } from 'vitest'
import { FIXTURE_QUOTA_MESSAGE } from './fixtures'
import { toolError } from './mcp'

describe('errores de las herramientas de Notion', () => {
  it('cuota agotada de los modos rows y SQL: motivo en español, sin copiar la respuesta', () => {
    const error = toolError(FIXTURE_QUOTA_MESSAGE)
    expect(error.code).toBe('quota')
    expect(error.message).toBe('Notion: límite de consultas del plan agotado; se reinicia en una hora')
  })

  it('herramienta fuera del plan, sin acceso, petición rechazada y desconocido', () => {
    expect(toolError('{"status":"plan_required","tool":"query_data_sources"}').code).toBe('plan')
    expect(toolError('{"code":"object_not_found","message":"Página SECRETO"}')).toMatchObject({
      code: 'not-found',
      message: 'La página no existe o tu cuenta de Notion no tiene acceso',
    })
    expect(toolError('{"code":"validation_error"}').code).toBe('invalid')
    expect(toolError('{"code":"rate_limited"}').code).toBe('quota')
    const unknown = toolError('algo raro con SECRETO')
    expect(unknown.code).toBe('unexpected')
    expect(unknown.message).not.toContain('SECRETO')
  })
})
