# 451
451 is a collection of utilities written in JavaScript to work with Qubic protocol.
Join syzygy (http://discord.gg/2vDMR8m) for more info.

## License
451 is licenced by Come-from-Beyond's ANTI-Military License.
Make something beautiful and include ANTI-Military license in your derivative.

## Installation
```
pnpm i 451
```

## Example

```JS
import _451 from '451';

// Change accordingly to current epoch's puzzle
// More about it on discord (https://discord.com/channels/768887649540243497/1068670081837580318)
const protocol = 85;
const numberOfNeurons = 262144;
const solutionThreshold = 29;
const randomSeed = new Uint8Array(32).fill(0);
randomSeed[0] = 159;
randomSeed[1] = 87;
randomSeed[2] = 115;
randomSeed[3] = 131;
randomSeed[4] = 132;
randomSeed[5] = 86;
randomSeed[6] = 13;
randomSeed[7] = 101;

const node = _451({
  protocol,
  randomSeed,
  numberOfNeurons,
  solutionThreshold,
  signalingServers,
  iceServers,
});
node.launch();

// Issue transaction
(async function () {
  const seed = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 55 random lowercase latin chars.
  const entity = await node.entity(seed);

  await entity.transaction({
    destination: '', // Destination identity.
    energy: 1000000,
  });
})();
```