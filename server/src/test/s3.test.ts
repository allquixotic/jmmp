// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { decodeXmlEntities, parseListXml } from "../sources/s3.ts";

describe("S3 list XML parsing", () => {
  test("decodes apostrophes in object keys", () => {
    const parsed = parseListXml(`
      <ListBucketResult>
        <Contents>
          <Key>music/Everyone&apos;s Song.mp3</Key>
          <Size>123</Size>
          <ETag>&quot;abc&quot;</ETag>
          <LastModified>2026-05-01T00:00:00.000Z</LastModified>
        </Contents>
      </ListBucketResult>
    `);

    expect(parsed.keys[0]).toMatchObject({
      key: "music/Everyone's Song.mp3",
      size: 123,
      etag: "abc",
    });
  });

  test("does not double decode escaped entity text", () => {
    expect(decodeXmlEntities("literal &amp;apos; text")).toBe(
      "literal &apos; text"
    );
  });

  test("decodes numeric XML entities", () => {
    expect(decodeXmlEntities("a&#39;b&#x2f;c")).toBe("a'b/c");
  });
});
