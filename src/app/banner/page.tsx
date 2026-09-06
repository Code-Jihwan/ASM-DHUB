import { redirect } from "next/navigation";

// 배너 공지는 '팝업/배너 공지'(/announcement)로 통합됐다. 옛 링크/북마크는 그리로 보낸다.
export default function BannerRedirect() {
  redirect("/announcement");
}
