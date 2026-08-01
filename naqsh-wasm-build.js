// Hand-assembles the naqsh ink-bbox kernel into a WebAssembly module.
// No toolchain required; emits raw bytes, validates, tests, prints base64.
//
// Equivalent WAT:
// (module
//   (import "e" "m" (memory 1))
//   (func (export "b") (param $w i32) (param $h i32) (param $t i32) (param $out i32)
//     (local $x i32) (local $y i32) (local $i i32)
//     (local $x0 i32) (local $x1 i32) (local $y0 i32) (local $y1 i32)
//     local.get $w  local.set $x0
//     i32.const -1  local.set $x1
//     local.get $h  local.set $y0
//     i32.const -1  local.set $y1
//     i32.const 3   local.set $i        ;; alpha byte of pixel 0
//     i32.const 0   local.set $y
//     loop
//       i32.const 0 local.set $x
//       loop
//         local.get $i i32.load8_u  local.get $t  i32.gt_u
//         if
//           local.get $x local.get $x0 local.get $x local.get $x0 i32.lt_s select local.set $x0
//           local.get $x local.get $x1 local.get $x local.get $x1 i32.gt_s select local.set $x1
//           local.get $y local.get $y0 local.get $y local.get $y0 i32.lt_s select local.set $y0
//           local.get $y local.set $y1
//         end
//         local.get $i i32.const 4 i32.add local.set $i
//         local.get $x i32.const 1 i32.add local.tee $x local.get $w i32.lt_s br_if 0
//       end
//       local.get $y i32.const 1 i32.add local.tee $y local.get $h i32.lt_s br_if 0
//     end
//     local.get $out local.get $x0 i32.store offset=0
//     local.get $out local.get $y0 i32.store offset=4
//     local.get $out local.get $x1 i32.store offset=8
//     local.get $out local.get $y1 i32.store offset=12))

const W = 0, H = 1, T = 2, OUT = 3, X = 4, Y = 5, I = 6, X0 = 7, X1 = 8, Y0 = 9, Y1 = 10;

const get = n => [0x20, n], set = n => [0x21, n], tee = n => [0x22, n];
const I32 = 0x7f, VOID = 0x40;

const body = [].concat(
  get(W), set(X0),
  [0x41, 0x7f], set(X1),          // i32.const -1
  get(H), set(Y0),
  [0x41, 0x7f], set(Y1),
  [0x41, 0x03], set(I),           // i = 3 (alpha of pixel 0)
  [0x41, 0x00], set(Y),
  [0x03, VOID],                   // loop (rows)
    [0x41, 0x00], set(X),
    [0x03, VOID],                 // loop (columns)
      get(I), [0x2d, 0x00, 0x00], // i32.load8_u
      get(T), [0x4b],             // i32.gt_u
      [0x04, VOID],               // if
        get(X), get(X0), get(X), get(X0), [0x48], [0x1b], set(X0),  // x0 = min(x0,x)
        get(X), get(X1), get(X), get(X1), [0x4a], [0x1b], set(X1),  // x1 = max(x1,x)
        get(Y), get(Y0), get(Y), get(Y0), [0x48], [0x1b], set(Y0),  // y0 = min(y0,y)
        get(Y), set(Y1),                                           // y1 = y
      [0x0b],                     // end if
      get(I), [0x41, 0x04, 0x6a], set(I),      // i += 4
      get(X), [0x41, 0x01, 0x6a], tee(X),      // x += 1
      get(W), [0x48], [0x0d, 0x00],            // br_if x < w
    [0x0b],                       // end column loop
    get(Y), [0x41, 0x01, 0x6a], tee(Y),
    get(H), [0x48], [0x0d, 0x00],              // br_if y < h
  [0x0b],                         // end row loop
  get(OUT), get(X0), [0x36, 0x02, 0x00],       // out[0] = x0
  get(OUT), get(Y0), [0x36, 0x02, 0x04],       // out[1] = y0
  get(OUT), get(X1), [0x36, 0x02, 0x08],       // out[2] = x1
  get(OUT), get(Y1), [0x36, 0x02, 0x0c],       // out[3] = y1
  [0x0b]                          // end function
);

const uleb = n => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const vec = items => [].concat(uleb(items.length), ...items);
const section = (id, payload) => [].concat([id], uleb(payload.length), payload);

const locals = [0x01, 0x07, I32];               // 7 i32 locals
const funcBody = [].concat(locals, body);
const code = section(10, vec([[].concat(uleb(funcBody.length), funcBody)]));

const types   = section(1, vec([[0x60].concat(vec([I32, I32, I32, I32]), [0x00])]));
const imports = section(2, vec([[0x01, 0x65, 0x01, 0x6d, 0x02, 0x00, 0x01]]));  // "e"."m" memory min 1
const funcs   = section(3, vec([[0x00]]));
const exports = section(7, vec([[0x01, 0x62, 0x00, 0x00]]));                    // export "b" func 0

const bytes = Uint8Array.from([].concat(
  [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
  types, imports, funcs, exports, code
));

console.log('bytes:', bytes.length);
console.log('valid:', WebAssembly.validate(bytes));

// ---- functional test against a JS reference ----
const memory = new WebAssembly.Memory({ initial: 20 });
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { m: memory } });
const inkBoxWasm = instance.exports.b;

function jsRef(d, w, h, t) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return [x0, y0, x1, y1];
}

let fails = 0;
for (let trial = 0; trial < 300; trial++) {
  const w = 1 + Math.floor(Math.random() * 40), h = 1 + Math.floor(Math.random() * 40);
  const u8 = new Uint8Array(memory.buffer, 0, w * h * 4);
  u8.fill(0);
  const n = Math.floor(Math.random() * 12);
  for (let k = 0; k < n; k++) {
    const px = Math.floor(Math.random() * w * h);
    u8[px * 4 + 3] = Math.floor(Math.random() * 256);
  }
  const outPtr = ((w * h * 4 + 15) & ~15) + 16;
  inkBoxWasm(w, h, 4, outPtr);
  const got = Array.from(new Int32Array(memory.buffer, outPtr, 4));       // x0,y0,x1,y1
  const exp = jsRef(u8, w, h, 4);
  const expOrdered = [exp[0], exp[1], exp[2], exp[3]];
  if (got[0] !== expOrdered[0] || got[1] !== expOrdered[1] || got[2] !== expOrdered[2] || got[3] !== expOrdered[3]) {
    if (fails < 3) console.log('MISMATCH', { w, h, got, exp: expOrdered });
    fails++;
  }
}
console.log('random trials failed:', fails, '/300');
console.log('base64:');
console.log(Buffer.from(bytes).toString('base64'));
