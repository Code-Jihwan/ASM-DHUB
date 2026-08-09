import {
  ArrowRightLeft,
  Clock,
  Coffee,
  Hand,
  LayoutGrid,
  MapPin,
  MousePointerClick,
  Sun,
  Timer,
  Undo2,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 사용 방법 페이지. 배포용 사용설명서 내용을 앱 안으로 옮긴 것이다.
 * 정적 콘텐츠라 훅이 없고, 서버 컴포넌트로 그대로 렌더된다.
 * 좌석 색 범례는 SeatMap.tsx의 LEGEND와 같은 색을 쓴다(어긋나면 안 된다).
 */

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";
const H2 = "text-lg font-black tracking-tight text-neutral-900";
const NOTE =
  "rounded-2xl bg-neutral-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-neutral-600";

/** 번호가 붙은 절차 한 줄 */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[13px] font-black text-white">
        {n}
      </span>
      <p className="pt-1 text-[15px] font-medium leading-relaxed text-neutral-700">{children}</p>
    </li>
  );
}

/** 아이콘 색. 앱 좌석 범례에 이미 쓰는 색(sky·emerald·amber)만 골라 톤을 맞춘다. */
const TONES = {
  neutral: "bg-white text-neutral-900 ring-neutral-200",
  sky: "bg-sky-50 text-sky-600 ring-sky-100",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
} as const;

