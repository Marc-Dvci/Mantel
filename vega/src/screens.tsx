/**
 * Mantel's screens in React Native, laid out as the Fire OS app's
 * (apps/tv/src/App.tsx and styles.css): read from across a room by someone
 * whose eyesight and attention are not what they were. Very large type, one
 * idea per screen, high contrast without glare, nothing that flashes, and
 * every change a slow fade.
 */

import * as React from 'react';
import {useEffect, useRef} from 'react';
import {Animated, Dimensions, Image, StyleSheet, Text, View, type TextStyle} from 'react-native';
import {memberById, type Answer, type DoorCard, type Household, type Message, type Moment, type TodayBoard} from './core';

const {width, height} = Dimensions.get('window');
/** 1% of the screen's width and height, the units the web interface is written in. */
const vw = width / 100;
const vh = height / 100;

export const INK = '#f7f1e6';
const INK_SOFT = 'rgba(247, 241, 230, 0.72)';
const INK_FAINT = 'rgba(247, 241, 230, 0.45)';
const PANEL = 'rgba(255, 255, 255, 0.07)';
const PANEL_EDGE = 'rgba(255, 255, 255, 0.12)';

export type Mode = 'day' | 'evening' | 'night';
export const THEME: Record<Mode, {top: string; accent: string; sky: number; ink: string}> = {
  day: {top: '#1c2735', accent: '#f2b56b', sky: 0.42, ink: INK},
  evening: {top: '#2b1f26', accent: '#eda673', sky: 0.3, ink: INK},
  night: {top: '#050507', accent: '#f2b56b', sky: 0, ink: '#9b8263'},
};

// Vega finds a font by file name, one weight per family (assets/fonts/).
const REGULAR = 'Atkinson Hyperlegible';
const BOLD = 'Atkinson Hyperlegible Bold';

/**
 * Text in Atkinson Hyperlegible, whose zero is slashed; digits come from the
 * platform's sans-serif, whose zero is plain, as on the Fire OS app.
 */
export function T({style, children, tail}: {style?: TextStyle | TextStyle[]; children: React.ReactNode; tail?: React.ReactNode}) {
  const flat = StyleSheet.flatten(style) ?? {};
  const family = flat.fontWeight === '700' ? BOLD : REGULAR;
  const text = React.Children.toArray(children).join('');
  const parts = text.split(/(\d+)/).filter(Boolean);
  return (
    <Text style={[style, {fontFamily: family, fontWeight: 'normal'}]}>
      {parts.map((p, i) =>
        /^\d/.test(p) ? (
          <Text key={i} style={{fontFamily: 'sans-serif', fontWeight: flat.fontWeight ?? 'normal'}}>
            {p}
          </Text>
        ) : (
          p
        ),
      )}
      {tail}
    </Text>
  );
}

/** Fades its content in whenever `k` changes. */
export function Fade({k, ms = 900, style, children}: {k: string; ms?: number; style?: object; children: React.ReactNode}) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    o.setValue(0);
    Animated.timing(o, {toValue: 1, duration: ms, useNativeDriver: true}).start();
  }, [k]);
  return <Animated.View style={[style, {opacity: o}]}>{children}</Animated.View>;
}

/**
 * The sky light is a radial gradient in the web interface. React Native on
 * Vega draws neither CSS gradients nor tinted translucent images cleanly, so
 * it is built from nested opaque ellipses, each already blended with the
 * background to the gradient's value at its radius.
 */
const RINGS = Array.from({length: 64}, (_, i) => 1 - i / 64);

/** `a` moved towards `b` by `t`, both as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The screen's backdrop: the mode's colour, a soft sky light that follows the real sky, a darker foot. */
export function Backdrop({mode, sky}: {mode: Mode; sky: string}) {
  const t = THEME[mode];
  return (
    <View style={[StyleSheet.absoluteFill, {backgroundColor: t.top}]}>
      {t.sky > 0 && (
        <View style={s.glow}>
          {RINGS.map(r => (
            <View key={r} style={[s.ring, {backgroundColor: mix(t.top, sky, t.sky * (1 - r + 0.5 / RINGS.length)), width: r * 95 * vw, height: r * 95 * vw, borderRadius: (r * 95 * vw) / 2}]} />
          ))}
        </View>
      )}
      <Image source={require('../assets/image/shade.png')} style={StyleSheet.absoluteFill} resizeMode="stretch" />
    </View>
  );
}

