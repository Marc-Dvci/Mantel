/**
 * MP3 in an MP4 container, without re-encoding.
 *
 * Vega's media player plays a URL only over https. A household server on the
 * home network is plain http, so the app fetches each recording itself (the
 * manifest allows cleartext to that host) and hands the bytes to the player
 * through Media Source Extensions. Vega's MSE takes MP3 inside MP4
 * (`audio/mp4; codecs="mp4a.6b"`) but not a bare MP3 stream, so this wraps the
 * MP3 frames, untouched, in the smallest MP4 that describes them.
 */

export interface Mp3Info {
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  /** MPEG-1 (0x6B) or MPEG-2/2.5 (0x69) audio, as MP4 names it. */
  objectType: 0x6b | 0x69;
  frames: Uint8Array[];
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]};

interface Header {
  length: number;
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  mpeg1: boolean;
}

/** A Layer III frame header at `i`, or undefined. */
function header(b: Uint8Array, i: number): Header | undefined {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return undefined;
  const version = (b[i + 1]! >> 3) & 3;
  const layer = (b[i + 1]! >> 1) & 3;
  const bitrateIndex = b[i + 2]! >> 4;
  const rateIndex = (b[i + 2]! >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return undefined;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex]! * 1000;
  const sampleRate = RATES[version]![rateIndex]!;
  const padding = (b[i + 2]! >> 1) & 1;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return {length, sampleRate, channels: b[i + 3]! >> 6 === 3 ? 1 : 2, samplesPerFrame: mpeg1 ? 1152 : 576, mpeg1};
}

/** A Xing, Info or VBRI frame: metadata that decodes as silence, left out of the MP4. */
function isTagFrame(b: Uint8Array, i: number, h: Header): boolean {
  const side = h.mpeg1 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const at = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  return ['Xing', 'Info'].includes(at(i + 4 + side)) || at(i + 36) === 'VBRI';
}

export function parseMp3(b: Uint8Array): Mp3Info {
  let i = 0;
  // ID3v2 at the start: "ID3", version, flags, then a sync-safe size.
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b.length > 10) {
    i = 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) + (b[5]! & 0x10 ? 10 : 0);
  }
  const frames: Uint8Array[] = [];
  let first: Header | undefined;
  while (i < b.length) {
    const h = header(b, i);
    // A header counts only when the next frame starts where it says it ends (or the data ends).
    if (!h || (i + h.length < b.length && !header(b, i + h.length) && i + h.length + 128 !== b.length)) {
      i++;
      continue;
    }
    if (i + h.length > b.length) break;
    if (!first) first = h;
    if (h.sampleRate === first.sampleRate && !(frames.length === 0 && isTagFrame(b, i, h))) frames.push(b.subarray(i, i + h.length));
    i += h.length;
  }
  if (!first || !frames.length) throw new Error('no MP3 frames');
  return {sampleRate: first.sampleRate, channels: first.channels, samplesPerFrame: first.samplesPerFrame, objectType: first.mpeg1 ? 0x6b : 0x69, frames};
}

// ---------------------------------------------------------------- MP4 boxes

type Part = Uint8Array | number[];

function concat(parts: Part[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >>> 8) & 255, v & 255];
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);

function box(type: string, ...parts: Part[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(8 + body.length), ascii(type), body]);
}

/** A full box: version 0 and the given flags, then the body. */
const fullBox = (type: string, flags: number, ...parts: Part[]) => box(type, u32(flags & 0xffffff), ...parts);

const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

function descriptor(tag: number, body: number[]): number[] {
  return [tag, body.length, ...body];
}

export function mp3ToMp4(mp3: Uint8Array): {data: Uint8Array; mime: string; seconds: number} {
  const a = parseMp3(mp3);
  const count = a.frames.length;
  const mediaDuration = count * a.samplesPerFrame;
  const ms = Math.round((mediaDuration * 1000) / a.sampleRate);
  const bytes = a.frames.reduce((s, f) => s + f.length, 0);
  const bitrate = Math.round((bytes * 8 * a.sampleRate) / mediaDuration);

  const esds = fullBox(
    'esds',
    0,
    descriptor(0x03, [
      ...u16(1),
      0,
      ...descriptor(0x04, [a.objectType, 0x15, 0, 0, 0, ...u32(bitrate), ...u32(bitrate)]),
      ...descriptor(0x06, [0x02]),
    ]),
  );
  const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(a.channels), u16(16), zeros(4), u32(a.sampleRate << 16), esds);

  const stbl = (chunkOffset: number) =>
    box(
      'stbl',
      fullBox('stsd', 0, u32(1), mp4a),
      fullBox('stts', 0, u32(1), u32(count), u32(a.samplesPerFrame)),
      fullBox('stsc', 0, u32(1), u32(1), u32(count), u32(1)),
      fullBox('stsz', 0, u32(0), u32(count), concat(a.frames.map(f => u32(f.length)))),
      fullBox('stco', 0, u32(1), u32(chunkOffset)),
    );
  const moov = (chunkOffset: number) =>
    box(
      'moov',
      fullBox('mvhd', 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        'trak',
        fullBox('tkhd', 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0x100), zeros(2), MATRIX, u32(0), u32(0)),
        box(
          'mdia',
          fullBox('mdhd', 0, u32(0), u32(0), u32(a.sampleRate), u32(mediaDuration), u16(0x55c4), u16(0)),
          fullBox('hdlr', 0, u32(0), ascii('soun'), zeros(12), ascii('SoundHandler'), [0]),
          box('minf', fullBox('smhd', 0, u16(0), u16(0)), box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', 1))), stbl(chunkOffset)),
        ),
      ),
    );

  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('mp41'));
  // The chunk offset is a fixed-size field, so the moov's size does not depend on its value.
  const offset = ftyp.length + moov(0).length + 8;
  const data = concat([ftyp, moov(offset), u32(8 + bytes), ascii('mdat'), ...a.frames]);
  return {data, mime: `audio/mp4; codecs="mp4a.${a.objectType.toString(16)}"`, seconds: mediaDuration / a.sampleRate};
}
