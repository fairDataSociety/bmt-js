import { getSpanValue, makeSpan } from '../../src'
import { MAX_SPAN_LENGTH } from '../../src/span'

describe('span', () => {
  it('should serialize/deserialize', () => {
    const chunkLengthBytes1 = makeSpan(4096)
    const chunkLength1 = getSpanValue(chunkLengthBytes1)
    expect(chunkLength1).toBe(4096)
    const chunkLengthBytes2 = makeSpan(MAX_SPAN_LENGTH)
    const chunkLength2 = getSpanValue(chunkLengthBytes2)
    expect(chunkLength2).toBe(MAX_SPAN_LENGTH)
    const chunkLengthBytes3 = makeSpan(1)
    const chunkLength3 = getSpanValue(chunkLengthBytes3)
    expect(chunkLength3).toBe(1)
    expect(() => makeSpan(0)).toThrowError(/^invalid length for span: 0$/)
  })
})
