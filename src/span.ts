import { Bytes, Flavor } from './utils'

export const DEFAULT_SPAN_SIZE = 8 as const

export interface Span<Length extends number = typeof DEFAULT_SPAN_SIZE>
  extends Bytes<Length>,
    Flavor<'Span'> {}

// we limit the maximum span size in 32 bits to avoid BigInt compatibility issues
export const MAX_SPAN_LENGTH = 2 ** 32 - 1

/**
 * Create a span for storing the length of the chunk
 *
 * The length is encoded in 64-bit little endian.
 *
 * @param value The length of the span
 */
export function makeSpan<Length extends number>(value: number, length?: Length): Span<Length> {
  const spanLength = length || DEFAULT_SPAN_SIZE

  if (value <= 0) {
    throw new Error(`invalid length for span: ${value}`)
  }

  if (value > MAX_SPAN_LENGTH) {
    throw new Error(`invalid length (> ${MAX_SPAN_LENGTH}) ${value}`)
  }

  const span = new Uint8Array(spanLength)
  const dataView = new DataView(span.buffer)
  const littleEndian = false
  const lengthLower32 = value & 0xffffffff

  dataView.setUint32(0, lengthLower32, littleEndian)

  return span as Bytes<Length>
}

export function getSpanValue<Length extends number = 8>(span: Span<Length>): number {
  const dataView = new DataView(span.buffer)

  return dataView.getUint32(0, false)
}
