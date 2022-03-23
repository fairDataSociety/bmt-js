import {
  Chunk,
  ChunkAddress,
  DEFAULT_MAX_PAYLOAD_SIZE,
  DEFAULT_SPAN_SIZE,
  getSpanValue,
  makeChunk,
  SEGMENT_SIZE,
  Span,
} from '.'
import { Bytes, Flavor, keccak256Hash, serializeBytes } from './utils'

export interface ChunkedFile<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
> extends Flavor<'ChunkedFile'> {
  // zero level data chunks
  leafChunks(): Chunk<MaxChunkLength, SpanSize>[]
  rootChunk(): Chunk<MaxChunkLength, SpanSize>
  payload: Uint8Array
  address(): ChunkAddress
  span(): Span<SpanSize>
  bmtTree(): Chunk<MaxChunkLength, SpanSize>[][]
}

export function makeChunkedFile<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: Uint8Array,
  options?: {
    maxPayloadSize?: MaxChunkLength
    spanSize?: SpanSize
  },
): ChunkedFile<MaxChunkLength, SpanSize> {
  const maxPayloadSize = (options?.maxPayloadSize || DEFAULT_MAX_PAYLOAD_SIZE) as MaxChunkLength
  let calculatedRootChunk: Chunk<MaxChunkLength, SpanSize>

  //splitter
  const leafChunks = () => {
    const chunks: Chunk<MaxChunkLength, SpanSize>[] = []
    for (let offset = 0; offset < payload.length; offset += maxPayloadSize) {
      chunks.push(makeChunk(payload.slice(offset, offset + maxPayloadSize), options))
    }

    return chunks
  }
  // const span = () => makeSpan(payload.length, spanSize) as Span<SpanSize>
  const span = () => {
    if (!calculatedRootChunk) calculatedRootChunk = bmtRootChunk(leafChunks())

    return calculatedRootChunk.span()
  }
  const address = () => {
    if (!calculatedRootChunk) calculatedRootChunk = bmtRootChunk(leafChunks())

    return calculatedRootChunk.address()
  }
  const rootChunk = () => {
    if (!calculatedRootChunk) calculatedRootChunk = bmtRootChunk(leafChunks())

    return calculatedRootChunk
  }

  const bmtTreeFn = () => {
    const tree = bmtTree(leafChunks())
    calculatedRootChunk = tree[tree.length - 1][0]

    return tree
  }

  return {
    payload,
    span,
    leafChunks,
    address,
    rootChunk,
    bmtTree: bmtTreeFn,
  }
}

export interface ChunkInclusionProof<SpanSize extends number = typeof DEFAULT_SPAN_SIZE> {
  span: Bytes<SpanSize>
  sisterSegments: Uint8Array[]
}

