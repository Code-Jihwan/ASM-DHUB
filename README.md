# 부산센터 개발공간 좌석 예약

48석 개발공간을 예약제로 운영하기 위한 웹앱. PC / 모바일 반응형.

## 예약 규칙

| 항목 | 값 |
| --- | --- |
| 기본 예약 | 최대 6시간 |
| 연장 | 종료 1시간 전부터, 최대 3시간, **1회만** |
| 한 예약의 최대 길이 | 9시간 (6 + 3). 이후엔 새로 예약 |
| 동시 보유 | 1인 1건 |
| 재예약 | 종료 후 즉시 가능 |
| 예약 오픈 | 사용 시작 12시간 전부터 |
| 시간 단위 | 30분 |
| 운영 | 24시간, 48석 (A/B 구역 24석씩) |

규칙은 **전부 DB에 있다.** 앱 코드는 화면을 그릴 뿐이고, 최종 판정은 PostgreSQL이 한다.
`src/lib/policy.ts`의 상수는 화면 표시용 사본이므로, 값을 바꾸면
`supabase/migrations/0001_init.sql`의 `policy` 스키마도 함께 바꿔야 한다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS v4
- Supabase (PostgreSQL + Auth + Realtime)

## 설정

### 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com)에서 프로젝트 생성 (region은 `Northeast Asia (Seoul)` 권장)
2. SQL Editor에서 `supabase/migrations/0001_init.sql` 전체를 붙여넣고 실행
3. Settings > API에서 값을 복사해 `.env.local` 작성

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

`service_role` 키는 넣지 않는다. 브라우저로 새어나가면 RLS가 통째로 무력화된다.

### 2. 로그인 방식

지금은 이메일 매직 링크다. Supabase 기본 SMTP는 **시간당 발송 수가 매우 적어 실서비스에는 못 쓴다.**
운영 전에 둘 중 하나를 해야 한다.

- Authentication > Emails에서 커스텀 SMTP 연결, 또는
- Google/Kakao OAuth 추가 (`signInWithOAuth`로 교체)

### 3. 실행

```bash
npm install
npm run dev
```

## DB 규칙 테스트

로컬 PostgreSQL이 있으면 Supabase 없이도 예약 규칙을 검증할 수 있다.

```bash
createdb dhub_test
psql -d dhub_test -f supabase/tests/00_auth_stub.sql    # auth 스키마/롤 흉내
psql -d dhub_test -f supabase/migrations/0001_init.sql
psql -d dhub_test -f supabase/tests/01_rules_test.sql   # 마지막에 "전체 통과"
```

RLS 정책은 superuser가 우회하므로 이 테스트에 포함되지 않는다.

## 설계 메모

### 겹침은 DB가 막는다

```sql
exclude using gist (seat_id with =, period with &&) where (status = 'active')
```

같은 좌석에 시간이 겹치는 예약은 존재할 수 없다. 두 사람이 같은 순간 같은 좌석을 눌러도,
연장이 뒷사람 예약을 침범해도 트랜잭션 단위로 거부된다.
그래서 `extend_reservation()`에는 겹침 검사 코드가 없다 — 제약이 대신한다.

"빈자리 확인 → 예약" 같은 코드를 앱에 짜면 그 사이에 다른 사람이 끼어드는 틈이 생긴다.
이 방식엔 그 틈이 없다.

### 날짜 개념이 없다

24시간 운영이라 "며칠의 몇 교시" 같은 게 필요 없다. 예약은 그냥 `tstzrange` 하나다.
23시-02시처럼 자정을 넘는 예약도 특별 처리 없이 동작한다.

### 남은 것

- **관리자 화면** — 예약 강제 취소, 좌석 잠금(`seat.active = false`), 이용 통계.
  지금은 SQL을 직접 쳐야 한다.
- **노쇼 처리** — 예약해놓고 안 오는 사람의 좌석이 계속 잠긴다.
- **종료 직후 재예약** — 규칙상 허용이라 빈자리면 하루 종일 이어 쓸 수 있다.
  좌석 경합이 실제로 생기면 쿨다운이나 일일 총량을 넣는 걸 검토한다.
  스키마 변경 없이 트리거만 고치면 된다.
