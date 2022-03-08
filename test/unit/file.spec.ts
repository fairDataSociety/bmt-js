import { makeChunkedFile } from '../../src'
import FS from 'fs'
import path from 'path'
import { bytesToHex, keccak256Hash } from '../../src/utils'

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

    // expect(chunkedFile.span()).toStrictEqual(makeSpan(17825792))

    expect(bytesToHex(keccak256Hash(chunkedFile.span(), chunkedFile.address()), 64)).toStrictEqual(
      'b8d17f296190ccc09a2c36b7a59d0f23c4479a3958c3bb02dc669466ec919c5d',
    )
  })
})
