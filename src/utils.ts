/* eslint-disable @typescript-eslint/no-empty-function */
import { keccak256, Message } from 'js-sha3'

/** Used for FavorTypes */
export type Flavor<Name> = { __tag__?: Name }

export class Deferred<T> {
  public resolve: (value: T) => void = () => {}
  public reject: (reason?: unknown) => void = () => {}
  public promise: Promise<T>

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

/**
 * Nominal type to represent hex strings WITHOUT '0x' prefix.
 * For example for 32 bytes hex representation you have to use 64 length.
 * TODO: Make Length mandatory: https://github.com/ethersphere/bee-js/issues/208
 */
export type HexString<Length extends number = number> = string & {
  readonly length: Length
} & Flavor<'HexString'>

export interface Bytes<Length extends number> extends Uint8Array {
  readonly length: Length
}

/**
 * Helper type for dealing with flexible sized byte arrays.
 *
 * The actual min and and max values are not stored in runtime, they
 * are only there to differentiate the type from the Uint8Array at
 * compile time.
 * @see BrandedType
 */
export interface FlexBytes<Min extends number, Max extends number> extends Uint8Array {
  readonly __min__?: Min
  readonly __max__?: Max
}

export function isFlexBytes<Min extends number, Max extends number = Min>(
  b: unknown,
  min: Min,
  max: Max,
): b is FlexBytes<Min, Max> {
  return b instanceof Uint8Array && b.length >= min && b.length <= max
}

/**
 * Verifies if a byte array has a certain length between min and max
 *
 * @param b       The byte array
 * @param min     Minimum size of the array
 * @param max     Maximum size of the array
 */
export function assertFlexBytes<Min extends number, Max extends number = Min>(
  b: unknown,
  min: Min,
  max: Max,
): asserts b is FlexBytes<Min, Max> {
  if (!isFlexBytes(b, min, max)) {
    throw new TypeError(
      `Parameter is not valid FlexBytes of  min: ${min}, max: ${max}, length: ${(b as Uint8Array).length}`,
    )
  }
}

/**
 * Helper function for serialize byte arrays
 *
 * @param arrays Any number of byte array arguments
 */
export function serializeBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((prev, curr) => prev + curr.length, 0)
  const buffer = new Uint8Array(length)
  let offset = 0
  arrays.forEach(arr => {
    buffer.set(arr, offset)
    offset += arr.length
  })

  return buffer
}

/**
 * Helper function for calculating the keccak256 hash with
 * correct types.
 *
 * @param messages Any number of messages (strings, byte arrays etc.)
 */
export function keccak256Hash(...messages: Message[]): Bytes<32> {
  const hasher = keccak256.create()

  messages.forEach(bytes => hasher.update(bytes))

  return Uint8Array.from(hasher.digest()) as Bytes<32>
}

/**
 * Converts array of number or Uint8Array to HexString without prefix.
 *
 * @param bytes   The input array
 * @param len     The length of the non prefixed HexString
 */
export function bytesToHex<Length extends number>(bytes: Uint8Array, len: Length): HexString<Length> {
  const hexByte = (n: number) => n.toString(16).padStart(2, '0')
  const hex = Array.from(bytes, hexByte).join('') as HexString<Length>

  if (hex.length !== len) {
    throw new TypeError(`Resulting HexString does not have expected length ${len}: ${hex}`)
  }

  return hex
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  return a.every((byte, index) => b[index] === byte)
}

export { Message }

export function concatBytes(bytes1: Uint8Array, bytes2: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(bytes1.length + bytes2.length)

  buffer.set(bytes1, 0)
  buffer.set(bytes2, bytes1.length)

  return buffer
}
