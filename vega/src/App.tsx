/**
 * Mantel for Vega OS.
 *
 * The TV side of Mantel as a native React Native app, with the same behaviour
 * as the Fire OS app's interface (apps/tv): the shared core computes the day,
 * matches questions and resolves the family's answers on the TV itself; the
 * household server supplies the plan, the door cards and the recordings.
 *
 * The remote: OK reads the day aloud, or plays a photo's story; Left and Right
 * browse photos; Back closes whatever is on screen.
 *
 * Vega gives apps no camera and no speech recognition, so on Vega the person
 * is treated as present. A demo server can stand in for both (a heard sentence,
 * a presence change: `POST /api/dev/tv/input`), which is how the Vega Virtual
 * Device, with neither, is driven.
 */

import * as React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {useHideSplashScreenCallback, usePreventHideSplashScreen, useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {Matcher, UNKNOWN_RESPONSE, addressed, computeToday, isQuestion, nextMessage, resolveAnswer, type Answer, type DoorCard, type Household, type Message, type Moment} from './core';
import {SERVER, TOKEN} from './config';
import {Connection, type TvState} from './connection';
import {AnswerScreen, Backdrop, DoorScreen, Fade, Loading, MessageScreen, NightScreen, RestScreen, Status, StoryScreen, THEME, TodayScreen, mix, type Mode} from './screens';
import {playMedia, say, stopVoice} from './voice';

type Overlay =
  | {kind: 'answer'; answer: Answer; heard: string}
  | {kind: 'unknown'; heard: string}
  | {kind: 'door'; card: DoorCard}
  | {kind: 'message'; message: Message}
  | {kind: 'story'; moment: Moment};

const REST_AFTER_MS = 5 * 60_000;
const MOMENT_EVERY_MS = 45_000;
const KEY_DOWN = 0;

export const App = () => {
  usePreventHideSplashScreen();
  const hide = useHideSplashScreenCallback();
  useEffect(() => hide(), []);
  if (!SERVER || !TOKEN) return <Loading text="This TV is not connected to a family yet." />;
  return <Screen />;
};

function Screen() {
  const [state, setState] = useState<TvState>();
  const [online, setOnline] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [present, setPresent] = useState(true);
  const [absentSince, setAbsentSince] = useState<number | undefined>();
  const [overlay, setOverlay] = useState<Overlay | undefined>();
  const [momentIndex, setMomentIndex] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const dismissedDoor = useRef<string | undefined>(undefined);
  const lastShown = useRef(new Map<string, number>());
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const conn = useMemo(
    () =>
      new Connection(
        {server: SERVER, token: TOKEN},
        s => {
          setState(s);
          setNowMs(Date.now());
        },
        setOnline,
      ),
    [],
  );

  useEffect(() => {
    void conn.start();
    return () => conn.stop();
  }, [conn]);

  const now = conn.now();
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const h = state?.household;
  const board = useMemo(() => (h ? computeToday(h, now) : undefined), [h, Math.floor(now / 60_000)]);
  const matcher = useMemo(() => (h ? new Matcher(h, h.topics) : undefined), [h]);
  const moments = useMemo(() => {
    const all = h?.moments ?? [];
    return board?.mode === 'evening' ? all.filter(m => m.calm) : all;
  }, [h, board?.mode]);
  const moment = moments.length ? moments[momentIndex % moments.length] : undefined;

  const closeOverlay = useCallback(() => {
    if (overlayTimer.current !== undefined) clearTimeout(overlayTimer.current);
    setOverlay(o => {
      if (o?.kind === 'door') dismissedDoor.current = o.card.id;
      return undefined;
    });
    stopVoice();
  }, []);

  const showFor = useCallback((o: Overlay, seconds: number) => {
    if (overlayTimer.current !== undefined) clearTimeout(overlayTimer.current);
    setOverlay(o);
    overlayTimer.current = setTimeout(() => setOverlay(cur => (cur === o ? undefined : cur)), seconds * 1000);
  }, []);

  // A question: match it, answer with the family's words, and record it.
  const onHeard = useCallback(
    (text: string) => {
      if (!h || !matcher || !board) return;
      if (!addressed(text, h.settings.listening)) return;
      if (overlay?.kind === 'door' || overlay?.kind === 'message') return;
      const m = matcher.match(text);
      if (m.kind === 'answer') {
        const answer = resolveAnswer(h, m.topic, conn.now());
        conn.send('question', {text, topicId: m.topic.id, score: Number(m.score.toFixed(3))});
        showFor({kind: 'answer', answer, heard: text}, h.settings.answerSeconds);
        void say(conn, {text: answer.speech, audio: answer.audio});
      } else if (m.reason !== 'not-a-question' && m.reason !== 'empty') {
        conn.send('question', {text, topicId: null, score: Number((m.best?.score ?? 0).toFixed(3))});
        showFor({kind: 'unknown', heard: text}, Math.max(12, h.settings.answerSeconds - 5));
        setHighlight(x => x + 1);
        void say(conn, {text: `${UNKNOWN_RESPONSE.speech} ${board.speech}${board.next ? ` ${board.next.speech}.` : ''}`});
      }
    },
    [h, matcher, board, overlay, conn, showFor],
  );

  const onPresence = useCallback(
    (p: boolean) => {
      setPresent(was => {
        if (was !== p) conn.send(p ? 'presence.start' : 'presence.end');
        return p;
      });
      setAbsentSince(p ? undefined : Date.now());
    },
    [conn],
  );

  // Demo servers stand in for the camera and microphone this platform does not give apps.
  // Whatever input was waiting when the TV connected is history, not input.
  const devInput = state?.devInput;
  const seenDevInput = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const id = devInput?.id ?? '';
    if (seenDevInput.current === null) {
      seenDevInput.current = id;
      return;
    }
    if (!devInput || seenDevInput.current === id) return;
    seenDevInput.current = id;
    if (devInput.present !== undefined) onPresence(devInput.present);
    if (devInput.heard) onHeard(devInput.heard);
  }, [Boolean(state), devInput?.id]);

  // The doorbell: a new card interrupts everything, once.
  const card = state?.doorCard;
  useEffect(() => {
    // The server's state is the truth: a card it no longer holds (cleared, or state from before a restart) closes.
    if (!card) {
      setOverlay(o => (o?.kind === 'door' ? undefined : o));
      return;
    }
    if (dismissedDoor.current === card.id) return;
    const remaining = Date.parse(card.expiresAt) - conn.now();
    if (remaining <= 0) return;
    // The same card again (its snapshot arrived), or a newer one: either way it is the one to show.
    setOverlay({kind: 'door', card});
    if (overlayTimer.current !== undefined) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => {
      dismissedDoor.current = card.id;
      setOverlay(o => (o?.kind === 'door' ? undefined : o));
    }, remaining);
  }, [card?.id, card?.snapshot]);
  useEffect(() => {
    if (card && dismissedDoor.current !== card.id) void say(conn, {text: card.speech});
  }, [card?.id]);

  // Family messages play when the person is in the room.
  useEffect(() => {
    if (!h || overlay || !present) return;
    const m = nextMessage(h, conn.now(), present);
    if (!m) return;
    setOverlay({kind: 'message', message: m});
    void playMedia(conn, conn.mediaUrl(m.media)).then(() => {
      conn.send('message.played', {id: m.id, from: m.from});
      setTimeout(() => setOverlay(o => (o?.kind === 'message' && o.message.id === m.id ? undefined : o)), 4000);
    });
  }, [h, present, Math.floor(nowMs / 30_000), overlay?.kind]);

  // Moments rotate slowly while the person is here and nothing else is on screen.
  useEffect(() => {
    if (!present || overlay || moments.length < 2) return;
    const t = setInterval(() => setMomentIndex(i => i + 1), MOMENT_EVERY_MS);
    return () => clearInterval(t);
  }, [present, overlay, moments.length]);
  useEffect(() => {
    if (!moment || !present || overlay) return;
    const last = lastShown.current.get(moment.id) ?? 0;
    if (Date.now() - last > 10 * 60_000) {
      lastShown.current.set(moment.id, Date.now());
      conn.send('moment.shown', {id: moment.id});
    }
  }, [moment?.id, present, overlay]);

  // The remote: OK plays a story or reads the day; Left and Right browse photos.
  const onKey = useRef<(e: HWEvent) => void>(() => {});
  onKey.current = (e: HWEvent) => {
    if (e.eventKeyAction !== KEY_DOWN || !h || !board) return;
    // The remote's OK arrives as 'select'; a keyboard's Enter as 'enter'.
    const ok = e.eventType === 'select' || e.eventType === 'enter';
    if (overlay) {
      if (ok) closeOverlay();
      return;
    }
    if (e.eventType === 'right') setMomentIndex(i => i + 1);
    else if (e.eventType === 'left') setMomentIndex(i => i - 1 + Math.max(1, moments.length));
    else if (ok) {
      if (moment?.story && !board.next?.soon) {
        showFor({kind: 'story', moment}, 40);
        conn.send('story.played', {id: moment.id});
        void say(conn, {text: moment.story.text, audio: moment.story.audio});
      } else {
        void say(conn, {text: `${board.speech}${board.next ? ` ${board.next.speech}.` : ''}`});
      }
    }
  };
  useTVEventHandler(e => onKey.current(e));

  // Back closes what is on screen. Mantel is the TV's home in a care setting, so Back never leaves it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeOverlay();
      return true;
    });
    return () => sub.remove();
  }, [closeOverlay]);

  const resting = !present && absentSince !== undefined && Date.now() - absentSince > REST_AFTER_MS;
  const mode: Mode = board?.mode ?? 'day';
  const accent = THEME[mode].accent;
  const sky = h ? skyColour(now, h) : '#7fb2e0';

  if (!h || !board) {
    return (
      <View style={styles.screen}>
        <Backdrop mode="day" sky={sky} />
        <Loading text="Mantel" />
      </View>
    );
  }

  const photo = (id?: string) => conn.mediaUrl(id);
  let key: string;
  let body: React.ReactElement;
  if (overlay?.kind === 'door') {
    key = `door-${overlay.card.id}`;
    body = <DoorScreen card={overlay.card} h={h} photo={photo} accent={accent} />;
  } else if (overlay?.kind === 'message') {
    key = `message-${overlay.message.id}`;
    body = <MessageScreen message={overlay.message} h={h} photo={photo} accent={accent} />;
  } else if (mode === 'night') {
    key = `night-${present}`;
    body = <NightScreen board={board} present={present} />;
  } else if (overlay?.kind === 'answer') {
    key = `answer-${overlay.answer.topicId}-${overlay.heard}`;
    body = <AnswerScreen answer={overlay.answer} heard={asWritten(overlay.heard, h)} photo={photo} />;
  } else if (overlay?.kind === 'story') {
    key = `story-${overlay.moment.id}`;
    body = <StoryScreen moment={overlay.moment} photo={photo} h={h} accent={accent} />;
  } else if (resting) {
    key = 'rest';
    body = <RestScreen board={board} />;
  } else {
    key = 'today';
    body = <TodayScreen board={board} h={h} moment={moment} photo={photo} highlight={highlight} accent={accent} />;
  }

  return (
    <View style={styles.screen}>
      <Backdrop mode={mode} sky={sky} />
      <Fade k={key} style={StyleSheet.absoluteFill}>
        {body}
      </Fade>
      <Status online={online} />
    </View>
  );
}

