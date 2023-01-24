import process from 'node:process';
import cluster from 'node:cluster';
import net from 'net';
import WebSocket from "ws";
import wrtc from 'wrtc';

const QUBIC_PORT = process.env.QUBIC_PORT || 21841;
const QUBIC_PROTOCOL = process.env.QUBIC_PROTOCOL || 83;
const COMPUTOR = process.env.COMPUTOR || '0.0.0.0';

const NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS = 3;
const MAX_WEBRTC_CONNECTION_ATTEMPT_DURATION = 3 * 1000;
const MAX_WEBRTC_CONNECTION_DURATION = 3 * 60 * 1000;
// change accordingly
const PEER_MATCHER = process.env.PEER_MATCHER || '0.0.0.0:8081';
const ICE_SERVER = process.env.ICE_SERVER || 'stun:0.0.0.0:3478';

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3, 
}

const NUMBER_OF_AVAILABLE_PROCCESSORS = 3;

const BUFFER_SIZE = 65535; // = 64kb = Max TCP packet size.

const SIZE_OFFSET = 0;
const SIZE_LENGTH = 4;
const PROTOCOL_VERSION_OFFSET = SIZE_OFFSET + SIZE_LENGTH;
const PROTOCOL_VERSION_LENGTH = 2;
const TYPE_OFFSET = PROTOCOL_VERSION_OFFSET + PROTOCOL_VERSION_LENGTH;
const TYPE_LENGTH = 2;
const HEADER_LENGTH = TYPE_OFFSET + TYPE_LENGTH;
const REQUEST_TYPES = {
  EXCHANGE_PUBLIC_PEERS: 0,
  REQUEST_COMPUTORS: 11,
};

