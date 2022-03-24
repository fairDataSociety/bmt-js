import { keccak256 } from 'js-sha3'
import { DEFAULT_SPAN_SIZE, makeSpan, Span } from './span'
import { assertFlexBytes, Bytes, keccak256Hash, Flavor, FlexBytes, serializeBytes } from './utils'

export const SEGMENT_SIZE = 32
const SEGMENT_PAIR_SIZE = 2 * SEGMENT_SIZE
export const DEFAULT_MAX_PAYLOAD_SIZE = 4096 as const
const HASH_SIZE = 32
export const DEFAULT_MIN_PAYLOAD_SIZE = 1 as const
export type ChunkAddress = Bytes<32>
type ValidChunkData = Uint8Array & Flavor<'ValidChunkData'>

export interface Chunk<
  MaxPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
> extends Flavor<'Chunk'> {
  readonly payload: FlexBytes<1, MaxPayloadLength>
  maxPayloadLength: MaxPayloadLength
  spanLength: SpanLength
  data(): ValidChunkData
  span(): Bytes<SpanLength>
  address(): ChunkAddress
  inclusionProof(segmentIndex: number): Uint8Array[]
  bmt(): Uint8Array[]
}

/**
 * Creates a content addressed chunk and verifies the payload size.
 *
 * @param payloadBytes the data to be stored in the chunk
 */
export function makeChunk<
  MaxPayloadSize extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payloadBytes: Uint8Array,
  options?: {
    maxPayloadSize?: MaxPayloadSize
    spanLength?: SpanLength
    startingSpanValue?: number
  },
): Chunk<MaxPayloadSize, SpanLength> {
  // assertion for the sizes are required because
  // typescript does not recognise subset relation on union type definition
  const maxPayloadLength = (options?.maxPayloadSize || DEFAULT_MAX_PAYLOAD_SIZE) as MaxPayloadSize
  const spanLength = (options?.spanLength || DEFAULT_SPAN_SIZE) as SpanLength
  const spanValue = options?.startingSpanValue || payloadBytes.length

  assertFlexBytes(payloadBytes, 1, maxPayloadLength)
  const paddingChunkLength = new Uint8Array(maxPayloadLength - payloadBytes.length)
  const span = () => makeSpan(spanValue, spanLength)
  const data = () => serializeBytes(payloadBytes, new Uint8Array(paddingChunkLength)) as ValidChunkData
  const inclusionProof = (segmentIndex: number) => inclusionProofBottomUp(data(), segmentIndex)
  const address = () => chunkAddress(payloadBytes, spanLength, span())
  const bmtFn = () => bmt(data(), maxPayloadLength)

  return {
    payload: payloadBytes,
    spanLength,
    maxPayloadLength,
    data,
    span,
    address,
    inclusionProof,
    bmt: bmtFn,
  }
}

export function bmtRootHash(
  payload: Uint8Array,
  maxPayloadLength: number = DEFAULT_MAX_PAYLOAD_SIZE, // default 4096
): Uint8Array {
  if (payload.length > maxPayloadLength) {
    throw new Error(`invalid data length ${payload}`)
  }

  // create an input buffer padded with zeros
  let input = new Uint8Array([...payload, ...new Uint8Array(maxPayloadLength - payload.length)])
  while (input.length !== HASH_SIZE) {
    const output = new Uint8Array(input.length / 2)

    // in each round we hash the segment pairs together
    for (let offset = 0; offset < input.length; offset += SEGMENT_PAIR_SIZE) {
      const hashNumbers = keccak256.array(input.slice(offset, offset + SEGMENT_PAIR_SIZE))
      output.set(hashNumbers, offset / 2)
    }

    input = output
  }

  return input
}

/**
 * Gives back required segments for inclusion proof of a given payload byte index
 *
 * @param payloadBytes chunk data initialised in Uint8Array object
 * @param segmentIndex segment index in the data array that has to be proofed for inclusion
 * @returns Required segments for inclusion proof starting from the data level
 * until the BMT root hash of the payload
 */
