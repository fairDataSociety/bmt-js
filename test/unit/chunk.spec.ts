import { makeChunk } from '../../src'

describe('chunk', () => {
  const payload = new Uint8Array([1, 2, 3])

  test('should initialise Chunk object', () => {
    const chunk = makeChunk(payload)
    const expectedSpan = new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0])

    expect(chunk.payload).toStrictEqual(payload)
    expect(chunk.span()).toStrictEqual(expectedSpan)
    expect(chunk.data().length).toBe(4096)
    expect(chunk.address().length).toBe(32)
  })
})
