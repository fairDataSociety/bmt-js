import { Chunk, ChunkAddress, getSpanValue, makeChunk, makeSpan, Span } from '.'
import { DEFAULT_MAX_PAYLOAD_SIZE, SEGMENT_SIZE } from './chunk'
import { DEFAULT_SPAN_SIZE } from './span'
import { Bytes, Flavor, keccak256Hash, serializeBytes } from './utils'

export interface ChunkInclusionProof<SpanLength extends number = typeof DEFAULT_SPAN_SIZE> {
  span: Bytes<SpanLength>
  sisterSegments: Uint8Array[]
}

export interface ChunkedFile<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
> extends Flavor<'ChunkedFile'> {
  // zero level data chunks
  leafChunks(): Chunk<MaxChunkPayloadLength, SpanLength>[]
  rootChunk(): Chunk<MaxChunkPayloadLength, SpanLength>
  payload: Uint8Array
  address(): ChunkAddress
  span(): Span<SpanLength>
  bmt(): Chunk<MaxChunkPayloadLength, SpanLength>[][]
}

/**
 * Creates object for performing BMT functions on payload data
 *
 * @param payload byte array of the data
 * @param options settings for the used chunks
 * @returns ChunkedFile object with helper methods
 */
export function makeChunkedFile<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: Uint8Array,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): ChunkedFile<MaxChunkPayloadLength, SpanLength> {
  const maxPayloadLength = (options?.maxPayloadLength || DEFAULT_MAX_PAYLOAD_SIZE) as MaxChunkPayloadLength
  const spanLength = (options?.spanLength || DEFAULT_SPAN_SIZE) as SpanLength

  //splitter
  const leafChunks = () => {
    const chunks: Chunk<MaxChunkPayloadLength, SpanLength>[] = []
    for (let offset = 0; offset < payload.length; offset += maxPayloadLength) {
      chunks.push(makeChunk(payload.slice(offset, offset + maxPayloadLength), options))
    }

    return chunks
  }
  const span = () => makeSpan(payload.length, spanLength) as Span<SpanLength>
  const address = () => bmtRootChunk(leafChunks()).address()
  const rootChunk = () => bmtRootChunk(leafChunks())
  const bmtFn = () => bmt(leafChunks())

  return {
    payload,
    span,
    leafChunks,
    address,
    rootChunk,
    bmt: bmtFn,
  }
}

/**
 * Gives back required sister segments of a given payload segment index for inclusion proof
 *
 * @param chunkedFile initialised ChunkedFile object of the data
 * @param segmentIndex the segment index of the payload
 * @returns sister segments by chunks and the corresponding span of the chunk for calculating chunk address
 */
export function fileInclusionProofBottomUp<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunkedFile: ChunkedFile<MaxChunkPayloadLength, SpanLength>,
  segmentIndex: number,
): ChunkInclusionProof<SpanLength>[] {
  if (segmentIndex * SEGMENT_SIZE >= getSpanValue(chunkedFile.span())) {
    throw new Error(
      `The given segment index ${segmentIndex} is greater than ${Math.floor(
        getSpanValue(chunkedFile.span()) / SEGMENT_SIZE,
      )}`,
    )
  }

  let levelChunks = chunkedFile.leafChunks()
  const maxChunkPayload = levelChunks[0].maxPayloadLength
  const maxSegmentCount = maxChunkPayload / SEGMENT_SIZE // default 128
  const chunkBmtLevels = Math.log2(maxSegmentCount)
  let carrierChunk = popCarrierChunk(levelChunks)
  const chunkInclusionProofs: ChunkInclusionProof<SpanLength>[] = []
  while (levelChunks.length !== 1 || carrierChunk) {
    const chunkSegmentIndex = segmentIndex % maxSegmentCount
    let chunkIndexForProof = Math.floor(segmentIndex / maxSegmentCount)

    //edge-case carrier chunk
    if (chunkIndexForProof === levelChunks.length) {
      //carrier chunk has been placed to somewhere else in the bmtTree
      if (!carrierChunk) throw new Error('Impossible')
      segmentIndex >>>= chunkBmtLevels //log2(128) -> skip this level check now
      do {
        const {
          nextLevelChunks,
          nextLevelCarrierChunk,
        }: {
          nextLevelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[]
          nextLevelCarrierChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null
        } = nextBmtLevel(levelChunks, carrierChunk)
        levelChunks = nextLevelChunks
        carrierChunk = nextLevelCarrierChunk
        segmentIndex >>>= chunkBmtLevels
      } while (segmentIndex % maxSegmentCount === 0)
      // the carrier chunk is already placed in the BMT tree
      chunkIndexForProof = levelChunks.length - 1
      // continue the inclusion proofing of the inserted carrierChunk address
    }
    const chunk = levelChunks[chunkIndexForProof]
    const sisterSegments = chunk.inclusionProof(chunkSegmentIndex)
    chunkInclusionProofs.push({ sisterSegments, span: chunk.span() })
    segmentIndex = chunkIndexForProof

    const { nextLevelChunks, nextLevelCarrierChunk } = nextBmtLevel(levelChunks, carrierChunk)
    levelChunks = nextLevelChunks
    carrierChunk = nextLevelCarrierChunk
  }
  const sisterSegments = levelChunks[0].inclusionProof(segmentIndex)
  chunkInclusionProofs.push({ sisterSegments, span: levelChunks[0].span() })

  return chunkInclusionProofs
}

