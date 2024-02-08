import { Chunk, ChunkAddress, DEFAULT_MAX_PAYLOAD_SIZE, SEGMENT_SIZE, makeChunk } from './chunk'
import { createIntermediateChunk, nextBmtLevel } from './file'
import { DEFAULT_SPAN_SIZE, Span, makeSpan } from './span'
import { Deferred, Flavor, concatBytes } from './utils'

export interface GenericReadable<T> {
  on(event: 'close', listener: () => void): this
  on(event: 'data', listener: (chunk: T) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  push(chunk: unknown, encoding?: BufferEncoding): boolean
  destroy(error?: Error): this
  emit(event: 'error', err: Error): boolean
}

export interface ChunkedFileDeferred<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
> extends Flavor<'ChunkedFile'> {
  // zero level data chunks
  leafChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>
  rootChunk: Promise<Chunk<MaxChunkPayloadLength, SpanLength>>
  payload: GenericReadable<Uint8Array>
  address: Promise<ChunkAddress>
  span: Promise<Span<SpanLength>>
  bmt: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>
}

/**
 * Calculates total number of bytes received in given readable stream
 * @param payload byte array stream
 * @returns Total number of bytes resolved by a promise
 */
async function getByteStreamLength(payload: GenericReadable<Uint8Array>): Promise<number> {
  return new Promise((resolve, reject) => {
    let dataLength = 0
    payload.on('data', chunk => (dataLength += chunk.length))

    payload.on('close', () => resolve(dataLength))

    payload.on('error', error => reject(error))
  })
}

/**
 * Creates object for performing BMT functions on payload data using streams
 *
 * @param payload byte array stream of the data
 * @param chunkStreamFactory A factory function for a readable stream
 * @param options settings for the used chunks
 * @returns ChunkedFileDeferred object with helper methods
 */
export function makeChunkedFileWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): ChunkedFileDeferred<MaxChunkPayloadLength, SpanLength> {
  const spanLength = (options?.spanLength || DEFAULT_SPAN_SIZE) as SpanLength
  const payloadLengthPromise = getByteStreamLength(payload)

  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)

  const rootChunk = bmtRootChunkWithStreams(leafStream, chunkStreamFactory)

  const address = new Promise(async (resolve, reject) => {
    try {
      resolve((await rootChunk).address())
    } catch (error) {
      reject(error)
    }
  })

  const span = new Promise<Span<SpanLength>>(async (resolve, reject) => {
    try {
      resolve(makeSpan(await payloadLengthPromise, spanLength))
    } catch (error) {
      reject(error)
    }
  })

  const bmt = bmtWithStreams(leafStream, chunkStreamFactory)

  return {
    payload,
    span,
    leafChunks: leafStream,
    address: address as Promise<ChunkAddress>,
    rootChunk,
    bmt,
  }
}

/**
 * Generates BMT chunks and outputs them to a readable stream.
 * @param payload Readable stream of Uint8Array data
 * @param chunkStreamFactory A factory function for a readable stream
 * @param options settings for the used chunks
 * @returns A readable stream with all chunks from BMT. Levels are separated
 * by empty chunks (payload.length === 0)
 */
export function createBmtWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)

  return bmtWithStreams(leafStream, chunkStreamFactory)
}

/**
 * Calculates root chunk for bytes received by a readable stream
 * @param payload Readable stream of Uint8Array data
 * @param chunkStreamFactory A factory function for a readable stream
 * @param options settings for the used chunks
 * @returns Promise resolved with root chunk
 */
export async function createBmtRootChunkWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): Promise<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)

  return bmtRootChunkWithStreams(leafStream, chunkStreamFactory)
}

/**
 * Returns a readable stream of leaf chunks for received bytes.
 * @param payload Readable stream of Uint8Array data
 * @param chunkStreamFactory A factory function for a readable stream
 * @param options settings for the used chunks
 */
export function createLeafChunksStream<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const maxPayloadLength = (options?.maxPayloadLength || DEFAULT_MAX_PAYLOAD_SIZE) as MaxChunkPayloadLength

  let buffer: Uint8Array = new Uint8Array()
  let dataLength = 0
  const leafStream = chunkStreamFactory()

  payload.on('data', chunk => {
    buffer = concatBytes(buffer, chunk)
    dataLength += chunk.length

    for (let offset = 0; offset + maxPayloadLength <= buffer.length; offset += maxPayloadLength) {
      leafStream.push(makeChunk(buffer.slice(offset, offset + maxPayloadLength), options))
    }

    if (buffer.length >= maxPayloadLength) {
      buffer = buffer.slice(Math.floor(buffer.length / maxPayloadLength) * maxPayloadLength, buffer.length)
    }
  })

  payload.on('close', () => {
    if (dataLength === 0) {
      leafStream.push(makeChunk(new Uint8Array(), options))
    } else {
      for (let offset = 0; offset < buffer.length; offset += maxPayloadLength) {
        leafStream.push(makeChunk(buffer.slice(offset, offset + maxPayloadLength), options))
      }
    }

    leafStream.destroy()
  })

  payload.on('error', error => {
    leafStream.emit('error', error)
  })

  return leafStream
}

