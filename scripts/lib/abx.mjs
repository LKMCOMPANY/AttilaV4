/**
 * Decoder for Android Binary XML (ABX) — the format Android 12+ uses for
 * `/data/system/packages.xml`. Enough of the AOSP `BinaryXmlSerializer` wire
 * format to walk every element and attribute; the callers only need the
 * `<package name=… version=…>` pairs.
 *
 * Format: 4-byte magic `ABX\0`, then tokens. Token byte = event (low nibble)
 * | type (high nibble). Strings are Java `writeUTF` (u16 length + UTF-8);
 * interned strings are a u16 index into a table that grows as 0xFFFF entries
 * introduce new strings. Ints/longs are big-endian.
 */

const MAGIC = Buffer.from("ABX\0", "latin1");

const EVENT = {
  START_DOCUMENT: 0,
  END_DOCUMENT: 1,
  START_TAG: 2,
  END_TAG: 3,
  TEXT: 4,
  CDSECT: 5,
  ENTITY_REF: 6,
  IGNORABLE_WHITESPACE: 7,
  PROCESSING_INSTRUCTION: 8,
  COMMENT: 9,
  DOCDECL: 10,
  ATTRIBUTE: 15,
};

const TYPE = {
  NULL: 1 << 4,
  STRING: 2 << 4,
  STRING_INTERNED: 3 << 4,
  BYTES_HEX: 4 << 4,
  BYTES_BASE64: 5 << 4,
  INT: 6 << 4,
  INT_HEX: 7 << 4,
  LONG: 8 << 4,
  LONG_HEX: 9 << 4,
  FLOAT: 10 << 4,
  DOUBLE: 11 << 4,
  BOOLEAN_TRUE: 12 << 4,
  BOOLEAN_FALSE: 13 << 4,
};

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.interned = [];
  }
  get eof() {
    return this.pos >= this.buf.length;
  }
  u8() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }
  skip(n) {
    this.pos += n;
  }
  utf() {
    const len = this.u16();
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
  internedString() {
    const idx = this.u16();
    if (idx === 0xffff) {
      const s = this.utf();
      this.interned.push(s);
      return s;
    }
    return this.interned[idx] ?? "";
  }
  /** Read a typed value; returns a JS value (or null for non-scalar types). */
  value(type) {
    switch (type) {
      case TYPE.NULL:
      case TYPE.BOOLEAN_TRUE:
      case TYPE.BOOLEAN_FALSE:
        return type === TYPE.BOOLEAN_TRUE ? true : type === TYPE.BOOLEAN_FALSE ? false : null;
      case TYPE.STRING:
        return this.utf();
      case TYPE.STRING_INTERNED:
        return this.internedString();
      case TYPE.BYTES_HEX:
      case TYPE.BYTES_BASE64:
        this.skip(this.u16());
        return null;
      case TYPE.INT:
      case TYPE.INT_HEX:
        return this.i32();
      case TYPE.LONG:
      case TYPE.LONG_HEX:
        return Number(this.i64());
      case TYPE.FLOAT:
        this.skip(4);
        return null;
      case TYPE.DOUBLE:
        this.skip(8);
        return null;
      default:
        throw new Error(`ABX: unknown value type 0x${type.toString(16)} at ${this.pos}`);
    }
  }
}

/**
 * Walk an ABX document and invoke `onElement(name, attrs, depth)` for every
 * element once its attributes are complete. Attributes are the raw scalar
 * values (strings, ints, longs as numbers, booleans).
 */
export function walkAbx(buf, onElement) {
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error("ABX: bad magic — not an Android Binary XML document");
  }
  const r = new Reader(buf);
  r.skip(4);

  const stack = [];
  let pending = null; // { name, attrs, depth } — attributes follow START_TAG

  const flush = () => {
    if (pending) {
      onElement(pending.name, pending.attrs, pending.depth);
      pending = null;
    }
  };

  while (!r.eof) {
    const token = r.u8();
    const event = token & 0x0f;
    const type = token & 0xf0;

    if (event === EVENT.ATTRIBUTE) {
      const name = r.internedString();
      const value = r.value(type);
      if (pending) pending.attrs[name] = value;
      continue;
    }

    flush();

    switch (event) {
      case EVENT.START_DOCUMENT:
        break;
      case EVENT.END_DOCUMENT:
        return;
      case EVENT.START_TAG: {
        const name = r.internedString();
        stack.push(name);
        pending = { name, attrs: {}, depth: stack.length };
        break;
      }
      case EVENT.END_TAG:
        r.internedString();
        stack.pop();
        break;
      default:
        // TEXT, CDSECT, COMMENT, PI, DOCDECL, whitespace, entity refs carry one value.
        r.value(type);
    }
  }
  flush();
}

/**
 * `<package name=… version=…>` pairs of a packages.xml document.
 * @returns {Map<string, { versionCode: number | null }>}
 */
export function packagesFromAbx(buf) {
  const out = new Map();
  walkAbx(buf, (name, attrs, depth) => {
    if (name !== "package" || depth !== 2) return;
    const pkg = attrs.name;
    if (typeof pkg !== "string" || !pkg) return;
    const version = attrs.version;
    out.set(pkg, { versionCode: typeof version === "number" ? version : null });
  });
  return out;
}