/** 핵심 3가지 · 예약 관리 등에 쓰는 아이콘 + 제목 + 설명 블록 */
function Feature({
  icon: Icon,
  title,
  tone = "neutral",
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ring-1 ${TONES[tone]}`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </div>
      <p className="mt-3 text-[15px] font-black tracking-tight text-neutral-900">{title}</p>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-neutral-500">{children}</p>
    </div>
  );
}

/** 좌석 색 범례 한 칸. SeatMap.tsx의 색과 동일하게 유지한다. */
const SEAT_LEGEND: { c: string; t: string; d: string }[] = [
  { c: "border-neutral-300 bg-white shadow-sm", t: "예약 가능", d: "지금 잡을 수 있는 빈 자리" },
  { c: "border-rose-200 bg-rose-100", t: "사용 중", d: "다른 사람이 쓰는 중" },
  { c: "border-amber-400 bg-amber-100", t: "자리비움", d: "잠깐 비운 자리" },
  { c: "border-emerald-600 bg-emerald-600", t: "내 예약", d: "내가 지금 쓰는 자리" },
  { c: "border-sky-500 bg-sky-500 shadow-md", t: "선택됨", d: "예약하려고 고른 자리" },
  { c: "border-neutral-900 bg-neutral-900", t: "사용 불가", d: "점검 중이라 예약 불가" },
];

/** 예약 관리 4가지 */
const MANAGE: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Clock,
    title: "연장",
    body: "종료 1시간 전부터, 최대 3시간까지, 딱 한 번 늘릴 수 있어요(10분 단위). 더 쓰려면 끝난 뒤 새로 예약합니다.",
  },
  {
    icon: ArrowRightLeft,
    title: "자리 변경",
    body: "이용 시간은 그대로 두고 자리만 옮겨요. 옮길 빈 자리를 고르고 “이 자리로 옮기기”를 누르면 됩니다.",
  },
  {
    icon: Coffee,
    title: "자리비움",
    body: "잠깐 비울 때 눌러요. 남들에게 “비움”으로 보입니다. 예약당 2회까지, 20분 안에 “복귀했어요”를 눌러야 해요(복귀도 센터 와이파이에서).",
  },
  {
    icon: Undo2,
    title: "좌석 반납 / 예약 취소",
    body: "다 썼으면 자리를 돌려줍니다. 10분 넘게 쓰고 그만두면 “좌석 반납”, 10분 이내면 “예약 취소”로 버튼이 상황에 맞게 바뀝니다.",
  },
];

/** 규칙 요약표 */
const RULES: { k: string; v: string }[] = [
  { k: "예약 가능 시간", v: "08:00 – 20:00 · 그 외(밤·새벽)는 예약 없이 자유롭게 이용" },
  { k: "한 번 예약", v: "최대 3시간 (10분 단위)" },
  { k: "연장", v: "종료 1시간 전부터, 최대 3시간, 1회만" },
  { k: "동시 보유", v: "1인 1건" },
  { k: "자리비움", v: "예약당 2회까지 · 20분 초과 시 자동 취소" },
  { k: "좌석 반납 / 취소", v: "10분 넘게 쓰면 “좌석 반납”, 10분 이내면 “예약 취소”" },
  {
    k: "재예약 제한",
    v: "반납·자동취소한 자리는 20분간 다시 예약 불가 · 다른 자리는 즉시 가능 (10분 이내 취소는 제한 없음)",
  },
  { k: "접속", v: "센터 와이파이에서만 예약·복귀 가능" },
];

/** 자주 묻는 질문 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "예약 버튼이 안 눌려요.",
    a: "순서대로 확인하세요. ① 센터 와이파이에 연결돼 있나요? ② 지금이 08–20시인가요? ③ 이미 예약이 있진 않나요?(1인 1건) ④ 방금 반납·자동취소한 자리면 20분 재예약 제한이 있을 수 있어요 → 다른 자리로 잡아 보세요.",
  },
  {
    q: "“센터 밖”이라고 떠서 예약이 안 돼요.",
    a: "센터 와이파이가 아닌 데이터·외부 망으로 접속하면 예약이 막힙니다. 센터 와이파이에 연결한 뒤 “다시 확인”을 누르세요. 안내 문구에 지금 감지된 IP가 함께 표시되는데, 센터 안인데도 계속 막히면 그 IP를 사무국에 알려 주세요.",
  },
  {
    q: "좌석 반납과 예약 취소는 뭐가 달라요?",
    a: "동작은 같고 이름만 달라요. 10분 넘게 쓰고 자리를 돌려주면 “좌석 반납”(정상 이용), 10분 이내에 그만두면 “예약 취소”로 표시됩니다. 10분 이내 취소는 재예약 제한도 없어요.",
  },
  {
    q: "자리비움을 눌렀는데 예약이 취소됐어요.",
    a: "자리비움 후 20분 안에 “복귀했어요”를 누르지 않으면 자동 취소됩니다. 오래 비울 거면 반납·취소하고, 다시 올 때 새로 예약하는 게 좋아요.",
  },
  {
    q: "자리비움 버튼이 안 눌려요.",
    a: "자리비움은 한 예약에서 2회까지만 쓸 수 있어요. 2회를 다 쓰면 버튼이 “자리비움 횟수 소진”으로 바뀌며 비활성화됩니다. 자리를 오래 비울 거면 반납해 주세요.",
  },
  {
    q: "연장이 안 돼요.",
    a: "연장은 종료 1시간 전부터 열립니다. 아직 이르면 버튼이 나오지 않아요. 또 연장은 1회만 가능합니다(최대 3시간까지).",
  },
  {
    q: "20시가 지났는데 자리에 앉아도 되나요?",
    a: "네. 예약은 08–20시에만 필요하고, 그 외 시간(밤·새벽)은 예약 없이 자유롭게 이용하면 됩니다.",
  },
  {
    q: "이름·팀을 바꾸고 싶어요.",
    a: "이름과 팀은 직접 수정할 수 없어요. 사무국(운영자)에게 알려 주면 바꿔 드립니다.",
  },
];

export function GuidePage() {
  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header>
        <h1 className="text-[28px] font-black tracking-tighter text-neutral-900">사용 방법</h1>
        <p className="mt-1 text-sm font-bold text-neutral-500">
          자리를 예약하고 관리하는 방법을 처음부터 끝까지 정리했어요.
        </p>
      </header>

      {/* 핵심 3가지 */}
      <section className={CARD}>
        <h2 className={H2}>먼저, 이 3가지만 기억하세요</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Feature icon={Wifi} title="센터 안에서만 예약" tone="sky">
            센터 와이파이에 연결돼 있어야 예약·복귀 버튼이 눌립니다. 집·밖에서는 화면 확인만 됩니다.
          </Feature>
          <Feature icon={Clock} title="지금부터, 최대 3시간" tone="amber">
            미리 잡아두는 방식이 아니라 지금 바로 시작합니다. 한 번에 최대 3시간까지 예약하고, 필요하면
            3시간 더 연장할 수 있습니다. 운영 시간은 08–20시입니다.
          </Feature>
          <Feature icon={LayoutGrid} title="한 번에 한 자리" tone="emerald">
            동시에 1자리만 쓸 수 있습니다. 다 쓰면 자동으로 끝나거나 반납한 뒤, 다른 자리를 새로 잡으면
            됩니다.
          </Feature>
        </div>
      </section>

      {/* 자리 예약하기 */}
      <section className={CARD}>
        <h2 className={H2}>자리 예약하기</h2>
        <ol className="mt-4 flex flex-col gap-3">
          <Step n={1}>
            좌석 도면에서 비어 있는 <b className="font-bold text-neutral-900">자리(흰색)</b>를 누릅니다.
          </Step>
          <Step n={2}>
            오른쪽에서 이용 시간을 고릅니다.{" "}
            <b className="font-bold text-neutral-900">30분·1시간·2시간·3시간</b> 버튼을 누르거나, 10분
            단위로 미세하게 조절할 수 있어요. 시작 시각은 “지금” 바로입니다.
          </Step>
          <Step n={3}>
            <b className="font-bold text-neutral-900">“예약 확정하기”</b>를 누르면 완료! 내 자리가{" "}
            <b className="font-bold text-emerald-600">초록색</b>으로 표시됩니다.
          </Step>
        </ol>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <p className={NOTE}>
            <Sun className="mr-1.5 inline h-4 w-4 -translate-y-0.5 text-neutral-400" />
            <b className="font-bold text-neutral-800">아침 일찍 왔다면</b> — 07:30~08:00 사이에
            예약하면 시작 시각을 08:00으로 맞춰 예약해 줍니다. 조금 일찍 와도 걱정 마세요.
          </p>
          <p className={NOTE}>
            <Timer className="mr-1.5 inline h-4 w-4 -translate-y-0.5 text-neutral-400" />
            <b className="font-bold text-neutral-800">바로 이어서 쓸 때</b> — 예약 시간이 끝난 자리는
            20분간 다시 예약할 수 없습니다. 계속 이용하려면 다른 빈 자리를 골라 주세요.
          </p>
        </div>
      </section>

      {/* 좌석 색깔 */}
      <section className={CARD}>
        <h2 className={H2}>좌석 색깔이 뜻하는 것</h2>
        <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {SEAT_LEGEND.map((s) => (
            <div key={s.t} className="flex items-center gap-3">
              <span className={`h-9 w-9 shrink-0 rounded-xl border ${s.c}`} />
              <div className="min-w-0">
                <p className="text-[14px] font-black tracking-tight text-neutral-900">{s.t}</p>
                <p className="text-[12px] font-medium text-neutral-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <p className={`${NOTE} mt-4`}>
          <MousePointerClick className="mr-1.5 inline h-4 w-4 -translate-y-0.5 text-neutral-400" />
          사용 중인 자리를 눌러 보면 누가 언제까지 쓰는지 오른쪽에 정보가 나옵니다.
        </p>
      </section>

      {/* 예약 관리 */}
      <section className={CARD}>
        <h2 className={H2}>예약 관리하기</h2>
        <p className="mt-1 text-[13px] font-bold text-neutral-400">
          내 예약 카드에서 바로 할 수 있어요.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {MANAGE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200">
                  <Icon className="h-[17px] w-[17px]" strokeWidth={2.2} />
                </div>
                <p className="text-[15px] font-black tracking-tight text-neutral-900">{title}</p>
              </div>
              <p className="mt-2.5 text-[13px] font-medium leading-relaxed text-neutral-600">
                {body}
              </p>
            </div>
          ))}
        </div>
        <p className={`${NOTE} mt-4`}>
          <Coffee className="mr-1.5 inline h-4 w-4 -translate-y-0.5 text-amber-500" />
          <b className="font-bold text-neutral-800">자리비움은 20분까지</b> — 비운 뒤 20분 안에
          복귀하지 않으면 예약이 자동으로 취소돼요. 그리고 그 자리는 이후 20분간 다시 예약할 수 없어요
          (다른 자리는 바로 가능).
        </p>
      </section>

      {/* 규칙표 */}
      <section className={CARD}>
        <h2 className={H2}>꼭 알아둘 규칙</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <tbody className="divide-y divide-neutral-100">
              {RULES.map(({ k, v }) => (
                <tr key={k} className="align-top">
                  <th
                    scope="row"
                    className="w-[128px] whitespace-nowrap py-3 pr-4 text-[13px] font-bold text-neutral-400"
                  >
                    {k}
                  </th>
                  <td className="py-3 text-[14px] font-medium leading-relaxed text-neutral-800">
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${NOTE} mt-4`}>
          <Hand className="mr-1.5 inline h-4 w-4 -translate-y-0.5 text-neutral-400" />
          <b className="font-bold text-neutral-800">재예약 제한이 왜 있나요?</b> — 한 사람이 같은
          자리를 계속 독점하지 않도록 자리를 돌아가며 쓰는 장치예요.
        </p>
      </section>

      {/* 신고 */}
      <section className={CARD}>
        <h2 className={H2}>신고 · 의견 보내기</h2>
        <p className="mt-1 text-[13px] font-bold text-neutral-400">
          화면 오른쪽 위 빨간 신고 버튼으로 알려 주세요. 사무국이 확인합니다.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Feature icon={MapPin} title="자리 이용">
            예약 없이 쓰거나 오래 비운 사람 신고
          </Feature>
          <Feature icon={ArrowRightLeft} title="시설 고장">
            의자·모니터 등 고장 신고
          </Feature>
          <Feature icon={MousePointerClick} title="기타 의견">
            그 밖에 건의할 내용
          </Feature>
        </div>
      </section>

      {/* FAQ */}
      <section className={CARD}>
        <h2 className={H2}>자주 묻는 질문</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="rounded-2xl border border-neutral-200 p-4">
              <p className="flex gap-2 text-[14px] font-black tracking-tight text-neutral-900">
                <span className="text-neutral-300">Q</span>
                {q}
              </p>
              <p className="mt-2 pl-[18px] text-[13px] font-medium leading-relaxed text-neutral-600">
                {a}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
