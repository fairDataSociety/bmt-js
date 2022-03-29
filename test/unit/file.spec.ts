import { getSpanValue, makeChunkedFile } from '../../src'
import { fileInclusionProofBottomUp } from '../../src/file'
import { SEGMENT_SIZE } from '../../src/chunk'
import FS from 'fs'
import path from 'path'
import { bytesToHex } from '../../src/utils'
import { fileAddressFromInclusionProof, getBmtIndexOfSegment } from '../../src/file'

describe('file', () => {
  let bosBytes: Uint8Array
  let carrierChunkFileBytes: Uint8Array
  beforeAll(() => {
    bosBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'The-Book-of-Swarm.pdf')),
    )
    carrierChunkFileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'carrier-chunk-blob')),
    )
  })
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
    const fileBytes = bosBytes

    const chunkedFile = makeChunkedFile(fileBytes)

    expect(getSpanValue(chunkedFile.span())).toStrictEqual(15726634)
    expect(getSpanValue(new Uint8Array([42, 248, 239, 0, 0, 0, 0, 0]))).toStrictEqual(15726634)

    const tree = chunkedFile.bmt()
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

  it('should find BMT position of the payload segment index', () => {
    //edge case - carrier chunk
    const fileBytes = carrierChunkFileBytes
    const chunkedFile = makeChunkedFile(fileBytes)
    const tree = chunkedFile.bmt()
    const leafChunks = chunkedFile.leafChunks()
    // check whether the last chunk is not present in the BMT tree 0 level -> carrierChunk
    expect(tree[0].length).toBe(leafChunks.length - 1)
    const carrierChunk = leafChunks.pop()
    const segmentIndex = Math.floor((fileBytes.length - 1) / 32) // last segment index as well
    const lastChunkIndex = Math.floor((fileBytes.length - 1) / 4096)
    const segmentIdInTree = getBmtIndexOfSegment(segmentIndex, lastChunkIndex)
    expect(segmentIdInTree.level).toBe(1)
    expect(segmentIdInTree.chunkIndex).toBe(1)
    expect(tree[segmentIdInTree.level][segmentIdInTree.chunkIndex].address()).toStrictEqual(
      carrierChunk.address(),
    )
  })

  it('should collect the required segments for inclusion proof', () => {
    const fileBytes = carrierChunkFileBytes
    const chunkedFile = makeChunkedFile(fileBytes)
    const fileHash = chunkedFile.address()
    // segment to prove
    const segmentIndex = Math.floor((fileBytes.length - 1) / 32)

    // check segment array length for carrierChunk inclusion proof
    const proofChunks = fileInclusionProofBottomUp(chunkedFile, segmentIndex)
    expect(proofChunks.length).toBe(2) // 1 level is skipped because the segment was in a carrierChunk

    /** Gives back the file hash calculated from the inclusion proof method */
    const testGetFileHash = (segmentIndex: number): Uint8Array => {
      const proofChunks = fileInclusionProofBottomUp(chunkedFile, segmentIndex)
      let proveSegment = fileBytes.slice(
        segmentIndex * SEGMENT_SIZE,
        segmentIndex * SEGMENT_SIZE + SEGMENT_SIZE,
      )
      //padding
      proveSegment = new Uint8Array([...proveSegment, ...new Uint8Array(SEGMENT_SIZE - proveSegment.length)])

      // check the last segment has the correct span value.
      const fileSizeFromProof = getSpanValue(proofChunks[proofChunks.length - 1].span)
      expect(fileSizeFromProof).toBe(fileBytes.length)

      return fileAddressFromInclusionProof(proofChunks, proveSegment, segmentIndex)
    }
    // edge case
    const hash1 = testGetFileHash(segmentIndex)
    expect(hash1).toStrictEqual(fileHash)
    const hash2 = testGetFileHash(1000)
    expect(hash2).toStrictEqual(fileHash)
  })

  it('should collect the required segments for inclusion proof 2', () => {
    const fileBytes = bosBytes
    const chunkedFile = makeChunkedFile(fileBytes)
    const fileHash = chunkedFile.address()
    // segment to prove
    const lastSegmentIndex = Math.floor((fileBytes.length - 1) / 32)

    /** Gives back the file hash calculated from the inclusion proof method */
    const testGetFileHash = (segmentIndex: number): Uint8Array => {
      const proofChunks = fileInclusionProofBottomUp(chunkedFile, segmentIndex)
      let proveSegment = fileBytes.slice(
        segmentIndex * SEGMENT_SIZE,
        segmentIndex * SEGMENT_SIZE + SEGMENT_SIZE,
      )
      //padding
      proveSegment = new Uint8Array([...proveSegment, ...new Uint8Array(SEGMENT_SIZE - proveSegment.length)])

      // check the last segment has the correct span value.
      const fileSizeFromProof = getSpanValue(proofChunks[proofChunks.length - 1].span)
      expect(fileSizeFromProof).toBe(fileBytes.length)

      return fileAddressFromInclusionProof(proofChunks, proveSegment, segmentIndex)
    }
    // edge case
    const hash1 = testGetFileHash(lastSegmentIndex)
    expect(hash1).toStrictEqual(fileHash)
    const hash2 = testGetFileHash(1000)
    expect(hash2).toStrictEqual(fileHash)
    expect(() => testGetFileHash(lastSegmentIndex + 1)).toThrowError(/^The given segment index/)
  })

  it('should collect the required segments for inclusion proof 3', () => {
    // the file's byte counts will cause carrier chunk in the intermediate BMT level
    // 128 * 4096 * 128 = 67108864 <- left tree is saturated on bmt level 1
    // 67108864 + 2 * 4096 = 67117056 <- add two full chunks at the end thereby
    // the zero level won't have carrier chunk, but its parent will be that.
    const carrierChunkFileBytes2 = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'carrier-chunk-blob-2')),
    )
    expect(carrierChunkFileBytes2.length).toBe(67117056)
    const fileBytes = carrierChunkFileBytes2
    const chunkedFile = makeChunkedFile(fileBytes)
    const fileHash = chunkedFile.address()
    // segment to prove
    const lastSegmentIndex = Math.floor((fileBytes.length - 1) / 32)

    /** Gives back the file hash calculated from the inclusion proof method */
    const testGetFileHash = (segmentIndex: number): Uint8Array => {
      const proofChunks = fileInclusionProofBottomUp(chunkedFile, segmentIndex)
      let proveSegment = fileBytes.slice(
        segmentIndex * SEGMENT_SIZE,
        segmentIndex * SEGMENT_SIZE + SEGMENT_SIZE,
      )
      //padding
      proveSegment = new Uint8Array([...proveSegment, ...new Uint8Array(SEGMENT_SIZE - proveSegment.length)])

      // check the last segment has the correct span value.
      const fileSizeFromProof = getSpanValue(proofChunks[proofChunks.length - 1].span)
      expect(fileSizeFromProof).toBe(fileBytes.length)

      return fileAddressFromInclusionProof(proofChunks, proveSegment, segmentIndex)
    }
    // edge case
    const hash1 = testGetFileHash(lastSegmentIndex)
    expect(hash1).toStrictEqual(fileHash)
    const hash2 = testGetFileHash(1000)
    expect(hash2).toStrictEqual(fileHash)
    expect(() => testGetFileHash(lastSegmentIndex + 1)).toThrowError(/^The given segment index/)
  })
})
