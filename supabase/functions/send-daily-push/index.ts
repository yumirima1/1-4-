import { createClient } from "npm:@supabase/supabase-js@2";
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

function clipText(text: string, maxLength: number): string {
  const characters = Array.from(text);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join("")}…`
    : text;
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
  const weekday = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(targetDate);

  const periods: string[] = [];
  for (let period = 1; period <= 7; period++) {
    const item = schedule[String(period)];
    if (!isRecord(item)) continue;
    const subject = String(item.sub ?? "").trim();
    const detail = String(item.det ?? "").trim();
    if (subject || detail) {
      periods.push(`${period}限 ${subject || detail}`);
    }
  }
  const scheduleText = schedule.tag === "休み"
    ? "明日は休みです"
    : periods.length
    ? `時間割: ${periods.join("、")}`
    : "時間割: 登録なし";

  const assignments = submissionData
    .filter((item: unknown): item is JsonRecord =>
      isRecord(item) &&
      Number(item.month) === month &&
      Number(item.day) === day
    )
    .map((item) => String(item.title || "課題"));
  const assignmentText = assignments.length
    ? `提出物: ${assignments.join("、")}`
    : "提出物: なし";

  const url = new URL(notificationUrl);
  url.searchParams.set("show", "tomorrow");

  return {
    title: `明日の時間割・提出物（${month}/${day} ${weekday}）`,
    body: clipText(`${scheduleText} / ${assignmentText}`, 180),
    url: url.toString(),
  };
}

function isExpiredSubscriptionError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.statusCode === 404 || error.statusCode === 410;
}

if (import.meta.main) {
  Deno.serve(async (request: Request) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const cronSecret = Deno.env.get("PUSH_CRON_SECRET");
    if (
      !cronSecret ||
      request.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("PUSH_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");
    const notificationUrl = Deno.env.get("PUSH_NOTIFICATION_URL");
    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !vapidPublicKey ||
      !vapidPrivateKey ||
      !vapidSubject ||
      !notificationUrl
    ) {
      console.error(
        "One or more required push notification secrets are missing.",
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

    try {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
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
      const schedules = readJson(settingsByKey.get("schedules"), {});
      const submissions = readJson(settingsByKey.get("submissions"), []);
      const targetDate = getTomorrowInJst(new Date());
      const targetDateKey = `${targetDate.getUTCFullYear()}-${
        String(targetDate.getUTCMonth() + 1).padStart(2, "0")
      }-${String(targetDate.getUTCDate()).padStart(2, "0")}`;
      const notification = buildNotification(
        schedules,
        submissions,
        targetDate,
        notificationUrl,
      );

      const { data: subscriptions, error: subscriptionsError } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, last_notified_for");
      if (subscriptionsError) {
        throw new Error(
          `Could not load push subscriptions: ${subscriptionsError.message}`,
        );
      }

      let sent = 0;
      let skipped = 0;
      let removed = 0;
      const failed: string[] = [];
      for (
        const subscription of (subscriptions ?? []) as PushSubscriptionRow[]
      ) {
        if (subscription.last_notified_for === targetDateKey) {
          skipped++;
          continue;
        }
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify({
              ...notification,
              icon: new URL("./icon.svg", notification.url).toString(),
            }),
            { TTL: 3600, urgency: "normal" },
          );

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
            failed.push(subscription.id);
          } else {
            sent++;
          }
        } catch (error) {
          if (isExpiredSubscriptionError(error)) {
            const { error: deleteError } = await admin
              .from("push_subscriptions")
              .delete()
              .eq("id", subscription.id);
            if (deleteError) {
              console.error(
                `Could not remove expired subscription ${subscription.id}:`,
                deleteError.message,
              );
              failed.push(subscription.id);
            } else {
              removed++;
            }
          } else {
            console.error(
              `Push delivery failed for subscription ${subscription.id}:`,
              error,
            );
            failed.push(subscription.id);
          }
        }
      }

      return Response.json({
        targetDate: targetDateKey,
        sent,
        skipped,
        removed,
        failed: failed.length,
      });
    } catch (error) {
      console.error("Daily push delivery failed:", error);
      return Response.json({ error: "Daily push delivery failed." }, {
        status: 500,
      });
    }
  });
}
