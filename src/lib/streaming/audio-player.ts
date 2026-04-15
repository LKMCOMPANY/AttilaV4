/**
 * Audio player for scrcpy VMOS TCP audio streams.
 *
 * Protocol (over TCP→WebSocket bridge):
 *   64 bytes   device name (UTF-8, null-padded)
 *   4 bytes    codec string ("opus")
 *   repeated:  12-byte header + N bytes encoded audio
 *
 * Header format:
 *   byte 0      flags (0x80 = config frame)
 *   bytes 1-3   padding
 *   bytes 4-7   PTS (uint32 BE)
 *   bytes 8-11  data length (uint32 BE)
 *
 * Audio: Opus, 2 channels, 48 kHz.
 */

export type AudioPlayerStatus = "idle" | "connecting" | "playing" | "error";

export interface AudioPlayerOptions {
  url: string;
  onStatus?: (status: AudioPlayerStatus) => void;
  onError?: (error: string) => void;
}

const DEVICE_NAME_SIZE = 64;
const CODEC_SIZE = 4;
const FRAME_HEADER_SIZE = 12;

const enum ParseState {
  DeviceName,
  Codec,
  FrameHeader,
  FrameData,
}

export class AudioPlayer {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private decoder: AudioDecoder | null = null;
  private disposed = false;
  private gainNode: GainNode | null = null;

  private parseState = ParseState.DeviceName;
  private buffer = new Uint8Array(0);
  private currentFrameFlags = 0;
  private currentFrameDataLen = 0;
  private timestamp = 0;
  private configReceived = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;
  private nextPlayTime = 0;

  constructor(private opts: AudioPlayerOptions) {}

  async start() {
    if (this.disposed) return;
    this.opts.onStatus?.("connecting");
    this.initAudioContext();
    this.connectWs();
  }

  private initAudioContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
    this.nextPlayTime = 0;
  }

  private initDecoder() {
    if (this.decoder && this.decoder.state !== "closed") {
      try { this.decoder.close(); } catch { /* ignore */ }
    }

    this.decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        this.scheduleAudioData(audioData);
        audioData.close();
      },
      error: (e) => this.opts.onError?.(`AudioDecode: ${e.message}`),
    });

    this.decoder.configure({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 2,
    });
  }

  private scheduleAudioData(audioData: AudioData) {
    if (!this.ctx || !this.gainNode || this.disposed) return;

    const numFrames = audioData.numberOfFrames;
    const numChannels = audioData.numberOfChannels;
    const sampleRate = audioData.sampleRate;

    const buffer = this.ctx.createBuffer(numChannels, numFrames, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const dest = buffer.getChannelData(ch);
      audioData.copyTo(dest, { planeIndex: ch, format: "f32-planar" as AudioSampleFormat });
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.02;
    }
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  private connectWs() {
    this.parseState = ParseState.DeviceName;
    this.buffer = new Uint8Array(0);
    this.configReceived = false;
    this.timestamp = 0;

    this.ws = new WebSocket(this.opts.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      if (this.disposed) return;
      this.reconnectDelay = 2000;
    };

    this.ws.onmessage = (e) => {
      if (this.disposed) return;
      this.feed(new Uint8Array(e.data as ArrayBuffer));
    };

    this.ws.onclose = () => {
      if (!this.disposed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      if (!this.disposed) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    this.opts.onStatus?.("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      this.connectWs();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
    }, this.reconnectDelay);
  }

  // -----------------------------------------------------------------------
  // Stream parser — reassembles arbitrary TCP chunks into scrcpy frames
  // -----------------------------------------------------------------------

  private feed(chunk: Uint8Array<ArrayBuffer>) {
    this.buffer = concat(this.buffer, chunk);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      switch (this.parseState) {
        case ParseState.DeviceName: {
          if (this.buffer.length < DEVICE_NAME_SIZE) return;
          this.buffer = this.buffer.subarray(DEVICE_NAME_SIZE);
          this.parseState = ParseState.Codec;
          break;
        }

        case ParseState.Codec: {
          if (this.buffer.length < CODEC_SIZE) return;
          this.buffer = this.buffer.subarray(CODEC_SIZE);
          this.initDecoder();
          this.parseState = ParseState.FrameHeader;
          break;
        }

        case ParseState.FrameHeader: {
          if (this.buffer.length < FRAME_HEADER_SIZE) return;
          const view = new DataView(
            this.buffer.buffer,
            this.buffer.byteOffset,
            FRAME_HEADER_SIZE
          );
          this.currentFrameFlags = view.getUint8(0);
          this.currentFrameDataLen = view.getUint32(8, false);
          this.buffer = this.buffer.subarray(FRAME_HEADER_SIZE);
          this.parseState = ParseState.FrameData;
          break;
        }

        case ParseState.FrameData: {
          if (this.buffer.length < this.currentFrameDataLen) return;
          const data = this.buffer.subarray(0, this.currentFrameDataLen);
          this.buffer = this.buffer.subarray(this.currentFrameDataLen);

          const isConfig = (this.currentFrameFlags & 0x80) !== 0;
          if (isConfig) {
            this.configReceived = true;
          } else if (this.configReceived && data.length > 0) {
            this.decodeFrame(data);
          }

          this.parseState = ParseState.FrameHeader;
          break;
        }
      }
    }
  }

  private decodeFrame(data: Uint8Array) {
    if (!this.decoder || this.decoder.state !== "configured") return;

    try {
      this.decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: this.timestamp,
          data,
        })
      );
      this.timestamp += 20_000; // Opus default frame = 20ms = 20000µs
      this.opts.onStatus?.("playing");
    } catch {
      /* decode errors are non-fatal */
    }
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.decoder && this.decoder.state !== "closed") {
      try { this.decoder.close(); } catch { /* ignore */ }
    }
    this.ws?.close();
    this.ctx?.close().catch(() => {});
    this.ws = null;
    this.ctx = null;
    this.decoder = null;
  }
}

function concat(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (a.length === 0) return b;
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

