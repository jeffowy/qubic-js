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
              for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === undefined) {
                  break;
                }
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