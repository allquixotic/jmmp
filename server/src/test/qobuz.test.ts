// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import {
  createQobuzPlaylist,
  deriveQobuzSigningSecret,
  exchangeOAuthCode,
  extractQobuzSigningSecret,
  login,
  mapQobuzSearchResponse,
  oauthCodeFromParams,
  oauthSignInUrl,
  QOBUZ_OAUTH_PRIVATE_KEY,
  QOBUZ_PRODUCTION_SIGNING_SECRET,
  qobuzRequestSignature,
  QobuzHttpError,
  syncQobuzPlaylistOrder,
  syncQobuzPlaylistTracks,
} from "../sources/qobuz.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockQobuzFetch(
  loginResponder: (input: RequestInfo | URL, init?: RequestInit) => Response
): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://play.qobuz.com/") {
      return Promise.resolve(
        new Response('<script src="/resources/test/bundle.js"></script>')
      );
    }
    if (url === "https://play.qobuz.com/resources/test/bundle.js") {
      return Promise.resolve(
        new Response(
          'production:{api:{appId:"123456789",appSecret:"0123456789abcdef0123456789abcdef"}'
        )
      );
    }
    if (url === "https://www.qobuz.com/api.json/0.2/user/login") {
      return Promise.resolve(loginResponder(input, init));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }) as typeof fetch;
}

describe("qobuz search mapping", () => {
  test("maps Qobuz track search results into playable jmmp tracks", () => {
    const result = mapQobuzSearchResponse(
      {
        tracks: {
          items: [
            {
              id: 123,
              title: "Track One",
              duration: 185,
              track_number: 2,
              media_number: 1,
              maximum_sampling_rate: 96,
              maximum_bit_depth: 24,
              performer: { name: "Artist One" },
              album: {
                id: "alb-1",
                title: "Album One",
                release_date_original: "2024-01-19",
                artist: { name: "Album Artist" },
                image: { small: "https://img.example/cover.jpg" },
              },
            },
          ],
        },
      },
      7
    );

    expect(result.tracks[0]).toMatchObject({
      sourceId: 7,
      sourceTrackId: "123",
      title: "Track One",
      artist: "Artist One",
      album: "Album One",
      durationMs: 185_000,
      codec: "flac",
      sampleRate: 96_000,
      bitDepth: 24,
    });
    expect(result.albums[0]?.title).toBe("Album One");
    expect(result.artists[0]?.name).toBe("Artist One");
  });

  test("uses Qobuz image URLs as art references", () => {
    const result = mapQobuzSearchResponse(
      {
        albums: {
          items: [
            {
              id: "alb-1",
              title: "Album One",
              artist: { name: "Album Artist" },
              image: { large: "https://static.qobuz.com/cover.jpg" },
            },
          ],
        },
      },
      7
    );

    expect(result.albums[0]?.artHash).toBe("https://static.qobuz.com/cover.jpg");
  });
});

