import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// web-push는 Node 런타임 필요(Edge 불가).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushEvent = { user_id: string; kind: string; title: string; body: string };
type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string };

/**
 * pg_cron이 1분마다 호출한다(x-cron-secret 헤더로 보호).
 * claim_due_push_events()로 지금 보낼 이벤트를 가져와, 각 사용자의 기기로 웹푸시를 보낸다.
 * 만료된 구독(404/410)은 정리한다.
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.PUSH_RUN_SECRET || secret !== process.env.PUSH_RUN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:swmaestro.busan@gmail.com";
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!vapidPublic) missing.push("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  if (!vapidPrivate) missing.push("VAPID_PRIVATE_KEY");
  if (missing.length > 0) {
    // 값이 아니라 '어떤 키가 비었는지' 이름만 알려 준다(디버그용, 안전).
    return NextResponse.json({ error: "missing env", missing }, { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await supabase.rpc("claim_due_push_events");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const events = (data ?? []) as PushEvent[];
  if (events.length === 0) return NextResponse.json({ events: 0, sent: 0 });

  const userIds = [...new Set(events.map((e) => e.user_id))];
  const { data: subData } = await supabase
    .from("push_subscription")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  const subs = (subData ?? []) as Sub[];

  const byUser = new Map<string, Sub[]>();
  for (const s of subs) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }

  let sent = 0;
  const dead: string[] = [];
  for (const ev of events) {
    const payload = JSON.stringify({ title: ev.title, body: ev.body, kind: ev.kind, url: "/" });
    for (const s of byUser.get(ev.user_id) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }
  }

  if (dead.length > 0) {
    await supabase.from("push_subscription").delete().in("endpoint", dead);
  }

  return NextResponse.json({ events: events.length, sent, pruned: dead.length });
}
