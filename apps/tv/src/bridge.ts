/**
 * The bridge to the Fire TV app's native side.
 *
 * On a Fire TV, the Android shell exposes `window.MantelNative` and delivers
 * events by calling `window.__mantelNative(json)`. The native side owns the
 * sensors: the webcam (presence only, frames never leave the device), the
 * webcam's microphone (on-device speech recognition), the text-to-speech
 * engine, screen wake and brightness.
 *
 * In a desktop browser there is no native side. The bridge then reports the
 * person as present, and with `?dev=1` the page offers keys to toggle presence
 * and type a question, which is how the screens are developed.
 */

export type NativeEvent =
  | { type: "presence"; present: boolean; confidence?: number }
  | { type: "speech"; text: string; final: boolean }
  | { type: "tts"; id: string; state: "start" | "done" | "error" }
  | { type: "key"; key: "back" | "menu" }
  | { type: "camera"; active: boolean }
  | { type: "microphone"; active: boolean };

export interface NativeConfig {
  server?: string;
  token?: string;
  deviceName?: string;
}

export interface Capabilities {
  native: boolean;
  camera: boolean;
  microphone: boolean;
  tts: boolean;
  presenceModel?: string;
}

interface MantelNativeApi {
  getConfig(): string;
  capabilities(): string;
  speak(text: string, id: string): void;
  stopSpeaking(): void;
  setListening(mode: string): void;
  setMediaPlaying(playing: boolean): void;
  setKeepScreenOn(on: boolean): void;
  setDim(level: number): void;
  openSettings(): void;
  log(message: string): void;
}

declare global {
  interface Window {
    MantelNative?: MantelNativeApi;
    __mantelNative?: (json: string) => void;
  }
}

type Listener = (e: NativeEvent) => void;
const listeners = new Set<Listener>();

export function onNative(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: NativeEvent) {
  for (const l of listeners) l(e);
}

window.__mantelNative = (json: string) => {
  try {
    emit(JSON.parse(json) as NativeEvent);
  } catch {
    /* a malformed native message is dropped */
  }
};

const api = (): MantelNativeApi | undefined => window.MantelNative;

export const native = {
  get available() {
    return Boolean(api());
  },
  config(): NativeConfig {
    try {
      return api() ? (JSON.parse(api()!.getConfig()) as NativeConfig) : {};
    } catch {
      return {};
    }
  },
  capabilities(): Capabilities {
    try {
      if (api()) return { native: true, ...(JSON.parse(api()!.capabilities()) as Omit<Capabilities, "native">) };
    } catch {
      /* fall through */
    }
    return { native: false, camera: false, microphone: false, tts: typeof speechSynthesis !== "undefined" };
  },
  /** Speak with the device's own engine; resolves when it finishes (or is unavailable). */
  speak(text: string): Promise<void> {
    const n = api();
    if (!n) return browserSpeak(text);
    const id = `tts-${Date.now().toString(36)}`;
    return new Promise((resolve) => {
      const off = onNative((e) => {
        if (e.type === "tts" && e.id === id && e.state !== "start") {
          off();
          resolve();
        }
      });
      n.speak(text, id);
      setTimeout(() => {
        off();
        resolve();
      }, 4000 + text.length * 90);
    });
  },
  stopSpeaking() {
    api()?.stopSpeaking();
    if (!api() && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  },
  setListening(mode: string) {
    api()?.setListening(mode);
  },
  setMediaPlaying(playing: boolean) {
    api()?.setMediaPlaying(playing);
  },
  setKeepScreenOn(on: boolean) {
    api()?.setKeepScreenOn(on);
  },
  setDim(level: number) {
    api()?.setDim(level);
  },
  openSettings() {
    api()?.openSettings();
  },
  log(message: string) {
    api()?.log(message);
  },
};

function browserSpeak(text: string): Promise<void> {
  if (typeof speechSynthesis === "undefined") return new Promise((r) => setTimeout(r, 1500 + text.length * 60));
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    setTimeout(resolve, 4000 + text.length * 90);
  });
}