function bmtTree<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(leafChunks: Chunk<MaxChunkLength, SpanSize>[]): Chunk<MaxChunkLength, SpanSize>[][] {
  if (leafChunks.length === 0) {
    throw new Error(`given chunk array is empty`)
  }

  // data level assign
  const levelChunks: Chunk<MaxChunkLength, SpanSize>[][] = [leafChunks]
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
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(chunks: Chunk<MaxChunkLength, SpanSize>[]): Chunk<MaxChunkLength, SpanSize> {
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
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: Chunk<MaxChunkLength, SpanSize>[],
  carrierChunk: Chunk<MaxChunkLength, SpanSize> | null,
): {
  nextLevelChunks: Chunk<MaxChunkLength, SpanSize>[]
  nextLevelCarrierChunk: Chunk<MaxChunkLength, SpanSize> | null
} {
  if (chunks.length === 0) {
    throw new Error('The given chunk array is empty')
  }
  const maxDataLength = chunks[0].maxDataLength
  const spanSize = chunks[0].spanSize
  // max segment count in one chunk. the segment size have to be equal to the chunk addresses
  const maxSegmentCount = maxDataLength / SEGMENT_SIZE //128 by default
  const nextLevelChunks: Chunk<MaxChunkLength, SpanSize>[] = []

  for (let offset = 0; offset < chunks.length; offset += maxSegmentCount) {
    const childrenChunks = chunks.slice(offset, offset + maxSegmentCount)
    nextLevelChunks.push(createParentChunk(childrenChunks, spanSize, maxDataLength))
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

function createParentChunk<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(childrenChunks: Chunk<MaxChunkLength, SpanSize>[], spanSize: SpanSize, maxPayloadSize: MaxChunkLength) {
  const chunkAddresses = childrenChunks.map(chunk => chunk.address())
  const chunkSpanSumValues = childrenChunks
    .map(chunk => getSpanValue(chunk.span()))
    .reduce((prev, curr) => prev + curr)
  const nextLevelChunkBytes = serializeBytes(...chunkAddresses)

  return makeChunk(nextLevelChunkBytes, {
    spanSize,
    startingSpanValue: chunkSpanSumValues,
    maxPayloadSize,
  })
}

/**
 * Removes carrier chunk of a the given chunk array and gives back
 *
 * @returns carrier chunk or undefined
 */
function popCarrierChunk<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(chunks: Chunk<MaxChunkLength, SpanSize>[]): Chunk<MaxChunkLength, SpanSize> | null {
  // chunks array has to be larger than 1 (a carrier count)
  if (chunks.length <= 1) return null
  const maxDataLength = chunks[0].maxDataLength
  // max segment count in one chunk. the segment size have to be equal to the chunk addresses
  const maxSegmentCount = maxDataLength / SEGMENT_SIZE

  return chunks.length % maxSegmentCount === 1 ? chunks.pop() || null : null
}

/**
 * Gives back required segments for inclusion proof of a given payload byte index
 */
export function fileInclusionProofBottomUp<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(chunkedFile: ChunkedFile<MaxChunkLength, SpanSize>, segmentIndex: number): ChunkInclusionProof<SpanSize>[] {
  if (segmentIndex * SEGMENT_SIZE >= getSpanValue(chunkedFile.span())) {
    throw new Error(
      `The given segment index ${segmentIndex * SEGMENT_SIZE} is greater than ${getSpanValue(
        chunkedFile.span(),
      )}`,
    )
  }

  let levelChunks = chunkedFile.leafChunks()
  const maxChunkPayload = levelChunks[0].maxDataLength
  const maxSegmentCount = maxChunkPayload / SEGMENT_SIZE // default 128
  const chunkBmtLevels = Math.log2(maxSegmentCount)
  let carrierChunk = popCarrierChunk(levelChunks)
  const chunkInclusionProofs: ChunkInclusionProof<SpanSize>[] = []
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
          nextLevelChunks: Chunk<MaxChunkLength, SpanSize>[]
          nextLevelCarrierChunk: Chunk<MaxChunkLength, SpanSize> | null
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

export function fileHashFromInclusionProof<SpanSize extends number = typeof DEFAULT_SPAN_SIZE>(
  proveChunks: ChunkInclusionProof<SpanSize>[],
  proveSegment: Uint8Array,
  proveSegmentIndex: number,
): Uint8Array {
  const fileSize = getSpanValue(proveChunks[proveChunks.length - 1].span)
  let calculatedHash = proveSegment
  for (const proveChunk of proveChunks) {
    const { chunkIndex: parentChunkIndex } = getSegmentIndexAndLevelInTree(proveSegmentIndex, fileSize)
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

/** Get chunk ID in the BMT tree */
export function getSegmentIndexAndLevelInTree(
  segmentIndex: number,
  spanValue: number,
  maxChunkPayloadByteLength = 4096,
): { level: number; chunkIndex: number } {
  const maxSegmentCount = maxChunkPayloadByteLength / SEGMENT_SIZE
  const chunkBmtLevels = Math.log2(maxSegmentCount) // 7 by default
  // the saturated byte length in the BMT tree (on the left)
  const fullBytesLength = spanValue - (spanValue % maxChunkPayloadByteLength)
  // the saturated segments length in the BMT tree (on the left)
  const fullSegmentsLength = fullBytesLength / SEGMENT_SIZE
  let level = 0
  if (segmentIndex >= fullSegmentsLength && segmentIndex < fullSegmentsLength + maxSegmentCount) {
    do {
      segmentIndex >>>= chunkBmtLevels
      level++
    } while (segmentIndex % SEGMENT_SIZE === 0)
    level--
  } else {
    segmentIndex >>>= chunkBmtLevels
  }

  return { chunkIndex: segmentIndex, level }
}
