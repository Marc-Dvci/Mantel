/**
 * One voice at a time.
 *
 * In order of preference: the family member's own recording, the household
 * voice the server synthesises (Amazon Polly), the device's speech engine.
 * While anything plays, the native side stops listening, so Mantel never
 * answers itself.
 */

import { native } from "./bridge";
import type { Connection } from "./connection";

let current: HTMLAudioElement | undefined;
let generation = 0;

function play(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    current = a;
    const done = () => {
      if (current === a) current = undefined;
      resolve();
    };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  });
}

export function stopVoice() {
  generation++;
  current?.pause();
  current = undefined;
  native.stopSpeaking();
  native.setMediaPlaying(false);
}

export async function say(conn: Connection, line: { text: string; audio?: string | undefined }): Promise<void> {
  stopVoice();
  const mine = ++generation;
  native.setMediaPlaying(true);
  try {
    const recorded = conn.mediaUrl(line.audio);
    if (recorded) {
      await play(recorded);
      return;
    }
    const synthesised = await conn.speechUrl(line.text);
    if (mine !== generation) return;
    if (synthesised) {
      await play(synthesised);
      URL.revokeObjectURL(synthesised);
      return;
    }
    await native.speak(line.text);
  } finally {
    if (mine === generation) native.setMediaPlaying(false);
  }
}

export async function playMedia(url: string | undefined): Promise<void> {
  if (!url) return;
  stopVoice();
  const mine = ++generation;
  native.setMediaPlaying(true);
  try {
    await play(url);
  } finally {
    if (mine === generation) native.setMediaPlaying(false);
  }
}
