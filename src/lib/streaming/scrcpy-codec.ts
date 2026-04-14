export interface DeviceMeta {
  name: string;
  codec: string;
  width: number;
  height: number;
  spsData: Uint8Array;
}

export interface VideoFrame {
  isKeyframe: boolean;
  data: Uint8Array;
}

export function parseDeviceMeta(buf: ArrayBuffer): DeviceMeta {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  const nameEnd = bytes.indexOf(0);
  const name = new TextDecoder().decode(
    bytes.subarray(0, nameEnd > 0 ? Math.min(nameEnd, 64) : 64)
  );

  const codec = new TextDecoder().decode(bytes.subarray(64, 68));
  const width = view.getUint32(68, false);
  const height = view.getUint32(72, false);

  const FRAME_HEADER = 12;
  const spsData = bytes.subarray(76 + FRAME_HEADER);

  return { name, codec, width, height, spsData };
}

const VIDEO_HEADER_SIZE = 12;

export function parseVideoFrame(buf: ArrayBuffer): VideoFrame {
  const bytes = new Uint8Array(buf);
  const flags = bytes[0];
  const isKeyframe = (flags & 0x40) !== 0;
  const data = bytes.subarray(VIDEO_HEADER_SIZE);
  return { isKeyframe, data };
}

export function extractCodecString(spsNal: Uint8Array): string {
  for (let i = 0; i < spsNal.length - 5; i++) {
    const isStartCode4 =
      spsNal[i] === 0 &&
      spsNal[i + 1] === 0 &&
      spsNal[i + 2] === 0 &&
      spsNal[i + 3] === 1;
    const isStartCode3 =
      spsNal[i] === 0 && spsNal[i + 1] === 0 && spsNal[i + 2] === 1;
    const offset = isStartCode4 ? i + 4 : isStartCode3 ? i + 3 : -1;
    if (offset < 0) continue;

    const nalType = spsNal[offset] & 0x1f;
    if (nalType === 7 && spsNal.length > offset + 3) {
      const profile = spsNal[offset + 1];
      const compat = spsNal[offset + 2];
      const level = spsNal[offset + 3];
      return `avc1.${hex(profile)}${hex(compat)}${hex(level)}`;
    }
  }
  return "avc1.42c032";
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Control message types
// ---------------------------------------------------------------------------

const INJECT_KEYCODE = 0x00;
const INJECT_TEXT = 0x01;
const INJECT_TOUCH = 0x02;
const INJECT_SCROLL = 0x03;
const SET_CLIPBOARD = 0x09;

export const ACTION_DOWN = 0;
export const ACTION_UP = 1;
export const ACTION_MOVE = 2;

// ---------------------------------------------------------------------------
// Android keycode mapping (browser key → Android keycode)
// ---------------------------------------------------------------------------

export const ANDROID_KEYCODES: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 3,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  " ": 62,
};

export const KEYCODE_BACK = 4;
export const KEYCODE_HOME = 3;
export const KEYCODE_APP_SWITCH = 187;

// Android meta-state flags
export const META_SHIFT = 0x01;
export const META_CTRL = 0x1000;
export const META_ALT = 0x02;

// ---------------------------------------------------------------------------
// INJECT_KEYCODE (14 bytes)
// ---------------------------------------------------------------------------

export function buildKeycodeEvent(
  action: number,
  keycode: number,
  repeat: number = 0,
  metastate: number = 0
): ArrayBuffer {
  const buf = new ArrayBuffer(14);
  const view = new DataView(buf);
  view.setUint8(0, INJECT_KEYCODE);
  view.setUint8(1, action);
  view.setUint32(2, keycode, false);
  view.setUint32(6, repeat, false);
  view.setUint32(10, metastate, false);
  return buf;
}

// ---------------------------------------------------------------------------
// INJECT_TEXT (variable length)
// ---------------------------------------------------------------------------

export function buildTextEvent(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(5 + encoded.length);
  const view = new DataView(buf);
  view.setUint8(0, INJECT_TEXT);
  view.setUint32(1, encoded.length, false);
  new Uint8Array(buf).set(encoded, 5);
  return buf;
}

// ---------------------------------------------------------------------------
// INJECT_TOUCH_EVENT (32 bytes)
// ---------------------------------------------------------------------------

export function buildTouchEvent(
  action: number,
  x: number,
  y: number,
  videoWidth: number,
  videoHeight: number
): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  let offset = 0;

  view.setUint8(offset, INJECT_TOUCH);
  offset += 1;
  view.setUint8(offset, action);
  offset += 1;
  view.setBigInt64(offset, BigInt(-1), false);
  offset += 8;
  view.setInt32(offset, Math.round(x), false);
  offset += 4;
  view.setInt32(offset, Math.round(y), false);
  offset += 4;
  view.setUint16(offset, videoWidth, false);
  offset += 2;
  view.setUint16(offset, videoHeight, false);
  offset += 2;
  view.setUint16(offset, action === ACTION_UP ? 0 : 0xffff, false);
  offset += 2;
  view.setInt32(offset, 1, false);
  offset += 4;
  view.setInt32(offset, action === ACTION_UP ? 0 : 1, false);

  return buf;
}

// ---------------------------------------------------------------------------
// INJECT_SCROLL_EVENT (25 bytes)
// ---------------------------------------------------------------------------

export function buildScrollEvent(
  x: number,
  y: number,
  videoWidth: number,
  videoHeight: number,
  hscroll: number,
  vscroll: number
): ArrayBuffer {
  const buf = new ArrayBuffer(25);
  const view = new DataView(buf);
  view.setUint8(0, INJECT_SCROLL);
  view.setInt32(1, Math.round(x), false);
  view.setInt32(5, Math.round(y), false);
  view.setUint16(9, videoWidth, false);
  view.setUint16(11, videoHeight, false);
  view.setInt32(13, Math.round(hscroll), false);
  view.setInt32(17, Math.round(vscroll), false);
  view.setInt32(21, 0, false);
  return buf;
}

// ---------------------------------------------------------------------------
// SET_CLIPBOARD (variable length)
// ---------------------------------------------------------------------------

export function buildClipboardEvent(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(14 + encoded.length);
  const view = new DataView(buf);
  view.setUint8(0, SET_CLIPBOARD);
  view.setBigInt64(1, BigInt(0), false);
  view.setUint8(9, 1);
  view.setUint32(10, encoded.length, false);
  new Uint8Array(buf).set(encoded, 14);
  return buf;
}
