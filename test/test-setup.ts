/* eslint-disable no-console */
import { Bee, PostageBatch } from '@ethersphere/bee-js'

async function sleep(ms = 1000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default async function testsSetup(): Promise<void> {
  if (!process.env.BEE_POSTAGE) {
    try {
      console.log('Creating postage stamps...')
      const beeDebugUrl = process.env.BEE_API_URL || 'http://localhost:1633'
      const beeDebug = new Bee(beeDebugUrl)
      process.env.BEE_POSTAGE = await beeDebug.createPostageBatch('1', 22)
      console.log(`export BEE_API_URL=${beeDebugUrl}`)
      //wait for chunk to be usable
      let postageBatch: PostageBatch
      do {
        postageBatch = await beeDebug.getPostageBatch(beeDebugUrl)

        console.log('Waiting 1 sec for batch ID settlement...')
        await sleep()
      } while (!postageBatch.usable)
      console.log(`export BEE_POSTAGE=${postageBatch.batchID}`)
    } catch (e) {
      // It is possible that for unit tests the Bee nodes does not run
      // so we are only logging errors and not leaving them to propagate
      console.error(e)
    }
  }
}
