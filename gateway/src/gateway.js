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

import process from 'node:process';
import cluster from 'node:cluster';
import net from 'node:net';
import crypto from 'qubic-crypto';
import { gossip, MESSAGE_TYPES, SIZE_OFFSET, SIZE_LENGTH, PROTOCOL_VERSION_OFFSET, PROTOCOL_VERSION_LENGTH, TYPE_OFFSET, TYPE_LENGTH, HEADER_LENGTH, NUMBER_OF_CHANNELS, TICK_COMPUTOR_INDEX_LENGTH, TICK_COMPUTOR_INDEX_OFFSET } from 'qubic-gossip';
import { publicKeyBytesToString, publicKeyStringToBytes } from 'qubic-converter';
import { resourceTester, NUMBER_OF_COMPUTORS, COMPUTORS_PUBLIC_KEYS_OFFSET, TICK_SIGNATURE_OFSSET } from '451';

const NUMBER_OF_AVAILABLE_PROCESSORS = process.env.NUMBER_OF_AVAILABLE_PROCESSORS || 3;
const QUBIC_PORT = process.env.QUBIC_PORT || 21841;
const QUBIC_PROTOCOL = process.env.QUBIC_PROTOCOL || 89;
const NUMBER_OF_COMPUTOR_CONNECTIONS = process.env.NUMBER_OF_COMPUTOR_CONNECTIONS || 4;
const COMPUTORS = (process.env.COMPUTORS || '0.0.0.0').split(',').map(s => s.trim());
const COMPUTOR_CONNECTION_TIMEOUT_MULTIPLIER = 1000;
const NUMBER_OF_EXCHANGED_PEERS = 4;
const PEER_MATCHER = process.env.PEER_MATCHER || '0.0.0.0:8081';
const ICE_SERVER = process.env.ICE_SERVER || 'stun:0.0.0.0:3478';

const ADMIN_PUBLIC_KEY_BYTES = publicKeyStringToBytes(process.env.ADMIN_PUBLIC_KEY || 'EWVQXREUTMLMDHXINHYJKSLTNIFBMZQPYNIFGFXGJBODGJHCFSSOKJZCOBOH');

const NUMBER_OF_NEURONS = process.env.NUMBER_OF_NEURONS || 262144;
const SOLUTION_THRESHOLD = process.env.SOLUTION_THRESHOLD || 28;
const SEED_A = process.env.SEED_A || 159;
const SEED_B = process.env.SEED_B || 87;
const SEED_C = process.env.SEED_C || 115;
const SEED_D = process.env.SEED_D || 132;
const SEED_E = process.env.SEED_E || 132;
const SEED_F = process.env.SEED_F || 86;
const SEED_G = process.env.SEED_G || 13;
const SEED_H = process.env.SEED_H || 101;


MESSAGE_TYPES.EXCHANGE_PUBLIC_PEERS = 0;
MESSAGE_TYPES.REQUEST_COMPUTORS = 11;
MESSAGE_TYPES.REQUEST_QUORUM_TICK = 14;

