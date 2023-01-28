import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8081;

const MAX_INNACTIVITY_DURATION = process.env.MAX_INNACTIVITY_DURATION || 10 * 1000;
const MIN_ENQUEUE_DELAY = process.env.MIN_ENQUEUE_DELAY || 0;
const MAX_ENQUEUE_DELAY = process.env.MAX_ENQUEUE_DELAY || 100;

const SIGNAL_TYPES = {
  ROLE: 0,
  ICE_CANDIDATE: 1,
  SESSION_DESCRIPTION: 2,
  CHANNEL_ESTABLISHED: 3, // debug only
}

export const delayQueue = (A, B) => {
  return {
    schedule(f, g) {
      const t = setTimeout(f, Math.floor(Math.random() * (B - A + 1)) + A)
      return function cancel () {
        clearTimeout(t)
        g();
      };
    },
  }
}

export const server = function () {
  let cons = 0;
  let rejects = 0;
  const queue = delayQueue(MIN_ENQUEUE_DELAY, MAX_ENQUEUE_DELAY);
  const buffer = [];
  const matches = new Set();
  const wss = new WebSocketServer({
    port: PORT,
  });

  const match = function (a) {
    return new Promise(function (resolve, reject) {
      const coinToss = Math.random();
      if (coinToss > 1 / 2) {
        a.resolve = resolve;
        a.reject = reject;
        buffer.push(a);
      } else {
        a.deschedule = queue.schedule(
          function () {
            if (!a.closed) {
              while (buffer.length > 0) {
                const i = Math.floor(Math.random() * buffer.length);
                let b = buffer[i];
                if (b.closed === true) {
                  b.reject();
                  buffer.splice(i, 1);
                } else if (b.remoteAddress !== a.remoteAddress && matches.has([a.remoteAddress, b.remoteAddress].sort().join('-')) === false) {
                  matches.add([a.remoteAddress, b.remoteAddress].sort().join('-'));
                  buffer.splice(i, 1);
                  // Assign roles
                  a.role = 1; // Caller makes SDP offer
                  b.role = 0; // Callee answers SDP offer
                  a.peer = b;
                  b.peer = a;
                  resolve();
                  b.resolve();
                  return;
                }
              }
              a.resolve = resolve;
              a.reject = reject;
              buffer.push(a);
            }
          },
          reject
        );
      }
    });
  }


  function heartbeat(socket) {
    socket.isAlive = true;
  }
  
  const interval = setInterval(function () {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        rejects++;
        return socket.terminate();
      }
  
      socket.isAlive = false;
    }
  }, MAX_INNACTIVITY_DURATION);
  
  wss.on('close', function close() {
    clearInterval(interval);
  });

  wss.on('connection', function connection(socket, req) {
    socket.remoteAddress = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(/\s*,\s*/)[0]
      : req.socket.remoteAddress;

    heartbeat(socket);

    const promise = match(socket);

    promise
      .then(function () {
        const signal = new Uint8Array(2);
        const view = new DataView(signal.buffer);
        view.setUint8(0, SIGNAL_TYPES.ROLE, true);
        view.setUint8(1, socket.role, true);
        socket.send(signal);
      })
      .catch(function () {
        rejects++;
        socket.close();
      });

    socket.on('message', function message(signal) {
      const signalType = new DataView(Uint8Array.from(signal).buffer).getUint8(0, true);
      if (signalType === SIGNAL_TYPES.ICE_CANDIDATE || signalType === SIGNAL_TYPES.SESSION_DESCRIPTION) {
        promise.then(function () {
          socket.peer.send(signal);
        });
        heartbeat(socket);
      } else if (signalType === SIGNAL_TYPES.CHANNEL_ESTABLISHED) {
        cons++;
      } else {
        socket.close();
      }
    });

    socket.on('close', function close() {
      socket.closed = true;
      if (socket.peer !== undefined) {
        matches.delete([socket.remoteAddress, socket.peer.remoteAddress].sort().join('-'));
      }
      let i = buffer.indexOf(socket);
      if (i > -1) {
        buffer.splice(i, 1);
      }
      if (typeof socket.deschedule === 'function') {
        socket.deschedule(); // if needed
      }
    });
  });

  let cons2 = 0;
  let rejects2 = 0;
  setInterval(function () {
    console.log('+' + (cons - cons2), -(rejects - rejects2), buffer.length);
    cons2 = cons;
    rejects2 = rejects; 
  }, 1000);
}

server();