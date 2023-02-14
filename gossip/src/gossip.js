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
import WebSocket from 'isomorphic-ws';
import wrtc from 'wrtc';
import crypto from 'qubic-crypto';
import { digestBytesToString } from 'qubic-converter';

export const NUMBER_OF_CHANNELS = 4;
const MIN_WEBRTC_CONNECTION_ATTEMPT_DURATION = 6 * 1000;
const MAX_ROTATING_CHANNEL_DURATION = 1 * 60 * 1000;
const MAX_PERIOD_OF_CHANNEL_INACTIVITY = 10 * 1000;
const CHANNEL_TIMEOUT_MULTIPLIER = 100;

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3, 
}

export const MESSAGE_TYPES = {
  EXCHANGE_PUBLIC_PEERS: 0,
  BROADCAST_RESOURCE_TEST_SOLUTION: 1,
  BROADCAST_COMPUTORS: 2,
  BROADCAST_TICK: 3,
  BROADCAST_REVENUES: 4,
  REQUEST_COMPUTORS: 11,
  BROADCAST_TRANSACTION: 24,
};

export const SIZE_OFFSET = 0;
export const SIZE_LENGTH = 4;
export const PROTOCOL_VERSION_OFFSET = SIZE_OFFSET + SIZE_LENGTH;
export const PROTOCOL_VERSION_LENGTH = 2;
export const TYPE_OFFSET = PROTOCOL_VERSION_OFFSET + PROTOCOL_VERSION_LENGTH;
export const TYPE_LENGTH = 2;
export const HEADER_LENGTH = TYPE_OFFSET + TYPE_LENGTH;

export const RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET = HEADER_LENGTH;

export const TICK_COMPUTOR_INDEX_OFFSET = HEADER_LENGTH;
export const TICK_COMPUTOR_INDEX_LENGTH = 2;
export const TICK_EPOCH_OFFSET = TICK_COMPUTOR_INDEX_OFFSET + TICK_COMPUTOR_INDEX_LENGTH;
export const TICK_EPOCH_LENGTH = 2;
export const TICK_TICK_OFFSET = TICK_EPOCH_OFFSET + TICK_EPOCH_LENGTH;
export const TICK_TICK_LENGTH = 4;

const MIN_COMPUTORS_PROPAGATION_TIMEOUT = 30 * 1000;
const MIN_RESOURCE_TEST_SOLUTION_PROPAGATION_TIMEOUT = 30 * 1000;
const MIN_TICK_PROPAGATION_TIMEOUT = 3 * 1000;
const TICK_PROPAGATION_PROBABILTY = 1;

const MAX_BIG_INT = 2n ** 64n - 1n;
const TRANSACTION_DEJAVU_FALSE_POSITIVE_PROBABILITY = 0.1;
const TRANSACTION_DEJAVU_CAPACITY = 16000000;
const TRANSACTION_DEJAVU_BIT_LENGTH = Math.ceil(-(TRANSACTION_DEJAVU_CAPACITY * Math.log(TRANSACTION_DEJAVU_FALSE_POSITIVE_PROBABILITY)) / (Math.log(2) ** 2));
const NUMBER_OF_TRANSACTION_REBROADCASTINGS = 5;
const TRANSACTION_REBROADCAST_TIMEOUT = 1000;

