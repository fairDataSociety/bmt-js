import { fileAddressFromInclusionProof, fileInclusionProofBottomUp, makeChunkedFile } from '../../src'
import FS from 'fs'
import path from 'path'

// sample logic around inclusion proofs
describe('operations', () => {
  let carrierChunkFileBytes: Uint8Array
  beforeAll(() => {
    carrierChunkFileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'carrier-chunk-blob')),
    )
  })

  it('changing one segment will keep the same sister segment in BMT', () => {
    // This test shows that a slight difference in the data array
    // will result different file hash
    // but the sister segments will remain the same
    const lastSegmentIndex = Math.floor((carrierChunkFileBytes.length - 1) / 32)
    const chunkFile1 = makeChunkedFile(carrierChunkFileBytes)

    const alterOneSegment = (segmentIndex: number, byteOffset = 0) => {
      // byteoffset has be be maximum 31 in order to keep in the segment
      const carrierChunkFileBytes2 = new Uint8Array([...carrierChunkFileBytes])
      const byteIndex = segmentIndex * 32
      carrierChunkFileBytes2[byteIndex + byteOffset] += 1 // change segments value at `segmentIndex`
      const chunkFile2 = makeChunkedFile(carrierChunkFileBytes2)
      const sisterSegments1 = fileInclusionProofBottomUp(chunkFile1, segmentIndex)
      const sisterSegments2 = fileInclusionProofBottomUp(chunkFile2, segmentIndex)
      expect(sisterSegments1).toStrictEqual(sisterSegments2)

      // sanity checks
      const file1Address = chunkFile1.address()
      const file2Address = chunkFile2.address()
      expect(file1Address).not.toStrictEqual(file2Address)
      let segment1 = carrierChunkFileBytes.slice(byteIndex, byteIndex + 32)
      //padding
      segment1 = new Uint8Array([...segment1, ...new Uint8Array(32 - segment1.length)])
      let segment2 = carrierChunkFileBytes2.slice(byteIndex, byteIndex + 32)
      //padding
      segment2 = new Uint8Array([...segment2, ...new Uint8Array(32 - segment2.length)])
      expect(segment1).not.toStrictEqual(segment2)
      expect(fileAddressFromInclusionProof(sisterSegments1, segment1, segmentIndex)).toStrictEqual(
        file1Address,
      )
      expect(fileAddressFromInclusionProof(sisterSegments2, segment2, segmentIndex)).toStrictEqual(
        file2Address,
      )
    }

    alterOneSegment(0)
    alterOneSegment(1)
    alterOneSegment(lastSegmentIndex)
    alterOneSegment(lastSegmentIndex - 1)
    alterOneSegment(7)
    alterOneSegment(13)
    alterOneSegment(103, 31)
    alterOneSegment(1000, 10)
  })
})
