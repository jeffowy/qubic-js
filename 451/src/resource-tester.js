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

import crypto from 'qubic-crypto';
import { bytes32ToString, digestBytesToString, publicKeyBytesToString } from 'qubic-converter';
import { MESSAGE_TYPES, HEADER_LENGTH } from 'qubic-gossip';
import { isZero } from './is-zero.js';

const NUMBER_OF_LINKS_PER_NEURON = 2;
const NUMBER_OF_SOLUTION_NONCES = 1000;
const MILLISECOND_LENGTH = 2;
const TIME_UNIT_LENGTH = 1
const RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET = HEADER_LENGTH;
const RESOURCE_TESTING_SOLUTION_MILLISECOND_OFFSET = RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH + 1;
const RESOURCE_TESTING_SOLUTION_SECOND_OFFSET = RESOURCE_TESTING_SOLUTION_MILLISECOND_OFFSET + MILLISECOND_LENGTH;
const RESOURCE_TESTING_SOLUTION_MINUTE_OFFSET = RESOURCE_TESTING_SOLUTION_SECOND_OFFSET + TIME_UNIT_LENGTH;
const RESOURCE_TESTING_SOLUTION_HOUR_OFFSET = RESOURCE_TESTING_SOLUTION_MINUTE_OFFSET + TIME_UNIT_LENGTH;
const RESOURCE_TESTING_SOLUTION_MONTH_OFFSET = RESOURCE_TESTING_SOLUTION_HOUR_OFFSET + TIME_UNIT_LENGTH;
const RESOURCE_TESTING_SOLUTION_YEAR_OFFSET = RESOURCE_TESTING_SOLUTION_MONTH_OFFSET + TIME_UNIT_LENGTH;
const RESOURCE_TESTING_SOLUTION_NONCES_OFFSET = RESOURCE_TESTING_SOLUTION_YEAR_OFFSET + TIME_UNIT_LENGTH;
const RESOURCE_TESTING_SOLUTION_NONCES_LENGTH = NUMBER_OF_SOLUTION_NONCES * crypto.NONCE_LENGTH;
const RESOURCE_TESTING_SOLUTION_SIGNATURE_OFFSET = RESOURCE_TESTING_SOLUTION_NONCES_OFFSET + RESOURCE_TESTING_SOLUTION_NONCES_LENGTH;

const random = function (publicKey, nonce, output) {
  const state = new Uint8Array(crypto.KECCAK_STATE_LENGTH).fill(0);
  state.set(publicKey, 0);
  state.set(nonce, crypto.PUBLIC_KEY_LENGTH);

  let j = 0;
  for (; j < Math.floor(output.byteLength / state.length); j++) {
    crypto.keccakP160012(state);
    if (output instanceof BigUint64Array) {
      output.set(new BigUint64Array(state.slice().buffer), j * state.length / 8);
    } else if (output instanceof Uint32Array) {
      output.set(new Uint32Array(state.slice().buffer), j * state.length / 4);
    }
  }
  if (output.byteLength % state.length) {
    crypto.keccakP160012(state);
    if (output instanceof BigUint64Array) {
      output.set(new BigUint64Array(state.slice(0, output.byteLength % state.length).buffer), j * state.length / 8);
    } else if (output instanceof Uint32Array) {
      output.set(new Uint32Array(state.slice(0, output.byteLength % state.length).buffer), j * state.length / 4);
    }
  }
}

