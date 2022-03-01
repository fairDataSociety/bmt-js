import { keccak256 } from 'js-sha3'
import { makeSpan } from '.'
import { Bytes, keccak256Hash } from './utils'

const MAX_CHUNK_PAYLOAD_SIZE = 4096
const SEGMENT_SIZE = 32
const SEGMENT_PAIR_SIZE = 2 * SEGMENT_SIZE
const HASH_SIZE = 32

/**
 * Calculate a Binary Merkle Tree hash for a chunk
 *
 * The BMT chunk address is the hash of the 8 byte span and the root
 * hash of a binary Merkle tree (BMT) built on the 32-byte segments
 * of the underlying data.
 *
 * If the chunk content is less than 4k, the hash is calculated as
 * if the chunk was padded with all zeros up to 4096 bytes.
 *
 * @param payload Chunk data including span and payload as well
 *
 * @returns the keccak256 hash in a byte array
 */
export function bmtHash(payload: Uint8Array): Bytes<32> {
  const span = makeSpan(payload.length)
  const rootHash = bmtRootHash(payload)
  const chunkHashInput = new Uint8Array([...span, ...rootHash])
  const chunkHash = keccak256Hash(chunkHashInput)

  return chunkHash
}

function bmtRootHash(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_CHUNK_PAYLOAD_SIZE) {
    throw new Error(`invalid data length ${payload}`)
  }

  // create an input buffer padded with zeros
  let input = new Uint8Array([...payload, ...new Uint8Array(MAX_CHUNK_PAYLOAD_SIZE - payload.length)])
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
 * Gives back all level of the bmt of the payload
 *
 * @param payload any data in Uint8Array object
 * @returns array of the whole bmt hash level of the given data.
 * First level is the data itself until the last level that is the root hash itself.
 */
export function bmtTree(payload: Uint8Array): Uint8Array[] {
  if (payload.length > MAX_CHUNK_PAYLOAD_SIZE) {
    throw new Error(`invalid data length ${payload.length}`)
  }

  // create an input buffer padded with zeros
  let input = new Uint8Array([...payload, ...new Uint8Array(MAX_CHUNK_PAYLOAD_SIZE - payload.length)])
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
 * Gives back required inclusion proof segment pairs for a byte index of the given payload byte array
 *
 * @param payloadBytes data initialised in Uint8Array object
 * @param payloadBytesIndex byte index in the data array that has to be proofed for inclusion
 * @returns Required merged segment pairs for inclusion proofing starting from the data level and
 * the root hash of the payload
 */
export function inclusionProofBottomUp(
  payloadBytes: Uint8Array,
  payloadBytesIndex: number,
): { sisterSegments: Uint8Array[]; rootHash: Uint8Array } {
  if (payloadBytesIndex >= payloadBytes.length) {
    throw new Error(`The given segment index ${payloadBytesIndex} is greater than the payloadbyte length`)
  }

  const tree = bmtTree(payloadBytes)
  const sisterSegments: Array<Uint8Array> = []
  let segmentIndex = Math.floor(payloadBytesIndex / SEGMENT_SIZE)
  const rootHashLevel = tree.length - 1
  for (let level = 0; level < rootHashLevel; level++) {
    const mergeCoefficient = segmentIndex % 2 === 0 ? 1 : -1
    const sisterSegmentIndex = segmentIndex + SEGMENT_SIZE * mergeCoefficient
    const startIndex = sisterSegmentIndex < segmentIndex ? sisterSegmentIndex : segmentIndex
    const segments = tree[level].slice(startIndex, startIndex + SEGMENT_PAIR_SIZE)
    sisterSegments.push(segments)
    //segmentIndex for the next iteration
    segmentIndex = Math.floor(segmentIndex / 2)
  }

  return { sisterSegments, rootHash: tree[rootHashLevel] }
}