describe("qobuz login", () => {
  test("extracts the current web-player signing seed", async () => {
    expect(
      deriveQobuzSigningSecret(
        "YWJiMjEzNjQ5NDVjMDU4MzMwOTY2N2",
        "QxM2NhM2Q5M2E=YmFhMDRlOTU2OD",
        "E4NDM4ZGIzNTVlMjZlNjM1M2Y0ZTc="
      )
    ).toBe("abb21364945c0583309667d13ca3d93a");

    const bundleSnippet =
      'c.initialization=function(){var r=window.__ENVIRONMENT__;return"recette"===r?c.initialSeed("x",window.utimezone.london):c.initialSeed("YWJiMjEzNjQ5NDVjMDU4MzMwOTY2N2",window.utimezone.berlin)};' +
      'name:"Europe/Berlin",info:"QxM2NhM2Q5M2E=YmFhMDRlOTU2OD",extras:"E4NDM4ZGIzNTVlMjZlNjM1M2Y0ZTc="';
    expect(extractQobuzSigningSecret(bundleSnippet)).toBe(
      "abb21364945c0583309667d13ca3d93a"
    );
  });

  test("generates Qobuz request signatures with sorted parameters", async () => {
    await expect(
      qobuzRequestSignature(
        "/track/getFileUrl",
        { track_id: "3554685", format_id: "27", intent: "stream" },
        "1700000000",
        "abb21364945c0583309667d13ca3d93a"
      )
    ).resolves.toBe("bc705f6001e51d288587438c7f472ccb");
  });

  test("builds the current web-player OAuth sign-in URL", () => {
    const url = new URL(
      oauthSignInUrl("123456789", "https://jmmp.example/api/sources/qobuz/oauth/callback/state")
    );
    expect(url.origin).toBe("https://www.qobuz.com");
    expect(url.pathname).toBe("/signin/oauth");
    expect(url.searchParams.get("ext_app_id")).toBe("123456789");
    expect(url.searchParams.get("redirect_url")).toBe(
      "https://jmmp.example/api/sources/qobuz/oauth/callback/state"
    );
  });

  test("accepts Qobuz's localized OAuth code parameter", () => {
    expect(oauthCodeFromParams(new URLSearchParams("code=plain"))).toBe("plain");
    expect(oauthCodeFromParams(new URLSearchParams("code_autorisation=fr"))).toBe("fr");
    expect(oauthCodeFromParams(new URLSearchParams("code_authorisation=uk"))).toBe("uk");
    expect(oauthCodeFromParams(new URLSearchParams("code_authorization=us"))).toBe("us");
  });

  test("exchanges an OAuth code and loads authenticated user details", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://www.qobuz.com/api.json/0.2/oauth/callback")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "oauth-token", user_id: 42 }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url === "https://www.qobuz.com/api.json/0.2/user/login") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: { id: 42, email: "person@example.com" },
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    const result = await exchangeOAuthCode("code-1", QOBUZ_OAUTH_PRIVATE_KEY, {
      appId: "123456789",
      appSecret: "0123456789abcdef0123456789abcdef",
    });

    expect(result).toMatchObject({
      userAuthToken: "oauth-token",
      userId: "42",
      email: "person@example.com",
      appId: "123456789",
      appSecret: "0123456789abcdef0123456789abcdef",
    });

    const callback = new URL(calls[0]!.url);
    expect(callback.pathname).toBe("/api.json/0.2/oauth/callback");
    expect(callback.searchParams.get("code")).toBe("code-1");
    expect(callback.searchParams.get("private_key")).toBe(QOBUZ_OAUTH_PRIVATE_KEY);
    expect(new Headers(calls[0]!.init?.headers).get("X-App-Id")).toBe("123456789");

    const userLookupHeaders = new Headers(calls[1]!.init?.headers);
    expect(calls[1]!.init?.method).toBe("POST");
    expect(userLookupHeaders.get("X-App-Id")).toBe("123456789");
    expect(userLookupHeaders.get("X-User-Auth-Token")).toBe("oauth-token");
    expect(userLookupHeaders.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const userLookupBody = calls[1]!.init?.body as URLSearchParams;
    expect(userLookupBody.get("extra")).toBe("partner");
    expect(userLookupBody.get("device_manufacturer_id")).toBeTruthy();
  });

  test("uses the current web-player style form login request", async () => {
    let capturedInit: RequestInit | undefined;
    mockQobuzFetch((_input, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          user_auth_token: "token-1",
          user: { id: 42, email: "person@example.com" },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await login(" person@example.com ", "secret-password");

    expect(result).toMatchObject({
      userAuthToken: "token-1",
      userId: "42",
      email: "person@example.com",
      appId: "123456789",
      appSecret: QOBUZ_PRODUCTION_SIGNING_SECRET,
    });

    expect(capturedInit?.method).toBe("POST");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("X-App-Id")).toBe("123456789");
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const body = capturedInit?.body as URLSearchParams;
    expect(body.get("app_id")).toBe("123456789");
    expect(body.get("email")).toBe("person@example.com");
    expect(body.get("password")).toBe("secret-password");
    expect(body.get("device_manufacturer_id")).toBeTruthy();
  });

  test("turns Qobuz 401 responses into actionable auth errors", async () => {
    mockQobuzFetch(() => {
      return new Response(
        JSON.stringify({
          status: "error",
          code: 401,
          message: "User authentication is required. (Root=1-test)",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await login("person@example.com", "wrong-password");
      throw new Error("login unexpectedly succeeded");
    } catch (err) {
      expect(err).toBeInstanceOf(QobuzHttpError);
      expect((err as QobuzHttpError).status).toBe(401);
      expect((err as Error).message).toContain("Qobuz rejected the email/password");
      expect((err as Error).message).toContain("User authentication is required.");
      expect((err as Error).message).not.toContain("Root=");
    }
  });
});

describe("qobuz playlist sync", () => {
  test("creates Qobuz playlists with web-player form parameters", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://www.qobuz.com/api.json/0.2/playlist/create") {
        return Promise.resolve(
          new Response(JSON.stringify({ playlist: { id: "new-playlist" } }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    await expect(
      createQobuzPlaylist(
        {
          kind: "qobuz",
          userAuthToken: "token-1",
          appId: "app-1",
          appSecret: "secret-1",
          harvestedAt: 0,
        },
        "New Mix",
        mockFetch
      )
    ).resolves.toBe("new-playlist");

    const body = calls[0]!.init!.body as URLSearchParams;
    expect(calls[0]!.init?.method).toBe("POST");
    expect(new Headers(calls[0]!.init?.headers).get("X-App-Id")).toBe("app-1");
    expect(body.get("name")).toBe("New Mix");
    expect(body.get("description")).toBe("");
  });

  test("moves Qobuz playlist entries into jmmp's Qobuz-track order", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://www.qobuz.com/api.json/0.2/playlist/get")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tracks: {
                total: 3,
                items: [
                  { id: "a", playlist_track_id: "pta" },
                  { id: "b", playlist_track_id: "ptb" },
                  { id: "c", playlist_track_id: "ptc" },
                ],
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (
        url ===
        "https://www.qobuz.com/api.json/0.2/playlist/updateTracksPosition"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ updated_at: 123 }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    await syncQobuzPlaylistOrder(
      {
        kind: "qobuz",
        userAuthToken: "token-1",
        appId: "app-1",
        appSecret: "secret-1",
        harvestedAt: 0,
      },
      "playlist-1",
      ["b", "c", "a"],
      mockFetch
    );

    const posts = calls.filter(
      (call) =>
        call.url ===
        "https://www.qobuz.com/api.json/0.2/playlist/updateTracksPosition"
    );
    expect(posts).toHaveLength(2);
    expect(new Headers(posts[0]!.init?.headers).get("X-App-Id")).toBe("app-1");
    expect(new Headers(posts[0]!.init?.headers).get("X-User-Auth-Token")).toBe(
      "token-1"
    );
    expect(posts.map((post) => Object.fromEntries(post.init!.body as URLSearchParams)))
      .toEqual([
        {
          playlist_id: "playlist-1",
          playlist_track_ids: "ptb",
          insert_before: "1",
        },
        {
          playlist_id: "playlist-1",
          playlist_track_ids: "ptc",
          insert_before: "2",
        },
      ]);
  });

  test("leaves remote-only Qobuz entries in place after jmmp-ordered entries", async () => {
    const posts: URLSearchParams[] = [];
    const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.qobuz.com/api.json/0.2/playlist/get")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tracks: {
                total: 3,
                items: [
                  { id: "a", playlist_track_id: "pta" },
                  { id: "b", playlist_track_id: "ptb" },
                  { id: "remote-only", playlist_track_id: "ptr" },
                ],
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (
        url ===
        "https://www.qobuz.com/api.json/0.2/playlist/updateTracksPosition"
      ) {
        posts.push(init!.body as URLSearchParams);
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    await syncQobuzPlaylistOrder(
      {
        kind: "qobuz",
        userAuthToken: "token-1",
        appId: "app-1",
        appSecret: "secret-1",
        harvestedAt: 0,
      },
      "playlist-1",
      ["b", "a"],
      mockFetch
    );

    expect(posts.map((body) => Object.fromEntries(body))).toEqual([
      {
        playlist_id: "playlist-1",
        playlist_track_ids: "ptb",
        insert_before: "1",
      },
    ]);
  });

  test("mirrors jmmp's bound-source membership before reordering", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let getCount = 0;
    const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://www.qobuz.com/api.json/0.2/playlist/get")) {
        getCount++;
        const items =
          getCount === 1
            ? [
                { id: "a", playlist_track_id: "pta" },
                { id: "remote-only", playlist_track_id: "ptr" },
              ]
            : getCount === 2
              ? [
                  { id: "a", playlist_track_id: "pta" },
                  { id: "remote-only", playlist_track_id: "ptr" },
                  { id: "b", playlist_track_id: "ptb" },
                ]
              : [
                  { id: "a", playlist_track_id: "pta" },
                  { id: "b", playlist_track_id: "ptb" },
                ];
        return Promise.resolve(
          new Response(JSON.stringify({ tracks: { total: items.length, items } }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (
        url === "https://www.qobuz.com/api.json/0.2/playlist/addTracks" ||
        url === "https://www.qobuz.com/api.json/0.2/playlist/deleteTracks" ||
        url === "https://www.qobuz.com/api.json/0.2/playlist/updateTracksPosition"
      ) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    await syncQobuzPlaylistTracks(
      {
        kind: "qobuz",
        userAuthToken: "token-1",
        appId: "app-1",
        appSecret: "secret-1",
        harvestedAt: 0,
      },
      "playlist-1",
      ["b", "a"],
      mockFetch
    );

    const posts = calls.filter((call) => call.init?.method === "POST");
    expect(posts.map((post) => [post.url, Object.fromEntries(post.init!.body as URLSearchParams)]))
      .toEqual([
        [
          "https://www.qobuz.com/api.json/0.2/playlist/addTracks",
          { playlist_id: "playlist-1", track_ids: "b" },
        ],
        [
          "https://www.qobuz.com/api.json/0.2/playlist/deleteTracks",
          { playlist_id: "playlist-1", playlist_track_ids: "ptr" },
        ],
        [
          "https://www.qobuz.com/api.json/0.2/playlist/updateTracksPosition",
          {
            playlist_id: "playlist-1",
            playlist_track_ids: "ptb",
            insert_before: "1",
          },
        ],
      ]);
  });
});
