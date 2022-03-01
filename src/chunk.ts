import { bmtHash } from './bmt'
import { DEFAULT_SPAN_SIZE, makeSpan } from './span'
import { assertFlexBytes, Bytes, Flavor, FlexBytes, serializeBytes } from './utils'

const DEFAULT_MAX_PAYLOAD_SIZE = 4096 as const
const DEFAULT_MIN_PAYLOAD_SIZE = 1 as const
export type ChunkAddress = Bytes<32>
type ValidChunkData = Uint8Array & Flavor<'ValidChunkData'>

export interface Chunk<
  MaxLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  MinLength extends number = typeof DEFAULT_MIN_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
> extends Flavor<'Chunk'> {
  readonly payload: FlexBytes<MinLength, MaxLength>
  data(): ValidChunkData
  span(): Bytes<SpanSize>
  address(): ChunkAddress
}

/**
 * Creates a content addressed chunk and verifies the payload size.
 *
 * @param payloadBytes the data to be stored in the chunk
 */
export function makeChunk<
  MaxPayloadSize extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  MinPayloadSize extends number = typeof DEFAULT_MIN_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payloadBytes: Uint8Array,
  options?: {
    maxPayloadSize?: MaxPayloadSize
    minPayloadSize?: MinPayloadSize
    spanSize?: SpanSize
  },
): Chunk<MaxPayloadSize, MinPayloadSize, SpanSize> {
  // assertion for the sizes are required because
  // typescript does not recognise subset relation on union type definition
  const maxPayloadSize = (options?.maxPayloadSize || DEFAULT_MAX_PAYLOAD_SIZE) as MaxPayloadSize
  const minPayloadSize = (options?.minPayloadSize || DEFAULT_MIN_PAYLOAD_SIZE) as MinPayloadSize
  const spanSize = (options?.spanSize || DEFAULT_SPAN_SIZE) as SpanSize

  assertFlexBytes(payloadBytes, minPayloadSize, maxPayloadSize)
  const paddingChunkLength = new Uint8Array(maxPayloadSize - payloadBytes.length)
  const spanFn = () => makeSpan(payloadBytes.length, spanSize)
  const dataFn = () => serializeBytes(payloadBytes, new Uint8Array(paddingChunkLength)) as ValidChunkData

  return {
    payload: payloadBytes,
    data: dataFn,
    span: spanFn,
    address: () => bmtHash(payloadBytes),
  }
}
