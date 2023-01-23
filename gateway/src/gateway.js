import { availableParallelism } from 'node:os';
import process from 'node:process';
import cluster from 'node:cluster';
import net from 'net';
import WebSocket from "ws";
import wrtc from 'wrtc';

const QUBIC_PORT = 21841;
const QUBIC_PROTOCOL = 83;
const COMPUTOR = '0.0.0.0';

const NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS = 10;
const MAX_WEBRTC_CONNECTION_DURATION = 60 * 60 * 1_000; // change to a sane value
// change accordingly
const SIGNALING_SERVER = '0.0.0.0:8082';
const ICE_SERVER = 'stun:0.0.0.0:3478';

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3, 
}

const NUMBER_OF_AVAILABLE_PROCCESSORS = availableParallelism();

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

const gateway = function ({ computor, numberOfFailingConnectionsInARow }) {
  const channels = Array(NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS);
  const socket = new net.Socket();
  const buffer = Buffer.alloc(BUFFER_SIZE);
  let extraBytesFlag = false;
  let byteOffset = 0;

  if (numberOfFailingConnectionsInARow === undefined) {
    numberOfFailingConnectionsInARow = 0;
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
    function toArrayBuffer(buf) {
      const ab = new ArrayBuffer(buf.length);
      const view = new Uint8Array(ab);
      for (let i = 0; i < buf.length; ++i) {
          view[i] = buf[i];
      }
      console.log(ab);
      return ab;
    }
    console.log(`Request type on ${process.pid}:`, response[`readUint${TYPE_LENGTH * 8}LE`](TYPE_OFFSET));
    for (let i = 0; i < NUMBER_OF_WEBRTC_CONNECTIONS_PER_PROCCESS; i++) {
      if (channels[i]?.readyState === 'open') {
        channels[i].send(response);
      }
    }
  }

  const channel = function ({ iceServers }, i) {
    let pc
    const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;
    const socket = new WebSocket(`ws://${SIGNALING_SERVER}`);
  
    socket.binaryType = 'arraybuffer';
  
    const timeout = setTimeout(function () {
      socket.close();
      if (pc !== undefined) {
        pc.close();
      }
      channel({ iceServers }, i)
    }, 3000);
  
    socket.addEventListener('message', function (event) {
      const view = new DataView(event.data);
  
      switch (view.getUint8(0, true)) {
        case SIGNAL_TYPES.ROLE:
          const role = view.getUint8(1, true);
    
          const open = function (dc) {
            dc.binaryType = 'arraybuffer';
            dc.onopen =  function () {
              channels[i] = dc;

              clearTimeout(timeout);

              setTimeout(function () {
                socket.close();
                dc.close();
                pc.close()
              }, MAX_WEBRTC_CONNECTION_DURATION);
            };
            dc.onclose = function () {
              channels[i] = undefined;
              setTimeout(function () {
                channel({ iceServers }, i);
              }, 1);
            };
            dc.onmessage = function (event) {
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
            open(pc.createDataChannel('qbc'));
          }
          break;
        case SIGNAL_TYPES.ICE_CANDIDATE:
          const candidate = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.log);
          break;
        case SIGNAL_TYPES.SESSION_DESCRIPTION:
          const sessionDescription = JSON.parse(new TextDecoder().decode(event.data.slice(1)));
          if (sessionDescription.type === 'offer') {
            ;(pc.signalingState !== 'stable'
              ? Promise.all([
                pc.setLocalDescription({ type: 'rollback' }),
                pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)),
              ])
              : pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)))
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
                .catch(console.log);
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
        pc.close();
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
    console.log(`Connection on ${process.pid} oppened.`);
    numberOfFailingConnectionsInARow = 0;
    exchangePublicPeers();
    setInterval(requestComputors, 5000);
  });

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
    console.log(`Connection on ${process.pid} closed. Reopening...`);
    setTimeout(function () {
      numberOfFailingConnectionsInARow++;
      gateway({ computor, numberOfFailingConnectionsInARow });
    }, numberOfFailingConnectionsInARow * 100);
  });
};

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running.`);

  for (let i = 0; i < NUMBER_OF_AVAILABLE_PROCCESSORS - 3; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log('Worker %d died (%s). Restarting...', worker.process.pid, signal || code);
    cluster.fork();
  });
} else {
  
  gateway({ computor: COMPUTOR });

  console.log(`Worker ${process.pid} is running.`);
}

