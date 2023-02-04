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
import net from 'net';
import WebSocket from "ws";
import wrtc from 'wrtc';

const QUBIC_PORT = process.env.QUBIC_PORT || 21841;
const QUBIC_PROTOCOL = process.env.QUBIC_PROTOCOL || 85;
const COMPUTORS = (process.env.COMPUTORS || '0.0.0.0').split(',').map(s => s.trim());
const COMPUTOR_CONNECTION_TIMEOUT_MULTIPLIER = 1000;

const PEER_MATCHER = process.env.PEER_MATCHER || '0.0.0.0:8081';
const ICE_SERVER = process.env.ICE_SERVER || 'stun:0.0.0.0:3478';
const NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS = process.env.WEBRTC_CONNECTIONS_PER_PROCESS || 4;
const MIN_WEBRTC_CONNECTION_ATTEMPT_DURATION = 6 * 1000;
const MAX_ROTATING_WEBRTC_CONNECTION_DURATION = 1 * 60 * 1000;
const CHANNEL_TIMEOUT_MULTIPLIER = 100;

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3,
}

const NUMBER_OF_AVAILABLE_PROCESSORS = process.env.NUMBER_OF_AVAILABLE_PROCESSORS || 3;

const SIZE_OFFSET = 0;
const SIZE_LENGTH = 4;
const PROTOCOL_VERSION_OFFSET = SIZE_OFFSET + SIZE_LENGTH;
const PROTOCOL_VERSION_LENGTH = 2;
const TYPE_OFFSET = PROTOCOL_VERSION_OFFSET + PROTOCOL_VERSION_LENGTH;
const TYPE_LENGTH = 2;
const HEADER_LENGTH = TYPE_OFFSET + TYPE_LENGTH;
const REQUEST_TYPES = {
  EXCHANGE_PUBLIC_PEERS: 0,
  BROADCAST_COMPUTORS: 2,
  BROADCAST_TICK: 3,
  BROADCAST_REVENUES: 4,
  REQUEST_COMPUTORS: 11,
  BROADCAST_TRANSACTION: 24,
};

const NUMBER_OF_EXCHANGED_PEERS = 4;

