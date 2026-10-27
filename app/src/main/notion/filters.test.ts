import { describe, expect, it } from 'vitest'
import { contentToLines } from './content'
import { hasMoney, isExcludedPropertyName, OMITTED_MARK, redactMoney, safeLabel, type TextLine } from './filters'

const line = (text: string, indent = 0, table?: number): TextLine => (table === undefined ? { indent, text } : { indent, text, table })

describe('importes y palabras económicas', () => {
  it.each([
    'Total 12.000 €',
    '€1.500 de anticipo',
    'son 3k€',
    '5 k€ al mes',
    'USD 300',
    '300 USD',
    '$ 45',
    '45$',
    '2.000 euros',
    '1.200 EUR',
    'Presupuesto aprobado',
    'PRESUPUESTOS',
    'el precio final',
    'nueva tarifa',
    'Facturación trimestral',
    'factura enviada',
    'Honorarios del equipo',
    'coste por hora',
    'Budget review',
    'fee mensual',
    'Invoice #12',
    'pago pendiente',
    'payment terms',
    // Énfasis, enlaces y código de Markdown no esconden el importe.
    '12.000 **€**',
    '**12.000** €',
    '`12.000 €`',
    '[presupuesto](https://example.com/x)',
    // Monedas con palabras, también con números escritos.
    'doce mil euros',
    'mil euros',
    'quince dólares',
    'cinco libras',
    'veinte mil dólares',
    'twelve thousand dollars',
    'un euro',
    '3.000 dólares',
    'Presupuesto: 12k',
    'importe en €',
  ])('detecta «%s»', text => {
    expect(hasMoney(text)).toBe(true)
  })

  it.each(['Entrega en noviembre', 'Paso 1: entrevistas', 'feedback del cliente', 'página 3', 'Euro-estilo sin cifras', '2026-10-05', 'zona costera', 'dos semanas', 'mil ideas'])(
    'no detecta «%s»',
    text => {
      expect(hasMoney(text)).toBe(false)
    },
  )
})

describe('nombres de propiedad excluidos', () => {
  it.each([
    'Budget',
    'budget',
    'Opportunity',
    'Opportunities',
    'Account',
    'Lead',
    'Leaders',
    'Preview',
    'Notion Link',
    'notion link',
    'Presupuesto',
    'Precio',
    'Coste interno',
    'Tarifa',
    'Factura',
    'Honorarios',
    'Fee',
    'Invoice',
    'Price',
    'Cost',
    'Pago',
    'Payment',
    'Oportunidad',
    // Nombres compuestos: camelCase, cifras, guiones y guiones bajos.
    'Budget2026',
    'PrecioFinal',
    'CosteInterno',
    'Opportunity2026',
    'coste_interno',
    'precio-final',
    'TotalFees',
    'NotionLink',
    // Falsos positivos aceptados: mejor excluir de más.
    'Leading',
    'Accountability',
  ])('excluye «%s»', name => {
    expect(isExcludedPropertyName(name)).toBe(true)
  })

  it.each(['Name', 'Fase', 'Notas', 'Estado', 'Fecha', 'Enlace', 'Etiquetas', 'Hecho', 'Status', 'Services', 'Due Date'])('permite «%s»', name => {
    expect(isExcludedPropertyName(name)).toBe(false)
  })
})

describe('nombres para avisos', () => {
  it('un nombre económico no se muestra', () => {
    expect(safeLabel('Budget 12.000 €', 'sin título')).toBe('sin título')
    expect(safeLabel('Proceso', 'sin título')).toBe('Proceso')
    expect(safeLabel('', 'sin título')).toBe('sin título')
  })
})

describe('omisión de líneas', () => {
  it('sustituye la línea y cuenta cada una; tramos seguidos, una sola marca', () => {
    const result = redactMoney([line('Intro'), line('Coste 3.000 €'), line('Factura 2'), line('Fin')])
    expect(result.lines).toEqual(['Intro', OMITTED_MARK, 'Fin'])
    expect(result.omitted).toBe(2)
  })

  it('omite los hijos sangrados de una línea económica', () => {
    const result = redactMoney([line('Honorarios', 1), line('Detalle 1.200', 2), line('Más detalle', 3), line('Siguiente', 1)])
    expect(result.lines).toEqual([`  ${OMITTED_MARK}`, '  Siguiente'])
    expect(result.omitted).toBe(3)
  })

  it('omite la sección de un encabezado económico hasta otro de igual o mayor nivel', () => {
    const result = redactMoney([
      line('## Presupuesto'),
      line('Diseño: 3.000'),
      line('### Detalle'),
      line('Web: 4.500'),
      line(''),
      line('## Calendario'),
      line('Noviembre'),
    ])
    expect(result.lines).toEqual([OMITTED_MARK, '## Calendario', 'Noviembre'])
    expect(result.omitted).toBe(4)
  })

  it('una fila económica arrastra el resto de su tabla (cabecera con cifras sin moneda)', () => {
    const result = redactMoney([line('| Concepto | Importe |', 0, 1), line('| Logo | 1.500 |', 0, 1), line('Después'), line('| A | B |', 0, 2)])
    expect(result.lines).toEqual([OMITTED_MARK, 'Después', '| A | B |'])
    expect(result.omitted).toBe(2)
  })

  it('un aviso destacado, desplegable o cita con una línea económica se omite entero', () => {
    const content = [
      'Antes',
      '<callout icon="💡">',
      '\tPresupuesto revisado',
      '\tDiseño: 12000',
      '</callout>',
      '<details>',
      '<summary>Notas</summary>',
      '\tFase uno',
      '\tTotal: doce mil euros',
      '</details>',
      '> Cita normal',
      '> Diseño: 3000',
      '> Pago a 30 días',
      'Después',
    ].join('\n')
    const result = redactMoney(contentToLines(content, () => ''))
    expect(result.lines).toEqual(['Antes', `  ${OMITTED_MARK}`, 'Después'])
    expect(result.lines.join('\n')).not.toMatch(/12000|Fase uno|3000|Cita normal/)
    expect(result.omitted).toBe(8)
  })
})