type PhotoFn = (id?: string) => string | undefined;

function Portrait({src, size = 'md'}: {src?: string | undefined; size?: 'sm' | 'md' | 'lg'}) {
  if (!src) return null;
  const d = {sm: 5, md: 8, lg: 12}[size] * vw;
  return <Image source={{uri: src}} style={[s.portrait, {width: d, height: d, borderRadius: d / 2}]} />;
}

export function TodayScreen({board, h, moment, photo, highlight, accent}: {board: TodayBoard; h: Household; moment?: Moment; photo: PhotoFn; highlight: number; accent: string}) {
  const greeting = board.partOfDay === 'night' ? 'Good evening' : `Good ${board.partOfDay}`;
  const showMoment = moment && !board.next?.soon;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!highlight) return;
    glow.setValue(0);
    Animated.sequence([
      Animated.timing(glow, {toValue: 1, duration: 700, useNativeDriver: true}),
      Animated.timing(glow, {toValue: 0, duration: 1700, useNativeDriver: true}),
    ]).start();
  }, [highlight]);
  return (
    <View style={s.today}>
      <View style={s.todayMain}>
        <View style={s.when}>
          <Animated.View style={[s.whenGlow, {opacity: glow}]} />
          <T style={s.greeting}>
            {greeting}, {h.person.name}
          </T>
          <T style={s.dayname}>{board.dayName}</T>
          <T style={[s.part, {color: accent}]}>{board.partOfDay}</T>
          <T style={s.date}>{board.dateLine}</T>
          <Text style={s.clock}>{board.clock}</Text>
        </View>
        <View style={s.side}>
          {board.next ? (
            <View style={[s.next, board.next.soon && {borderColor: accent, backgroundColor: 'rgba(242, 181, 107, 0.12)'}]}>
              <T style={[s.label, {color: accent}]}>{board.next.soon ? 'SOON' : 'NEXT'}</T>
              <View style={s.nextRow}>
                <Portrait src={photo(board.next.photo)} size={board.next.soon ? 'lg' : 'md'} />
                <T style={[s.nextLine, board.next.soon ? {fontSize: 4 * vw} : {}]}>{board.next.line}</T>
              </View>
              {board.later.length > 0 && !board.next.soon && <T style={s.later}>Later: {board.later.join('. ')}</T>}
            </View>
          ) : (
            <View style={s.next}>
              <T style={[s.nextLine, {fontWeight: 'normal', color: INK_SOFT}]}>A quiet day at home.</T>
            </View>
          )}
          {showMoment && (
            <Fade k={moment.id} ms={1600} style={s.moment}>
              <Image source={{uri: photo(moment.photo)}} style={s.momentImg} />
              <T style={s.caption} tail={moment.story ? <Text style={[s.hint, {fontFamily: REGULAR}]}>{'  '}Press OK to hear the story.</Text> : undefined}>
                {moment.caption}
              </T>
            </Fade>
          )}
        </View>
      </View>
      {board.done.length > 0 && <T style={s.done}>{board.done.join('  ·  ')}</T>}
    </View>
  );
}

export function AnswerScreen({answer, heard, photo}: {answer: Answer; heard: string; photo: PhotoFn}) {
  const src = photo(answer.photo);
  return (
    <View style={s.overlay}>
      <T style={s.heard}>“{heard}”</T>
      <View style={s.row}>
        {src && <Image source={{uri: src}} style={s.answerPhoto} />}
        <T style={s.answerText}>{answer.text}</T>
      </View>
      <T style={s.attribution}>{answer.attribution}</T>
    </View>
  );
}

export function DoorScreen({card, h, photo, accent}: {card: DoorCard; h: Household; photo: PhotoFn; accent: string}) {
  const visitor = memberById(h, card.visitor);
  const snap = photo(card.snapshot);
  return (
    <View style={[s.overlay, {backgroundColor: '#1b2330'}]}>
      <T style={[s.label, s.overlayLabel, {color: accent}]}>AT THE DOOR</T>
      <View style={s.row}>
        {snap ? <Image source={{uri: snap}} style={s.doorSnapshot} /> : <View style={s.doorSnapshot} />}
        <View style={s.doorLines}>
          {visitor && <Portrait src={photo(visitor.photo)} size="lg" />}
          {card.lines.map((l, i) => (
            <T key={i} style={i === 0 ? s.doorFirst : [s.doorLine, card.kind === 'unexpected' && i === 1 ? {color: accent} : {}]}>
              {l}
            </T>
          ))}
        </View>
      </View>
    </View>
  );
}

