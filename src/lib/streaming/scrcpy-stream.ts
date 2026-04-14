import {
  parseDeviceMeta,
  parseVideoFrame,
  extractCodecString,
  buildTouchEvent,
  buildKeycodeEvent,
  buildTextEvent,
  buildScrollEvent,
  buildClipboardEvent,
  ACTION_DOWN,
  ACTION_UP,
  ACTION_MOVE,
  type DeviceMeta,
} from "./scrcpy-codec";

export type StreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "disconnected"
  | "error";

export interface ScrcpyStreamOptions {
  videoUrl: string;
  controlUrl: string;
  canvas: HTMLCanvasElement;
  onStatus?: (status: StreamStatus) => void;
  onError?: (error: string) => void;
}

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 15000;

export class ScrcpyStream {
  private videoWs: WebSocket | null = null;
  private controlWs: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private meta: DeviceMeta | null = null;
  private gotMeta = false;
  private metaChunks: Uint8Array[] = [];
  private metaLength = 0;
  private disposed = false;
  private timestamp = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_DELAY;

  constructor(private opts: ScrcpyStreamOptions) {
    this.ctx = opts.canvas.getContext("2d");
  }

  start() {
    this.opts.onStatus?.("connecting");
    this.connectVideo();
    this.connectControl();
  }

  private reset() {
    this.gotMeta = false;
    this.metaChunks = [];
    this.metaLength = 0;
    this.timestamp = 0;
    if (this.decoder && this.decoder.state !== "closed") {
      try {
        this.decoder.close();
      } catch {
        /* ignore */
      }
    }
    this.decoder = null;
    this.videoWs?.close();
    this.controlWs?.close();
    this.videoWs = null;
    this.controlWs = null;
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      this.reset();
      this.opts.onStatus?.("connecting");
      this.connectVideo();
      this.connectControl();
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 1.5,
        MAX_RECONNECT_DELAY
      );
    }, this.reconnectDelay);
  }

  private connectVideo() {
    this.videoWs = new WebSocket(this.opts.videoUrl);
    this.videoWs.binaryType = "arraybuffer";

    this.videoWs.onmessage = (e) => {
      if (this.disposed) return;
      const buf = e.data as ArrayBuffer;

      if (!this.gotMeta) {
        // Buffer meta chunks — some scrcpy implementations split the
        // 130-byte meta frame across multiple WS messages.
        this.metaChunks.push(new Uint8Array(buf));
        this.metaLength += buf.byteLength;

        // Need at least 76 bytes: 64 name + 4 codec + 4 width + 4 height
        if (this.metaLength < 76) return;

        const combined = new Uint8Array(this.metaLength);
        let offset = 0;
        for (const chunk of this.metaChunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        this.metaChunks = [];

        this.meta = parseDeviceMeta(combined.buffer);
        this.opts.canvas.width = this.meta.width;
        this.opts.canvas.height = this.meta.height;

        const codecString = extractCodecString(this.meta.spsData);
        this.initDecoder(codecString);
        this.gotMeta = true;
        this.reconnectDelay = RECONNECT_DELAY;
        this.opts.onStatus?.("streaming");
        return;
      }

      const frame = parseVideoFrame(buf);

      if (this.decoder && this.decoder.state === "configured") {
        try {
          this.decoder.decode(
            new EncodedVideoChunk({
              type: frame.isKeyframe ? "key" : "delta",
              timestamp: this.timestamp,
              data: frame.data,
            })
          );
          this.timestamp += 33333;
        } catch {
          /* decode errors are non-fatal */
        }
      }
    };

    this.videoWs.onclose = () => {
      if (!this.disposed) {
        this.opts.onStatus?.("disconnected");
        this.scheduleReconnect();
      }
    };
    this.videoWs.onerror = () => {
      if (!this.disposed) this.scheduleReconnect();
    };
  }

  private initDecoder(codecString: string) {
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.ctx && !this.disposed) {
          this.ctx.drawImage(frame, 0, 0);
        }
        frame.close();
      },
      error: (e) => this.opts.onError?.(`Decode: ${e.message}`),
    });

    this.decoder.configure({
      codec: codecString,
      optimizeForLatency: true,
    });
  }

  private connectControl() {
    this.controlWs = new WebSocket(this.opts.controlUrl);
    this.controlWs.binaryType = "arraybuffer";
    this.controlWs.onerror = () => {};
    this.controlWs.onclose = () => {};
  }

  private sendControl(msg: ArrayBuffer) {
    if (!this.controlWs || this.controlWs.readyState !== WebSocket.OPEN) return;
    this.controlWs.send(msg);
  }

  sendTouch(action: number, x: number, y: number) {
    if (!this.meta) return;
    this.sendControl(
      buildTouchEvent(action, x, y, this.meta.width, this.meta.height)
    );
  }

  sendKeycode(action: number, keycode: number, metastate: number = 0) {
    this.sendControl(buildKeycodeEvent(action, keycode, 0, metastate));
  }

  sendText(text: string) {
    if (!text) return;
    this.sendControl(buildTextEvent(text));
  }

  sendScroll(x: number, y: number, hscroll: number, vscroll: number) {
    if (!this.meta) return;
    this.sendControl(
      buildScrollEvent(x, y, this.meta.width, this.meta.height, hscroll, vscroll)
    );
  }

  sendClipboard(text: string) {
    if (!text) return;
    this.sendControl(buildClipboardEvent(text));
  }

  get videoWidth() {
    return this.meta?.width ?? 0;
  }
  get videoHeight() {
    return this.meta?.height ?? 0;
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.decoder && this.decoder.state !== "closed") {
      try {
        this.decoder.close();
      } catch {
        /* ignore */
      }
    }
    this.videoWs?.close();
    this.controlWs?.close();
  }
}

export function isWebCodecsSupported(): boolean {
  return typeof window !== "undefined" && "VideoDecoder" in window;
}

export { ACTION_DOWN, ACTION_UP, ACTION_MOVE };
