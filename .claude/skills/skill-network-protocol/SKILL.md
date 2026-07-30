---
name: skill-network-protocol
description: >
  Binary packet format traveling between apps/gateway (Node TCP<->WebSocket bridge) and the
  rAthena server. Use whenever writing or editing gateway packet parsing/encoding, adding
  support for a new opcode, or touching anything that reads/writes raw bytes to the rAthena
  TCP socket. Grounded in rathena/src/map/packets.hpp, packets_struct.hpp and clif.cpp —
  don't guess a byte layout, the exact struct is in that source tree and must match exactly
  or the connection desyncs.
---

## Framing (non-negotiable, gets this wrong = instant desync)

- Every packet starts with a **`uint16` opcode** at byte offset 0 (called `packetType` in
  rAthena's structs).
- Two kinds of packets:
  - **Fixed-length**: opcode only, then fixed fields. Total length is implied by the opcode
    (looked up in `packet_db`, see below) — you must know the length table, it's not
    self-describing.
  - **Variable-length**: opcode, then a second **`uint16` `packetLength`** field
    (total packet length including header), then a flexible-array payload
    (example: `PACKET_CZ_SE_PC_BUY_CASHITEM_LIST` in `packets_struct.hpp`).
- All structs are `#pragma pack(push,1)` (no padding) — when mirroring a struct in
  TypeScript (e.g. with a `DataView`/buffer reader), read/write every field at its exact
  byte offset with no alignment padding, matching the C struct exactly.

## Opcode → struct mapping

- `DEFINE_PACKET_HEADER(name, id)` macros in `rathena/src/map/packets.hpp` bind each
  `PACKET_*` struct to its `HEADER_*` opcode constant. This is the compile-time mapping.
- At runtime, rAthena actually dispatches through `packet_db[MAX_PACKET_DB+1]`
  (`rathena/src/map/clif.cpp:81`), a table keyed by opcode holding `.len` (packet length)
  and `.pos[]` (per-field byte offsets) — some legacy parsing paths read fields via this
  table rather than casting directly onto the struct (`clif.cpp:10450-10663`).
- When the gateway needs to know a packet's length to know where the next packet starts in
  the TCP stream, mirror this same table (opcode → length, or -1/variable for
  variable-length packets read via their own `packetLength` field) — don't hardcode a
  handful of opcodes and assume the rest follow a pattern.

## Versioning — read this before touching any struct

- Field types/sizes change per client build via `PACKETVER_MAIN_NUM` /
  `PACKETVER_RE_NUM` / `PACKETVER_ZERO_NUM` preprocessor conditionals in `packets.hpp`
  (e.g. an item ID field is `uint32` on newer clients, `uint16` on older — see
  `packets.hpp:49-53` for the pattern).
- This is resolved at **compile time** for the rAthena binary — one running server targets
  exactly one `PACKETVER`, it is not negotiated per-connection at runtime.
- **Before writing or changing any packet struct on the gateway side, confirm which
  `PACKETVER` this project's compiled rAthena binary targets** (check the build config/
  `src/config/renewal.hpp` or however it's set in this repo) and mirror struct layout for
  *that exact version* — don't pick whichever variant looks newest, and don't assume a
  layout copied from a different `PACKETVER` will work.

## Login / auth

- Password hashing at login uses MD5 (`rathena/src/common/md5calc.cpp`,
  `loginclif.cpp`) — the gateway must replicate this hashing if it terminates auth before
  handing off to rAthena, rather than assuming plaintext passthrough.
- **No packet-body encryption/obfuscation was found in this stock rAthena source** (searched
  for packet-obfuscation code, no hits). Some private-server forks add opcode-scrambling
  ("packet keys") — that is NOT present here unless this fork has been patched to add it.
  Don't add decryption logic on the gateway speculatively; if packets look garbled, check
  first whether this source tree was patched, don't assume obfuscation exists by default.
- Login/char servers write opcodes inline (`WFIFOW(fd, 0, 0x...)` style) rather than through
  dedicated `packets.hpp` headers like the map server — same 2-byte-opcode framing applies,
  but there's no single struct file to mirror for those two; opcode-by-opcode from
  `loginclif.cpp`/`charclif.cpp` is the source of truth there.

## Gateway implementation checklist

1. TCP socket to rAthena speaks raw packed structs per above — decode using the exact
   `PACKETVER` this build targets, not the newest known layout.
2. WebSocket side to the game client should use a clean JSON/msgpack protocol of your own
   design — don't leak rAthena's raw binary opcodes to the browser; translate at the
   gateway boundary.
3. When adding support for a new opcode: find its struct in `packets_struct.hpp`, find its
   `HEADER_*` binding in `packets.hpp`, mirror the exact byte layout for the project's
   `PACKETVER`, and add it to the gateway's own opcode→handler table — don't extrapolate a
   struct from a similar-looking opcode.
