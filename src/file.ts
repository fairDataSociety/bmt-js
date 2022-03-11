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
import { Flavor, serializeBytes } from './utils'

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
  const maxSegmentCount = maxDataLength / SEGMENT_SIZE
  const nextLevelChunks: Chunk<MaxChunkLength, SpanSize>[] = []

  for (let offset = 0; offset < chunks.length; offset += maxSegmentCount) {
    const childrenChunks = chunks.slice(offset, offset + maxSegmentCount)
    nextLevelChunks.push(createParentChunk(childrenChunks, spanSize, maxDataLength))
  }

  //edge case handling when there is carrierChunk
  const lastChunkOnNextLevel = nextLevelChunks[nextLevelChunks.length - 1]
  let nextLevelCarrierChunk = carrierChunk

  if (carrierChunk) {
    // try to merge carrier chunk if it first to its parents payload
    if (lastChunkOnNextLevel.payload.length < maxDataLength) {
      nextLevelChunks[nextLevelChunks.length - 1] = makeChunk(
        new Uint8Array([...lastChunkOnNextLevel.payload, ...carrierChunk.address()]),
        {
          spanSize,
          startingSpanValue: getSpanValue(lastChunkOnNextLevel.span()) + getSpanValue(carrierChunk.span()),
          maxPayloadSize: maxDataLength,
        },
      )
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
