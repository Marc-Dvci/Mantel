import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {App} from '../src/App';
import {demoHousehold} from '../src/core';

// The real React Native for Vega, with the splash screen, remote and Back hooks stubbed. A Proxy keeps its lazy exports lazy.
jest.mock('@amazon-devices/react-native-kepler', () => {
  const actual = jest.requireActual('@amazon-devices/react-native-kepler');
  const stubs: Record<string, unknown> = {
    usePreventHideSplashScreen: () => {},
    useHideSplashScreenCallback: () => () => {},
    useTVEventHandler: () => {},
    BackHandler: {addEventListener: () => ({remove: () => {}})},
  };
  return new Proxy(actual, {get: (target, key: string) => (key in stubs ? stubs[key] : target[key])});
});

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({AudioPlayer: jest.fn(), MediaSource: jest.fn()}));

jest.mock('@amazon-devices/react-native-async-storage__async-storage', () => ({
  __esModule: true,
  default: {getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined)},
}));

describe('App', () => {
  // A Monday afternoon where the demo household lives.
  const now = new Date('2026-09-28T18:05:00Z');

  // No family message waiting, so nothing takes over the Today screen.
  const household = {...demoHousehold(now), messages: []};

  beforeEach(() => {
    let calls = 0;
    (global as unknown as {fetch: typeof fetch}).fetch = jest.fn(async (url: string) => {
      // The first state arrives at once; later long-polls wait, as the server's would.
      if (String(url).includes('/api/tv/state') && calls++ > 0) return new Promise(() => {});
      return {
        ok: true,
        json: async () => ({version: 1, serverNow: now.toISOString(), household, mediaKey: 'k', speech: false}),
      };
    }) as unknown as typeof fetch;
  });

  it('shows the day from the household server', async () => {
    render(<App />);
    expect(await screen.findByText(/Good afternoon, Margaret/)).toBeTruthy();
    expect(screen.getByText('Monday')).toBeTruthy();
    expect(screen.getByText('afternoon')).toBeTruthy();
  });
});