export function MessageScreen({message, h, photo, accent}: {message: Message; h: Household; photo: PhotoFn; accent: string}) {
  const from = memberById(h, message.from);
  return (
    <View style={s.overlay}>
      <T style={[s.label, s.overlayLabel, {color: accent}]}>{`A MESSAGE FROM ${(from?.name ?? 'your family').toUpperCase()}`}</T>
      <View style={s.row}>
        <Portrait src={photo(from?.photo)} size="lg" />
        <T style={s.messageText}>{message.text}</T>
      </View>
    </View>
  );
}

export function StoryScreen({moment, photo, h, accent}: {moment: Moment; photo: PhotoFn; h: Household; accent: string}) {
  const by = memberById(h, moment.story?.by);
  return (
    <View style={[s.overlay, s.row]}>
      <Image source={{uri: photo(moment.photo)}} style={s.storyImg} />
      <View style={{flex: 1}}>
        <T style={[s.storyCaption, {color: accent}]}>{moment.caption}</T>
        <T style={s.storyWords}>{moment.story?.text ?? ''}</T>
        {by && <T style={s.attribution}>Told by {by.name}</T>}
      </View>
    </View>
  );
}

export function NightScreen({board, present}: {board: TodayBoard; present: boolean}) {
  if (!present) {
    return (
      <View style={s.centre}>
        <Text style={s.nightClockSmall}>{board.clock}</Text>
      </View>
    );
  }
  return (
    <View style={s.centre}>
      <T style={s.nightFirst}>{board.nightLines[0] ?? ''}</T>
      <Text style={s.nightClock}>{board.clock}</Text>
      {board.nightLines.slice(1).map((l, i) => (
        <T key={i} style={s.nightLine}>
          {l}
        </T>
      ))}
    </View>
  );
}

export function RestScreen({board}: {board: TodayBoard}) {
  // Drifts a little every minute so nothing is burnt into the panel.
  const m = Number(board.clock.split(':')[1] ?? 0);
  const x = (((m * 37) % 20) - 10) * vw;
  const y = (((m * 23) % 14) - 7) * vh;
  return (
    <View style={[s.centre, {transform: [{translateX: x}, {translateY: y}]}]}>
      <T style={s.restDay}>{board.headline}</T>
      <Text style={s.restClock}>{board.clock}</Text>
    </View>
  );
}

export function Loading({text}: {text: string}) {
  return (
    <View style={s.centre}>
      <T style={s.brand}>{text}</T>
    </View>
  );
}

export function Status({online}: {online: boolean}) {
  return online ? null : (
    <View style={s.status}>
      <T style={s.offline}>offline</T>
    </View>
  );
}

const shadow = {shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3 * vw, shadowOffset: {width: 0, height: vw}};

