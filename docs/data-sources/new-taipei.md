<!--
檔案用途：新北市垃圾車開放資料的端點、欄位意義、資料品質實測與抓取／快取策略。
所在層：docs/data-sources；AGENTS.md § 6 索引「動到新北 provider」入口。
主要關聯：src/providers/new-taipei/*、docs/DECISIONS.md D4。
-->

# 新北市資料來源

實測日期：2026-09-28。上游可能變動，改 provider 前請重新實測並更新本檔。

## 端點

| 資料 | URL | 分頁 |
| --- | --- | --- |
| 清運點（路線 × 站序 × 每週服務） | `https://data.ntpc.gov.tw/api/datasets/edc3ad26-8ae7-4916-a00b-bc6048d19bf8/json?page=N&size=1000` | 共約 26,600 筆、27 頁 |
| 即時 GPS | `https://data.ntpc.gov.tw/api/datasets/28ab4122-60e1-4065-98e5-abccb69aaca6/json?page=0&size=1000` | 約 100–200 筆，1 頁 |

`size` 最大可到 5000，但單頁約 3.4 MB，超過 Next data cache 單筆 2 MB 上限，所以固定用 1000。

## 清運點欄位

| 原始欄位 | 意義 | 注意 |
| --- | --- | --- |
| `city` | **行政區**（例如「板橋區」） | 名稱誤導，不是城市 |
| `lineid`／`linename` | 路線代碼／名稱 | 與即時 GPS 的 `lineid` 可直接對應（實測 100%） |
| `rank` | 站序 | `lineid + rank` 唯一 |
| `name`／`village` | 清運點名稱／里 | 同一地點常同時屬於下午班與晚上班兩條路線 |
| `latitude`／`longitude` | 座標（字串） | 實測無壞值 |
| `time` | 表定時刻 `HH:MM`（台北時間） | 分布 06–22 時，高峰 19 時 |
| `garbage{day}`／`recycling{day}`／`foodscraps{day}` | 該天是否收運：`"Y"` 或 `""` | `day` = sunday…saturday，共 21 欄 |
| `memo` | 備註 | 約 4,400 筆有值；多數是內部維護註記（「經緯度修正」「站序修正」「2025通報」），provider 只保留對使用者有意義的（如「國定假日、連假隔天會加收」） |

## 路線形狀（2026-09-29 實測，站序比對的依據）

- 648 條路線；每條站數中位數 32、最多 106。相鄰兩站距離中位數 79 m、p90 415 m。
- 站序幾乎連續（全市只有 3 處跳號），表定時刻隨站序遞增（只有 1 處倒退）。
- **415 條路線會繞回已收過的地方**（60 m 內、站序差 ≥ 5，中位數差 12 站）；兩次經過的表定時刻中位數只差 11 分鐘。所以「車最近的站」不等於「車開到的站」，見 `src/domain/route-progress.ts` 與 DECISIONS D9。

## 即時 GPS 欄位

| 原始欄位 | 意義 |
| --- | --- |
| `lineid` | 路線代碼 |
| `car` | 車牌 |
| `time` | `YYYY/MM/DD HH:mm:ss`，台北時間、無時區標記 |
| `location` | 反查門牌地址 |
| `latitude`／`longitude` | 座標 |
| `cityid`／`cityname` | 行政區代碼／名稱 |

- 只包含目前有回報位置的車；收班後消失，夜間可能為 0 筆（合法狀態）。
- 上游本身延遲約 1–2.5 分鐘（中位數 1.3 分鐘），所以過期門檻設 5 分鐘（`src/domain/freshness.ts`）。
- 偶有同一 `lineid` 兩台車同時在線。

## TLS 注意

Python 3.13+ 預設嚴格驗證 X.509，會因「Missing Subject Key Identifier」拒絕這個網站的憑證鏈；Node／bun／curl 正常。寫探勘腳本請用 bun。
