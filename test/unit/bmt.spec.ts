import { makeSpan, bmtHash, Utils } from '../../src'

describe('bmt', () => {
  it('should produce correct BMT hash', () => {
    const payload = new Uint8Array([1, 2, 3])
    const span = makeSpan(payload.length)
    const data = new Uint8Array([...span, ...payload])
    const hash = 'ca6357a08e317d15ec560fef34e4c45f8f19f01c372aa70f1da72bfa7f1a4338'

    const result = bmtHash(data)

    expect(Utils.bytesToHex(result, 64)).toEqual(hash)
  })
})
