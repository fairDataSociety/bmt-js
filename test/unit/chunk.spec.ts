import { bmtHash, Utils, makeChunk, bmtTree, inclusionProofBottomUp, makeSpan } from '../../src'
import { bytesToHex, keccak256Hash } from '../../src/utils'
import FS from 'fs'
import path from 'path'

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

  it('should give back the same content address like the Bee', () => {
    const fileBytes = Uint8Array.from(FS.readFileSync(path.join(__dirname, '..', 'test-files', 'text.txt')))

    const chunk = makeChunk(fileBytes)

    expect(bytesToHex(chunk.address(), 64)).toStrictEqual(
      'c6f3e5b376b99b627aed43708eba5e225800ebdae07b9acd36521d329a2212bb',
    )
  })
})
