/*

Permission is hereby granted, perpetual, worldwide, non-exclusive, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), 
to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, 
and to permit persons to whom the Software is furnished to do so, subject to the following conditions:


  1. The Software cannot be used in any form or in any substantial portions for development, maintenance and for any other purposes, in the military sphere and in relation to military products, 
  including, but not limited to:

    a. any kind of armored force vehicles, missile weapons, warships, artillery weapons, air military vehicles (including military aircrafts, combat helicopters, military drones aircrafts), 
    air defense systems, rifle armaments, small arms, firearms and side arms, melee weapons, chemical weapons, weapons of mass destruction;

    b. any special software for development technical documentation for military purposes;

    c. any special equipment for tests of prototypes of any subjects with military purpose of use;

    d. any means of protection for conduction of acts of a military nature;

    e. any software or hardware for determining strategies, reconnaissance, troop positioning, conducting military actions, conducting special operations;

    f. any dual-use products with possibility to use the product in military purposes;

    g. any other products, software or services connected to military activities;

    h. any auxiliary means related to abovementioned spheres and products.


  2. The Software cannot be used as described herein in any connection to the military activities. A person, a company, or any other entity, which wants to use the Software, 
  shall take all reasonable actions to make sure that the purpose of use of the Software cannot be possibly connected to military purposes.


  3. The Software cannot be used by a person, a company, or any other entity, activities of which are connected to military sphere in any means. If a person, a company, or any other entity, 
  during the period of time for the usage of Software, would engage in activities, connected to military purposes, such person, company, or any other entity shall immediately stop the usage 
  of Software and any its modifications or alterations.


  4. Abovementioned restrictions should apply to all modification, alteration, merge, and to other actions, related to the Software, regardless of how the Software was changed due to the 
  abovementioned actions.


The above copyright notice and this permission notice shall be included in all copies or substantial portions, modifications and alterations of the Software.


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH 
THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

'use strict';

import EventEmitter from 'events';
import crypto from 'qubic-crypto';
import { seedStringToBytes, digestBytesToString, publicKeyStringToBytes, publicKeyBytesToString } from 'qubic-converter';
import { gossip, SIZE_OFFSET, SIZE_LENGTH, TYPE_LENGTH, TYPE_OFFSET, PROTOCOL_VERSION_OFFSET, PROTOCOL_VERSION_LENGTH, HEADER_LENGTH, MESSAGE_TYPES, TICK_COMPUTOR_INDEX_LENGTH, TICK_COMPUTOR_INDEX_OFFSET, TICK_EPOCH_LENGTH, TICK_EPOCH_OFFSET, TICK_TICK_LENGTH, TICK_TICK_OFFSET } from 'qubic-gossip';
import { resourceTester } from './resource-tester.js';
import { computorsAlignmentTester } from './computors-alignment-tester.js';
import { isZero } from './is-zero.js';
import _crypto from 'crypto';

export const ADMIN_PUBLIC_KEY = 'EWVQXREUTMLMDHXINHYJKSLTNIFBMZQPYNIFGFXGJBODGJHCFSSOKJZCOBOH';
const ADMIN_PUBLIC_KEY_BYTES = publicKeyStringToBytes(ADMIN_PUBLIC_KEY);
export const NUMBER_OF_COMPUTORS = 676;
const QUORUM = Math.floor(NUMBER_OF_COMPUTORS  * 2 / 3 + 1);
const SEED_IN_LOWERCASE_LATIN_LENGTH = 55;
const OWN_TRANSACTION_REBROADCAST_TIMEOUT = 1000;

const COMPUTORS_EPOCH_OFFSET = HEADER_LENGTH;
const COMPUTORS_EPOCH_LENGTH = 2;
export const COMPUTORS_PUBLIC_KEYS_OFFSET = COMPUTORS_EPOCH_OFFSET + COMPUTORS_EPOCH_LENGTH;
const COMPUTORS_PUBLIC_KEYS_LENGTH = crypto.PUBLIC_KEY_LENGTH * NUMBER_OF_COMPUTORS;
const COMPUTORS_SIGNATURE_OFFSET = COMPUTORS_PUBLIC_KEYS_OFFSET + COMPUTORS_PUBLIC_KEYS_LENGTH;

const TICK_INIT_SPECTRUM_DIGEST_OFFSET = TICK_TICK_OFFSET + TICK_TICK_LENGTH;
const TICK_INIT_UNIVERSE_DIGEST_OFFSET = TICK_INIT_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_INIT_COMPUTER_DIGEST_OFFSET = TICK_INIT_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_PREV_SPECTRUM_DIGEST_OFFSET = TICK_INIT_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_PREV_UNIVERSE_DIGEST_OFFSET = TICK_PREV_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_PREV_COMPUTER_DIGEST_OFFSET = TICK_PREV_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_SALTED_SPECTRUM_DIGEST_OFFSET = TICK_PREV_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_SALTED_UNIVERSE_DIGEST_OFFSET = TICK_SALTED_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_SALTED_COMPUTER_DIGEST_OFFSET = TICK_SALTED_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_DIGEST_OF_TRANSACTIONS_OFFSET = TICK_SALTED_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
const TICK_NEXT_TICK_ZERO_OFFSET = TICK_DIGEST_OF_TRANSACTIONS_OFFSET + crypto.DIGEST_LENGTH;
const TICK_NEXT_TICK_ZERO_LENGTH = crypto.SIGNATURE_LENGTH - crypto.DIGEST_LENGTH;
const TICK_NEXT_TICK_DIGEST_OF_TRANSACTIONS_OFFSET = TICK_NEXT_TICK_ZERO_OFFSET + TICK_NEXT_TICK_ZERO_LENGTH;
export const TICK_SIGNATURE_OFSSET = TICK_NEXT_TICK_DIGEST_OF_TRANSACTIONS_OFFSET + crypto.DIGEST_LENGTH;

const TRANSACTION_SOURCE_PUBLIC_KEY_OFFSET = HEADER_LENGTH;
const TRANSACTION_DESTINATION_PUBLIC_KEY_OFFSET = TRANSACTION_SOURCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
const TRANSACTION_AMOUNT_OFFSET = TRANSACTION_DESTINATION_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
const TRANSACTION_AMOUNT_LENGTH = 8;
const TRANSACTION_TICK_OFFSET = TRANSACTION_AMOUNT_OFFSET + TRANSACTION_AMOUNT_LENGTH;
const TRANSACTION_TICK_LENGTH = 4;
const TRANSACTION_INPUT_TYPE_OFFSET = TRANSACTION_TICK_OFFSET + TRANSACTION_TICK_LENGTH;
const TRANSACTION_INPUT_TYPE_LENGTH = 2;
const TRANSACTION_INPUT_SIZE_OFFSET = TRANSACTION_INPUT_TYPE_OFFSET + TRANSACTION_INPUT_TYPE_LENGTH;
const TRANSACTION_INPUT_SIZE_LENGTH = 2;

const TRANSACTION_PUBLICATION_TICK_OFFSET = 4;

const _451 = function ({
  protocol,
  randomSeed,
  numberOfNeurons,
  solutionThreshold,
  signalingServers,
  iceServers
}) {
  if (isZero(ADMIN_PUBLIC_KEY_BYTES)) {
    throw new Error('Invalid admin public key!');
  }

  return function () {
    const that = this;

    let minScore;

    const system = {
      epoch: 0,
      terminatedEpoch: 0,
      tick: 0,
      computors: Array(NUMBER_OF_COMPUTORS),
      alignment: 0,
      ticks: new Map(),
      digestsOfTransactionsByTick: new Map(),
      scores: new Map(),
      greenLight: false,
      entities: new Set(),
    };

    const store = {
      computors: new Set(),
      resourceTestSolutions: new Map(),
    };

    const { resourceTest, setResourceTestParameters } = resourceTester();
    setResourceTestParameters({
      randomSeed,
      numberOfNeurons,
      solutionThreshold,
    })

    const setMinScore = function (value) {
      if (!Number.isInteger(minScore)) {
        throw new Error('Invalid minScore.');
      }
      minScore = value;
    }

    const computorsAlignmentTest = computorsAlignmentTester();


    const network = gossip({ signalingServers, iceServers, store, protocol });

    const computorsListener = async function ({ computors, channel, propagate, closeAndReconnect }) {
      const { K12, schnorrq } = await crypto;
      const digest = new Uint8Array(crypto.DIGEST_LENGTH);
      K12(computors.slice(COMPUTORS_EPOCH_OFFSET, COMPUTORS_SIGNATURE_OFFSET), digest, crypto.DIGEST_LENGTH);
      
      if (schnorrq.verify(ADMIN_PUBLIC_KEY_BYTES, digest, computors.slice(COMPUTORS_SIGNATURE_OFFSET, COMPUTORS_SIGNATURE_OFFSET + crypto.SIGNATURE_LENGTH)) === 1) {
        const result = computorsAlignmentTest(new DataView(computors.buffer)[`getUint${COMPUTORS_EPOCH_LENGTH * 8}`](COMPUTORS_EPOCH_OFFSET, true), digestBytesToString(digest), channel);

        if (result !== false && result.epoch > 0) {
          if (result.epoch > system.epoch || (result.epoch === system.epoch && result.alignment > system.alignment)) {
            if (minScore !== undefined) {
              if (system.terminatedEpoch !== 0 && result.epoch === system.terminatedEpoch + 1) {
                if (system.terminatedEpoch === system.epoch) { 
                  let n = 0;
                  let m = 0;
                  for (const computor of system.computors) {
                    if (isZero(computor) === false) {
                      n++;
                      if (system.scores.get(publicKeyBytesToString(computor)) >= minScore) {
                        m++;
                      }
                    }
                  }
                  system.greenLight = m / n;
                  system.scores.clear();
                  network.clearResourceTestSolutionsDejavu();
                }
              }
            }

            if (system.epoch !== result.epoch) {
              system.epoch = result.epoch;
              for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                system.computors[i] = computors.slice(COMPUTORS_PUBLIC_KEYS_OFFSET + (i * crypto.PUBLIC_KEY_LENGTH), COMPUTORS_PUBLIC_KEYS_OFFSET + ((i + 1) * crypto.PUBLIC_KEY_LENGTH));
              }
            }

            system.alignment = result.alignment;

            console.log(`Epoch: ${system.epoch} | Alignment: ${system.alignment}`);

            that.emit('computors', {
              epoch: system.epoch,
              alignment: system.alignment,
              computors: system.computors.map(function (computor) {
                return publicKeyBytesToString(computor);
              }),
            })
          }
        }

        propagate();
      } else {
        closeAndReconnect();
      }

    };

    const resourceTestSolutionListener = async function ({ resourceTestSolution, closeAndReconnect, propagate }) {
      const result = await resourceTest(resourceTestSolution);
      if (result !== false) {
        system.scores.set(result.computorPublicKey, result.score);
        propagate(result.digest);
      } else {
        closeAndReconnect();
      }
    };

    const terminatorListener = async function ({ terminator, propagate }) {
      that.emit('terminator', { setMinScore, setResourceTestParameters });
      propagate();
    }

    const tickListener = async function ({ tick, closeAndReconnect, propagate }) {
      if (system.epoch > 0) {
        const tickView = new DataView(tick.buffer);
        const receivedTick = tickView[`getUint${TICK_TICK_LENGTH * 8}`](TICK_TICK_OFFSET, true);

        if (receivedTick > system.tick && system.epoch === tickView[`getUint${TICK_EPOCH_LENGTH}`](TICK_EPOCH_OFFSET, true)) {
          console.log('Received tick:', receivedTick);

          const { K12, schnorrq } = await crypto;
          const digest = new Uint8Array(crypto.DIGEST_LENGTH);
          tickView.setUint8(TICK_COMPUTOR_INDEX_OFFSET, tickView.getUint8(TICK_COMPUTOR_INDEX_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_TICK, true);
          K12(tick.slice(TICK_COMPUTOR_INDEX_OFFSET, TICK_SIGNATURE_OFSSET), digest, crypto.DIGEST_LENGTH);
          tickView.setUint8(TICK_COMPUTOR_INDEX_OFFSET, tickView.getUint8(TICK_COMPUTOR_INDEX_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_TICK, true);

          const computorIndex = tickView[`getUint${TICK_COMPUTOR_INDEX_LENGTH * 8}`](TICK_COMPUTOR_INDEX_OFFSET, true);

          if (schnorrq.verify(system.computors[computorIndex], digest, tick.slice(TICK_SIGNATURE_OFSSET, TICK_SIGNATURE_OFSSET + crypto.SIGNATURE_LENGTH)) === 1) {
            propagate(computorIndex, receivedTick)

            if (system.ticks.has(receivedTick) === false) {
              system.ticks.set(receivedTick, new Array(NUMBER_OF_COMPUTORS));
            }

            if ((system.ticks.get(receivedTick)[computorIndex]?.tick || 0) < receivedTick) {
              const ticks = system.ticks.get(receivedTick);
              ticks[computorIndex] = {
                tick,
                initSpectrumDigest: digestBytesToString(tick.slice(TICK_INIT_SPECTRUM_DIGEST_OFFSET, TICK_INIT_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                initUniverseDigest: digestBytesToString(tick.slice(TICK_INIT_UNIVERSE_DIGEST_OFFSET, TICK_INIT_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                initComputerDigest: digestBytesToString(tick.slice(TICK_INIT_COMPUTER_DIGEST_OFFSET, TICK_INIT_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                prevSpectrumDigest: digestBytesToString(tick.slice(TICK_PREV_SPECTRUM_DIGEST_OFFSET, TICK_PREV_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                prevUniverseDigest: digestBytesToString(tick.slice(TICK_PREV_UNIVERSE_DIGEST_OFFSET, TICK_PREV_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                prevComputerDigest: digestBytesToString(tick.slice(TICK_PREV_COMPUTER_DIGEST_OFFSET, TICK_PREV_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                saltedSpectrumDigest: digestBytesToString(tick.slice(TICK_SALTED_SPECTRUM_DIGEST_OFFSET, TICK_SALTED_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                saltedUniverseDigest: digestBytesToString(tick.slice(TICK_SALTED_UNIVERSE_DIGEST_OFFSET, TICK_SALTED_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                saltedComputerDigest: digestBytesToString(tick.slice(TICK_SALTED_COMPUTER_DIGEST_OFFSET, TICK_SALTED_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH)),
                digestOfTransactions: digestBytesToString(tick.slice(TICK_DIGEST_OF_TRANSACTIONS_OFFSET, TICK_DIGEST_OF_TRANSACTIONS_OFFSET + crypto.DIGEST_LENGTH)),
              };

              let numberOfAlignedTicks = 1;
              for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                if (computorIndex !== i && ticks[i] !== undefined) {
                  if (
                    ticks[computorIndex].initSpectrumDigest === ticks[i].initSpectrumDigest &&
                    ticks[computorIndex].initUniverseDigest === ticks[i].initUniverseDigest &&
                    ticks[computorIndex].initComputerDigest === ticks[i].initComputerDigest &&
                    ticks[computorIndex].prevSpectrumDigest === ticks[i].prevSpectrumDigest &&
                    ticks[computorIndex].prevUniverseDigest === ticks[i].prevUniverseDigest &&
                    ticks[computorIndex].prevComputerDigest === ticks[i].prevComputerDigest &&
                    ticks[computorIndex].saltedSpectrumDigest === ticks[i].saltedSpectrumDigest &&
                    ticks[computorIndex].saltedUniverseDigest === ticks[i].saltedUniverseDigest &&
                    ticks[computorIndex].saltedComputerDigest === ticks[i].saltedComputerDigest &&
                    ticks[computorIndex].digestOfTransactions === ticks[i].digestOfTransactions
                  ) {
                    if (numberOfAlignedTicks >= QUORUM) {
                      if (system.tick < receivedTick) {
                        system.tick = receivedTick;
                        system.ticks.delete(receivedTick);
                        system.digestsOfTransactionsByTick.set(receivedTick, ticks[computorIndex].digestOfTransactions);

                        that.emit('tick', ticks[computorIndex]);
                      }
                      break;
                    }
                  }
                }
              }
              console.log('Number of aligned ticks:', numberOfAlignedTicks);
            }
          } else {
            closeAndReconnect();
          }
        }
      }
    }

    const peersListener = function (numberOfPeers) {
      that.emit('peers', numberOfPeers);
    }

    const messageListener = function (message) {
      that.emit('message', message);
    }

    const launch = function () {
      network.launch();
      network.addListener('computors', computorsListener);
      network.addListener('resource-test-solution', resourceTestSolutionListener);
      network.addListener('terminator', terminatorListener);
      network.addListener('tick', tickListener);
      network.addListener('peers', peersListener);
      network.addListener('message', messageListener);
    };

    const shutdown = function () {
      network.shutdown();
      network.removeListener('computors', computorsListener);
      network.removeListener('resource-test-solution', resourceTestSolutionListener);
      network.removeListener('terminator', terminatorListener);
      network.removeListener('tick', tickListener);
      network.removeListener('peers', peersListener);
      network.removeListener('message', messageListener);
    };

    const broadcastTransaction = function (transaction, state, tick) {
      network.broadcast(transaction);
      const transactionView = new DataView(transaction.buffer);
      let numberOfBroadcastings = 0;
      let cancel = false;
      setTimeout(function rebroadcast() {
        if (state !== undefined && (state.tickOffset - 1) > tick) {
          return;
        }
        if (transactionView[`getUint${TRANSACTION_TICK_LENGTH * 8}`](TRANSACTION_TICK_OFFSET, true) > system.tick) {
          if (cancel === false) {
            console.log('Rebroadcasting...', transaction);
            network.rebroadcast(transaction);
            setTimeout(rebroadcast, ++numberOfBroadcastings * OWN_TRANSACTION_REBROADCAST_TIMEOUT);
          }
        }
      }, OWN_TRANSACTION_REBROADCAST_TIMEOUT);

      return function () {
        cancel = true;
      }
    };

    const entity = async function (seed, index = 0) {
      if (new RegExp(`^[a-z]{${SEED_IN_LOWERCASE_LATIN_LENGTH}}$`).test(seed) === false) {
        throw new Error(`Invalid seed. Must be ${SEED_IN_LOWERCASE_LATIN_LENGTH} lowercase latin chars.`);
      }

      const state = {
        identity: '',
        energy: 0,
        tickOffset: 0,
      };

      const { K12, schnorrq } = await crypto;
      const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

      const preimage = seedStringToBytes(seed);
      while (index-- > 0) {
        for (let i = 0; i < preimage.length; i++) {
          if (++preimage[i] > ALPHABET.length) {
            preimage[i] = 1;
          } else {
            break;
          }
        }
      }
    
      const privateKey = new Uint8Array(crypto.PRIVATE_KEY_LENGTH);
      K12(preimage, privateKey, crypto.PRIVATE_KEY_LENGTH);
      
      const identityBytes = new Uint8Array(crypto.PUBLIC_KEY_LENGTH);
      identityBytes.set(schnorrq.generatePublicKey(privateKey));

      const identityWithChecksumBytes = new Uint8Array(crypto.PUBLIC_KEY_LENGTH + crypto.CHECKSUM_LENGTH);
      const checksum = new Uint8Array(crypto.CHECKSUM_LENGTH);
      K12(identityBytes, checksum, crypto.CHECKSUM_LENGTH);
      identityWithChecksumBytes.set(identityBytes);
      identityWithChecksumBytes.set(checksum, crypto.PUBLIC_KEY_LENGTH);

      state.identity = publicKeyBytesToString(identityWithChecksumBytes);

      system.entities.add(state.identity);

      const getEnergy = function () {
        return state.energy;
      }

      const verifyChecksum = function (identity) {
        const buffer = publicKeyStringToBytes(identity);
        const checksum = new Uint8Array(crypto.CHECKSUM_LENGTH);
        K12(buffer.slice(0, crypto.PUBLIC_KEY_LENGTH), checksum, crypto.CHECKSUM_LENGTH);
        const identityWithChecksumBytes = new Uint8Array(crypto.PUBLIC_KEY_LENGTH + crypto.CHECKSUM_LENGTH);
        identityWithChecksumBytes.set(buffer);
        identityWithChecksumBytes.set(checksum, crypto.PUBLIC_KEY_LENGTH);
        if (identity.slice(-4) === publicKeyBytesToString(identityWithChecksumBytes).slice(-4)){
          return true;
        }
        return false;
      }

      const transaction = async function ({ destination, energy, tick }) {
        if (verifyChecksum(destination) === false) {
          throw new Error('Invalid destination checksum.');
        }

        if (Number.isInteger(tick) === false) {
          throw new Error('Invalid tick.');
        }

        if (!tick && system.tick === 0) {
          return setTimeout(function () {
            transaction({ destination, energy });
          }, 1000);
        }
        const tx = new Uint8Array(TRANSACTION_INPUT_SIZE_OFFSET + TRANSACTION_INPUT_SIZE_LENGTH + crypto.SIGNATURE_LENGTH).fill(0);
        const txView = new DataView(tx.buffer);
        const publicKey = identityBytes.slice(0, crypto.PUBLIC_KEY_LENGTH);

        txView[`setUint${SIZE_LENGTH * 8}`](SIZE_OFFSET, tx.length, true);
        txView[`setUint${TYPE_LENGTH * 8}`](TYPE_OFFSET, MESSAGE_TYPES.BROADCAST_TRANSACTION, true);
        txView[`setUint${PROTOCOL_VERSION_LENGTH * 8}`](PROTOCOL_VERSION_OFFSET, protocol, true);

        tx.set(publicKey, TRANSACTION_SOURCE_PUBLIC_KEY_OFFSET);
        tx.set(
          publicKeyStringToBytes(destination).slice(0, crypto.PUBLIC_KEY_LENGTH),
          TRANSACTION_DESTINATION_PUBLIC_KEY_OFFSET
        );
        txView.setBigUint64(TRANSACTION_AMOUNT_OFFSET, BigInt(energy), true);
        if (!tick) {
          tick = system.tick + TRANSACTION_PUBLICATION_TICK_OFFSET;
          if (state.tickOffset === 0) {
            state.tickOffset = tick + 1;
          } else if (state.tickOffset > tick) {
            tick = state.tickOffset;
            state.tickOffset++;
          }
        } else if (state.tickOffset < tick){
          state.tickOffset = tick + 1;
        }
        txView[`setUint${TRANSACTION_TICK_LENGTH * 8}`](TRANSACTION_TICK_OFFSET, tick, true);

        const { schnorrq, K12 } = await crypto;
        const digest = new Uint8Array(crypto.DIGEST_LENGTH);
        K12(tx.slice(TRANSACTION_SOURCE_PUBLIC_KEY_OFFSET, TRANSACTION_INPUT_SIZE_OFFSET + TRANSACTION_INPUT_SIZE_LENGTH), digest, crypto.DIGEST_LENGTH);
        tx.set(schnorrq.sign(privateKey, publicKey, digest), TRANSACTION_INPUT_SIZE_OFFSET + TRANSACTION_INPUT_SIZE_LENGTH);
    
        console.log('Transaction:', tx);
        broadcastTransaction(tx, state, tick);

        return tx;
      };

      return {
        identity: state.identity,
        verifyChecksum,
        getEnergy,
        transaction,
      };
    }

    const getTick = function () {
      return system.tick;
    };

    return Object.assign(
      this,
      {
        launch,
        shutdown,
        entity,
        getTick,
        broadcastTransaction,
        setMinScore,
      },
      EventEmitter.prototype
    )
  }.call({});
};

export default _451;

export { resourceTester };
