/**
 * Filtros del contenido de Notion que llega a los agentes (T-009). Son
 * heurísticos y conservadores: ante la duda, se omite.
 *
 * - Propiedades: solo tipos de una lista cerrada y nunca nombres comerciales o
 *   económicos, también dentro de nombres compuestos (`PrecioFinal`, `Budget2026`).
 * - Textos: una línea, elemento de lista o fila de tabla con importes o
 *   palabras económicas se sustituye por OMITTED_MARK; también sus hijos
 *   sangrados, la sección de un encabezado económico, el resto de su tabla y el
 *   bloque entero (aviso destacado, desplegable, columna, cita) que la contiene.
 */

export const OMITTED_MARK = '[omitido: posible información económica]'

/**
 * Versión de las reglas de filtrado: forma parte de la clave con la que se
 * reutiliza una página guardada. Si las reglas cambian, se vuelve a filtrar.
 */
export const FILTER_RULES_VERSION = 2

/** Tipos de propiedad que pueden llegar al agente (nombres del MCP y de la API). */
export const ALLOWED_PROPERTY_TYPES: Readonly<Record<string, true>> = {
  title: true,
  text: true,
  rich_text: true,
  select: true,
  multi_select: true,
  status: true,
  date: true,
  url: true,
  checkbox: true,
}

/** Minúsculas y sin tildes, para comparar sin depender de mayúsculas ni acentos. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Texto llano para detectar: sin énfasis, código ni enlaces de Markdown
 * (`12.000 **€**`, `[presupuesto](…)`), sin tildes y en minúsculas.
 */