export const gossip = function ({ signalingServers, iceServers, store, protocol }) {
  const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;

  const channels = Array(NUMBER_OF_CHANNELS);
  const closeFunctions = Array(NUMBER_OF_CHANNELS);
  const numbersOfFailingChannelsInARow = Array(NUMBER_OF_CHANNELS).fill(0);

  const dejavu = {
    computors: Array(NUMBER_OF_CHANNELS).fill(0),
    resourceTestSolutionsByDigest: new Map(),
    ticksByComputorIndex: new Map(),
    transactions: new Uint8Array(TRANSACTION_DEJAVU_BIT_LENGTH / 8),
  };

  const clearResourceTestSolutionsDejavu = function () {
    dejavu.resourceTestSolutionsByDigest.clear();
  }

  const propagateComputors = function (i, data, callback) {
    const t = Date.now();
    dejavu.computors[i] = t;
    for (let j = 0; j < NUMBER_OF_CHANNELS; j++) {
      if (i !== j) {
        if (t - dejavu.computors[j] > MIN_COMPUTORS_PROPAGATION_TIMEOUT) {
          if (channels[j]?.readyState === 'open') {
            dejavu.computors[j] = t;
            channels[j].send(data);
            if (typeof callback === 'function') {
              callback();
            }
          }
        }
      }
    }
  };

  const propagateResourceTestingSolution = async function (i, data, digest, callback) {
    if (digest === undefined) {
      const resourceTestSolution = new Uint8Array(data);
      const resourceTestSolutionView = new DataView(data);
      const digestBytes = new Uint8Array(crypto.DIGEST_LENGTH);
      const { K12 } = await crypto;
      resourceTestSolutionView.setUint8(RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, resourceTestSolutionView.getUint8(RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_RESOURCE_TEST_SOLUTION, true);
      K12(resourceTestSolution.slice(RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, resourceTestSolution.length - crypto.SIGNATURE_LENGTH), digestBytes, crypto.DIGEST_LENGTH);
      resourceTestSolutionView.setUint8(RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, resourceTestSolutionView.getUint8(RESOURCE_TEST_SOLUTION_COMPUTOR_PUBLIC_KEY_OFFSET, true) ^ MESSAGE_TYPES.BROADCAST_RESOURCE_TEST_SOLUTION, true);
      digest = digestBytesToString(digestBytes);
    }

    const t = Date.now();
    if (dejavu.resourceTestSolutionsByDigest.has(digest) === false) {
      dejavu.resourceTestSolutionsByDigest.set(digest, Array(NUMBER_OF_CHANNELS).fill(0));
    }

    dejavu.resourceTestSolutionsByDigest.get(digest)[i] = t;

    for (let j = 0; j < NUMBER_OF_CHANNELS; j++) {
      if (i !== j) {
        if (t - dejavu.resourceTestSolutionsByDigest.get(digest)[j] > MIN_RESOURCE_TEST_SOLUTION_PROPAGATION_TIMEOUT) {
          if (channels[j]?.readyState === 'open') {
            dejavu.resourceTestSolutionsByDigest.get(digest)[j] = t;
            channels[j].send(data);
            if (typeof callback === 'function') {
              callback();
            }
          }
        }
      }
    }
  };

  const propagateTick = function (i, data, computorIndex, tick, callback) {
    if (computorIndex === undefined) {
      const tickView = new DataView(data);
      computorIndex = tickView[`getUint${TICK_COMPUTOR_INDEX_LENGTH * 8}`](TICK_COMPUTOR_INDEX_OFFSET, true);
      tick = tickView[`getUint${TICK_TICK_LENGTH * 8}`](TICK_TICK_OFFSET, true);
    }

    const t = Date.now();
    if (dejavu.ticksByComputorIndex.has(computorIndex) === false) {
      dejavu.ticksByComputorIndex.set(computorIndex, new Map());
    }
    if (dejavu.ticksByComputorIndex.get(computorIndex).has(tick) === false) {
      dejavu.ticksByComputorIndex.get(computorIndex).set(tick, Array(NUMBER_OF_CHANNELS).fill(0));
    }

    dejavu.ticksByComputorIndex.get(computorIndex).get(tick)[i] = t;

    for (let j = 0; j < NUMBER_OF_CHANNELS; j++) {
      if (i !== j) {
        if (t - dejavu.ticksByComputorIndex.get(computorIndex).get(tick)[j] > MIN_TICK_PROPAGATION_TIMEOUT) {
          if (Math.random() <= TICK_PROPAGATION_PROBABILTY) {
            if (channels[j]?.readyState === 'open') {
              dejavu.ticksByComputorIndex.get(computorIndex).get(tick)[j] = t;
              channels[j].send(data);
              if (typeof callback === 'function') {
                callback();
              }
            }
          }
        }
      }
    }
  };

  const propagateTransaction = function (i, data, callback) {
    let n = 0;
    for (let j = 0; j < Math.ceil((TRANSACTION_DEJAVU_BIT_LENGTH / TRANSACTION_DEJAVU_CAPACITY) * Math.log(2)); j++) {
      const digest = new Uint8Array(8);
      K12(new Uint8Array(data), digest, 8);
      const k = Math.ceil((new DataView(digest.buffer).readBigUint64(0, true) * TRANSACTION_DEJAVU_BIT_LENGTH) / MAX_BIG_INT);
      if ((dejavu.transactions[Math.floor(k / 8)] >>> (k - 8 * Math.floor(k / 8))) & 0x01) {
        n++;
      }
    }
    if (n === Math.ceil((TRANSACTION_DEJAVU_BIT_LENGTH / TRANSACTION_DEJAVU_CAPACITY) * Math.log(2))) {
      for (let j = 0; j < Math.ceil((TRANSACTION_DEJAVU_BIT_LENGTH / TRANSACTION_DEJAVU_CAPACITY) * Math.log(2)); j++) {
        const digest = new Uint8Array(8);
        K12(new Uint8Array(data), digest, 8);
        const k = Math.ceil((new DataView(digest.buffer).readBigUint64(0, true) * TRANSACTION_DEJAVU_BIT_LENGTH) / MAX_BIG_INT);
        dejavu.transactions[Math.floor(k / 8)] |= (0x01 << (k - 8 * Math.floor(k / 8)));
      }
      let count = 0;
      const f = function () {
        for (let j = 0; j < NUMBER_OF_CHANNELS; j++) {
          if (i !== j) {
            if (channels[j]?.readyState === 'open') {
              channels[j].send(data);
              if (typeof callback === 'function') {
                callback();
              }
            }
          }
        }
        if (++count <= NUMBER_OF_TRANSACTION_REBROADCASTINGS) {
          setTimeout(f, TRANSACTION_REBROADCAST_TIMEOUT);
        }
      };
      f();
    }
  };

  return function() {
    const that = this;

    const channel = function (i) {
      const socket = new WebSocket(`wss://${signalingServers[0] /* TODO: support many servers */}`);
      socket.binaryType = 'arraybuffer';

      let pc
      let state = 0;
  
      let closeAndReconnectTimeout;
      let inactiveChannelTimeout;
      let rotationTimeout;
      let connectionAttemptTimeout = setTimeout(function () {
        if (state++ > 0) {
          return;
        }
        clearTimeout(closeAndReconnectTimeout);
        clearTimeout(inactiveChannelTimeout);
        clearTimeout(rotationTimeout);
        socket.close();
        pc?.close();
        pc = undefined;
        if (channels[i]?.readyState === 'open') {
          channels[i].close();
          channels[i] = undefined;
        }
        channel(i);
      }, MIN_WEBRTC_CONNECTION_ATTEMPT_DURATION + (++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER));


      closeFunctions[i] = function () {
        clearTimeout(closeAndReconnectTimeout);
        clearTimeout(connectionAttemptTimeout);
        clearTimeout(inactiveChannelTimeout);
        clearTimeout(rotationTimeout);
        socket.close();
        pc?.close();
        pc = undefined;
        if (channels[i]?.readyState === 'open') {
          channels[i].close();
          channels[i] = undefined;
        }
      };

      const closeAndReconnect = function (timeoutDuration) {
        if (state++ > 0) {
          return;
        }
        closeAndReconnectTimeout = setTimeout(function () {
          clearTimeout(connectionAttemptTimeout);
          clearTimeout(inactiveChannelTimeout);
          clearTimeout(rotationTimeout);
          socket.close();
          pc?.close();
          pc = undefined;
          if (channels[i]?.readyState === 'open') {
            channels[i].close();
            channels[i] = undefined;
          }
          channel(i);
        }, timeoutDuration);
      };

      socket.addEventListener('message', function (event) {
        const view = new DataView(event.data);

        switch (view.getUint8(0, true)) {
          case SIGNAL_TYPES.ROLE:
            const role = view.getUint8(1, true);

            const open = function (dc) {
              dc.binaryType = 'arraybuffer';
              
              let inactivityFlag = false; 
              dc.onopen =  function () {
                that.emit('peers', channels.filter(channel => channel?.readyState === 'open' || channel?.readyState === 'closing').length);
                clearTimeout(closeAndReconnectTimeout);
                clearTimeout(connectionAttemptTimeout);
                numbersOfFailingChannelsInARow[i] = 0;
                channels[i] = dc;
                console.log(`Peer ${i} connected.`);
                inactiveChannelTimeout = setTimeout(function () {
                  inactivityFlag = true;
                  dc?.close();
                }, MAX_PERIOD_OF_CHANNEL_INACTIVITY);
                if (i === NUMBER_OF_CHANNELS - 1) {
                  rotationTimeout = setTimeout(function () {
                    dc?.close();
                  }, MAX_ROTATING_CHANNEL_DURATION);
                }

                if (store.computors !== undefined) {
                  if (dc.readyState === 'open') {
                    dc.send(store.computors.buffer);
                  }
                }

                for (const resourceTestSolution of store.resourceTestSolutions.values()) {
                  if (dc.readyState === 'open') {
                    //dc.send(resourceTestSolution);
                  }
                }

                for (const tick of store.ticks) {
                  if (tick !== undefined) {
                    if (dc.readyState === 'open') {
                     dc.send(tick.buffer);
                    }
                  }
                }
              };
              dc.onclose = function () {
                console.log(`Peer ${i} disconnected. Finding new peer...`);
                channels[i] = undefined;
                dc = undefined;
                that.emit('peers', channels.filter(channel => channel?.readyState === 'open' || channel?.readyState === 'closing').length);
                closeAndReconnect(inactivityFlag === true ? 0 : ++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
              };

              dc.onmessage = async function (event) {
                if ((event.data instanceof ArrayBuffer) === false) {
                  return closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
                }
                const dataView = new DataView(event.data);
                if (dataView[`getUint${PROTOCOL_VERSION_LENGTH * 8}`](PROTOCOL_VERSION_OFFSET, true) !== protocol) {
                  return closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);;
                }

                clearTimeout(inactiveChannelTimeout);
                inactiveChannelTimeout = setTimeout(function () {
                  dc?.close();
                }, MAX_PERIOD_OF_CHANNEL_INACTIVITY);

                const data = new Uint8Array(event.data);

                that.emit('message', data);

                switch (dataView[`getUint${TYPE_LENGTH * 8}`](TYPE_OFFSET, true)) {
                  case MESSAGE_TYPES.BROADCAST_COMPUTORS:
                    that.emit('computors', {
                      computors: data,
                      channel: i,
                      propagate: function () {
                        propagateComputors(i, event.data);
                      },
                      closeAndReconnect: function () {
                        closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
                      },
                    });
                    break;

                  case MESSAGE_TYPES.BROADCAST_RESOURCE_TEST_SOLUTION:
                    that.emit('resource-test-solution', {
                      resourceTestSolution: data,
                      closeAndReconnect: function () {
                        closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
                      },
                      propagate: function (digest) {
                        propagateResourceTestingSolution(i, digest, event.data);
                      }
                    });
                    break;

                  case MESSAGE_TYPES.BROADCAST_TICK:
                    that.emit('tick', {
                      tick: data,
                      closeAndReconnect: function () {
                        closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
                      },
                      propagate: function (computorIndex, tick) {
                       propagateTick(i, event.data, computorIndex, tick);
                      }
                    });
                    break;
                  case MESSAGE_TYPES.BROADCAST_TRANSACTION:
                    that.emit('transaction', {
                      transaction: data,
                      closeAndReconnect: function () {
                        closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
                      },
                      propagate: function () {
                        propagateTransaction(i, event.data);
                      },
                    })
                    console.log('Received transaction', data);
                    break;
                  default:
                }
              };
            }

            pc = new RTCPeerConnection({
              iceServers: iceServers.map(function (iceServer) {
                return {
                  urls: [
                    iceServer,
                  ],
                };
              }),
            });

            pc.oniceconnectionstatechange = function () {
              if (pc !== undefined && pc.iceConnectionState === 'failed') {
                pc.restartIce();
              }
              if (pc !== undefined && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed')) {
                closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
              }
            };
      
            pc.ondatachannel = function ({ channel }) {
              const signal = new Uint8Array(1);
              const signalView = new DataView(signal.buffer);
              signalView.setUint8(0, SIGNAL_TYPES.CHANNEL_ESTABLISHED, true);
              socket.send(signal);
              open(channel);
            };

            pc.onicecandidate = function ({ candidate }) {
              if (candidate) {
                const payload = new TextEncoder().encode(JSON.stringify(candidate));
                const signal = new Uint8Array(1 + payload.length);
                const signalView = new DataView(signal.buffer);
                signal.set(payload, 1);
                signalView.setUint8(0, SIGNAL_TYPES.ICE_CANDIDATE, true);
                socket.send(signal.buffer);
              }
            };

            pc.onnegotiationneeded = function () {
              if (pc !== undefined) {
                // Caller issues SDP offer
                pc
                  .createOffer()
                  .then(function (offer) {
                    return pc?.setLocalDescription(offer)
                  })
                  .then(function () {
                    const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription))
                    const signal = new Uint8Array(1 + payload.length);
                    const signalView = new DataView(signal.buffer);
                    signal.set(payload, 1);
                    signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
                    socket.send(signal);
                  })
                  .catch(console.log);
              }
            };

            if (role === 1) {
              open(pc.createDataChannel('qbc'));
            }
            break;
          case SIGNAL_TYPES.ICE_CANDIDATE:
            const candidate = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
            if (candidate?.candidate?.length > 0) {
              pc?.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.log);
            }
            break;
          case SIGNAL_TYPES.SESSION_DESCRIPTION:
            const sessionDescription = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
            if (sessionDescription.type === 'offer') {
              ;(pc !== undefined ? (pc.signalingState !== 'stable'
                ? Promise.all([
                  pc?.setLocalDescription({ type: 'rollback' }),
                  pc?.setRemoteDescription(new RTCSessionDescription(sessionDescription)),
                ])
                : pc?.setRemoteDescription(new RTCSessionDescription(sessionDescription))) : Promise.resolve())
                  .then(function () {
                    // Callee anwsers SDP offer
                    return pc?.createAnswer()
                  })
                  .then(function (answer) {
                    return pc?.setLocalDescription(answer);
                  })
                  .then(function () {
                    if (pc !== undefined) {
                      const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription))
                      const signal = new Uint8Array(1 + payload.length);
                      const signalView = new DataView(signal.buffer);
                      signal.set(payload, 1);
                      signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
                      socket.send(signal);
                    }
                  })
                  .catch(console.log);
            } else if (sessionDescription.type === 'answer') {
              pc?.setRemoteDescription(new RTCSessionDescription(sessionDescription)).catch(console.log);
            }
            break;
        }
      });

      socket.addEventListener('error', function (error) {
        console.log(error.message || error);
      });
      
      socket.addEventListener('close', function () {
        if (channels[i]?.readyState !== 'open' || channels[i]?.readyState === 'closing') {
          closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
        }
      });
    };

    const launch = function () {
      for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
        channel(i);
      }
    }

    const broadcast = function (data, callback) {
      const dataView = new DataView(data.buffer);
      for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
        switch (dataView[`getUint${TYPE_LENGTH * 8}`](TYPE_OFFSET, true)) {
          case MESSAGE_TYPES.BROADCAST_COMPUTORS:
            propagateComputors(-1, data.buffer, callback);
            break;
          case MESSAGE_TYPES.BROADCAST_RESOURCE_TEST_SOLUTION:
            propagateResourceTestingSolution(-1, data.buffer, undefined, callback);
            break;
          case MESSAGE_TYPES.BROADCAST_TICK:
            propagateTick(-1, data.buffer, undefined, undefined, callback);
            break;
          case MESSAGE_TYPES.BROADCAST_TRANSACTION:
            propagateTransaction(-1, data.buffer, callback);
            break;
        }
      }
    };

    const rebroadcast = function (data) {
      for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
        if (channels[i]?.readyState === 'open') {
          channels[i].send(data.buffer);
        }
      }
    };

    const shutdown = function () {
      for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
        closeFunctions[i]();
      }
    };

    return Object.assign(
      this,
      {
        launch,
        broadcast,
        rebroadcast,
        clearResourceTestSolutionsDejavu,
        shutdown,
      },
      EventEmitter.prototype
    );
  }.call({});
};
