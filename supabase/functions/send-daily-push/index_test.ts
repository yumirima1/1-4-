import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildNotification, getTomorrowInJst } from "./index.ts";

Deno.test("uses the next calendar date in Japan across UTC date boundaries", () => {
  const tomorrow = getTomorrowInJst(new Date("2026-10-09T09:30:00.000Z"));
  assertEquals(tomorrow.toISOString(), "2026-10-10T00:00:00.000Z");
});

Deno.test("includes the next school day's schedule details and due submissions", () => {
  const notification = buildNotification(
    {
      "2026-10-13": {
        "1": { sub: "数学", det: "p.12" },
        "2": { sub: "国語", det: "" },
      },
    },
    [
      { title: "数学ワーク", month: "10", day: "13" },
      { title: "理科レポート", month: "10", day: "14" },
    ],
    new Date("2026-10-13T00:00:00.000Z"),
    "https://example.com/1-4-/",
  );

  assertEquals(notification.title, "明日（火）のお知らせ");
  assertStringIncludes(notification.body, "【時間割】1.数学（p.12） 2.国語");
  assertStringIncludes(notification.body, "数学ワーク");
  assertEquals(notification.body.includes("理科レポート"), false);
  assertEquals(
    notification.body.includes("\n📝【提出物】数学ワーク"),
    true,
  );
  assertEquals(new URL(notification.url).searchParams.get("show"), "tomorrow");
});

Deno.test("keeps weekend and public holiday schedules as regular school notices", () => {
  const schedules = {
    "2026-10-10": { "1": { sub: "数学", det: "" } },
    "2026-10-12": { "1": { sub: "国語", det: "" } },
  };

  for (
    const [date, subject, day] of [
      ["2026-10-10", "数学", "10"],
      ["2026-10-12", "国語", "12"],
    ]
  ) {
    const notification = buildNotification(
      schedules,
      [{ title: "提出物", month: "10", day }],
      new Date(`${date}T00:00:00.000Z`),
      "https://example.com/",
    );
    assertEquals(
      notification.title.includes("のお知らせ"),
      true,
    );
    assertStringIncludes(notification.body, `【時間割】1.${subject}`);
    assertStringIncludes(notification.body, "【提出物】提出物");
  }
});

Deno.test("sends the day-off message for the explicit rest tag", () => {
  const notification = buildNotification(
    { "2026-10-13": { tag: "休み" } },
    [],
    new Date("2026-10-13T00:00:00.000Z"),
    "https://example.com/",
  );

  assertEquals(notification.title, "明日（火）はお休み！");
  assertEquals(
    notification.body,
    "お疲れ様！明日は休みだからゆっくり休もう！✨",
  );
});

Deno.test("supports the legacy month-day timetable key on a school day", () => {
  const notification = buildNotification(
    { "10-13": { "1": { sub: "英語", det: "" } } },
    [],
    new Date("2026-10-13T00:00:00.000Z"),
    "https://example.com/",
  );

  assertEquals(notification.body, "【時間割】1.英語");
});
