"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

// 서버 시각 − 기기 시각(ms). 기기 시계가 틀려도 서버 기준으로 동작하도록 보정한다.
let offset = 0;
let syncing = false;
let synced = false;
const listeners = new Set<() => void>();

// getSnapshot은 같은 시각대에서 반드시 같은 참조를 돌려줘야 한다.
// 매번 new Date()를 만들면 React가 무한 재렌더로 판단한다.
let cache: { bucket: number; value: Date } = { bucket: -1, value: new Date(0) };

/** 서버 시각으로 보정한 현재 epoch(ms). */
export function serverEpochMs(): number {
  return Date.now() + offset;
}

/** 서버 시각으로 보정한 현재 시각. 시간 계산은 이걸 써야 서버와 어긋나지 않는다. */
export function serverNow(): Date {
  return new Date(serverEpochMs());
}

function getSnapshot(): Date {
  const t = serverEpochMs();
  const bucket = Math.floor(t / TICK_MS);
  if (bucket !== cache.bucket) cache = { bucket, value: new Date(t) };
  return cache.value;
}

// 서버에는 "지금"이 없다. null을 주면 클라이언트가 붙을 때까지 스켈레톤이 뜬다.
function getServerSnapshot(): Date | null {
  return null;
}

function syncOnce() {
  if (syncing || synced) return;
  syncing = true;
  const t0 = Date.now();
  fetch("/api/time", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => {
      const t1 = Date.now();
      const server = Number(j?.now);
      if (!Number.isFinite(server)) return;
      // 왕복 지연의 절반을 보정해 응답 시점의 서버 시각을 추정한다.
      offset = server + (t1 - t0) / 2 - t1;
      synced = true;
      cache = { bucket: -1, value: new Date(0) }; // 다음 스냅샷 강제 재계산
      listeners.forEach((l) => l());
    })
    .catch(() => {})
    .finally(() => {
      syncing = false;
    });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  syncOnce();
  const id = setInterval(onChange, 1000);
  return () => {
    listeners.delete(onChange);
    clearInterval(id);
  };
}

/** 30초마다 갱신되는 현재 시각(서버 시각 기준). 서버 렌더에서는 null. */
export function useNow(): Date | null {
  return useSyncExternalStore<Date | null>(subscribe, getSnapshot, getServerSnapshot);
}
