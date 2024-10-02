# Changelog

## [2.2.0](https://www.github.com/fairDataSociety/bmt-js/compare/v2.1.0...v2.2.0) (2024-10-02)


### Features

* let's roll ([4fe3c70](https://www.github.com/fairDataSociety/bmt-js/commit/4fe3c7074f91ef33b41361f636f6dd7ab92464ac))
* update packages ([023d9c7](https://www.github.com/fairDataSociety/bmt-js/commit/023d9c7f4af1689804637a081327b765fa947158))


### Bug Fixes

* test setup ([f317a8c](https://www.github.com/fairDataSociety/bmt-js/commit/f317a8c15ee1437e37dcab3880035be6aa935936))

## [2.1.0](https://www.github.com/fairDataSociety/bmt-js/compare/v2.0.1...v2.1.0) (2023-07-05)


### Features

* custom hasher for chunks ([#21](https://www.github.com/fairDataSociety/bmt-js/issues/21)) ([2003efe](https://www.github.com/fairDataSociety/bmt-js/commit/2003efed9b58f240e51b9b983dbe4efbb37538ca))


### Bug Fixes

* allow 0 payload ([#18](https://www.github.com/fairDataSociety/bmt-js/issues/18)) ([10687d5](https://www.github.com/fairDataSociety/bmt-js/commit/10687d50b3dc01f5dbc80db3ff123ebe967d984f))

### [2.0.1](https://www.github.com/fairDataSociety/bmt-js/compare/v2.0.0...v2.0.1) (2022-05-10)


### Bug Fixes

* main ref ([#7](https://www.github.com/fairDataSociety/bmt-js/issues/7)) ([877a4f6](https://www.github.com/fairDataSociety/bmt-js/commit/877a4f60fd1da4a30716ac0b60bad98ee91c653e))

## [2.0.0](https://www.github.com/fairDataSociety/bmt-js/compare/v1.0.0...v2.0.0) (2022-03-31)


### ⚠ BREAKING CHANGES

* bmt index calculation of intermediate carrier chunks (#4)
  * `getBmtIndexOfSegment`:  instead of `spanVlaue`, the `lastChunkIndex` has to be given on the second parameter. It wasn't a necessary change, but it got a more explicit definition.
  * `fileAddressFromInclusionProof`: got new optional parameter for defining the default chunk's data length that is 4KB by default

### Bug Fixes

* bmt index calculation of intermediate carrier chunks ([#4](https://www.github.com/fairDataSociety/bmt-js/issues/4)) ([c486cd5](https://www.github.com/fairDataSociety/bmt-js/commit/c486cd5b5b5316bb8abdd5f2a451b866d6aa7622))

## 1.0.0 (2022-03-25)


### Features

* add equalBytes utility function ([1208b01](https://www.github.com/fairDataSociety/bmt-js/commit/1208b014c4fb226ead2d71eba5fb6a489ad20c4d))
* bee-js inspired feats ([8cb3dd4](https://www.github.com/fairDataSociety/bmt-js/commit/8cb3dd46e431a37b976734c86370b12b0df90476))
* bmt on files ([e946851](https://www.github.com/fairDataSociety/bmt-js/commit/e9468513966c80a416b03b8ea60de98bfa7f864a))
* carrier chunk ([84a109b](https://www.github.com/fairDataSociety/bmt-js/commit/84a109b104028fae6637f8d21c3adc5b86cc90cf))
* chunk bmt functions and inclusion proof ([a8695f8](https://www.github.com/fairDataSociety/bmt-js/commit/a8695f8d733a75c93bbf8c0ea0c90d81f8203f26))
* export file.ts ([f9fceaf](https://www.github.com/fairDataSociety/bmt-js/commit/f9fceaf840d7cc8bcc05e0edefd6e791964d72bf))
* export max span value constant ([f3bd2d4](https://www.github.com/fairDataSociety/bmt-js/commit/f3bd2d4bf7b5d6265ba4ffa2608d8ebded77d149))
* file inclusion proof ([23010c1](https://www.github.com/fairDataSociety/bmt-js/commit/23010c1b44f99d89d953277849e7a572545c2669))
* file inclusion proof with carrier chunk edge-case ([52e4f29](https://www.github.com/fairDataSociety/bmt-js/commit/52e4f291eb8187d226c6f5369c2c984301473011))
* get span value ([db8b8e6](https://www.github.com/fairDataSociety/bmt-js/commit/db8b8e6ba133f0f6290819df8a6325ce35cd10ed))
* init ([#1](https://www.github.com/fairDataSociety/bmt-js/issues/1)) ([ce95662](https://www.github.com/fairDataSociety/bmt-js/commit/ce9566273337b492169712bc471525defb09b90f))
* init file bmt ([77e1c7d](https://www.github.com/fairDataSociety/bmt-js/commit/77e1c7d574caf106e50bc3b237f20918897881f5))
* init inclusionProofBottomUp function ([569b9c9](https://www.github.com/fairDataSociety/bmt-js/commit/569b9c9eda87fd92ca632f9c07f06a8a9f6bd656))
* init init ([caf6695](https://www.github.com/fairDataSociety/bmt-js/commit/caf66959437c931e0bb5ffd2008a0fd2117cf25a))


### Bug Fixes

* calculate chunk address ([3946e46](https://www.github.com/fairDataSociety/bmt-js/commit/3946e463ceca469a170524f55a4d3096d7c0980b))
* condition for carrier chunk segment index calculation ([272c509](https://www.github.com/fairDataSociety/bmt-js/commit/272c509ee698f85656b5777e8b9adce17a99c9bb))
* I think it is better than was ([81e0b21](https://www.github.com/fairDataSociety/bmt-js/commit/81e0b213e51a6a899289a4ae0d0fc9d93f8743c9))
* last segment index calculation ([fac875e](https://www.github.com/fairDataSociety/bmt-js/commit/fac875e4643d8649ef6a537388972db49c3850c5))
* place chunkSegmentIndex inside the bmt level loop ([a7fed76](https://www.github.com/fairDataSociety/bmt-js/commit/a7fed762c768675a640aee9989b13d7ed7172bd8))
* typeo ([7606341](https://www.github.com/fairDataSociety/bmt-js/commit/7606341d1f7b6722a80d3118e6867a17acdc76f1))


### Miscellaneous Chores

* release 1.0.0 ([3fc146a](https://www.github.com/fairDataSociety/bmt-js/commit/3fc146ab4df72071d220e139dd9415b39eab195e))
