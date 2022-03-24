import { Utils, makeChunk, makeSpan, SEGMENT_SIZE, rootHashFromInclusionProof } from '../../src'
import { keccak256Hash } from '../../src/utils'

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

  it('should produce correct BMT hash', () => {
    const hash = 'ca6357a08e317d15ec560fef34e4c45f8f19f01c372aa70f1da72bfa7f1a4338'
    const chunk = makeChunk(payload)

    const result = chunk.address()

    expect(Utils.bytesToHex(result, 64)).toEqual(hash)
  })

  it('should test out bmtTree is in line with Chunk object calculations', () => {
    const chunk = makeChunk(payload)
    const tree = chunk.bmt()
    expect(tree.length).toBe(8)
    const rootHash = tree[tree.length - 1]
    expect(keccak256Hash(chunk.span(), rootHash)).toStrictEqual(chunk.address())
  })

  it('should retrieve the required segment pairs for inclusion proof', () => {
    const chunk = makeChunk(payload)
    const tree = chunk.bmt()
    const bmtHashOfPayload = chunk.address()
    expect(tree.length).toBe(8)
    /** Gives back the bmt root hash calculated from the inclusion proof method */
    const testGetRootHash = (segmentIndex: number): Uint8Array => {
      const inclusionProofSegments = chunk.inclusionProof(segmentIndex)
      const rootHash = rootHashFromInclusionProof(
        inclusionProofSegments,
        chunk.data().slice(segmentIndex * SEGMENT_SIZE, segmentIndex * SEGMENT_SIZE + SEGMENT_SIZE),
        segmentIndex,
      )

      return rootHash
    }
    const rootHash1 = testGetRootHash(0)
    expect(keccak256Hash(makeSpan(payload.length), rootHash1)).toStrictEqual(bmtHashOfPayload)
    const rootHash2 = testGetRootHash(101)
    expect(rootHash2).toStrictEqual(rootHash1)
    const rootHash3 = testGetRootHash(127)
    expect(rootHash3).toStrictEqual(rootHash1)

    expect(() => testGetRootHash(128)).toThrow()
  })
})
