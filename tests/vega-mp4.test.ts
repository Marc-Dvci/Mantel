import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mp3ToMp4, parseMp3 } from "../vega/src/mp4";

/** Top-level boxes, and the children of the ones that only contain boxes. */
function boxes(b: Uint8Array, start = 0, end = b.length): { type: string; at: number; size: number }[] {
  const out = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = start; i < end; ) {
    const size = view.getUint32(i);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    out.push({ type, at: i, size });
    i += size;
  }
  return out;
}

function find(b: Uint8Array, path: string[]): { at: number; size: number } {
  let range = { at: -8, size: b.length + 8 };
  for (const type of path) {
    const box = boxes(b, range.at + 8, range.at + range.size).find((x) => x.type === type);
    if (!box) throw new Error(`no ${type}`);
    range = box;
  }
  return range;
}

/** An MPEG-1 Layer III frame: 128 kbit/s, 44.1 kHz, stereo, no padding (417 bytes). */
function mpeg1Frame(fill: number): Uint8Array {
  const f = new Uint8Array(417).fill(fill);
  f.set([0xff, 0xfb, 0x90, 0x44]);
  return f;
}

describe("Vega audio: MP3 wrapped in MP4", () => {
  const fixture = new Uint8Array(readFileSync(join(__dirname, "../fixtures/media/audio-robert-sarah.mp3")));

  it("reads a family recording's frames past its ID3 tag", () => {
    const a = parseMp3(fixture);
    expect(a.sampleRate).toBe(24000);
    expect(a.channels).toBe(1);
    expect(a.samplesPerFrame).toBe(576);
    expect(a.objectType).toBe(0x69);
    // 5.3 s at 24 kHz, 576 samples a frame.
    expect(a.frames.length).toBeGreaterThan(215);
    expect(a.frames.length).toBeLessThan(225);
    expect(a.frames.every((f) => f[0] === 0xff && (f[1]! & 0xe0) === 0xe0)).toBe(true);
  });

  it("writes ftyp, moov, mdat, with every frame in the sample table and the chunk offset on the first frame", () => {
    const { data, mime, seconds } = mp3ToMp4(fixture);
    const a = parseMp3(fixture);
    expect(mime).toBe('audio/mp4; codecs="mp4a.69"');
    expect(seconds).toBeCloseTo((a.frames.length * 576) / 24000, 5);
    expect(boxes(data).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stsz = find(data, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
    expect(view.getUint32(stsz.at + 16)).toBe(a.frames.length);
    expect(view.getUint32(stsz.at + 20)).toBe(a.frames[0]!.length);

    const stco = find(data, ["moov", "trak", "mdia", "minf", "stbl", "stco"]);
    const offset = view.getUint32(stco.at + 16);
    const mdat = boxes(data).find((b) => b.type === "mdat")!;
    expect(offset).toBe(mdat.at + 8);
    expect(Array.from(data.subarray(offset, offset + 4))).toEqual(Array.from(a.frames[0]!.subarray(0, 4)));
    expect(mdat.size - 8).toBe(a.frames.reduce((s, f) => s + f.length, 0));
  });

  it("names MPEG-1 audio 0x6B, and leaves out a Xing header frame and an ID3v1 tag", () => {
    const xing = mpeg1Frame(0);
    xing.set([0x58, 0x69, 0x6e, 0x67], 4 + 32); // "Xing" after the stereo side info
    const tag = new Uint8Array(128).fill(0x20);
    tag.set([0x54, 0x41, 0x47]); // "TAG"
    const body = [xing, mpeg1Frame(1), mpeg1Frame(2), mpeg1Frame(3), tag];
    const mp3 = new Uint8Array(body.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of body) {
      mp3.set(p, o);
      o += p.length;
    }
    const a = parseMp3(mp3);
    expect(a.frames.map((f) => f[4])).toEqual([1, 2, 3]);
    expect(a.sampleRate).toBe(44100);
    expect(a.channels).toBe(2);
    expect(mp3ToMp4(mp3).mime).toBe('audio/mp4; codecs="mp4a.6b"');
  });

  it("refuses data with no MP3 frames", () => {
    expect(() => mp3ToMp4(new Uint8Array(1000))).toThrow("no MP3 frames");
  });
});