const channel = function ({ iceServers }, channels, numbersOfFailingChannelsInARow, i, onmessage) {
  const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;
  const socket = new WebSocket(`wss://${PEER_MATCHER}`);
  let pc;
  let state = 0;
  let closeAndReconnectTimeout;

  socket.binaryType = 'arraybuffer';

  let connectionAttemptTimeout = setTimeout(function () {
    if (state++ > 0) {
      return;
    }
    clearTimeout(closeAndReconnectTimeout);
    socket.close();
    pc?.close();
    pc = undefined;
    if (channels[i]?.readyState === 'open') {
      channels[i].close();
    }
    channel({ iceServers }, channels, numbersOfFailingChannelsInARow, i, onmessage);
  }, MIN_WEBRTC_CONNECTION_ATTEMPT_DURATION + (++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER));

  const closeAndReconnect = function (timeoutDuration) {
    if (state++ > 0) {
      return;
    }

    closeAndReconnectTimeout = setTimeout(function () {
      clearTimeout(connectionAttemptTimeout);
      socket.close();
      pc?.close();
      pc = undefined;
      if (channels[i]?.readyState === 'open') {
        channels[i].close();
      }
      channel({ iceServers }, channels, numbersOfFailingChannelsInARow, i, onmessage);
    }, timeoutDuration);
  }

  socket.addEventListener('open', function () {
  });

  socket.addEventListener('message', function (event) {
    const view = new DataView(event.data);

    switch (view.getUint8(0, true)) {
      case SIGNAL_TYPES.ROLE:
        const role = view.getUint8(1, true);
  
        const open = function (dc) {
          dc.binaryType = 'arraybuffer';
          dc.onopen =  function () {
            clearTimeout(connectionAttemptTimeout);
            numbersOfFailingChannelsInARow[i] = 0;
            channels[i] = dc;
            console.log(`Peer ${i} connected on ${process.pid}.`);
            if (i === NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS - 1) {
              setTimeout(function () {
                dc?.close();
              }, MAX_ROTATING_WEBRTC_CONNECTION_DURATION);
            }
          };
          dc.onclose = function () {
            console.log(`Peer ${i} disconnected on ${process.pid}. Finding new peer...`);
            channels[i] = undefined;
            dc = undefined;
            closeAndReconnect((numbersOfFailingChannelsInARow[i] += (channels[i] === undefined ? 0 : 1)) * CHANNEL_TIMEOUT_MULTIPLIER);
          };
          dc.onmessage = function (event) {
            onmessage(event);
          };
        }

        pc = new RTCPeerConnection({ iceServers });

        pc.oniceconnectionstatechange = function () {
          if (pc !== undefined && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed')) {
            //closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
          }
        };
  
        pc.ondatachannel = function ({ channel }) {
          const signal = new Uint8Array(1);
          const signalView = new DataView(signal.buffer);
          signalView.setUint8(0, SIGNAL_TYPES.CHANNEL_ESTABLISHED, true); // debug only
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
          // Caller issues SDP offer
          if (pc !== undefined) {
            pc
            .createOffer()
            .then(function (offer) { 
              return pc.setLocalDescription(offer)
            })
            .then(function () {
              const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription));
              const signal = new Uint8Array(1 + payload.length);
              const signalView = new DataView(signal.buffer);
              signal.set(payload, 1);
              signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
              socket.send(signal);
            })
            .catch(console.log);

            if (role === 1) {
              if (pc?.signalingState !== 'closed') {
                open(pc.createDataChannel('qbc'));
              }
            }
          }
        };
        break;
      case SIGNAL_TYPES.ICE_CANDIDATE:
        if (pc?.signalingState !== 'closed') {
          const candidate = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
          if (candidate?.candidate?.length > 0) {
            pc?.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.log);
          }
        }
        break;
      case SIGNAL_TYPES.SESSION_DESCRIPTION:
        const sessionDescription = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
        if (sessionDescription.type === 'offer') {
          ;(pc !== undefined && pc.signalingState !== 'stable' && pc.signalingState !== 'closed'
            ? Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)),
            ])
            : pc !== undefined && pc.signalingState !== 'closed' && pc.setRemoteDescription(new RTCSessionDescription(sessionDescription))
              .then(function () {
                // Callee anwsers SDP offer
                return pc !== undefined && pc.createAnswer();
              })
              .then(function (answer) {
                return pc !== undefined && answer && pc.setLocalDescription(answer);
              })
              .then(function () {
                const payload = new TextEncoder().encode(JSON.stringify(pc.localDescription))
                const signal = new Uint8Array(1 + payload.length);
                const signalView = new DataView(signal.buffer);
                signal.set(payload, 1);
                signalView.setUint8(0, SIGNAL_TYPES.SESSION_DESCRIPTION, true);
                socket.send(signal);
              })
              .catch(console.log));
        } else if (pc !== undefined && sessionDescription.type === 'answer') {
          pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)).catch(console.log);
        }
        break;
    }
  });

  socket.addEventListener('error', function (error) {
    //console.log(error.message);
  });
  
  socket.addEventListener('close', function () {
    // closeAndReconnect(++numbersOfFailingChannelsInARow[i] * CHANNEL_TIMEOUT_MULTIPLIER);
  });
};

