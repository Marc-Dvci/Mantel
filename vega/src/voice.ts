/**
 * One voice at a time, as in the Fire OS app (apps/tv/src/voice.ts).
 *
 * In order of preference: the family member's own recording, then the
 * household voice the server synthesises (Amazon Polly). Vega has no speech
 * engine an app can call, so a line with neither is shown and not spoken.
 *
 * Each clip is fetched by the app (the household server is plain http on the
 * home network, which Vega's media player will not open itself), wrapped in
 * MP4 (./mp4.ts) and played through Media Source Extensions.
 */

import {AudioPlayer, MediaSource} from '@amazon-devices/react-native-w3cmedia';
import type {Connection} from './connection';
import {mp3ToMp4} from './mp4';

let current: AudioPlayer | undefined;
let generation = 0;

async function release(p: AudioPlayer) {
  try {
    p.pause();
    await p.deinitialize();
  } catch {
    /* already gone */
  }
}

async function play(conn: Connection, url: string, mine: number): Promise<void> {
  const res = await fetch(url, {headers: conn.headers()});
  if (!res.ok) throw new Error(`audio ${res.status}`);
  const {data, mime, seconds} = mp3ToMp4(new Uint8Array(await res.arrayBuffer()));
  if (mine !== generation) return;
  const player = new AudioPlayer();
  current = player;
  await player.initialize();
  if (mine !== generation) {
    await release(player);
    return;
  }
  await new Promise<void>(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      if (current === player) current = undefined;
      void release(player);
      resolve();
    };
    // Some streams never report 'ended'; the clip's own length is the backstop.
    const guard = setTimeout(done, (seconds + 3) * 1000);
    player.addEventListener('ended', done);
    player.addEventListener('error', done);
    const ms = new MediaSource();
    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(mime);
        sb.addEventListener('updateend', () => {
          try {
            ms.endOfStream();
          } catch {
            /* already ended */
          }
          player.play();
        });
        sb.appendBuffer(data as unknown as ArrayBuffer);
      } catch {
        done();
      }
    });
    (player as unknown as {srcObject: MediaSource}).srcObject = ms;
  });
}

export function stopVoice() {
  generation++;
  const p = current;
  current = undefined;
  if (p) void release(p);
}

async function playSafely(conn: Connection, url: string, mine: number): Promise<boolean> {
  try {
    await play(conn, url, mine);
    return true;
  } catch (e) {
    console.warn(`[mantel] audio failed: ${(e as Error).message}`);
    return false;
  }
}

export async function say(conn: Connection, line: {text: string; audio?: string | undefined}): Promise<void> {
  stopVoice();
  const mine = ++generation;
  const recorded = conn.mediaUrl(line.audio);
  if (recorded && (await playSafely(conn, recorded, mine))) return;
  if (mine !== generation) return;
  const synthesised = conn.speechUrl(line.text);
  if (synthesised) await playSafely(conn, synthesised, mine);
}

export async function playMedia(conn: Connection, url: string | undefined): Promise<void> {
  if (!url) return;
  stopVoice();
  await playSafely(conn, url, ++generation);
}
