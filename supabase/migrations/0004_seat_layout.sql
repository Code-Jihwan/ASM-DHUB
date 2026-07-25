-- 실제 도면 반영.
--
--                      창문
--   ┌──────────────────────────────────────┐
--   │  [1 2 3]  [4 5]  [6 7 8]             │ 블록1 앞줄
--   │  [9 ...]  [...]  [... 16]            │ 블록1 뒷줄   (앞뒤가 등을 맞댄다)
--   │                                      │
--   │  17 ~ 32                             │ 블록2
--   │                                      │
--   │  33 ~ 48                             │ 블록3
--   └────┬────────────────────────┬────────┘
--     출입문                    출입문
--
-- 한 줄은 3석 / 2석 / 3석 세 그룹으로 나뉜다. 그룹 사이가 통로다.

alter table seat add column block   int;   -- 1(창가) ~ 3(출입문)
alter table seat add column seat_row int;  -- 블록 안에서 1(앞) 또는 2(뒤)
alter table seat add column seat_col int;  -- 줄 안에서 1 ~ 8

update seat set
  block    = ((id - 1) / 16) + 1,
  seat_row = (((id - 1) % 16) / 8) + 1,
  seat_col = ((id - 1) % 8) + 1,
  label    = lpad(id::text, 2, '0'),
  zone     = null;

alter table seat
  alter column block    set not null,
  alter column seat_row set not null,
  alter column seat_col set not null;

alter table seat
  add constraint seat_block_range check (block between 1 and 3),
  add constraint seat_row_range   check (seat_row between 1 and 2),
  add constraint seat_col_range   check (seat_col between 1 and 8),
  add constraint seat_spot_unique unique (block, seat_row, seat_col);

-- zone은 A/B 임의 구분이었다. 도면에 없는 개념이라 뺀다.
-- seat_status 뷰가 zone을 참조하므로 먼저 걷어내고 다시 만든다.
drop view if exists seat_status;

alter table seat drop column zone;

create view seat_status with (security_invoker = true) as
select
  s.id            as seat_id,
  s.label,
  s.block,
  s.seat_row,
  s.seat_col,
  s.active,
  r.id            as reservation_id,
  r.period,
  r.extended,
  r.user_id = auth.uid() as is_mine
from seat s
left join reservation r
  on r.seat_id = s.id
 and r.status = 'active'
 and upper(r.period) > now();
