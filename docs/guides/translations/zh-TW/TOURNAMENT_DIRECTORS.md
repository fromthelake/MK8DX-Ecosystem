# 主辦人：主持一場錦標賽之夜

*本文是[英文版 Tournament Directors 指南](../../TOURNAMENT_DIRECTORS.md)的機器翻譯，以英文版為準。歡迎透過「Translation correction」問題表單提交更正。*

[所有指南](../../../../README.md#get-started) · [Tournament Tools 參考文件](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

主辦人在社群網站上主持一場錦標賽之夜：參賽者、主機、組別、
分數、決賽以及公開的報告。Windows 版 **Tournament Tools** 可以從錄影或即時擷取中讀取比賽成績，
所以你不必手動輸入每一個名次。它們是選用的：分數也可以
手動輸入，或從 Excel/CSV 匯入。

**沒有網站時：** [第 3 節](#3-windows-tournament-tools) 中的 Windows Tournament Tools（Processor、
Analysis 和 Live）可以單獨使用。它們會在你的電腦上寫出 Excel、CSV 和 JSON 檔案；Connect 是選用的。

辨識結果本身絕不會成為正式成績。每場比賽在計入之前都由你審核，是否公開也由你決定。

## 1. 在你所在社群的網站上取得主辦人權限

1. 在網站上登入（請見 [玩家](PLAYERS.md)）。
2. 在 **錦標賽** 頁面上選擇 **申請舉辦**。管理員會核准或拒絕這個申請。
   管理員以及獲得核准後的主辦人看不到這個按鈕：他們會在同一頁面（**賽事指揮** 列中）看到
   **建立新錦標賽**，並從那裡開始當晚的比賽。
3. 若要把 Windows 工具辨識出的比賽傳送到網站，管理員還需要在 **管理 → 錦標賽 → 主辦人** 中
   為你已登入的玩家授予存取權限。這授予的是錦標賽存取權限，
   而不是全面的管理權限。

## 2. 在網站上主持當晚的比賽

從 **錦標賽** 開啟這場錦標賽（管理員也可以在 **管理 → 錦標賽** 中找到它）。
當晚的比賽由一連串步驟組成；頁面會顯示你目前所在的步驟：

| 步驟 | 你要做的事 |
| --- | --- |
| 0 | 選擇主辦人 |
| 1 | 開始錦標賽 |
| 2 | 選擇參賽者，標記誰已出席以及他們帶來哪些 Switch（每個名稱旁邊的 **NS1**/**NS2** 勾選框） |
| 3-4 | 建立並匯出預賽安排（組別和座位） |
| 5 | 輸入預賽分數：手動輸入、從 Excel/CSV 檔案匯入，或從 **收到的成績** 中取得 |
| 6 | 匯出預賽成績 |
| 7-8 | 檢查並匯出決賽組別 |
| 9 | 輸入決賽組別分數；匯入以組別為單位進行，只要還有名稱未配對，該組別的匯入就會被拒絕 |
| 10 | 完成並分享：最終排名表、報告和 WordPress 匯出 |

只有在 Switch 足夠時，步驟 2 才會繼續：每台 Switch 可坐兩名玩家，因此當晚至少需要
出席參賽者人數的一半（無條件進位）那麼多台已勾選的 Switch（9 名出席玩家需要 5 台）。清單下方的準備狀態框
會顯示還缺幾台；請勾選大家帶來的 Switch，或把參賽者移到候補名單或缺席。

對於來自 Tournament Tools 的比賽：開啟該組別的 **收到的成績**，把每個辨識出的
名稱配對到正確的玩家，檢查賽道和完賽名次，然後選擇 **確認**。暫定的即時
排名表不是正式成績。你也可以在組別內使用 **離線備援：匯入已儲存的 Live／Processor 成績檔案**，
或使用 **管理 → 錦標賽 → 匯入正式比賽成績** 直接匯入成績檔案。

公開和社群積分是最後一個步驟中兩個獨立的決定。

在 CSV 和 Excel 匯出中，以 `=`、`+`、`-` 或 `@` 開頭的名稱在試算表程式中開啟時仍保持為文字；在 CSV 中，它會為此在開頭加上一個撇號，網站和工具的匯入會再把它移除。

## 3. Windows Tournament Tools

### 需求

- x86-64 的 Windows（已在 Windows 11 上測試）以及數 GB 的可用空間。ZIP 大約 450 MB，解壓縮後大約 1.3 GB；
  安裝程式需要連上網路一次，以下載 Python 3.12 和公開的套件（使用 GPU/CUDA 時更多）；所有 OCR
  模型皆已包含在內。安裝完成後，處理可以離線進行。NVIDIA
  顯示卡只會加快 OCR 步驟；錄影的第一次掃描一律在 CPU 上執行（請見
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)）。
- 即時擷取：一張具有可正常運作的 Windows（DirectShow）驅動程式的擷取卡。使用錄影時：不需要額外的東西。
- 選用，用於傳送成績：網站網址和錦標賽操作員權限（步驟 1）。

### 安裝

1. 從專案的 [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) 頁面（每個版本都附有
   發行套件）下載 `tournament-tools-….zip` 和 `SHA256SUMS.txt`。如果你有程式碼儲存庫的複製，
   也可以自己建置（[自己建置這些工具](#自己建置這些工具)）。在 PowerShell 中：
   執行 `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`，並比對完整的值。
2. 把完整的 ZIP 解壓縮到一個可寫入的資料夾（不要放在 `Program Files` 中）。讓 `runtime-assets\` 保持在
   啟動器旁邊。
3. 按兩下 `Install-MK8DX-TournamentTools.cmd`，等待出現 `SUCCESS`。它會自行為這台電腦選擇 NVIDIA CUDA 或 CPU 版
   PyTorch。如果失敗，請閱讀套件資料夾中的 `install.log`。

安裝程式會寫出這些啟動器：

| 啟動器 | 用途 |
| --- | --- |
| `TournamentProcessor.cmd` | 把 `.mp4` 或 `.mkv` 錄影拖曳到它上面。它會在影片旁邊寫出一個工作階段資料夾（`<name>_TournamentSession\Output_Results\`），其中有 Excel、CSV 和 `<name>_TournamentRaceResultsV1.json`。 |
| `TournamentAnalysis.cmd` | 一個視窗，用於對多部影片或每場錦標賽的一個資料夾進行同樣的錄影分析（[見下文](#事後分析錄影)）。 |
| `TournamentLive.cmd` | 當晚的即時擷取，或重播影片：**新增影片檔案**（或新增擷取裝置）、**全部開始**、檢查 **已確認的排名**，然後 **開啟匯出**。若要提交結果，請見 [把 Tournament Live 的成績送到網站](#把-tournament-live-的成績送到網站)。 |
| `TournamentConnect.cmd` | 選用的網站連線（見下文）。 |
| `TournamentLiveCli.cmd` | 診斷：裝置探索、重播和成績指令。不能取代即時視窗。 |

`TournamentTools.config.cmd` 保存本機路徑和語言偏好。安裝較新的套件時，請保留它、`TournamentLive\` 工作階段
資料夾以及你的輸出資料夾。

**其他文字的玩家名稱。** Tournament Live 和 Tournament Analysis 除了拉丁字母外，也會讀取西里爾文、日文、韓文和中文的玩家名稱。這需要五個額外的文字辨識器，總共約 1 GB 記憶體（有顯示卡時佔用顯示卡記憶體）。如果你的社群裡沒有人使用這些文字，可以關閉它來節省這部分記憶體：在 Tournament Live 的 **辨識** 中，或在 Tournament Analysis 視窗的 **執行分析** 中取消勾選 **讀取非拉丁文字的玩家名稱**，或在 `TournamentTools.config.cmd` 中設定 `MK8DX_NAME_SCRIPTS=off`（也適用於 `TournamentProcessor.cmd`）。拉丁文字名稱在兩種情況下讀取結果相同。預設為開啟。

### 事後分析錄影

如果你在當晚比賽進行時擷取畫面，請使用 Tournament Live。如果當晚沒有使用它，而你只有
錄影，請在事後用 **Tournament Analysis** 視窗分析它們：

1. 在套件資料夾中按兩下 `TournamentAnalysis.cmd`。
2. **① 選擇錄影**：**新增影片...**可以選擇一部或多部錄影（`.mp4`、`.mkv`、`.mov`、`.avi`、
   `.ts`）；**新增資料夾...**會加入一個存放某場錦標賽錄影的資料夾。
3. **② 選擇影片**：你加入的所有內容都已勾選；取消勾選不需要分析的內容（**全部**、**無**、
   **清除**）。
4. **③ 執行分析**：檢查 **工作階段 ID**（依第一個名稱和日期填入；它會隨
   每場比賽一起儲存）和 **結果資料夾**（預設為第一部錄影旁邊的 `<first name>_TournamentSession`），
   然後選擇 **開始分析**。這個視窗執行與 `TournamentProcessor.cmd` 相同的處理；
   活動記錄會顯示它的彩色輸出，開始指示燈會變成琥珀色，**取消**可以結束處理。錄影
   會連結到成績資料夾的 `Input_Videos\` 中，如果它們在另一個磁碟機上則會被複製。
5. **🏁 結果**：顯示 **已完成**後，選擇 **開啟最新的 Excel**或 **開啟結果資料夾**：`Output_Results\`
   中有 Excel 活頁簿、CSV 和 `*_TournamentRaceResultsV1.json`。檢查這些比賽，然後依上文所述在網站上
   匯入 JSON。

介面文字會跟隨 Windows 語言（英文或荷蘭文）；`TournamentTools.config.cmd` 中的 `MK8DX_TOURNAMENT_LANGUAGE`
可以覆寫它。若要在橫幅中顯示另一張圖片，請把 `TournamentTools.config.cmd` 中的 `MK8DX_ANALYSIS_BACKGROUND`
設定為那個檔案。在複製的程式碼儲存庫中，如果已安裝 Tournament Processor 及其辨識素材，`python -m tournament_processor.gui` 會開啟同一個視窗；
它需要 PySide6（processor 的 `gui` extra），
否則，或使用 `--classic-gui` 時，會開啟一個較簡單的 Tkinter 視窗。

### 給觀眾和 OBS 的即時計分板

Tournament Live 的**開啟即時計分板**（一次一個組）和**開啟固定的全畫面來源計分板**會開啟觀眾用的儀表板；
把同一個 URL 加入為 OBS 的瀏覽器來源。右下角的小齒輪下有三項顯示設定（移動滑鼠時出現；OBS 中不會顯示）：

- **語言**：儀表板本身的文字（標題、說明文字、狀態、此面板）使用遊戲的 15 種語言之一。*瀏覽器語言*（預設）
  跟隨瀏覽器，不支援時使用英語。賽道名稱以及 Tournament Live 讀取的主機語言與此無關。
- **計分板**：*自動*（預設）在每場比賽後交替顯示最新的比賽結果和總排名。*僅總排名*讓總排名一直顯示在畫面上；
  總排名只包含已確認的比賽，說明文字會寫明計入到哪一場，例如 *第 7 場比賽後（共 12 場） · 第 8 場比賽待確認*。
- **賽道名稱**：*英語 + 荷蘭語*（預設）或遊戲的 15 種語言之一，只用於賽道和盃賽名稱。它不會改變
  Tournament Live 讀取的主機語言。

瀏覽器會記住你的選擇。在 OBS 中把它加到 URL 裡：`?lang=de`（儀表板文字）、`?scoreboard=overall`、
`?trackLang=ja`（或完整的地區代碼，如 `zh-TW`、`es-419`），合在一起例如
`http://127.0.0.1:8800/?view=grid&lang=ja&scoreboard=overall&trackLang=ja`。`?controls=0` 在一般瀏覽器中也會隱藏齒輪。

### 連線到網站（選用）

在 PowerShell 中，在套件資料夾裡：

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out                          # ends this PC's session on the website, then forgets it here
.\TournamentConnect.cmd sign-out --this-pc-only           # forgets it on this PC only; the website session stays valid
```

只有當網站在同一台 Windows 電腦上執行時（像 A1 和 A3 那樣），才使用 `http://127.0.0.1:<port>`（或 `http://localhost:<port>`）：
一般 HTTP 只對這台電腦上的這些網址有效，對其他任何網址都無效；其他每個
網址都需要它受信任的 HTTPS 網址。沒有終端機時（例如從指令碼執行），`sign-in` 不會詢問：
請先用 `TournamentConnect.cmd server <address>` 設定網址。等待送往某個伺服器的上傳會留在那個
伺服器底下。提交的比賽會進入 **收到的成績**；它絕不會被自動公開。

登入只會在你選擇的位址上開啟瀏覽器：TournamentConnect 和 Tournament Live 會把該位址與代碼一起顯示，並拒絕指向其他地方的登入連結。只有當瀏覽器顯示相同的位址和相同的代碼時才核准。`sign-out` 會結束此電腦在網站上的工作階段，然後在本機刪除它；只有當網站確認該工作階段已失效時，它才會顯示 *Signed out*。其他裝置仍保持登入。如果無法連線到網站，登入會保留在此電腦上：請稍後再試，或使用 `sign-out --this-pc-only`，然後在網站的帳號選單中用 **在所有裝置上登出** 結束工作階段（用 **在所有地方登出** 確認後，該帳號的所有裝置都會登出）。在 Tournament Live 中，**登出** 與 `sign-out` 作用相同；**離線工作** 只會忘記此電腦上的連線，並會說明這一點。

### 把 Tournament Live 的成績送到網站

1. 在 Tournament Live 中選擇 **連線到 Tournament Manager**（之後是 **變更錦標賽**），完成瀏覽器
   登入，並在 **選擇錦標賽**中選擇當晚的比賽。這個選擇只是一個建議；你可以在執行之前
   或之後做出選擇。
2. 執行各路訊號（**新增影片檔案** 或一張擷取卡，然後 **全部開始**）。Tournament Live 可能會自行把它記得的擷取
   卡當成額外的訊號來源加到組別 1 上。如果組別 1 上還有一部影片，**全部開始**
   會停止並顯示 *按下 START 前，請將每個畫面來源分配到目前步驟中各不相同的一個組別*：選擇那個額外的訊號來源並選擇 **移除
   所選項目**，或給它一個獨立的組別，然後再次開始。
3. 在網站上開啟當晚的比賽，前往步驟 5（決賽組別為步驟 9），在 **可用的 Tournament Live 錄影** 底下找到這次執行。
   在 **連結至組別** 中選擇它的組別，然後選擇 **連結已檢查的錄影**。這些比賽會作為待處理的證據等待，
   直到你接受它們。

### 擷取委派與撤下直播來源

僅憑名單比對永遠不會自行開放公開直播檢視。Tournament Live 的直播來源只有在你（或管理員）確認後，或來自你已為今晚委派直播
擷取的帳號時，才會公開。在此之前，網站會在該場次上顯示 *正在等待主辦人*，Tournament Live 也會提示它正在等待主辦人。

- **委派：** 在第 5 步（決賽組別為第 9 步）的 **直播擷取委派** 下，選擇擷取操作員的帳號和 **有效期間**（預設 12 小時，最長
  7 天），然後按 **委派直播擷取**。等待中的場次也會提供 **將直播擷取委派給 …（12 小時）**。帳號的 Tournament Live
  連線到今晚並按下 **START** 後，就會出現在那裡。之後，下一場名字與組別名單相符的比賽會開放公開檢視。
- **撤銷：** 按委派旁的 **撤銷**。該帳號的直播來源會立即離開公開檢視；其比賽保留供你審核。
- **撤下直播來源：** 在公開的場次上按 **撤下此直播來源**，再按一次確認。比賽會保留；只有你能透過 **手動確認直播對應**
  再次開放它，名單比對不行。

### 稍後再連線

在沒有連線的情況下處理的當晚比賽，在你的電腦上也是完整的：`Output_Results\` 中有 Excel 活頁簿、CSV
和 `*_TournamentRaceResultsV1.json`。沒有連線的 Tournament Live 也會寫出它的 Excel 活頁簿：在你
停止各路訊號時、分析完成時，或在訊號仍在執行時關閉視窗時（它會先停止訊號）。
關閉之後，這些檔案會留在 `Live_Output\exports`（**開啟匯出**）中。如果 Live 在訊號停止之前被強制結束，
最終的活頁簿就會缺少；錄影仍然保留，Tournament Analysis 或 Processor 可以
用它們產生同樣的活頁簿。之後不會自動傳送任何內容；請用以下
其中一種方式把它帶到網站：

- 在網站的組別中：用 JSON 檔案使用 **離線備援：匯入已儲存的 Live／Processor 成績檔案**，
  或使用該組別的 Excel 匯入。每個辨識出的名稱都必須先配對到一名玩家；只要還有名稱未配對，
  匯入就會拒絕該組別。
- 管理員：**管理 → 錦標賽 → 匯入正式比賽成績**。匯入的比賽在公開之前
  保持不公開。
- 使用 TournamentConnect：先執行 `.\TournamentConnect.cmd sign-in`，然後執行
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`。它會詢問當晚的比賽、組別和
  第一場比賽的編號；這些比賽會進入 **收到的成績**。如果無法連上網站，檔案會留在
  原處；請稍後再次傳送。
- 在 Tournament Live 中：工作階段結束後用 **連線到 Tournament Manager** 選擇當晚的比賽，就會把
  那個已結束的工作階段提供給當晚的比賽。Live 連線期間上傳失敗的內容會被保留並再次傳送，
  可以自動傳送，也可以用 **重試上傳**，但只限同一個已登入的帳號。用 **離線工作** 執行的工作階段
  不會保留以供上傳；請用上面的其中一種方式處理它的檔案。

登入會增加兩樣東西：你可以提交到的當晚比賽清單，以及當晚的即時訊號（`target`），
它會在 Tournament Live 辨識出每場比賽時把它傳送到所選的組別。無論哪種方式，一場比賽只有在
你於 **收到的成績** 中確認之後才會計入。

### 檢查讀取的內容

OCR 可能會讀錯名稱、名次或累計分數。在確認之前，請把每場比賽與螢幕或錄影
進行比對。一個已知的限制：Tournament Live 可能會匯出一個正確的比賽成績，但累計總分讀錯了，
而網站的審核無法編輯觀察到的名稱或總分（請見
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)）。

這些工具可以讀取主機全部 15 種語言的遊戲畫面。Tournament Live 使用
v0.2.2 套件通過了一次實體 1× 驗收執行：三台訊號來源電腦把錄好的預賽影片播放到各自的擷取卡中
（[issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)）。沒有擷取卡的影片重播
不能測試擷取路徑。

## 刪除或移除比賽需要電子郵件連結

在網站或 Android 應用程式中刪除草稿或移除比賽時，會先要求重新確認。**透過新的電子郵件連結確認** 視窗會說明原因；點按 **傳送連結** 會向你帳號自己的地址傳送一次性連結。該連結只能使用一次，有效期 10 分鐘。在任何裝置上開啟它並點按 **確認此操作**，刪除隨後會自動繼續。確認僅對該瀏覽器或應用程式有效，持續 10 分鐘。進行比賽（參賽者、分組、分數、完成）時從不需要它，沒有電子郵件的家庭或俱樂部離線安裝也完全不會要求。收不到郵件？請檢查垃圾郵件並傳送新連結；如果社群的電子郵件無法使用，伺服器的營運者可以在伺服器上核發連結（請見 [Operations](../../../OPERATIONS.md#when-e-mail-fails-confirm-a-dangerous-action-from-the-server)）。

## 自己建置這些工具

在複製的程式碼儲存庫中執行 `python tooling/tournament/build_windows_package.py --output <new folder> --version local`，
即可建置同樣的套件；請見 [Client builds](../../../CLIENT_BUILDS.md)。
