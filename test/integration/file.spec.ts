import { Bee, SPAN_SIZE } from '@ethersphere/bee-js'
import FS from 'fs'
import path from 'path'
import { makeChunkedFile } from '../../src'
import { DEFAULT_MAX_PAYLOAD_SIZE } from '../../src/chunk'
import { bytesToHex } from '../../src/utils'

const beeUrl = process.env.BEE_API_URL || 'http://localhost:1633'
const bee = new Bee(beeUrl)
const stamp = process.env.BEE_POSTAGE

describe('file', () => {
  it('should produce same chunk like Bee for data < 4KB', async () => {
    const fileBytes = Uint8Array.from(FS.readFileSync(path.join(__dirname, '..', 'test-files', 'text.txt')))
    const chunkedFile = makeChunkedFile(fileBytes)
    const result = await bee.uploadData(stamp, fileBytes)
    const reference = result.reference

    expect(bytesToHex(chunkedFile.address(), 64)).toStrictEqual(reference)
  })

  it('should produce same BMT tree like Bee for data > 4KB', async () => {
    const fileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'The-Book-of-Swarm.pdf')),
    )
    const chunkedFile = makeChunkedFile(fileBytes)
    const result = await bee.uploadData(stamp, fileBytes)
    const reference = result.reference

    const spanAndChunkPayloadLength = DEFAULT_MAX_PAYLOAD_SIZE + SPAN_SIZE
    const beeRootChunk = await bee.downloadChunk(reference)
    expect(beeRootChunk.length).toBe(968)
    const bee2ndLayer1stChunkAddress = beeRootChunk.slice(8, 40)
    const bee2ndLayer1stChunk = await bee.downloadChunk(bytesToHex(bee2ndLayer1stChunkAddress, 64))
    expect(bee2ndLayer1stChunk.length).toBe(spanAndChunkPayloadLength)
    const beeLeafLayer1stChunk = await bee.downloadChunk(bytesToHex(bee2ndLayer1stChunk.slice(8, 40), 64))
    expect(beeLeafLayer1stChunk.length).toBe(spanAndChunkPayloadLength)

    const tree = chunkedFile.bmt()
    expect(tree[0][0].payload).toStrictEqual(beeLeafLayer1stChunk.slice(8))

    expect(tree[1][0].payload).toStrictEqual(bee2ndLayer1stChunk.slice(8))
    expect(tree[1][0].span()).toStrictEqual(bee2ndLayer1stChunk.slice(0, 8))
    expect(tree[1][0].address()).toStrictEqual(bee2ndLayer1stChunkAddress)
    expect(bytesToHex(tree[2][0].address(), 64)).toStrictEqual(reference)
  })

  it('should work with edge case - carrier chunk', async () => {
    const fileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'carrier-chunk-blob')),
    )
    const beeResult = await bee.uploadData(stamp, fileBytes)
    const chunkedFile = makeChunkedFile(fileBytes)
    expect(bytesToHex(chunkedFile.address(), 64)).toBe(beeResult.reference)
  })

  it('should work with edge case - carrier chunk in intermediate level', async () => {
    const fileBytes = Uint8Array.from(
      FS.readFileSync(path.join(__dirname, '..', 'test-files', 'carrier-chunk-blob-2')),
    )
    const beeResult = await bee.uploadData(stamp, fileBytes)
    const chunkedFile = makeChunkedFile(fileBytes)
    expect(bytesToHex(chunkedFile.address(), 64)).toBe(beeResult.reference)
  })
})