/** What was heard, as a person would write it: a capital first letter, capitals on the household's names, a question mark. */
function asWritten(heard: string, h: Household): string {
  const names = [...h.members.flatMap(m => [m.name, ...(m.aliases ?? [])]), ...h.person.others.flatMap(o => [o.name, ...(o.aliases ?? [])])];
  let s = heard.trim();
  for (const n of names) s = s.replace(new RegExp(`\\b${n.toLowerCase()}\\b`, 'g'), n.charAt(0).toUpperCase() + n.slice(1));
  s = s.replace(/^./, c => c.toUpperCase());
  return /[?.!]$/.test(s) || !isQuestion(s) ? s : `${s}?`;
}

/** The sky's colour at this hour where the person lives. */
function skyColour(now: number, h: Household): string {
  const p = new Intl.DateTimeFormat('en-US', {timeZone: h.settings.timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23'}).formatToParts(new Date(now));
  const hour = Number(p.find(x => x.type === 'hour')?.value ?? 12) + Number(p.find(x => x.type === 'minute')?.value ?? 0) / 60;
  const stops: [number, string][] = [
    [0, '#0b1020'], [5, '#1b2240'], [6.5, '#e8a86b'], [8, '#9cc3e6'], [12, '#7fb2e0'],
    [16, '#8fb4d8'], [18, '#e59a6a'], [19.5, '#7a4a6e'], [21, '#1c1b33'], [24, '#0b1020'],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (hour >= a && hour < b) return mix(ca, cb, (hour - a) / (b - a));
  }
  return stops[0]![1];
}

const styles = StyleSheet.create({
  screen: {flex: 1, overflow: 'hidden', backgroundColor: '#0d1118'},
});
