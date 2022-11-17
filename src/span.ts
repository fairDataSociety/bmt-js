import { Bytes, bytesToHex, Flavor } from './utils'

export const DEFAULT_SPAN_SIZE = 8 as const

export interface Span<Length extends number = typeof DEFAULT_SPAN_SIZE>
  extends Bytes<Length>,
    Flavor<'Span'> {}

// we limit the maximum span size to avoid BigInt compatibility issues
export const MAX_SPAN_LENGTH = Number.MAX_SAFE_INTEGER

/**
 * Create a span for storing the length of the chunk
 *
 * The length is encoded in 64-bit little endian.
 *
 * @param value The length of the span
 */
export function makeSpan<Length extends number>(value: number, length?: Length): Span<Length> {
  const spanLength = length || DEFAULT_SPAN_SIZE

  if (value < 0) {
    throw new Error(`invalid length for span: ${value}`)
  }

  if (value > MAX_SPAN_LENGTH) {
    throw new Error(`invalid length (> ${MAX_SPAN_LENGTH}) ${value}`)
  }

  const span = new Uint8Array(spanLength)
  const dataView = new DataView(span.buffer)
  const littleEndian = true
  const hi32 = Math.floor(value / (2 ** 32))
  const lo32 = value % (2 ** 32)

  dataView.setUint32(0, lo32, littleEndian)
  dataView.setUint32(4, hi32, littleEndian)

  return span as Bytes<Length>
}

export function getSpanValue<Length extends number = 8>(span: Span<Length>): number {
  const dataView = new DataView(span.buffer)

  const lo32 = dataView.getUint32(0, true)
  const hi32 = dataView.getUint32(4, true) * (2 ** 32)
  const value = lo32 + hi32

  if (value > Number.MAX_SAFE_INTEGER || value < 0) {
    throw new Error(`invalid span value: ${bytesToHex(span, 16)}`)
  }

  return value
}