const gateway = function () {
  const store = {
    computors: new Set(),
    resourceTestSolutions: new Map(),
  };
  const network = gossip({
    signalingServers: [PEER_MATCHER],
    iceServers: [ICE_SERVER],
    store,
    protocol: QUBIC_PROTOCOL,
  });
  network.launch();

  const randomSeed = new Uint8Array(32).fill(0);
  randomSeed[0] = SEED_A;
  randomSeed[1] = SEED_B;
  randomSeed[2] = SEED_C;
  randomSeed[3] = SEED_D;
  randomSeed[4] = SEED_E;
  randomSeed[5] = SEED_F;
  randomSeed[6] = SEED_G;
  randomSeed[7] = SEED_H;

  const { resourceTest, setResourceTestParameters } = resourceTester();
  setResourceTestParameters({
    randomSeed,
    numberOfNeurons: NUMBER_OF_NEURONS,
    solutionThreshold: SOLUTION_THRESHOLD,
  });

  const faultyComputors = new Set();

  let numberOfFailingComputorConnectionsInARow = 0;

  let numberOfInboundComputorRequests = 0;
  let numberOfOutboundComputorRequests = 0;
  let numberOfInboundWebRTCRequests = 0;
  let numberOfOutboundWebRTCRequests = 0;
  let numberOfInboundComputorRequests2 = 0;
  let numberOfOutboundComputorRequests2 = 0;
  let numberOfInboundWebRTCRequests2 = 0;
  let numberOfOutboundWebRTCRequests2 = 0;
  let numberOfPeers = 0;
  network.addListener('peers', function (n) {
    numberOfPeers = n;
  });

  const clusterNotificationInterval = setInterval(function () {
    process.send(JSON.stringify([
      numberOfInboundComputorRequests - numberOfInboundComputorRequests2,
      numberOfOutboundComputorRequests - numberOfOutboundComputorRequests2,
      numberOfInboundWebRTCRequests - numberOfInboundWebRTCRequests2,
      numberOfOutboundWebRTCRequests - numberOfOutboundWebRTCRequests2,
      numberOfPeers,
    ]));
    numberOfInboundComputorRequests2 = numberOfInboundComputorRequests;
    numberOfOutboundComputorRequests2 = numberOfOutboundComputorRequests;
    numberOfInboundWebRTCRequests2 = numberOfInboundWebRTCRequests;
    numberOfOutboundWebRTCRequests2 = numberOfOutboundWebRTCRequests;
  }, 1000);

  const onIPCMessage = function (message) {
    const data = JSON.parse(message);
    numberOfOutboundComputorRequests = numberOfOutboundComputorRequests2 = data[0];
    numberOfOutboundComputorRequests = numberOfOutboundComputorRequests2 = data[1];
    numberOfInboundWebRTCRequests = numberOfInboundWebRTCRequests2 = data[2];
    numberOfOutboundWebRTCRequests = numberOfOutboundWebRTCRequests2 = data[3];
  }
  process.on('message', onIPCMessage);

  network.on('message', function () {
    numberOfInboundWebRTCRequests++;
  });

  const computorConnection = function () {
    if (COMPUTORS.length === 0) {
      console.log('List of computors is empty.');
      return;
    }

    const socket = new net.Socket();
    let buffer;
    let extraBytesFlag = false;
    let byteOffset = 0;

    const system = {
      epoch: 0,
      computors: Array(NUMBER_OF_COMPUTORS),
    };

    const selectedComputorIndex = Math.floor(Math.random() * COMPUTORS.length)
    const computor = COMPUTORS[selectedComputorIndex];

    const destroyFaultyConnection = function () {
      COMPUTORS.splice(selectedComputorIndex, 1);
      faultyComputors.add(computor);
      socket.destroy();
    }

    const exchangePublicPeers = function () {
      const exchangePublicPeersRequest = Buffer.alloc(HEADER_LENGTH, 0);
      exchangePublicPeersRequest[`writeUint${SIZE_LENGTH * 8}LE`](exchangePublicPeersRequest.byteLength, SIZE_OFFSET);
      exchangePublicPeersRequest[`writeUint${PROTOCOL_VERSION_LENGTH * 8}LE`](QUBIC_PROTOCOL, PROTOCOL_VERSION_OFFSET);
      exchangePublicPeersRequest[`writeUint${TYPE_LENGTH * 8}LE`](MESSAGE_TYPES.EXCHANGE_PUBLIC_PEERS, TYPE_OFFSET);
      socket.write(exchangePublicPeersRequest);
    }

    const requestComputors = function () {
      const computorsRequest = Buffer.alloc(HEADER_LENGTH, 0);
      computorsRequest[`writeUint${SIZE_LENGTH * 8}LE`](computorsRequest.byteLength, SIZE_OFFSET);
      computorsRequest[`writeUint${PROTOCOL_VERSION_LENGTH * 8}LE`](QUBIC_PROTOCOL, PROTOCOL_VERSION_OFFSET);
      computorsRequest[`writeUint${TYPE_LENGTH * 8}LE`](MESSAGE_TYPES.REQUEST_COMPUTORS, TYPE_OFFSET);
      socket.write(computorsRequest);
    }

    const requestQuorumTick = function () {
      const quorumTickRequest = Buffer.alloc(HEADER_LENGTH + 4 + NUMBER_OF_COMPUTORS / 4, 0);
      quorumTickRequest[`writeUint${SIZE_LENGTH * 8}LE`](quorumTickRequest.byteLength, SIZE_OFFSET);
      quorumTickRequest[`writeUint${PROTOCOL_VERSION_LENGTH * 8}LE`](QUBIC_PROTOCOL, PROTOCOL_VERSION_OFFSET);
      quorumTickRequest[`writeUint${TYPE_LENGTH * 8}LE`](MESSAGE_TYPES.REQUEST_QUORUM_TICK, TYPE_OFFSET);
      quorumTickRequest[`writeUint${4 * 8}LE`](4900499, TYPE_OFFSET + TYPE_LENGTH);
      socket.write(quorumTickRequest);
    }


    const onTransaction = async function ({ transaction, closeAndReconnect }) {
      const transactionView = new DataView(transaction.buffer);
      if (transactionView[`getUint${SIZE_LENGTH * 8}`](SIZE_OFFSET, true) === transaction.byteLength) {
        const { K12, schnorrq } = await crypto;
        const digest = new Uint8Array(crypto.DIGEST_LENGTH);
        K12(transaction.slice(HEADER_LENGTH, transaction.length - crypto.SIGNATURE_LENGTH), digest, crypto.DIGEST_LENGTH);

        if (schnorrq.verify(transaction.slice(HEADER_LENGTH, HEADER_LENGTH + crypto.PUBLIC_KEY_LENGTH), digest, transaction.slice(-crypto.SIGNATURE_LENGTH))) {
          socket.write(transaction);
          numberOfOutboundComputorRequests++;
        }
      } else {
        closeAndReconnect();
      }
    }

    network.addListener('transaction', onTransaction);

    const messageProcessor = async function (message) {
      numberOfInboundComputorRequests++;

      if (message[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET) !== message.length) {
        destroyFaultyConnection();
        return;
      }

      if (message[`readUint${PROTOCOL_VERSION_LENGTH * 8}LE`](PROTOCOL_VERSION_OFFSET) !== QUBIC_PROTOCOL) {
        destroyFaultyConnection();
        return;
      }

      if (message[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.EXCHANGE_PUBLIC_PEERS) {
        for (let i = 0; i < NUMBER_OF_EXCHANGED_PEERS; i++) {
          const computor = Array.from(message.subarray(i * 4, (i + 1) * 4)).join('.');
          if (COMPUTORS.indexOf(computor) === -1 && faultyComputors.has(computor) === false) {
            COMPUTORS.push(computor);
          }
        }
        return;
      }

      if (message[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.BROADCAST_COMPUTORS) {
        const { K12, schnorrq } = await crypto;
        const digest = new Uint8Array(crypto.DIGEST_LENGTH);
        K12(message.slice(HEADER_LENGTH, message.length - crypto.SIGNATURE_LENGTH), digest, crypto.DIGEST_LENGTH);
        
        if (schnorrq.verify(ADMIN_PUBLIC_KEY_BYTES, digest, message.slice(message.length - crypto.SIGNATURE_LENGTH, message.length)) === 1) {
          for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
            system.computors[i] = message.slice(COMPUTORS_PUBLIC_KEYS_OFFSET + (i * crypto.PUBLIC_KEY_LENGTH), COMPUTORS_PUBLIC_KEYS_OFFSET + ((i + 1) * crypto.PUBLIC_KEY_LENGTH));
          }
          network.broadcast(message, function () {
            numberOfOutboundWebRTCRequests++;
          });
        } else {
          destroyFaultyConnection();
        }

        return;
      }

      if (message[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.BROADCAST_RESOURCE_TEST_SOLUTION) {
        const result = await resourceTest(message);
        if (result !== false) {
          network.broadcast(message, function () {
            numberOfOutboundWebRTCRequests++;
          });
        } else {
          destroyFaultyConnection();
        }

        return;
      }

      if (message[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.BROADCAST_TICK) {
        const { K12, schnorrq } = await crypto;
        const digest = new Uint8Array(crypto.DIGEST_LENGTH);
        message.writeUint8(message.readUint8(TICK_COMPUTOR_INDEX_OFFSET) ^ MESSAGE_TYPES.BROADCAST_TICK, TICK_COMPUTOR_INDEX_OFFSET);
        K12(message.slice(TICK_COMPUTOR_INDEX_OFFSET, TICK_SIGNATURE_OFSSET), digest, crypto.DIGEST_LENGTH);
        message.writeUint8(message.readUint8(TICK_COMPUTOR_INDEX_OFFSET) ^ MESSAGE_TYPES.BROADCAST_TICK, TICK_COMPUTOR_INDEX_OFFSET);

        const computorIndex = message[`readUint${TICK_COMPUTOR_INDEX_LENGTH * 8}LE`](TICK_COMPUTOR_INDEX_OFFSET);
        if (system.computors[computorIndex] !== undefined) {
          if (schnorrq.verify(system.computors[computorIndex], digest, message.slice(TICK_SIGNATURE_OFSSET, TICK_SIGNATURE_OFSSET + crypto.SIGNATURE_LENGTH)) === 1) {
            console.log('TICK')
            network.broadcast(message, function () {
              numberOfOutboundWebRTCRequests++;
            });
          } else {
            destroyFaultyConnection();
          }
        }

        return;
      }

      if (message[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.BROADCAST_TRANSACTION) {
        const { K12, schnorrq } = await crypto;
        const digest = new Uint8Array(crypto.DIGEST_LENGTH);
        K12(message.slice(HEADER_LENGTH, message.length - crypto.SIGNATURE_LENGTH), digest, crypto.DIGEST_LENGTH);

        if (schnorrq.verify(message.slice(HEADER_LENGTH, HEADER_LENGTH + crypto.PUBLIC_KEY_LENGTH), digest, message.slice(-crypto.SIGNATURE_LENGTH))) {
          network.broadcast(message, function () {
            numberOfOutboundWebRTCRequests++;
          });

          console.log(`Transaction from:`, publicKeyBytesToString(message.slice(HEADER_LENGTH, HEADER_LENGTH + crypto.PUBLIC_KEY_LENGTH)));
        } else {
          destroyFaultyConnection();
        }
        return;
      }

      network.broadcast(message, function () {
        numberOfOutboundWebRTCRequests++;
      });
    }

    let interval;
    socket.connect(QUBIC_PORT, computor, function() {
      console.log(`Connection opened (${computor}) on ${process.pid}.`);
      numberOfFailingComputorConnectionsInARow = 0;
      exchangePublicPeers();
      interval = setInterval(function () {
        numberOfOutboundComputorRequests++;
        requestComputors();
        setTimeout(function () {
          requestQuorumTick();
        }, 1000);
      }, 15 * 1000);
    });
    
    socket.on('error', function () {});

    socket.on('data', function (data) {
      let byteOffset2 = 0;
      while (byteOffset2 < data.length) {
        if (extraBytesFlag === false) {
          if (data[`readUint${SIZE_LENGTH * 8}LE`](byteOffset2 + SIZE_OFFSET) - (data.length - byteOffset2) > 0) {
            buffer = Buffer.alloc(data[`readUint${SIZE_LENGTH * 8}LE`](byteOffset2 + SIZE_OFFSET));
            data.copy(buffer, byteOffset, byteOffset2);
            byteOffset += data.length - byteOffset2;
            byteOffset2 = data.length;
            extraBytesFlag = true;
          } else {
            const response = data.slice(byteOffset2, byteOffset2 + data[`readUint${SIZE_LENGTH * 8}LE`](byteOffset2 + SIZE_OFFSET))
            messageProcessor(response);
            byteOffset2 += response.length;
          }
        } else {
          const l = Math.min(buffer[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET) - byteOffset, data.length - byteOffset2);
          data.copy(buffer, byteOffset, byteOffset2, l);
          byteOffset += l;
          byteOffset2 += l;
          if (byteOffset === buffer[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET)) {
            extraBytesFlag = false;
            byteOffset = 0;
            messageProcessor(buffer.slice(0, buffer[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET)));
          }
        }
      }
    });

    socket.on('close', function() {
      console.log(`Connection closed (${computor}) on ${process.pid}. Connecting...`);
      setTimeout(function () {
        numberOfFailingComputorConnectionsInARow++;
        clearInterval(interval);
        clearInterval(clusterNotificationInterval);
        process.removeListener('message', onIPCMessage);
        network.removeListener('transaction', onTransaction);
        computorConnection();
      }, numberOfFailingComputorConnectionsInARow * COMPUTOR_CONNECTION_TIMEOUT_MULTIPLIER);
    });
  }

  for (let i = 0; i < NUMBER_OF_COMPUTOR_CONNECTIONS; i++) {
    computorConnection();
  }
};

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running.`);

  const numbersOfRequestsByPid = new Map();
  const numberOfPeersByPid = new Map();
  let numberOfInboundComputorRequests = 0;
  let numberOfOutboundComputorRequests = 0;
  let numberOfInboundWebRTCRequests = 0;
  let numberOfOutboundWebRTCRequests = 0;
  let numberOfInboundComputorRequests2 = 0;
  let numberOfOutboundComputorRequests2 = 0;
  let numberOfInboundWebRTCRequests2 = 0;
  let numberOfOutboundWebRTCRequests2 = 0;


  const onmessage = function (pid) {
    return function (message) {
      const data = JSON.parse(message);
      numberOfInboundComputorRequests += data[0];
      numberOfOutboundComputorRequests += data[1];
      numberOfInboundWebRTCRequests += data[2];
      numberOfOutboundWebRTCRequests += data[3];
      numbersOfRequestsByPid.set(pid, data.slice(0, 4));
      numberOfPeersByPid.set(pid, data[4]);
    }
  }

  for (let i = 0; i < NUMBER_OF_AVAILABLE_PROCESSORS; i++) {
    const child = cluster.fork();
    numberOfPeersByPid.set(child.pid, 0);
    child.on('message', onmessage(child.pid));
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log('Worker %d died (%s). Restarting...', worker.process.pid, signal || code);
    worker.process.removeAllListeners();
    const child = cluster.fork();
    if (numbersOfRequestsByPid.has(worker.process.pid)) {
      child.send(JSON.stringify(numbersOfRequestsByPid.get(worker.process.pid)));
    }
    numbersOfRequestsByPid.delete(worker.process.pid);
    numberOfPeersByPid.delete(worker.process.pid);
    numberOfPeersByPid.set(child.pid, 0);
    child.on('message', onmessage(child.pid));
  });

  setInterval(function () {
    let numberOfPeers = 0;
    for (const [_, n] of numberOfPeersByPid) {
      numberOfPeers += n;
    }

    console.log(
      'Q[+' + (numberOfInboundComputorRequests - numberOfInboundComputorRequests2),
      '-' + (numberOfOutboundComputorRequests - numberOfOutboundComputorRequests2) + ']',
      'W[+' + (numberOfInboundWebRTCRequests - numberOfInboundWebRTCRequests2),
      '-' + (numberOfOutboundWebRTCRequests - numberOfOutboundWebRTCRequests2) + ']',
      numberOfPeers + '/' + NUMBER_OF_CHANNELS * NUMBER_OF_AVAILABLE_PROCESSORS + ' peers'
    );

    numberOfInboundComputorRequests2 = numberOfInboundComputorRequests;
    numberOfOutboundComputorRequests2 = numberOfOutboundComputorRequests;
    numberOfInboundWebRTCRequests2 = numberOfInboundWebRTCRequests;
    numberOfOutboundWebRTCRequests2 = numberOfOutboundWebRTCRequests;
  }, 1000);
} else {
  
  gateway();

  console.log(`Worker ${process.pid} is running.`);
}