function plainText(text: string): string {
  return foldText(
    text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[*_~`]/g, ''),
  )
}

const WORD_START = '(?<![\\p{L}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{N}])'

/** Palabras económicas (ya sin tildes) en español e inglés. */
const MONEY_WORDS =
  'presupuest\\p{L}*|precios?|tarifas?|factur\\p{L}*|honorarios?|costes?|costos?|costs?|budgets?|fees?|invoic\\p{L}*|pagos?|payments?|importes?|prices?|pricing'

const MONEY_WORD = new RegExp(`${WORD_START}(?:${MONEY_WORDS})${WORD_END}`, 'u')

/** Monedas escritas con palabras o códigos (ya sin tildes). */
const CURRENCY_WORDS = 'euros?|eur|dolares|dolar|dollars?|usd|libras?|pounds?|gbp'

/** Números escritos con palabras (español e inglés), para «doce mil euros». */
const NUMBER_WORDS = [
  'un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince',
  'dieci\\p{L}+|veinti?\\p{L}*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa',
  'cien|ciento|\\p{L}+cientos|mil|millon\\p{L}*|medio',
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\p{L}+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety',
  'hundred|thousand|million\\p{L}*|half',
].join('|')

/** Importes: símbolo o moneda junto a cifras o números en palabras, en cualquier orden. */
const MONEY_AMOUNTS: readonly RegExp[] = [
  // € y £ casi nunca aparecen sin dinero; $ solo junto a cifras (código, LaTeX).
  /[€£]/u,
  /\$\s?\d/u,
  /\d\s?(?:k|m|mil)?\s?\$/u,
  new RegExp(`\\d\\s?(?:k|m|mil|millones)?\\s?(?:de\\s)?(?:${CURRENCY_WORDS})${WORD_END}`, 'u'),
  new RegExp(`${WORD_START}(?:${CURRENCY_WORDS})\\s?\\d`, 'u'),
  new RegExp(`${WORD_START}(?:${NUMBER_WORDS})${WORD_END}\\s+(?:de\\s+)?(?:${CURRENCY_WORDS})${WORD_END}`, 'u'),
]

/** Verdadero si el texto menciona dinero (importes o palabras económicas). */
export function hasMoney(text: string): boolean {
  const plain = plainText(text)
  return MONEY_WORD.test(plain) || MONEY_AMOUNTS.some(pattern => pattern.test(plain))
}

/**
 * Términos comerciales o económicos de un nombre de propiedad, ya sin tildes y
 * sin separadores. Se buscan dentro del nombre compacto: excluye también
 * `Budget2026`, `PrecioFinal` o `coste_interno`, y alguna propiedad inocente
 * que los contenga (preferible a dejar pasar una económica).
 */
const EXCLUDED_NAME_TERMS: readonly string[] = [
  'budget',
  'opportunit',
  'oportunidad',
  'account',
  'lead',
  'preview',
  'notionlink',
  'presupuest',
  'precio',
  'price',
  'pricing',
  'cost',
  'tarifa',
  'factur',
  'honorario',
  'fee',
  'invoic',
  'pago',
  'payment',
  'importe',
]

export function isExcludedPropertyName(name: string): boolean {
  const compact = foldText(name).replace(/[^\p{L}\p{N}]+/gu, '')
  return EXCLUDED_NAME_TERMS.some(term => compact.includes(term))
}

/**
 * Línea de texto con su sangría (niveles), su tabla si es una fila, y los
 * bloques que la contienen (aviso destacado, desplegable, columna, cita).
 */
export interface TextLine {
  readonly indent: number
  readonly text: string
  readonly table?: number
  readonly blocks?: readonly number[]
}

export interface RedactedText {
  readonly lines: readonly string[]
  /** Líneas omitidas (cada una cuenta, aunque se muestren juntas). */
  readonly omitted: number
}

/**
 * Sustituye las líneas económicas por OMITTED_MARK (una marca por tramo
 * seguido). Además de la línea, se omiten:
 * - todo bloque que la contenga (aviso destacado, desplegable, columna, cita),
 *   aunque la línea económica no sea la primera,
 * - sus hijos (líneas siguientes con más sangría),
 * - la sección de un encabezado económico, hasta otro de igual o mayor nivel,
 * - el resto de una tabla a partir de una fila económica (la cabecera arrastra
 *   las filas con cifras sin moneda).
 */
export function redactMoney(lines: readonly TextLine[]): RedactedText {
  const taintedBlocks = new Set<number>()
  for (const line of lines) {
    if (line.blocks && line.blocks.length > 0 && hasMoney(line.text)) {
      line.blocks.forEach(block => taintedBlocks.add(block))
    }
  }
  const output: string[] = []
  let omitted = 0
  let childrenOf: number | null = null
  let sectionLevel: number | null = null
  let table: number | null = null
  let previousOmitted = false
  for (const line of lines) {
    if (line.text.trim() === '') {
      // Sin blancos al principio ni repetidos, ni dentro de un tramo omitido.
      if (!previousOmitted && output.length > 0 && output[output.length - 1] !== '') {
        output.push('')
      }
      continue
    }
    const heading = /^(#{1,6})\s/.exec(line.text)
    if (sectionLevel !== null && heading && heading[1]!.length <= sectionLevel) {
      sectionLevel = null
    }
    if (childrenOf !== null && line.indent <= childrenOf) {
      childrenOf = null
    }
    if (table !== null && line.table !== table) {
      table = null
    }
    const money = hasMoney(line.text)
    const inTaintedBlock = line.blocks?.some(block => taintedBlocks.has(block)) ?? false
    if (!money && !inTaintedBlock && sectionLevel === null && childrenOf === null && table === null) {
      output.push(`${'  '.repeat(line.indent)}${line.text}`)
      previousOmitted = false
      continue
    }
    omitted += 1
    if (money) {
      if (heading && sectionLevel === null) {
        sectionLevel = heading[1]!.length
      }
      if (childrenOf === null) {
        childrenOf = line.indent
      }
      if (line.table !== undefined) {
        table = line.table
      }
    }
    if (!previousOmitted) {
      output.push(`${'  '.repeat(line.indent)}${OMITTED_MARK}`)
      previousOmitted = true
    }
  }
  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop()
  }
  return { lines: output, omitted }
}

/** Texto externo para avisos y nombres: si parece económico, no se muestra. */
export function safeLabel(text: string, fallback: string): string {
  return text && !hasMoney(text) ? text : fallback
}