/**
 * Gives back the file address that is calculated with only the inclusion proof segments
 * and the corresponding proved segment and its position.
 *
 * @param proveChunks sister segments that will be hashed together with the calculated hashes
 * @param proveSegment the segment that is wanted to be validated it is subsumed under the file address
 * @param proveSegmentIndex the `proveSegment`'s segment index on its BMT level
 * @returns the calculated file address
 */
export function fileAddressFromInclusionProof<SpanLength extends number = typeof DEFAULT_SPAN_SIZE>(
  proveChunks: ChunkInclusionProof<SpanLength>[],
  proveSegment: Uint8Array,
  proveSegmentIndex: number,
): Uint8Array {
  const fileSize = getSpanValue(proveChunks[proveChunks.length - 1].span)
  let calculatedHash = proveSegment
  for (const proveChunk of proveChunks) {
    const { chunkIndex: parentChunkIndex } = getBmtIndexOfSegment(proveSegmentIndex, fileSize)
    for (const proofSegment of proveChunk.sisterSegments) {
      const mergeSegmentFromRight = proveSegmentIndex % 2 === 0 ? true : false
      calculatedHash = mergeSegmentFromRight
        ? keccak256Hash(calculatedHash, proofSegment)
        : keccak256Hash(proofSegment, calculatedHash)
      proveSegmentIndex = Math.floor(proveSegmentIndex / 2)
    }
    calculatedHash = keccak256Hash(proveChunk.span, calculatedHash)
    // this line is necessary if the proveSegmentIndex
    // was in a carrierChunk
    proveSegmentIndex = parentChunkIndex
  }

  return calculatedHash
}

/**
 * Get the chunk's position of a given payload segment index in the BMT tree
 *
 * The BMT buils up in an optimalized way, where an orphan/carrier chunk
 * can be inserted into a higher level of the tree. It may cause that
 * the segment index of a payload cannot be found in the lowest level where the splitter
 * originally created its corresponding chunk.
 *
 * @param segmentIndex the segment index of the payload
 * @param spanValue the byte length of the payload on which the BMT tree is built
 * @param maxChunkPayloadByteLength what is the maximum byte length of a chunk. Default is 4096
 * @returns level and position of the chunk that contains segment index of the payload
 */
export function getBmtIndexOfSegment(
  segmentIndex: number,
  spanValue: number,
  maxChunkPayloadByteLength = 4096,
): { level: number; chunkIndex: number } {
  const maxSegmentCount = Math.floor(maxChunkPayloadByteLength / SEGMENT_SIZE)
  const maxChunkIndex = Math.floor(spanValue / maxChunkPayloadByteLength)
  const chunkBmtLevels = Math.log2(maxSegmentCount) // 7 by default
  let level = 0
  if (Math.floor(segmentIndex / maxSegmentCount) === maxChunkIndex && maxChunkIndex % maxSegmentCount === 0) {
    // segmentIndex in carrier chunk
    segmentIndex >>>= chunkBmtLevels
    while (segmentIndex % SEGMENT_SIZE === 0) {
      level++
      segmentIndex >>>= chunkBmtLevels
    }
  } else {
    segmentIndex >>>= chunkBmtLevels
  }

  return { chunkIndex: segmentIndex, level }
}

