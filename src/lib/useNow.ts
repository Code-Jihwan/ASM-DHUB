"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

// getSnapshot은 같은 시각대에서 반드시 같은 참조를 돌려줘야 한다.
// 매번 new Date()를 만들면 React가 무한 재렌더로 판단한다.
let cache: { bucket: number; value: Date } = { bucket: -1, value: new Date(0) };

function getSnapshot(): Date {
  const bucket = Math.floor(Date.now() / TICK_MS);
  if (bucket !== cache.bucket) cache = { bucket, value: new Date() };
  return cache.value;
}

// 서버에는 "지금"이 없다. null을 주면 클라이언트가 붙을 때까지 스켈레톤이 뜬다.
function getServerSnapshot(): Date | null {
  return null;
}

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

/** 30초마다 갱신되는 현재 시각. 서버 렌더에서는 null. */
export function useNow(): Date | null {
  return useSyncExternalStore<Date | null>(subscribe, getSnapshot, getServerSnapshot);
}