const computorConnection = function ({ channels, numberOfFailingComputorConnectionsInARow, numbersOfRequests }) {
  const socket = new net.Socket();
  let buffer;
  let extraBytesFlag = false;
  let byteOffset = 0;

  let numberOfInboundComputorRequests = numbersOfRequests?.[0] || 0;
  let numberOfOutboundComputorRequests = numbersOfRequests?.[1] || 0;
  let numberOfInboundWebRTCRequests = numbersOfRequests?.[2] || 0;
  let numberOfOutboundWebRTCRequests = numbersOfRequests?.[3] || 0;
  let numberOfInboundComputorRequests2 = numbersOfRequests?.[0] || 0;
  let numberOfOutboundComputorRequests2 = numbersOfRequests?.[1] || 0;
  let numberOfInboundWebRTCRequests2 = numbersOfRequests?.[2] || 0;
  let numberOfOutboundWebRTCRequests2 = numbersOfRequests?.[3] || 0;

  const onIPCMessage = function (message) {
    const data = JSON.parse(message);
    numberOfOutboundComputorRequests = numberOfOutboundComputorRequests2 = data[0];
    numberOfOutboundComputorRequests = numberOfOutboundComputorRequests2 = data[1];
    numberOfInboundWebRTCRequests = numberOfInboundWebRTCRequests2 = data[2];
    numberOfOutboundWebRTCRequests = numberOfOutboundWebRTCRequests2 = data[3];
  }
  process.on('message', onIPCMessage);

  if (numberOfFailingComputorConnectionsInARow === undefined) {
    numberOfFailingComputorConnectionsInARow = 0;
  }

  const exchangePublicPeers = function () {
    const exchangePublicPeersRequest = Buffer.alloc(HEADER_LENGTH, 0);
    exchangePublicPeersRequest[`writeUint${SIZE_LENGTH * 8}LE`](exchangePublicPeersRequest.byteLength, SIZE_OFFSET);
    exchangePublicPeersRequest[`writeUint${PROTOCOL_VERSION_LENGTH * 8}LE`](QUBIC_PROTOCOL, PROTOCOL_VERSION_OFFSET);
    exchangePublicPeersRequest[`writeUint${TYPE_LENGTH * 8}LE`](REQUEST_TYPES.EXCHANGE_PUBLIC_PEERS, TYPE_OFFSET);
    socket.write(exchangePublicPeersRequest);
  }

  const requestComputors = function () {
    const computorsRequest = Buffer.alloc(HEADER_LENGTH, 0);
    computorsRequest[`writeUint${SIZE_LENGTH * 8}LE`](computorsRequest.byteLength, SIZE_OFFSET);
    computorsRequest[`writeUint${PROTOCOL_VERSION_LENGTH * 8}LE`](QUBIC_PROTOCOL, PROTOCOL_VERSION_OFFSET);
    computorsRequest[`writeUint${TYPE_LENGTH * 8}LE`](REQUEST_TYPES.REQUEST_COMPUTORS, TYPE_OFFSET);
    socket.write(computorsRequest);
  }

  const requestProcessor = function (event) {
    numberOfInboundWebRTCRequests++;
    const buffer = Buffer.from(event.data);
    if (buffer[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === REQUEST_TYPES.BROADCAST_TRANSACTION) {
      socket.write(buffer);
    }
  }

  const responseProcessor = function (response) {
    numberOfInboundComputorRequests++;

    if (response[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET) === REQUEST_TYPES.EXCHANGE_PUBLIC_PEERS) {
      for (let i = 0; i < NUMBER_OF_EXCHANGED_PEERS; i++) {
        const computor = Array.from(response.subarray(i * 4, (i + 1) * 4)).join('.');
        if (COMPUTORS.indexOf(computor) === -1) {
          COMPUTORS.push(computor);
        }
      }
      return;
    }

    for (let i = 0; i < NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS; i++) {
      if (channels[i]?.readyState === 'open') {
        numberOfOutboundWebRTCRequests++;
        if (channels[i] !== undefined) {
          channels[i].send(response);
        }
      }
    }
  }

  let interval;
  const COMPUTOR = COMPUTORS[Math.floor(Math.random() * COMPUTORS.length)];
  socket.connect(QUBIC_PORT, COMPUTOR, function() {
    console.log(`Connection opened (${COMPUTOR}) on ${process.pid}.`);
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

  const clusterNotificationInterval = setInterval(function () {
    const numberOfPeers = channels.filter(function (channel) {
      return channel?.readyState === 'open';
    }).length;
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

  socket.on('close', function() {
    console.log(`Connection closed (${COMPUTOR}) on ${process.pid}. Connecting...`);
    setTimeout(function () {
      numberOfFailingComputorConnectionsInARow++;
      clearInterval(interval);
      clearInterval(clusterNotificationInterval);
      process.removeListener('message', onIPCMessage);
      computorConnection({
        channels,
        numberOfFailingComputorConnectionsInARow,
        numbersOfRequests: [
          numberOfInboundComputorRequests,
          numberOfOutboundComputorRequests,
          numberOfInboundWebRTCRequests,
          numberOfOutboundWebRTCRequests,
        ]
      });
    }, numberOfFailingComputorConnectionsInARow * COMPUTOR_CONNECTION_TIMEOUT_MULTIPLIER);
  });

  return requestProcessor;
};

const gateway = function () {
  const channels = Array(NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS);
  const numbersOfFailingChannelsInARow = Array(NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS).fill(0);

  const requestProcessor = computorConnection({ channels });

  for (let i = 0; i < NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS; i++) {
    channel({
      iceServers: [
        {
          urls: [
            ICE_SERVER,
          ],
        },
      ],
    }, channels, numbersOfFailingChannelsInARow, i, requestProcessor);
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
      'Q[->' + (numberOfInboundComputorRequests - numberOfInboundComputorRequests2),
      '<-' + (numberOfOutboundComputorRequests - numberOfOutboundComputorRequests2) + ']',
      'W[->' + (numberOfInboundWebRTCRequests - numberOfInboundWebRTCRequests2),
      '<-' + (numberOfOutboundWebRTCRequests - numberOfOutboundWebRTCRequests2) + ']',
      numberOfPeers + '/' + NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCESS * NUMBER_OF_AVAILABLE_PROCESSORS + ' peers'
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