function bmt<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(leafChunks: Chunk<MaxChunkPayloadLength, SpanLength>[]): Chunk<MaxChunkPayloadLength, SpanLength>[][] {
  if (leafChunks.length === 0) {
    throw new Error(`given chunk array is empty`)
  }

  // data level assign
  const levelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[][] = [leafChunks]
  let carrierChunk = popCarrierChunk(leafChunks)
  while (levelChunks[levelChunks.length - 1].length !== 1) {
    const { nextLevelChunks, nextLevelCarrierChunk } = nextBmtLevel(
      levelChunks[levelChunks.length - 1],
      carrierChunk,
    )
    carrierChunk = nextLevelCarrierChunk
    levelChunks.push(nextLevelChunks)
  }

  return levelChunks
}

function bmtRootChunk<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(chunks: Chunk<MaxChunkPayloadLength, SpanLength>[]): Chunk<MaxChunkPayloadLength, SpanLength> {
  if (chunks.length === 0) {
    throw new Error(`given chunk array is empty`)
  }

  // zero level assign
  let levelChunks = chunks
  let carrierChunk = popCarrierChunk(levelChunks)

  while (levelChunks.length !== 1 || carrierChunk) {
    const { nextLevelChunks, nextLevelCarrierChunk } = nextBmtLevel(levelChunks, carrierChunk)
    levelChunks = nextLevelChunks
    carrierChunk = nextLevelCarrierChunk
  }

  return levelChunks[0]
}

function nextBmtLevel<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: Chunk<MaxChunkPayloadLength, SpanLength>[],
  carrierChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null,
): {
  nextLevelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[]
  nextLevelCarrierChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null
} {
  if (chunks.length === 0) {
    throw new Error('The given chunk array is empty')
  }
  const maxPayloadLength = chunks[0].maxPayloadLength
  const spanLength = chunks[0].spanLength
  // max segment count in one chunk. the segment size have to be equal to the chunk addresses
  const maxSegmentCount = maxPayloadLength / SEGMENT_SIZE //128 by default
  const nextLevelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[] = []

  for (let offset = 0; offset < chunks.length; offset += maxSegmentCount) {
    const childrenChunks = chunks.slice(offset, offset + maxSegmentCount)
    nextLevelChunks.push(createIntermediateChunk(childrenChunks, spanLength, maxPayloadLength))
  }

  //edge case handling when there is carrierChunk
  let nextLevelCarrierChunk = carrierChunk

  if (carrierChunk) {
    // try to merge carrier chunk if it first to its parents payload
    if (nextLevelChunks.length % maxSegmentCount !== 0) {
      nextLevelChunks.push(carrierChunk)
      nextLevelCarrierChunk = null //merged
    } // or nextLevelCarrierChunk remains carrierChunk
  } else {
    // try to pop carrier chunk if it exists on the level
    nextLevelCarrierChunk = popCarrierChunk(nextLevelChunks)
  }

  return {
    nextLevelChunks,
    nextLevelCarrierChunk,
  }
}

function createIntermediateChunk<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  childrenChunks: Chunk<MaxChunkPayloadLength, SpanLength>[],
  spanLength: SpanLength,
  maxPayloadSize: MaxChunkPayloadLength,
) {
  const chunkAddresses = childrenChunks.map(chunk => chunk.address())
  const chunkSpanSumValues = childrenChunks
    .map(chunk => getSpanValue(chunk.span()))
    .reduce((prev, curr) => prev + curr)
  const nextLevelChunkBytes = serializeBytes(...chunkAddresses)

  return makeChunk(nextLevelChunkBytes, {
    spanLength,
    startingSpanValue: chunkSpanSumValues,
    maxPayloadSize,
  })
}

/**
 * Removes carrier chunk of a the given chunk array and gives it back
 *
 * @returns carrier chunk or undefined
 */
function popCarrierChunk<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(chunks: Chunk<MaxChunkPayloadLength, SpanLength>[]): Chunk<MaxChunkPayloadLength, SpanLength> | null {
  // chunks array has to be larger than 1 (a carrier count)
  if (chunks.length <= 1) return null
  const maxDataLength = chunks[0].maxPayloadLength
  // max segment count in one chunk. the segment size have to be equal to the chunk addresses
  const maxSegmentCount = maxDataLength / SEGMENT_SIZE

  return chunks.length % maxSegmentCount === 1 ? chunks.pop() || null : null
}
