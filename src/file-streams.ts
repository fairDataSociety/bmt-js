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
  span: () => Span<SpanLength>
  bmt: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>
}

/**
 * Calculates number of leaf chunks from payload length
 * @param payloadLength Payload length
 * @param options settings for the used chunks
 * @returns Number of leaf chunks
 */
export function byteLengthToChunkLength<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payloadLength: number,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): number {
  const maxPayloadLength = (options?.maxPayloadLength || DEFAULT_MAX_PAYLOAD_SIZE) as MaxChunkPayloadLength

  return Math.ceil(payloadLength / maxPayloadLength)
}

/**
 * Creates object for performing BMT functions on payload data using streams
 *
 * @param payload byte array stream of the data
 * @param options settings for the used chunks
 * @returns ChunkedFileDeferred object with helper methods
 */
export function makeChunkedFileWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  payloadLength: number,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): ChunkedFileDeferred<MaxChunkPayloadLength, SpanLength> {
  const spanLength = (options?.spanLength || DEFAULT_SPAN_SIZE) as SpanLength
  const chunkLength = byteLengthToChunkLength(payloadLength, options)

  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)

  const rootChunk = bmtRootChunkWithStreams(leafStream, chunkLength, chunkStreamFactory)

  const address = new Promise(async (resolve, reject) => {
    try {
      resolve((await rootChunk).address())
    } catch (error) {
      reject(error)
    }
  })

  const bmt = bmtWithStreams(leafStream, chunkLength, chunkStreamFactory)

  return {
    payload,
    span: () => makeSpan(payloadLength, spanLength),
    leafChunks: leafStream,
    address: address as Promise<ChunkAddress>,
    rootChunk,
    bmt,
  }
}

/**
 * Generates BMT chunks and outputs them to a readable stream.
 * @param payload Readable stream of Uint8Array data
 * @param payloadLength Total number of bytes in payload
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
  payloadLength: number,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)
  const leafChunkLength = byteLengthToChunkLength(payloadLength, options)

  return bmtWithStreams(leafStream, leafChunkLength, chunkStreamFactory)
}

/**
 * Calculates root chunk for bytes received by a readable stream
 * @param payload Readable stream of Uint8Array data
 * @param payloadLength Total number of bytes in payload
 * @param chunkStreamFactory A factory function for a readable stream
 * @param options settings for the used chunks
 * @returns Promise resolved with root chunk
 */
export async function createBmtRootChunkWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  payload: GenericReadable<Uint8Array>,
  payloadLength: number,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  options?: {
    maxPayloadLength?: MaxChunkPayloadLength
    spanLength?: SpanLength
  },
): Promise<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const leafStream = createLeafChunksStream(payload, chunkStreamFactory, options)
  const leafChunkLength = byteLengthToChunkLength(payloadLength, options)

  return bmtRootChunkWithStreams(leafStream, leafChunkLength, chunkStreamFactory)
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
 * @param chunksLength Total number of leaf chunks expected
 * @param chunkStreamFactory A factory function for a readable stream
 * @returns A readable stream with all chunks from BMT. Levels are separated
 * by empty chunks (payload.length === 0)
 */
function bmtWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  leafChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunksLength: number,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const outputStream = chunkStreamFactory()

  if (chunksLength === 0) {
    throw new Error(`given chunk array is empty`)
  }

  checkShouldPopCarrierChunkWithStreams(leafChunks, chunksLength, (error, initialChunk, popCarrierChunk) => {
    try {
      if (error) {
        throw error
      }

      if (popCarrierChunk) {
        chunksLength -= 1
      }

      let prevChunk = initialChunk

      leafChunks.on('data', chunk => {
        outputStream.push(prevChunk)
        prevChunk = chunk
      })

      leafChunks.on('close', () => {
        if (!popCarrierChunk && prevChunk) {
          outputStream.push(prevChunk)
        }

        if (chunksLength === 1) {
          outputStream.destroy()
        } else {
          outputStream.push(makeChunk(new Uint8Array()))
        }
      })

      leafChunks.on('error', error => outputStream.emit('error', error))

      if (chunksLength === 1) {
        return
      }

      const { nextCarrierChunk: nextLevelCarrierChunk, nextLevelChunks } = firstBmtLevelWithStreams(
        leafChunks,
        chunksLength,
        initialChunk as Chunk<MaxChunkPayloadLength, SpanLength>,
        popCarrierChunk,
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
  })

  return outputStream
}

/**
 * Calculates root chunk for leaf chunks received by a readable stream
 * @param chunks Readable stream of leaf chunks
 * @param chunksLength Total number of leaf chunks expected
 * @param chunkStreamFactory A factory function for a readable stream
 * @returns Promise resolved with root chunk
 */
async function bmtRootChunkWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunksLength: number,
  chunkStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): Promise<Chunk<MaxChunkPayloadLength, SpanLength>> {
  const result = new Deferred<Chunk<MaxChunkPayloadLength, SpanLength>>()

  try {
    if (chunksLength === 0) {
      result.reject(new Error(`given chunk array is empty`))
    }

    checkShouldPopCarrierChunkWithStreams(chunks, chunksLength, (error, initialChunk, popCarrierChunk) => {
      try {
        if (error) {
          throw error
        }

        if (popCarrierChunk) {
          chunksLength -= 1
        }

        if (chunksLength === 1 && !popCarrierChunk) {
          return result.resolve(initialChunk as Chunk<MaxChunkPayloadLength, SpanLength>)
        }

        const { nextCarrierChunk: nextLevelCarrierChunk, nextLevelChunks } = firstBmtLevelWithStreams(
          chunks,
          chunksLength,
          initialChunk as Chunk<MaxChunkPayloadLength, SpanLength>,
          popCarrierChunk,
          chunkStreamFactory,
        )

        let levelChunks: Chunk<MaxChunkPayloadLength, SpanLength>[] = []

        nextLevelChunks.on('data', chunk => {
          levelChunks.push(chunk)
        })

        nextLevelChunks.on('close', async () => {
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
    })
  } catch (error) {
    result.reject(error)
  }

  return result.promise
}

/**
 * A helper function that generates first level of intermediate chunks using streams.
 * It is expected that first chunk has already been received and calculated whether
 * last chunk should be excluded.
 * @param chunks Readable stream of leaf chunks
 * @param chunksLength Total number of leaf chunks expected
 * @param initialChunk First chunk that has already been received
 * @param popCarrierChunk Whether last chunk should be excluded from current level
 * @param chunkArrayStreamFactory A factory function for a readable stream
 * @returns A readable stream of first level intermediate chunks,
 * number of chunks in first level and a promise of carrierChunk for this level
 */
function firstBmtLevelWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunksLength: number,
  initialChunk: Chunk<MaxChunkPayloadLength, SpanLength>,
  popCarrierChunk: boolean,
  chunkArrayStreamFactory: () => GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
): {
  nextLevelChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>
  nextCarrierChunk: Promise<Chunk<MaxChunkPayloadLength, SpanLength> | null>
  nextLevelChunksLength: number
} {
  const nextLevelChunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>> = chunkArrayStreamFactory()

  if (chunksLength === 0) {
    throw new Error('The given chunk array is empty')
  }

  let lastChunk: Chunk<MaxChunkPayloadLength, SpanLength>
  let nextPopCarrierChunk = popCarrierChunk
  let nextLevelChunksBuffer: Chunk<MaxChunkPayloadLength, SpanLength>[] = [initialChunk]
  const nextCarrierChunk = new Deferred<Chunk<MaxChunkPayloadLength, SpanLength> | null>()
  let generatedChunksCount = 0

  const maxPayloadLength = initialChunk.maxPayloadLength
  const spanLength = initialChunk.spanLength
  const maxSegmentCount = maxPayloadLength / SEGMENT_SIZE
  let nextLevelChunksLength = Math.ceil(chunksLength / maxSegmentCount)
  const carrierChunkIncluded = nextLevelChunksLength % maxSegmentCount !== 0
  let receivedChunks = 1

  if (popCarrierChunk) {
    if (carrierChunkIncluded) {
      nextLevelChunksLength += 1
      nextPopCarrierChunk = false
    }
  } else {
    nextPopCarrierChunk = shouldPopCarrierChunk(initialChunk, nextLevelChunksLength)
    if (nextPopCarrierChunk) {
      nextLevelChunksLength -= 1
    }
  }

  if (!nextPopCarrierChunk) {
    nextCarrierChunk.resolve(null)
  }

  const handleChunk = (chunk: Chunk<MaxChunkPayloadLength, SpanLength>) => {
    generatedChunksCount += 1

    if (generatedChunksCount <= nextLevelChunksLength) {
      nextLevelChunks.push(chunk)
    } else if (nextPopCarrierChunk) {
      nextCarrierChunk.resolve(chunk)
    }
  }

  chunks.on('data', chunk => {
    try {
      receivedChunks += 1

      if (receivedChunks <= chunksLength || !popCarrierChunk) {
        nextLevelChunksBuffer.push(chunk)
      }

      lastChunk = chunk

      for (
        let offset = 0;
        offset + maxSegmentCount <= nextLevelChunksBuffer.length;
        offset += maxSegmentCount
      ) {
        const childrenChunks = nextLevelChunksBuffer.slice(offset, offset + maxSegmentCount)
        const intermediateChunk = createIntermediateChunk(childrenChunks, spanLength, maxPayloadLength)

        handleChunk(intermediateChunk as Chunk<MaxChunkPayloadLength, SpanLength>)
      }

      if (nextLevelChunksBuffer.length >= maxSegmentCount) {
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
    for (let offset = 0; offset < nextLevelChunksBuffer.length; offset += maxSegmentCount) {
      const childrenChunks = nextLevelChunksBuffer.slice(offset, offset + maxSegmentCount)
      const intermediateChunk = createIntermediateChunk(childrenChunks, spanLength, maxPayloadLength)
      handleChunk(intermediateChunk as Chunk<MaxChunkPayloadLength, SpanLength>)
    }

    if (popCarrierChunk && carrierChunkIncluded) {
      nextLevelChunks.push(lastChunk)
    }

    nextLevelChunks.destroy()
  })

  chunks.on('error', error => {
    nextLevelChunks.emit('error', error)
    nextCarrierChunk.reject(error)
  })

  return {
    nextLevelChunks,
    nextLevelChunksLength,
    nextCarrierChunk: nextCarrierChunk.promise,
  }
}

/**
 * A helper function that waits for first chunk to arrive and determines
 * whether last chunk should be excluded from current level.
 *
 * @param chunks Readable chunk stream
 * @param chunkLength Total number of chunks expected in the stream
 * @param callback Called when first chunk is received and determined wheter last chunk
 * should be excluded
 */
function checkShouldPopCarrierChunkWithStreams<
  MaxChunkPayloadLength extends number = typeof DEFAULT_MAX_PAYLOAD_SIZE,
  SpanLength extends number = typeof DEFAULT_SPAN_SIZE,
>(
  chunks: GenericReadable<Chunk<MaxChunkPayloadLength, SpanLength>>,
  chunksLength: number,
  callback: (
    error: unknown | null,
    initialChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null,
    popCarrierChunk: boolean,
  ) => void,
) {
  let firstChunk: Chunk<MaxChunkPayloadLength, SpanLength> | null = null
  let popCarrierChunk = false

  chunks.on('data', chunk => {
    if (!firstChunk) {
      firstChunk = chunk

      popCarrierChunk = shouldPopCarrierChunk(firstChunk, chunksLength)

      callback(null, firstChunk, popCarrierChunk)
    }
  })

  chunks.on('close', () => {
    if (!firstChunk) {
      callback(null, firstChunk, popCarrierChunk)
    }
  })

  chunks.on('error', error => {
    callback(error, firstChunk, popCarrierChunk)
  })
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