const gateway = function ({ computor, numberOfFailingComputorConnectionsInARow }) {
  const channels = Array(NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS);
  const socket = new net.Socket();
  const buffer = Buffer.alloc(BUFFER_SIZE);
  let extraBytesFlag = false;
  let byteOffset = 0;

  let numberOfInboundComputorRequests = 0;
  let numberOfOutboundComputorRequests = 0;
  let numberOfInboundWebRTCRequests = 0;
  let numberOfOutboundWebRTCRequests = 0;

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

  const responseProcessor = function (response) {
    numberOfInboundComputorRequests++;
    for (let i = 0; i < NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS; i++) {
      if (channels[i]?.readyState === 'open') {
        numberOfOutboundWebRTCRequests++;
        channels[i].send(response);
      }
    }
  }

  const channel = function ({ iceServers }, i) {
    let pc
    const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;
    const socket = new WebSocket(`wss://${PEER_MATCHER}`);
  
    socket.binaryType = 'arraybuffer';
  
    const connectionAttemptTimeout = setTimeout(function () {
      socket.close();
      if (pc !== undefined) {
        pc.close();
      }
      channel({ iceServers }, i);
    }, MAX_WEBRTC_CONNECTION_ATTEMPT_DURATION);

    socket.addEventListener('message', function (event) {
      const view = new DataView(event.data);
  
      switch (view.getUint8(0, true)) {
        case SIGNAL_TYPES.ROLE:
          const role = view.getUint8(1, true);
    
          const open = function (dc) {
            dc.binaryType = 'arraybuffer';
            dc.onopen =  function () {
              channels[i] = dc;
              console.log(`Peer ${i} connected on ${process.pid}`);
              setTimeout(function () {
                dc.close();
              }, MAX_WEBRTC_CONNECTION_DURATION);

              clearTimeout(connectionAttemptTimeout);
            };
            dc.onclose = function () {
              channels[i] = undefined;
              console.log(`Peer ${i} disconnected on ${process.pid}. Finding new peer...`);
              setTimeout(function () {
                channel({ iceServers }, i);
              }, 1);
            };
            dc.onmessage = function (event) {
              numberOfInboundWebRTCRequests++;
            };
          }
  
          pc = new RTCPeerConnection({ iceServers });
  
          pc.oniceconnectionstatechange = function () {
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
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
            pc
              .createOffer()
              .then(function (offer) { 
                return pc.setLocalDescription(offer)
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
          };
  
          if (role === 1) {
            if (pc.signalingState !== 'closed') { 
              open(pc.createDataChannel('qbc'));
            }
          }
          break;
        case SIGNAL_TYPES.ICE_CANDIDATE:
          if (pc.signalingState !== 'closed') {
            const candidate = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.log);
          }
          break;
        case SIGNAL_TYPES.SESSION_DESCRIPTION:
          const sessionDescription = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
          if (sessionDescription.type === 'offer') {
            ;(pc.signalingState !== 'stable' && pc.signalingState !== 'closed'
              ? Promise.all([
                pc.setLocalDescription({ type: 'rollback' }),
                pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)),
              ])
              : pc.signalingState !== 'closed' && (pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)))
                .then(function () {
                  // Callee anwsers SDP offer
                  return pc.createAnswer();
                })
                .then(function (answer) {
                  return pc.setLocalDescription(answer);
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
          } else if (sessionDescription.type === 'answer') {
            pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)).catch(console.log);
          }
          break;
      }
    });
  
    socket.addEventListener('error', function (error) {
      console.log(error.message);
    });
    
    socket.addEventListener('close', function () {
      if (pc !== undefined) {
        //pc.close();
      }
    });
  };

  for (let i = 0; i < NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS; i++) {
    channel({
      iceServers: [
        {
          urls: [
            ICE_SERVER,
          ],
        },
      ],
    }, i);
  }

  socket.connect(QUBIC_PORT, computor, function() {
    console.log(`Connection (${COMPUTOR}) on ${process.pid} oppened.`);
    numberOfFailingComputorConnectionsInARow = 0;
    exchangePublicPeers();
    setInterval(function () {
      numberOfOutboundComputorRequests++;
      requestComputors()
    }, 5000);
  });
  
  socket.on('error', function () {});

  socket.on('data', function (data) {
    let byteOffset2 = 0;
    while (byteOffset2 < data.length) {
      if (extraBytesFlag === false) {
        if (data[`readUint${SIZE_LENGTH * 8}LE`](byteOffset2 + SIZE_OFFSET) - (data.length - byteOffset2) > 0) {
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
          responseProcessor(buffer.subarray(0, buffer[`readUint${SIZE_LENGTH * 8}LE`](SIZE_OFFSET)));
        }
      }
    }
  });

  socket.on('close', function() {
    console.log(`Connection (${COMPUTOR}) on ${process.pid} closed. Reopening...`);
    setTimeout(function () {
      numberOfFailingComputorConnectionsInARow++;
      gateway({ computor, numberOfFailingComputorConnectionsInARow });
    }, numberOfFailingComputorConnectionsInARow * 100);
  });

  let numberOfInboundComputorRequests2 = 0;
  let numberOfOutboundComputorRequests2 = 0;
  let numberOfInboundWebRTCRequests2 = 0;
  let numberOfOutboundWebRTCRequests2 = 0;
  let numberOfPeers = 0;
  let numberOfPeers2 = 0;

  setInterval(function () {
    numberOfPeers = channels.filter(function (channel) {
      return channel?.readyState === 'open';
    }).length;
    process.send(JSON.stringify([
      numberOfInboundComputorRequests - numberOfInboundComputorRequests2,
      numberOfOutboundComputorRequests - numberOfOutboundComputorRequests2,
      numberOfInboundWebRTCRequests - numberOfInboundWebRTCRequests2,
      numberOfOutboundWebRTCRequests - numberOfOutboundWebRTCRequests2,
      numberOfPeers - numberOfPeers2,
    ]));
    numberOfPeers2 = numberOfPeers;
    numberOfInboundComputorRequests2 = numberOfInboundComputorRequests;
    numberOfOutboundComputorRequests2 = numberOfOutboundComputorRequests;
    numberOfInboundWebRTCRequests2 = numberOfInboundWebRTCRequests;
    numberOfOutboundWebRTCRequests2 = numberOfOutboundWebRTCRequests;
  }, 1000);

};

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running.`);

  let numberOfInboundComputorRequests = 0;
  let numberOfOutboundComputorRequests = 0;
  let numberOfInboundWebRTCRequests = 0;
  let numberOfOutboundWebRTCRequests = 0;
  let numberOfInboundComputorRequests2 = 0;
  let numberOfOutboundComputorRequests2 = 0;
  let numberOfInboundWebRTCRequests2 = 0;
  let numberOfOutboundWebRTCRequests2 = 0;
  let numberOfPeersByPid = new Map();


  const onmessage = function (pid) {
    return function (message) {
      const deltas = JSON.parse(message);
      numberOfInboundComputorRequests += deltas[0];
      numberOfOutboundComputorRequests += deltas[1];
      numberOfInboundWebRTCRequests += deltas[2];
      numberOfOutboundWebRTCRequests += deltas[3];
      numberOfPeersByPid.set(pid, numberOfPeersByPid.get(pid) + deltas[4]);
    }
  }

  for (let i = 0; i < NUMBER_OF_AVAILABLE_PROCCESSORS; i++) {
    const child = cluster.fork();
    numberOfPeersByPid.set(child.pid, 0);
    child.on('message', onmessage(child.pid));
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(signal, code);
    console.log('Worker %d died (%s). Restarting...', worker.process.pid, signal || code);
    const child = cluster.fork();
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
      numberOfPeers + '/' + NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS * NUMBER_OF_AVAILABLE_PROCCESSORS + ' peers'
    );

    numberOfInboundComputorRequests2 = numberOfInboundComputorRequests;
    numberOfOutboundComputorRequests2 = numberOfOutboundComputorRequests;
    numberOfInboundWebRTCRequests2 = numberOfInboundWebRTCRequests;
    numberOfOutboundWebRTCRequests2 = numberOfOutboundWebRTCRequests;
  }, 1000);
} else {
  
  gateway({ computor: COMPUTOR });

  console.log(`Worker ${process.pid} is running.`);
}

