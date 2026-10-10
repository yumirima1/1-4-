import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type JsonRecord = Record<string, unknown>;

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_notified_for: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

function jstDateParts(
  date: Date,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function getTomorrowInJst(now: Date): Date {
  const today = jstDateParts(now);
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
}

function sanitizeAscii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

function getAsciiSecret(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (raw === undefined) return undefined;
  const value = sanitizeAscii(raw);
  if (value !== raw.trim()) {
    console.warn(
      `${name} contained non-ASCII or control characters; they were removed.`,
    );
  }
  return value || undefined;
}

function hasScheduleContent(day: unknown): boolean {
  if (!isRecord(day)) return false;
  if (typeof day.tag === "string" && day.tag.trim()) return true;
  for (let period = 1; period <= 7; period++) {
    const item = day[String(period)];
    if (
      isRecord(item) &&
      (String(item.sub ?? "").trim() || String(item.det ?? "").trim())
    ) return true;
  }
  return false;
}

function getScheduleForDate(
  schedules: JsonRecord,
  dateKey: string,
  legacyKey: string,
): JsonRecord {
  const isoDay = schedules[dateKey];
  const legacyDay = schedules[legacyKey];
  if (hasScheduleContent(isoDay) && isRecord(isoDay)) return isoDay;
  if (hasScheduleContent(legacyDay) && isRecord(legacyDay)) return legacyDay;
  if (
    Object.prototype.hasOwnProperty.call(schedules, dateKey) && isRecord(isoDay)
  ) return isoDay;
  if (
    Object.prototype.hasOwnProperty.call(schedules, legacyKey) &&
    isRecord(legacyDay)
  ) return legacyDay;
  return {};
}

export function buildNotification(
  scheduleData: unknown,
  submissionData: unknown,
  targetDate: Date,
  notificationUrl: string,
): { title: string; body: string; url: string } {
  if (!isRecord(scheduleData) || !Array.isArray(submissionData)) {
    throw new Error(
      "Schedule or submission settings are not in the expected format.",
    );
  }

  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth() + 1;
  const day = targetDate.getUTCDate();
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
  const legacyKey = `${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
  const schedule = getScheduleForDate(scheduleData, dateKey, legacyKey);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][
    targetDate.getUTCDay()
  ];
  const isDayOff = schedule.tag === "休み";

  const periods: string[] = [];
  for (let period = 1; period <= 7; period++) {
    const item = schedule[String(period)];
    if (!isRecord(item)) continue;
    const subject = String(item.sub ?? "").trim();
    const detail = String(item.det ?? "").trim();
    if (subject || detail) {
      periods.push(
        `${period}.${subject || detail}${
          subject && detail ? `（${detail}）` : ""
        }`,
      );
    }
  }

  const assignments = submissionData
    .filter((item: unknown): item is JsonRecord =>
      isRecord(item) &&
      Number(item.month) === month &&
      Number(item.day) === day
    )
    .map((item) => String(item.title || "課題").trim())
    .filter(Boolean);

  const url = new URL(notificationUrl);
  url.searchParams.set("show", "tomorrow");

  return {
    title: isDayOff
      ? `明日（${weekday}）はお休み！`
      : `明日（${weekday}）のお知らせ`,
    body: isDayOff ? "お疲れ様！明日は休みだからゆっくり休もう！✨" : [
      `【時間割】${periods.length ? periods.join(" ") : "登録なし"}`,
      ...(assignments.length ? [`📝【提出物】${assignments.join("、")}`] : []),
    ].join("\n"),
    url: url.toString(),
  };
}

function isExpiredSubscriptionError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.statusCode === 404 || error.statusCode === 410;
}

function isPushSubscriptionRow(value: unknown): value is PushSubscriptionRow {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.endpoint === "string" &&
    typeof value.p256dh === "string" &&
    typeof value.auth === "string" &&
    (typeof value.last_notified_for === "string" ||
      value.last_notified_for === null);
}

function getErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (isRecord(error)) {
    const details: Record<string, string> = {};
    for (const key of ["name", "message", "code", "details", "hint"]) {
      if (typeof error[key] === "string") details[key] = error[key];
    }
    return details;
  }
  return { message: String(error) };
}

if (import.meta.main) {
  Deno.serve(async (request: Request) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const cronSecret = getAsciiSecret("PUSH_CRON_SECRET");
    if (
      !cronSecret ||
      request.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const supabaseUrl = getAsciiSecret("SUPABASE_URL");
    const serviceRoleKey = getAsciiSecret("PUSH_SERVICE_ROLE_KEY");
    const vapidPublicKey = getAsciiSecret("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = getAsciiSecret("VAPID_PRIVATE_KEY");
    const vapidSubject = getAsciiSecret("VAPID_SUBJECT");
    const notificationUrl = getAsciiSecret("PUSH_NOTIFICATION_URL");
    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !vapidPublicKey ||
      !vapidPrivateKey ||
      !vapidSubject ||
      !notificationUrl
    ) {
      const missingConfiguration = [
        !supabaseUrl && "SUPABASE_URL",
        !serviceRoleKey && "PUSH_SERVICE_ROLE_KEY",
        !vapidPublicKey && "VAPID_PUBLIC_KEY",
        !vapidPrivateKey && "VAPID_PRIVATE_KEY",
        !vapidSubject && "VAPID_SUBJECT",
        !notificationUrl && "PUSH_NOTIFICATION_URL",
      ].filter((name): name is string => Boolean(name));
      console.error(
        `Missing required push notification configuration: ${
          missingConfiguration.join(", ")
        }`,
      );
      return Response.json({
        error: "Push notification service is not configured.",
      }, { status: 500 });
    }

    let parsedNotificationUrl: URL;
    try {
      parsedNotificationUrl = new URL(notificationUrl);
    } catch {
      return Response.json({
        error: "PUSH_NOTIFICATION_URL is not a valid URL.",
      }, { status: 500 });
    }
    if (parsedNotificationUrl.protocol !== "https:") {
      return Response.json({ error: "PUSH_NOTIFICATION_URL must use HTTPS." }, {
        status: 500,
      });
    }

    let stage = "vapid_setup";
    try {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      stage = "settings_query";
      const { data: settings, error: settingsError } = await admin
        .from("settings")
        .select("key, value")
        .in("key", ["schedules", "submissions"]);
      if (settingsError) {
        throw new Error(
          `Could not load schedule settings: ${settingsError.message}`,
        );
      }

      const settingsByKey = new Map(
        (settings ?? []).map((row) => [row.key, row.value]),
      );
      stage = "settings_parse";
      let schedules: unknown;
      let submissions: unknown;
      try {
        schedules = readJson(settingsByKey.get("schedules"), {});
        submissions = readJson(settingsByKey.get("submissions"), []);
      } catch (error) {
        console.error(
          "Could not parse schedule settings from the database:",
          error,
        );
        return Response.json(
          { error: "Schedule settings contain invalid JSON.", stage },
          { status: 500 },
        );
      }
      const targetDate = getTomorrowInJst(new Date());
      const targetDateKey = `${targetDate.getUTCFullYear()}-${
        String(targetDate.getUTCMonth() + 1).padStart(2, "0")
      }-${String(targetDate.getUTCDate()).padStart(2, "0")}`;
      stage = "notification_build";
      const notification = buildNotification(
        schedules,
        submissions,
        targetDate,
        notificationUrl,
      );

      stage = "subscriptions_query";
      const { data: subscriptions, error: subscriptionsError } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, last_notified_for");
      if (subscriptionsError) {
        console.error("Could not load push subscriptions:", subscriptionsError);
        return Response.json(
          {
            error: "Could not load push subscriptions.",
            stage,
            details: getErrorDetails(subscriptionsError),
          },
          { status: 500 },
        );
      }

      let sent = 0;
      let skipped = 0;
      let removed = 0;
      let failed = 0;
      const payload = JSON.stringify({
        ...notification,
        icon: new URL("./app-icon.png", notification.url).toString(),
      });
      for (const candidate of subscriptions ?? []) {
        if (!isPushSubscriptionRow(candidate)) {
          console.error("Skipping a push subscription with invalid row data.");
          failed++;
          continue;
        }
        const subscription = candidate;
        if (subscription.last_notified_for === targetDateKey) {
          skipped++;
          continue;
        }

        stage = "push_delivery";
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: 3600, urgency: "normal" },
          );
        } catch (error) {
          if (isExpiredSubscriptionError(error)) {
            try {
              const { error: deleteError } = await admin
                .from("push_subscriptions")
                .delete()
                .eq("id", subscription.id);
              if (deleteError) {
                console.error(
                  `Could not remove expired subscription ${subscription.id}:`,
                  deleteError.message,
                );
                failed++;
              } else {
                removed++;
              }
            } catch (deleteError) {
              console.error(
                `Could not remove expired subscription ${subscription.id}:`,
                deleteError,
              );
              failed++;
            }
          } else {
            console.error(
              `Push delivery failed for subscription ${subscription.id}:`,
              error,
            );
            failed++;
          }
          continue;
        }

        stage = "delivery_state_update";
        try {
          const { error: updateError } = await admin
            .from("push_subscriptions")
            .update({
              last_notified_for: targetDateKey,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscription.id);
          if (updateError) {
            console.error(
              `Notification sent but delivery state could not be saved for subscription ${subscription.id}:`,
              updateError.message,
            );
            failed++;
          } else {
            sent++;
          }
        } catch (error) {
          console.error(
            `Notification sent but delivery state could not be saved for subscription ${subscription.id}:`,
            error,
          );
          failed++;
        }
      }

      return Response.json({
        targetDate: targetDateKey,
        sent,
        skipped,
        removed,
        failed,
      });
    } catch (error) {
      console.error(`Daily push delivery failed during ${stage}:`, error);
      return Response.json(
        {
          error: "Daily push delivery failed.",
          stage,
          details: getErrorDetails(error),
        },
        { status: 500 },
      );
    }
  });
}