const s = StyleSheet.create({
  glow: {position: 'absolute', left: -20 * vw, top: -40 * vh - (95 * vw - 95 * vh) / 2, width: 95 * vw, height: 95 * vw, alignItems: 'center', justifyContent: 'center', transform: [{scaleY: vh / vw}]},
  ring: {position: 'absolute'},
  portrait: {borderWidth: 0.3 * vw, borderColor: 'rgba(255, 255, 255, 0.85)'},

  today: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, paddingTop: 6 * vh, paddingRight: 5 * vw, paddingBottom: 5 * vh, paddingLeft: 6 * vw},
  todayMain: {flex: 1, flexDirection: 'row'},
  when: {width: '54%', justifyContent: 'center'},
  whenGlow: {position: 'absolute', left: -2 * vw, right: 2 * vw, top: 8 * vh, bottom: 8 * vh, borderRadius: 3 * vw, backgroundColor: 'rgba(255, 255, 255, 0.10)'},
  greeting: {fontSize: 3.1 * vw, color: INK_SOFT, marginBottom: 2.4 * vh},
  dayname: {fontSize: 12.5 * vw, fontWeight: '700', color: INK, lineHeight: 12.5 * vw * 1.02, letterSpacing: -0.25 * vw},
  part: {fontSize: 5.6 * vw, marginTop: 1.4 * vh},
  date: {fontSize: 4.6 * vw, color: INK, marginTop: 2.2 * vh},
  clock: {fontSize: 4.2 * vw, color: INK_SOFT, marginTop: 2.2 * vh},
  side: {flex: 1, justifyContent: 'center'},
  next: {backgroundColor: PANEL, borderWidth: 1, borderColor: PANEL_EDGE, borderRadius: 2.2 * vw, paddingVertical: 3.2 * vh, paddingHorizontal: 2.4 * vw},
  label: {fontSize: 2 * vw, letterSpacing: 0.24 * vw, marginBottom: 1.6 * vh},
  nextRow: {flexDirection: 'row', alignItems: 'center', gap: 1.8 * vw},
  nextLine: {flex: 1, fontSize: 3.4 * vw, lineHeight: 3.4 * vw * 1.18, fontWeight: '700', color: INK},
  later: {fontSize: 2.2 * vw, color: INK_SOFT, marginTop: 2 * vh},
  moment: {marginTop: 3.5 * vh},
  momentImg: {width: '100%', height: 34 * vh, borderRadius: 1.8 * vw, ...shadow},
  caption: {fontSize: 2.3 * vw, lineHeight: 2.3 * vw * 1.25, color: INK, marginTop: 1.4 * vh},
  hint: {fontSize: 1.7 * vw, color: INK_FAINT},
  done: {fontSize: 2.2 * vw, color: INK_SOFT, paddingTop: 2 * vh, borderTopWidth: 1, borderTopColor: PANEL_EDGE},

  overlay: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, paddingVertical: 7 * vh, paddingHorizontal: 6 * vw, justifyContent: 'center'},
  overlayLabel: {fontSize: 2.2 * vw, letterSpacing: 0.3 * vw, marginBottom: 4 * vh},
  row: {flexDirection: 'row', alignItems: 'center', gap: 4 * vw},
  heard: {fontSize: 2.4 * vw, color: INK_FAINT, marginBottom: 4 * vh},
  answerPhoto: {width: 30 * vw, height: 44 * vh, borderRadius: 2 * vw, ...shadow},
  answerText: {flex: 1, fontSize: 5 * vw, lineHeight: 5 * vw * 1.2, fontWeight: '700', color: INK},
  attribution: {marginTop: 5 * vh, fontSize: 2 * vw, color: INK_FAINT},
  doorSnapshot: {width: 44 * vw, height: 56 * vh, borderRadius: 2 * vw, backgroundColor: 'rgba(255, 255, 255, 0.06)', ...shadow},
  doorLines: {flex: 1, gap: 3 * vh},
  doorFirst: {fontSize: 4.8 * vw, lineHeight: 4.8 * vw * 1.15, fontWeight: '700', color: INK},
  doorLine: {fontSize: 3.4 * vw, lineHeight: 3.4 * vw * 1.25, color: INK},
  messageText: {flex: 1, fontSize: 4.2 * vw, lineHeight: 4.2 * vw * 1.25, color: INK},
  storyImg: {width: 48 * vw, height: 70 * vh, borderRadius: 2 * vw, ...shadow},
  storyCaption: {fontSize: 2.6 * vw, marginBottom: 3 * vh},
  storyWords: {fontSize: 3.6 * vw, lineHeight: 3.6 * vw * 1.3, color: INK},

  centre: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 2.6 * vh},
  nightFirst: {fontSize: 5.4 * vw, fontWeight: '700', color: '#a88c68'},
  nightClock: {fontSize: 4 * vw, color: '#a88c68', opacity: 0.8},
  nightLine: {fontSize: 3.6 * vw, color: '#a88c68'},
  nightClockSmall: {fontSize: 2.2 * vw, color: 'rgba(155, 130, 99, 0.35)'},
  restDay: {fontSize: 4 * vw, color: INK_SOFT},
  restClock: {fontSize: 7 * vw, color: INK_SOFT},
  brand: {fontSize: 5 * vw, color: INK_SOFT},
  status: {position: 'absolute', right: 2 * vw, bottom: 2 * vh},
  offline: {fontSize: 1.2 * vw, color: INK_FAINT},
});
