import { Utils, makeChunk, makeSpan, rootHashFromInclusionProof } from '../../src'
import { SEGMENT_SIZE } from '../../src/chunk'
import { bytesToHex, keccak256Hash } from '../../src/utils'

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

  it('should run the same unit test that Bee client has', () => {
    const data = new Uint8Array(new TextEncoder().encode('hello world'))
    const chunk = makeChunk(data)

    // proof for the leftmost
    const inclusionProofSegments = chunk.inclusionProof(0).map(v => bytesToHex(v, 64))
    expect(inclusionProofSegments).toStrictEqual([
      '0000000000000000000000000000000000000000000000000000000000000000',
      'ad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5',
      'b4c11951957c6f8f642c4af61cd6b24640fec6dc7fc607ee8206a99e92410d30',
      '21ddb9a356815c3fac1026b6dec5df3124afbadb485c9ba5a3e3398a04b7ba85',
      'e58769b32a1beaf1ea27375a44095a0d1fb664ce2dd358e7fcbfb78c26a19344',
      '0eb01ebfc9ed27500cd4dfc979272d1f0913cc9f66540d7e8005811109e1cf2d',
      '887c22bd8750d34016ac3c66b5ff102dacdd73f6b014e710b51e8022af9a1968',
    ])

    // proof for the rightmost
    const inclusionProofSegments2 = chunk.inclusionProof(127).map(v => bytesToHex(v, 64))
    expect(inclusionProofSegments2).toStrictEqual([
      '0000000000000000000000000000000000000000000000000000000000000000',
      'ad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5',
      'b4c11951957c6f8f642c4af61cd6b24640fec6dc7fc607ee8206a99e92410d30',
      '21ddb9a356815c3fac1026b6dec5df3124afbadb485c9ba5a3e3398a04b7ba85',
      'e58769b32a1beaf1ea27375a44095a0d1fb664ce2dd358e7fcbfb78c26a19344',
      '0eb01ebfc9ed27500cd4dfc979272d1f0913cc9f66540d7e8005811109e1cf2d',
      '745bae095b6ff5416b4a351a167f731db6d6f5924f30cd88d48e74261795d27b',
    ])

    // proof for the middle
    const inclusionProofSegments3 = chunk.inclusionProof(64).map(v => bytesToHex(v, 64))
    expect(inclusionProofSegments3).toStrictEqual([
      '0000000000000000000000000000000000000000000000000000000000000000',
      'ad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5',
      'b4c11951957c6f8f642c4af61cd6b24640fec6dc7fc607ee8206a99e92410d30',
      '21ddb9a356815c3fac1026b6dec5df3124afbadb485c9ba5a3e3398a04b7ba85',
      'e58769b32a1beaf1ea27375a44095a0d1fb664ce2dd358e7fcbfb78c26a19344',
      '0eb01ebfc9ed27500cd4dfc979272d1f0913cc9f66540d7e8005811109e1cf2d',
      '745bae095b6ff5416b4a351a167f731db6d6f5924f30cd88d48e74261795d27b',
    ])
  })
})