/**
 * Generates BMT chunks and outputs them to a readable stream.
 * @param chunks Readable stream of leaf chunks
 * @param chunkStreamFactory A factory function for a readable stream
 * @returns A readable stream with all chunks from BMT. Levels are separated
 * by empty chunks (payload.length === 0)
 */
function bmtWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  leafChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const outputStream = chunkStreamFactory()
  let chunksLength = 0

  try {
    let firstChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null = null
    let prevChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null = null

    leafChunks.on('data', chunk => {
      chunksLength += 1

      if (chunksLength === 1) {
        firstChunk = chunk
      }

      if (prevChunk) {
        outputStream.push(prevChunk)
      }

      prevChunk = chunk
    })

    leafChunks.on('close', () => {
      try {
        if (chunksLength === 0) {
          throw new Error(`given chunk array is empty`)
        }

        if (!shouldPopCarrierChunk(firstChunk as Chunk<MaxChunkPayloadLength, SpanLength>, chunksLength)) {
          outputStream.push(prevChunk)
        }

        if (chunksLength === 1) {
          outputStream.destroy()
        } else {
          outputStream.push(makeChunk(new Uint8Array()))
        }
      } catch (error) {
        outputStream.emit('error', error as Error)
      }
    })

    leafChunks.on('error', error => outputStream.emit('error', error))

    const { nextCarrierChunk: nextLevelCarrierChunk, nextLevelChunks } = firstBmtLevelWithStreams(
      leafChunks,
      chunkStreamFactory,
    )

    let levelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[] = []

    nextLevelChunks.on('data', chunk => levelChunks.push(chunk))

    nextLevelChunks.on('close', async () => {
      let carrierChunk = await nextLevelCarrierChunk

      levelChunks.forEach(chunk => outputStream.push(chunk))

      while (levelChunks.length !== 1) {
        outputStream.push(makeChunk(new Uint8Array()))

        const { nextLevelChunks, nextLevelCarrierChunk } = nextBmtLevel(levelChunks, carrierChunk)

        nextLevelChunks.forEach(chunk => outputStream.push(chunk))

        levelChunks = nextLevelChunks
        carrierChunk = nextLevelCarrierChunk
      }

      outputStream.destroy()
    })

    nextLevelChunks.on('error', error => {
      outputStream.emit('error', error)
    })
  } catch (error) {
    outputStream.emit('error', error as Error)
  }

  return outputStream
}

/**
 * Calculates root chunk for leaf chunks received by a readable stream
 * @param chunks Readable stream of leaf chunks
 * @param chunkStreamFactory A factory function for a readable stream
 * @returns Promise resolved with root chunk
 */
async function bmtRootChunkWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): Promise<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const result = new Deferred<Chunk<MaxChunkPayloadLength, SpanLength>>()
  let chunksLength = 0

  try {
    const { nextCarrierChunk: nextLevelCarrierChunk, nextLevelChunks } = firstBmtLevelWithStreams(
      chunks,
      chunkStreamFactory,
    )

    let levelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[] = []

    nextLevelChunks.on('data', chunk => {
      chunksLength += 1
      levelChunks.push(chunk)
    })

    nextLevelChunks.on('close', async () => {
      if (chunksLength === 0) {
        result.reject(new Error(`given chunk array is empty`))
      }

      let carrierChunk = await nextLevelCarrierChunk

      while (levelChunks.length !== 1 || carrierChunk) {
        const { nextLevelChunks, nextLevelCarrierChunk } = nextBmtLevel(levelChunks, carrierChunk)
        levelChunks = nextLevelChunks
        carrierChunk = nextLevelCarrierChunk
      }

      result.resolve(levelChunks[0])
    })

    nextLevelChunks.on('error', error => {
      result.reject(error)
    })
  } catch (error) {
    result.reject(error)
  }

  return result.promise
}

/**
 * A helper function that generates first level of intermediate chunks using streams.
 * @param chunks Readable stream of leaf chunks
 * @param chunkArrayStreamFactory A factory function for a readable stream
 * @returns A readable stream of first level intermediate chunks and a promise of
 * carrierChunk for this level
 */
function firstBmtLevelWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunkArrayStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): {
  nextLevelChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>
  nextCarrierChunk: Promise<Chunk<MaxChunkPayloadLength, SpanLength> | null>
} {
  const nextLevelChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> = chunkArrayStreamFactory()

  let firstReceivedChunk: Chunk<MaxChunkPayloadLength, SpanLength>
  let lastReceivedChunk: Chunk<MaxChunkPayloadLength, SpanLength>
  let firstSentChunk: Chunk<MaxChunkPayloadLength, SpanLength>

  let prevIntermediateChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null = null

  const nextCarrierChunk = new Deferred<Chunk<MaxChunkPayloadLength, SpanLength> | null>()
  let nextLevelChunksBuffer: Chunk<MaxChunkPayloadLength, SpanLength>[] = []
  let generatedChunksCount = 0
  let receivedChunks = 0
  let maxPayloadLength: number
  let spanLength: number
  let maxSegmentCount: number

  const handleChunk = (chunk: Chunk<MaxChunkPayloadLength, SpanLength>) => {
    generatedChunksCount += 1

    if (!firstReceivedChunk) {
      firstReceivedChunk = chunk
    }

    if (generatedChunksCount === 1) {
      firstSentChunk = chunk
    }

    nextLevelChunks.push(chunk)
  }

  chunks.on('data', chunk => {
    try {
      receivedChunks += 1

      lastReceivedChunk = chunk

      nextLevelChunksBuffer.push(chunk)

      if (receivedChunks === 1) {
        firstReceivedChunk = chunk
        maxPayloadLength = chunk.maxPayloadLength
        spanLength = chunk.spanLength
        maxSegmentCount = maxPayloadLength / SEGMENT_SIZE
      }

      for (
        let offset = 0;
        offset + maxSegmentCount < nextLevelChunksBuffer.length;
        offset += maxSegmentCount
      ) {
        if (prevIntermediateChunk) {
          handleChunk(prevIntermediateChunk)
        }
        const childrenChunks = nextLevelChunksBuffer.slice(offset, offset + maxSegmentCount)
        prevIntermediateChunk = createIntermediateChunk(
          childrenChunks,
          spanLength,
          maxPayloadLength,
        ) as Chunk<MaxChunkPayloadLength, SpanLength>
      }

      if (nextLevelChunksBuffer.length > maxSegmentCount) {
        nextLevelChunksBuffer = nextLevelChunksBuffer.slice(
          Math.floor(nextLevelChunksBuffer.length / maxSegmentCount) * maxSegmentCount,
          nextLevelChunksBuffer.length,
        )
      }
    } catch (error) {
      nextLevelChunks.emit('error', error as Error)
      nextCarrierChunk.reject(error)
    }
  })

  chunks.on('close', () => {
    let nextCarrierChunkValue: Chunk<MaxChunkPayloadLength, SpanLength> | null = null

    try {
      if (receivedChunks === 0) {
        throw new Error('The given chunk array is empty')
      }

      const popCarrierChunk = shouldPopCarrierChunk(firstReceivedChunk, receivedChunks)

      if (popCarrierChunk) {
        nextLevelChunksBuffer.pop()
      }

      if (receivedChunks === 1 && !popCarrierChunk) {
        return nextLevelChunks.push(firstReceivedChunk)
      }

      for (let offset = 0; offset < nextLevelChunksBuffer.length; offset += maxSegmentCount) {
        if (prevIntermediateChunk) {
          handleChunk(prevIntermediateChunk)
        }
        const childrenChunks = nextLevelChunksBuffer.slice(offset, offset + maxSegmentCount)
        prevIntermediateChunk = createIntermediateChunk(
          childrenChunks,
          spanLength,
          maxPayloadLength,
        ) as Chunk<MaxChunkPayloadLength, SpanLength>
      }

      if (popCarrierChunk || !shouldPopCarrierChunk(firstSentChunk, generatedChunksCount + 1)) {
        handleChunk(prevIntermediateChunk as Chunk<MaxChunkPayloadLength, SpanLength>)
      } else if (shouldPopCarrierChunk(firstSentChunk, generatedChunksCount + 1)) {
        nextCarrierChunkValue = prevIntermediateChunk
      }

      if (popCarrierChunk && generatedChunksCount % maxSegmentCount !== 0) {
        nextLevelChunks.push(lastReceivedChunk)
      }
    } catch (error) {
      nextLevelChunks.emit('error', error as Error)
      nextCarrierChunk.reject(error)
    } finally {
      nextCarrierChunk.resolve(nextCarrierChunkValue)
      nextLevelChunks.destroy()
    }
  })

  chunks.on('error', error => {
    nextLevelChunks.emit('error', error)
    nextCarrierChunk.reject(error)
  })

  return {
    nextLevelChunks,
    nextCarrierChunk: nextCarrierChunk.promise,
  }
}

/**
 * Returs whether last chunk should be excluded from current level.
 * This can be calculated as soon as first chunk arrives
 * @param firstChunk First chunk of current level
 * @param chunkLength Number of chunks in current level
 * @returns Whether last chunk should be excluded
 */
function shouldPopCarrierChunk<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(firstChunk: Chunk<MaxChunkPayloadLength, SpanLength>, chunkLength: number): boolean {
  if (chunkLength <= 1) return false

  const maxDataLength = firstChunk.maxPayloadLength
  // max segment count in one chunk. the segment size have to be equal to the chunk addresses
  const maxSegmentCount = maxDataLength / SEGMENT_SIZE

  return chunkLength % maxSegmentCount === 1
}
