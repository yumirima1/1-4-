import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildNotification, getTomorrowInJst } from "./index.ts";

Deno.test("uses the next calendar date in Japan across UTC date boundaries", () => {
  const tomorrow = getTomorrowInJst(new Date("2026-10-09T09:30:00.000Z"));
  assertEquals(tomorrow.toISOString(), "2026-10-10T00:00:00.000Z");
});

Deno.test("includes the next day's shared schedule and due submissions", () => {
  const notification = buildNotification(
    {
      "2026-10-10": {
        "1": { sub: "数学", det: "p.12" },
        "2": { sub: "国語", det: "" },
      },
    },
    [
      { title: "数学ワーク", month: "10", day: "10" },
      { title: "理科レポート", month: "10", day: "11" },
    ],
    new Date("2026-10-10T00:00:00.000Z"),
    "https://example.com/1-4-/",
  );

  assertStringIncludes(notification.title, "10/10");
  assertStringIncludes(notification.body, "1限 数学");
  assertStringIncludes(notification.body, "数学ワーク");
  assertEquals(notification.body.includes("理科レポート"), false);
  assertEquals(new URL(notification.url).searchParams.get("show"), "tomorrow");
});

Deno.test("supports the legacy month-day timetable key", () => {
  const notification = buildNotification(
    { "10-10": { "1": { sub: "英語", det: "" } } },
    [],
    new Date("2026-10-10T00:00:00.000Z"),
    "https://example.com/",
  );

  assertStringIncludes(notification.body, "1限 英語");
});
