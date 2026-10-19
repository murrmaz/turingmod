# TuringMod Arduino protocol

How TuringMod talks to an Arduino over Wi-Fi, for whoever writes the board's firmware.
`turingmod-arm/turingmod-arm.ino` is a reference sketch for an ESP32 that implements
everything TuringMod uses today (the connection, the handshake and `log` messages), with no servo
code yet. It's a starting point to build the arm firmware on.

This is **protocol 1**. The connection, handshake and board-to-TuringMod messages are what
TuringMod implements now. The servo messages under [Planned](#planned-servo-gestures) are agreed
but not implemented on either side yet.

## Connection

- **The board is the WebSocket server, and TuringMod connects to it.** TuringMod only listens on
  its own computer, so it can't accept a connection from the network.
- **Address.** TuringMod connects to `ws://turingmod-arm.local:81` unless a different address is
  entered in its setup dialog (Integrations → arduino → Set up). The `.local` name works if the
  board announces it over mDNS, as the reference sketch does. Otherwise use the board's IP
  address, reserved in the router so it doesn't change.
- **One client.** TuringMod is the only client. If a second connection arrives, close the first
  one. This happens when TuringMod restarts before the board noticed the old connection had gone.
- **Reconnects.** TuringMod reconnects on its own if the board reboots, drops off Wi-Fi or is
  switched on later. It waits 2 seconds after the first failure, doubling each time up to 30
  seconds. The delay starts over only after a connection has lasted 30 seconds, so a board that
  accepts and then drops at once (rebooting in a loop, say) isn't retried every 2 seconds.
- **Keepalive.** TuringMod sends a WebSocket ping every 5 seconds. If it gets no pong by the next
  ping, it drops the connection and reconnects. The arduinoWebSockets library answers pings
  automatically.

## Messages

Every message is a single JSON object in a WebSocket **text** frame, with a `type` field. Binary
frames are ignored.

### Handshake

As soon as the connection opens, TuringMod sends:

```json
{"type":"hello","protocol":1}
```

The board must answer within 5 seconds with:

```json
{"type":"hello","protocol":1,"name":"turingmod-arm","firmware":"0.1.0","servos":3}
```

| Field | Meaning |
| --- | --- |
| `protocol` | The protocol version the firmware implements. Answer with your own version even if TuringMod's differs: TuringMod compares the two and reports a mismatch. |
| `name` | What the device is. TuringMod shows it in its log. |
| `firmware` | The firmware's own version, any text. |
| `servos` | How many servos the board drives, numbered from 1. Use 0 for a board without any. |

TuringMod shows the board as connected only after a valid reply. Send nothing else until you
have answered: TuringMod ignores any message that arrives before the reply.

- **No reply in time:** TuringMod disconnects and tries again.
- **Different protocol version, or a reply missing a field:** TuringMod shows an error and stops
  retrying, since only new firmware fixes it.

Extra fields in the reply are allowed and ignored.

### Board to TuringMod

After the handshake, the board can send any message with a `type` at any time. Each one is
published inside TuringMod for features to react to, and shown in the console's live activity
feed, with its fields. Board messages are shown as they arrive but aren't kept in TuringMod's
history.

TuringMod handles at most 20 messages a second and drops the rest of that second's, so a firmware
bug can't flood it. Nothing the protocol needs comes close to that.

| Type | Fields | Meaning |
| --- | --- | --- |
| `log` | `text` | A line for the activity feed. The reference sketch sends each line typed into the Serial Monitor. |

New types need no change to TuringMod to arrive, so a button panel's `{"type":"button","id":2}`
already reaches the activity feed, shown as `button` with `id 2`.

## Planned: servo gestures

TuringMod plans the motion and the board plays it. A gesture arrives as one message holding every
step, with times relative to the moment it arrives. The board plays it on its own clock, so Wi-Fi
delay only affects when a gesture starts, never how smoothly it moves.

```json
{"type":"play","id":7,"steps":[
  {"at":0,    "servo":1, "angle":30, "ms":250},
  {"at":10,   "servo":2, "angle":15, "ms":60},
  {"at":3500, "servo":1, "angle":45, "ms":250}
]}
```

Each step moves `servo` from wherever it is to `angle` (in degrees), starting `at` milliseconds
after the gesture begins and taking `ms` milliseconds, at a constant speed for now. Steps on
different servos may overlap in time. Steps on the same servo may not.

The board answers with the gesture's `id`:

```json
{"type":"started","id":7}
{"type":"done","id":7}
{"type":"rejected","id":7,"reason":"servo 2: 200° is outside 0–170°"}
```

- **`started`, then `done`:** the board sends `done` once the last step has finished, which is
  3750 ms here. Until then the arm is busy, and TuringMod sends nothing else but `stop`.
- **`rejected`:** sent instead of `started`, and nothing moves. The board rejects the **whole**
  gesture if:
  - a gesture is already playing (`busy`)
  - a servo number doesn't exist
  - any angle is outside that joint's safe range
  - two steps on one servo overlap
  - there are more steps than the board has memory for (about 64 is a sensible cap)

  Rejecting is better than clamping or skipping, because a wrong gesture should fail visibly, not
  quietly do something else.

`{"type":"stop"}` halts every servo where it is and abandons the gesture playing. The board then
sends `done` for that gesture. Stop is the software e-stop.

The board also needs to handle these:

- **Starting position.** A hobby servo can't report where it is, so the firmware tracks the last
  angle it commanded each servo. At power-on that's unknown, so move every servo to a home
  position first.
- **Joint limits.** Each joint's safe range lives in the firmware, because it depends on how the
  arm is built. TuringMod checks gestures before sending them, but the firmware has the final say.
- **Lost connection.** If TuringMod disconnects mid-gesture, finish the gesture (or stop it) and
  return to home. An arm left frozen mid-motion is the failure to avoid.

Possible later additions, each a new optional field rather than a new protocol version:

- easing per step, for a more natural-looking wave
- loading a gesture in advance and playing it on cue, for exact sync with a sound

## Changing the protocol

Bump `protocol` only for a change that would break existing firmware or TuringMod. A new message
type, or a new optional field, doesn't need a bump.
