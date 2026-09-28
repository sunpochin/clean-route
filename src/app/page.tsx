// 檔案用途：首頁路由——只負責掛上 NearbyView，所有互動邏輯都在 client 元件內。
// 所在層：src/app（Next.js page）。
// 主要關聯：src/components/NearbyView.tsx。

import { NearbyView } from "@/components/NearbyView";

export default function Home() {
  return <NearbyView />;
}
