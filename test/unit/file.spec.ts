import { getSpanValue, makeChunkedFile, SEGMENT_SIZE } from '../../src'
import FS from 'fs'
import path from 'path'
import { bytesToHex } from '../../src/utils'

describe('file', () => {
  it('should work with lesser than 4KB of data', () => {
    const payload = new Uint8Array([1, 2, 3])

    const chunkedFile = makeChunkedFile(payload)
    const expectedSpan = new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0])

    expect(chunkedFile.leafChunks().length).toBe(1)
    const onlyChunk = chunkedFile.leafChunks()[0]
    expect(onlyChunk.payload).toStrictEqual(payload)
    expect(onlyChunk.span()).toStrictEqual(expectedSpan)
    expect(onlyChunk.span()).toStrictEqual(chunkedFile.span())
    expect(onlyChunk.address()).toStrictEqual(chunkedFile.address())
  })

  it('should work with greater than 4KB of data', () => {
    const fileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'The-Book-of-Swarm.pdf')),
    )

    const chunkedFile = makeChunkedFile(fileBytes)

    expect(getSpanValue(chunkedFile.span())).toStrictEqual(15726634)
    expect(getSpanValue(new Uint8Array([42, 248, 239, 0, 0, 0, 0, 0]))).toStrictEqual(15726634)

    const tree = chunkedFile.bmtTree()
    expect(tree.length).toBe(3)
    // last level only contains the rootChunk
    expect(tree[2].length).toBe(1)
    const rootChunk = tree[2][0]
    const secondLevelFirstChunk = tree[1][0] // first intermediate chunk on the the first intermediate chunk level
    expect(getSpanValue(secondLevelFirstChunk.span())).toBe(4096 * (4096 / SEGMENT_SIZE)) // 524288
    expect(rootChunk.payload.slice(0, 32)).toStrictEqual(secondLevelFirstChunk.address())
    expect(secondLevelFirstChunk.payload.length).toBe(4096)
    // encapsulated address has to be the same to the corresponding children chunk's address
    expect(secondLevelFirstChunk.payload.slice(0, 32)).toStrictEqual(tree[0][0].address())

    // last rootchunk data

    expect(chunkedFile.rootChunk().payload.length).toBe(960)

    expect(bytesToHex(chunkedFile.address(), 64)).toStrictEqual(
      'b8d17f296190ccc09a2c36b7a59d0f23c4479a3958c3bb02dc669466ec919c5d', //bee generated hash
    )
  })
})
