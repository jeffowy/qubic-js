import process from 'node:process';
import cluster from 'node:cluster';
import net from 'net';
import WebSocket from "ws";
import wrtc from 'wrtc';

const QUBIC_PORT = process.env.QUBIC_PORT || 21841;
const QUBIC_PROTOCOL = process.env.QUBIC_PROTOCOL || 84;
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

