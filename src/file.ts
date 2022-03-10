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

  // zero level assign
  const levelChunks: Chunk<MaxChunkLength, SpanSize>[][] = [leafChunks]
  while (levelChunks[levelChunks.length - 1].length !== 1) {
    levelChunks.push(nextBmtLevel(levelChunks[levelChunks.length - 1]))
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
  while (levelChunks.length !== 1) {
    levelChunks = nextBmtLevel(levelChunks)
  }

  return levelChunks[0]
}

function nextBmtLevel<
  MaxChunkLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanSize extends number = typeof DEFAULT_SPAN_SIZE,
>(chunks: Chunk<MaxChunkLength, SpanSize>[]): Chunk<MaxChunkLength, SpanSize>[] {
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
    const chunkAddresses = childrenChunks.map(chunk => chunk.address())
    const chunkSpanSumValues = childrenChunks
      .map(chunk => getSpanValue(chunk.span()))
      .reduce((prev, curr) => prev + curr)
    const nextLevelChunkBytes = serializeBytes(...chunkAddresses)
    nextLevelChunks.push(
      makeChunk(nextLevelChunkBytes, {
        spanSize,
        startingSpanValue: chunkSpanSumValues,
        maxPayloadSize: maxDataLength,
      }),
    )
  }

  return nextLevelChunks
}