export const resourceTester = function () {
  const parameters = {};
  const miningData = new BigUint64Array(65536);
  const noncesByPublicKey = new Map();

  const resourceTest = async function(resourceTestSolution) {
    const { K12, schnorrq } = await crypto;
    const resourceTestSolutionView = new DataView(resourceTestSolution.buffer);

    const computorPublicKey = resourceTestSolution.slice(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH);

    if (isZero(computorPublicKey) === false) {
      const digest = new Uint8Array(crypto.DIGEST_LENGTH);
      resourceTestSolutionView.setUint8(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, resourceTestSolutionView.getUint8(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_RESOURCE_TESTING_SOLUTION, true);
      K12(resourceTestSolution.slice(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, RESOURCE_TESTING_SOLUTION_SIGNATURE_OFFSET), digest, crypto.DIGEST_LENGTH);
      resourceTestSolutionView.setUint8(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, resourceTestSolutionView.getUint8(RESOURCE_TESTING_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_RESOURCE_TESTING_SOLUTION, true);

      if (schnorrq.verify(computorPublicKey, digest, resourceTestSolution.slice(RESOURCE_TESTING_SOLUTION_SIGNATURE_OFFSET, RESOURCE_TESTING_SOLUTION_SIGNATURE_OFFSET + crypto.SIGNATURE_LENGTH)) === 1) { // anti-spam
        const computorPublicKeyString = publicKeyBytesToString(publicKey);

        if (noncesByPublicKey.has(computorPublicKeyString) === false) {
          noncesByPublicKey.set(computorPublicKeyString, new Set());
        }
        
        let score = 0;
        for (let i = 0; i < NUMBER_OF_SOLUTION_NONCES; i++) {
          const nonce = resourceTestSolution.slice(RESOURCE_TESTING_SOLUTION_NONCES_OFFSET + i * crypto.NONCE_LENGTH, RESOURCE_TESTING_SOLUTION_NONCES_OFFSET + (i + 1) * crypto.NONCE_LENGTH);
          
          if (isZero(nonce) === false) {
            const nonceString = bytes32ToString(nonce);
            
            if (noncesByPublicKey.get(computorPublicKeyString).has(nonceString) === false) {
              noncesByPublicKey.add(nonceString);

              const neuronLinks = new Uint32Array(parameters.numberOfNeurons * NUMBER_OF_LINKS_PER_NEURON);
              random(computorPublicKey, nonce, neuronLinks);
              
              for (let j = 0; j < parameters.numberOfNeurons * NUMBER_OF_LINKS_PER_NEURON; j += NUMBER_OF_LINKS_PER_NEURON) {
                neuronLinks[j] %= parameters.numberOfNeurons;
                neuronLinks[j + 1] %= parameters.numberOfNeurons;
              }
            
              const neuronValues = new Uint8Array(parameters.numberOfNeurons).fill(0xFF);
              let limiter = miningData.length;
              let outputLength = 0;
            
              while (outputLength < (miningData.byteLength << 3)) {
                const prevValue0 = neuronValues[parameters.numberOfNeurons - 1];
                const prevValue1 = neuronValues[parameters.numberOfNeurons - 2];
            
                for (let j = 0; j < parameters.numberOfNeurons; j++) {
                  neuronValues[j] = ~(neuronValues[neuronLinks[j * NUMBER_OF_LINKS_PER_NEURON]] & neuronValues[neuronLinks[j * NUMBER_OF_LINKS_PER_NEURON + 1]]);
                }
            
                if (neuronValues[parameters.numberOfNeurons - 1] !== prevValue0 && neuronValues[parameters.numberOfNeurons - 2] === prevValue1) {
                  if (((miningData[outputLength >> 6] >> BigInt(outputLength & 63)) & 1n) === 0n) {
                    break;
                  }
            
                  outputLength++;
                } else {
                  if (neuronValues[parameters.numberOfNeurons - 2] !== prevValue1 && neuronValues[parameters.numberOfNeurons - 1] === prevValue0) {
                    if (((miningData[outputLength >> 6] >> BigInt(outputLength & 63)) & 1n) !== 0n) {
                      break;
                    }
            
                    outputLength++;
                  } else {
                    if (--limiter === 0) {
                      break;
                    }
                  }
                }
              }
            
              console.log(outputLength);

              if (outputLength >= parameters.solutionThreshold) {
                score++;
              }
            } else {
              return false;
            }
          }
        }

        console.log(`Score [${computorPublicKeyString}]: ${score}`);

        return {
          computorPublicKey,
          score,
          digest: digestBytesToString(digest),
        }
      }
    }

    return false;
  };

  const setResourceTestParameters = function ({ randomSeed, numberOfNeurons, solutionThreshold }) {
    if (Number.isInteger(numberOfNeurons) === false) {
      throw new Error('Invalid number of neurons!');
    }

    if (Number.isInteger(solutionThreshold) === false || solutionThreshold === 0) {
      throw new Error('Invalid solution threshold!');
    }

    parameters.numberOfNeurons = numberOfNeurons;
    parameters.solutionThreshold = solutionThreshold;
    random(randomSeed, randomSeed, miningData);
  }

  return {
    resourceTest,
    setResourceTestParameters,
  };
};