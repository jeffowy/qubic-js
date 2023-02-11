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
import { gossip, MESSAGE_TYPES, SIZE_OFFSET, SIZE_LENGTH, PROTOCOL_VERSION_OFFSET, PROTOCOL_VERSION_LENGTH, TYPE_OFFSET, TYPE_LENGTH, HEADER_LENGTH, NUMBER_OF_CHANNELS } from 'qubic-gossip';
import { publicKeyBytesToString } from 'qubic-converter';

const NUMBER_OF_AVAILABLE_PROCESSORS = process.env.NUMBER_OF_AVAILABLE_PROCESSORS || 3;
const QUBIC_PORT = process.env.QUBIC_PORT || 21841;
const QUBIC_PROTOCOL = process.env.QUBIC_PROTOCOL || 89;
const NUMBER_OF_COMPUTOR_CONNECTIONS = process.env.NUMBER_OF_COMPUTOR_CONNECTIONS || 4;
const COMPUTORS = (process.env.COMPUTORS || '0.0.0.0').split(',').map(s => s.trim());
const COMPUTOR_CONNECTION_TIMEOUT_MULTIPLIER = 1000;
const NUMBER_OF_EXCHANGED_PEERS = 4;
const PEER_MATCHER = process.env.PEER_MATCHER || '0.0.0.0:8081';
const ICE_SERVER = process.env.ICE_SERVER || 'stun:0.0.0.0:3478';

MESSAGE_TYPES.EXCHANGE_PUBLIC_PEERS = 0;
MESSAGE_TYPES.REQUEST_COMPUTORS = 11;

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
    const socket = new net.Socket();
    let buffer;
    let extraBytesFlag = false;
    let byteOffset = 0;

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

    const responseProcessor = async function (response) {
      numberOfInboundComputorRequests++;

      if (response[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.EXCHANGE_PUBLIC_PEERS) {
        for (let i = 0; i < NUMBER_OF_EXCHANGED_PEERS; i++) {
          const computor = Array.from(response.subarray(i * 4, (i + 1) * 4)).join('.');
          if (COMPUTORS.indexOf(computor) === -1) {
            COMPUTORS.push(computor);
          }
        }
        return;
      }

      if (response[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === MESSAGE_TYPES.BROADCAST_TRANSACTION) {
        const transactionView = new DataView(response.buffer);
        if (transactionView[`getUint${SIZE_LENGTH * 8}`](SIZE_OFFSET, true) === response.byteLength) {
          const { K12, schnorrq } = await crypto;
          const digest = new Uint8Array(crypto.DIGEST_LENGTH);
          K12(response.slice(HEADER_LENGTH, response.length - crypto.SIGNATURE_LENGTH), digest, crypto.DIGEST_LENGTH);
  
          if (schnorrq.verify(response.slice(HEADER_LENGTH, HEADER_LENGTH + crypto.PUBLIC_KEY_LENGTH), digest, response.slice(-crypto.SIGNATURE_LENGTH))) {
            numberOfOutboundWebRTCRequests += numberOfPeers;
            network.broadcast(response);

            console.log(`Transaction from:`, publicKeyBytesToString(response.slice(HEADER_LENGTH, HEADER_LENGTH + crypto.PUBLIC_KEY_LENGTH)));
          }
        }
        return;
      }

      network.broadcast(response, function () {
        numberOfOutboundWebRTCRequests += numberOfPeers;
      });
    }

    let interval;
    const computor = COMPUTORS[Math.floor(Math.random() * COMPUTORS.length)];
    socket.connect(QUBIC_PORT, computor, function() {
      console.log(`Connection opened (${computor}) on ${process.pid}.`);
      numberOfFailingComputorConnectionsInARow = 0;
      exchangePublicPeers();
      interval = setInterval(function () {
        numberOfOutboundComputorRequests++;
        requestComputors();
      }, 5000);
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
            const response = data.subarray(byteOffset2, byteOffset2 + data[`readUint${SIZE_LENGTH * 8}LE`](byteOffset2 + SIZE_OFFSET))
            responseProcessor(response);
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
            responseProcessor(buffer.slice(0, buffer[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET)));
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