export function inclusionProofBottomUp(payloadBytes: Uint8Array, segmentIndex: number): Uint8Array[] {
  if (segmentIndex * SEGMENT_SIZE >= payloadBytes.length) {
    throw new Error(
      `The given segment index ${segmentIndex} is greater than ${payloadBytes.length / SEGMENT_SIZE}`,
    )
  }

  const tree = bmt(payloadBytes)
  const sisterSegments: Array<Uint8Array> = []
  const rootHashLevel = tree.length - 1
  for (let level = 0; level < rootHashLevel; level++) {
    const mergeCoefficient = segmentIndex % 2 === 0 ? 1 : -1
    const sisterSegmentIndex = segmentIndex + mergeCoefficient
    const sisterSegment = tree[level].slice(
      sisterSegmentIndex * SEGMENT_SIZE,
      (sisterSegmentIndex + 1) * SEGMENT_SIZE,
    )
    sisterSegments.push(sisterSegment)
    //segmentIndex for the next iteration
    segmentIndex >>>= 1
  }

  return sisterSegments
}

/** Calculates the BMT root hash from the provided inclusion proof segments and its corresponding segment index */
export function rootHashFromInclusionProof(
  proofSegments: Uint8Array[],
  proveSegment: Uint8Array,
  proveSegmentIndex: number,
): Uint8Array {
  let calculatedHash = proveSegment
  for (const proofSegment of proofSegments) {
    const mergeSegmentFromRight = proveSegmentIndex % 2 === 0 ? true : false
    calculatedHash = mergeSegmentFromRight
      ? keccak256Hash(calculatedHash, proofSegment)
      : keccak256Hash(proofSegment, calculatedHash)
    proveSegmentIndex >>>= 1
  }

  return calculatedHash
}

/**
 * Gives back all level of the bmt of the payload
 *
 * @param payload any data in Uint8Array object
 * @returns array of the whole bmt hash level of the given data.
 * First level is the data itself until the last level that is the root hash itself.
 */
function bmt(payload: Uint8Array, maxPayloadLength: number = DEFAULT_MAX_PAYLOAD_SIZE): Uint8Array[] {
  if (payload.length > maxPayloadLength) {
    throw new Error(`invalid data length ${payload.length}`)
  }

  // create an input buffer padded with zeros
  let input = new Uint8Array([...payload, ...new Uint8Array(maxPayloadLength - payload.length)])
  const tree: Uint8Array[] = []
  while (input.length !== HASH_SIZE) {
    tree.push(input)
    const output = new Uint8Array(input.length / 2)

    // in each round we hash the segment pairs together
    for (let offset = 0; offset < input.length; offset += SEGMENT_PAIR_SIZE) {
      const hashNumbers = keccak256.array(input.slice(offset, offset + SEGMENT_PAIR_SIZE))
      output.set(hashNumbers, offset / 2)
    }

    input = output
  }
  //add the last "input" that is the bmt root hash of the application
  tree.push(input)

  return tree
}

/**
 * Calculate the chunk address from the Binary Merkle Tree of the chunk data
 *
 * The BMT chunk address is the hash of the 8 byte span and the root
 * hash of a binary Merkle tree (BMT) built on the 32-byte segments
 * of the underlying data.
 *
 * If the chunk content is less than 4k, the hash is calculated as
 * if the chunk was padded with all zeros up to 4096 bytes.
 *
 * @param payload Chunk data Uint8Array
 * @param spanLength dedicated byte length for serializing span value of chunk
 * @param chunkSpan constucted Span uint8array object of the chunk
 *
 * @returns the keccak256 hash in a byte array
 */
function chunkAddress<SpanLength extends number = typeof DEFAULT_SPAN_SIZE>(
  payload: Uint8Array,
  spanLength?: SpanLength,
  chunkSpan?: Span<SpanLength>,
): Bytes<32> {
  const span = chunkSpan || makeSpan(payload.length, spanLength)
  const rootHash = bmtRootHash(payload)
  const chunkHashInput = new Uint8Array([...span, ...rootHash])
  const chunkHash = keccak256Hash(chunkHashInput)

  return chunkHash
}
