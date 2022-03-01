import { bmtHash, Utils, makeChunk, bmtTree, inclusionProofBottomUp, makeSpan } from '../../src'
import { keccak256Hash } from '../../src/utils'

describe('bmt', () => {
  const payload = new Uint8Array([1, 2, 3])

  it('should produce correct BMT hash', () => {
    const hash = 'ca6357a08e317d15ec560fef34e4c45f8f19f01c372aa70f1da72bfa7f1a4338'

    const result = bmtHash(payload)

    expect(Utils.bytesToHex(result, 64)).toEqual(hash)
  })

  it('should test out bmtTree is in line with Chunk object calculations', () => {
    const chunk = makeChunk(payload)
    const tree = bmtTree(chunk.data())
    expect(tree.length).toBe(8)
    const rootHash = tree[tree.length - 1]
    expect(keccak256Hash(chunk.span(), rootHash)).toStrictEqual(chunk.address())
  })

  it('should retrieve the required segment pairs for inclusion proof', () => {
    const tree = bmtTree(payload)
    const bmtHashOfPayload = bmtHash(payload)
    expect(tree.length).toBe(8)
    const { sisterSegments, rootHash } = inclusionProofBottomUp(payload, 2)
    expect(keccak256Hash(makeSpan(payload.length), rootHash)).toStrictEqual(bmtHashOfPayload)

    let calculatedRootHash: Uint8Array
    for (const sisterSegment of sisterSegments) {
      calculatedRootHash = keccak256Hash(sisterSegment)
    }
    expect(keccak256Hash(makeSpan(payload.length), calculatedRootHash)).toStrictEqual(bmtHashOfPayload)
  })
})
