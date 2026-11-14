# 大会ディレクター向け：大会の夜を運営する

これは英語版ガイド（[TOURNAMENT_DIRECTORS.md](../../TOURNAMENT_DIRECTORS.md)）の機械翻訳です。内容は英語版が正となります。翻訳の誤りは「Translation correction」の Issue フォームからお知らせください。

[すべてのガイド](../../../../README.md#get-started) · [Tournament Tools リファレンス](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

大会ディレクターは、コミュニティのウェブサイトで大会の夜を運営します：参加者、本体、グループ、スコア、決勝、
そして公開するレポートです。Windows 用の **Tournament Tools** は録画やライブキャプチャーからレース結果を読み取れる
ので、順位を 1 つずつ手で入力する必要はありません。ツールは任意です：スコアは手で入力することも、Excel/CSV から
インポートすることもできます。

**ウェブサイトなしの場合：**[セクション 3](#3-windows-版-tournament-tools) の Windows 用 Tournament Tools（Processor、
Analysis、Live）は単独で動作します。Excel、CSV、JSON のファイルを PC に書き出します。Connect は任意です。

認識によって結果が正式なものになることはありません。どのレースも、カウントされる前に自分で確認し、公開するかどうかも
自分で決めます。

## 1. コミュニティのウェブサイトでディレクター権限を得る

1. ウェブサイトにサインインします（[プレイヤー向け](PLAYERS.md) を参照）。
2. **大会** ページで **主催を申請** を選びます。管理者が申請を承認または却下します。
   管理者と、承認済みのディレクターにはこのボタンは表示されません。代わりに同じページ（**レース運営** バー）に
   **新しい大会を作成** が表示され、そこから大会の夜を始めます。
3. Windows のツールから認識したレースをウェブサイトに送るには、管理者がさらに、サインイン中の自分のプレイヤーに
   **管理 → 大会 → ディレクター** でアクセス権を与えます。これは大会へのアクセス権であり、
   全般的な管理権限ではありません。

## 2. ウェブサイトで大会の夜を運営する

**大会** から大会を開きます（管理者は **管理 → 大会** からも開けます）。
大会の夜はステップの連続で、ページに現在の位置が表示されます：

| ステップ | やること |
| --- | --- |
| 0 | ディレクターを選ぶ |
| 1 | 大会を開始する |
| 2 | 参加者を選び、誰が出席しているか、どの Switch を持ってくるかを記録する（各名前の横の **NS1**/**NS2** のチェック） |
| 3-4 | 予選の組み合わせ（グループと席）を作成してエクスポートする |
| 5 | 予選のスコアを入力する：手で、Excel/CSV ファイルから、または **受信した結果** から |
| 6 | 予選の結果をエクスポートする |
| 7-8 | 決勝グループを確認してエクスポートする |
| 9 | 決勝グループのスコアを入力する。インポートはグループ単位で行われ、照合されていない名前が残っているグループは拒否される |
| 10 | 確定して共有する：最終順位表、レポート、WordPress エクスポート |

ステップ 2 は、Switch が足りている場合にだけ先に進めます。Switch 1 台に 2 人のプレイヤーが座るので、大会の夜には
**出席** の参加者の半分（切り上げ）以上の台数の Switch にチェックが入っている必要があります（出席者 9 人なら 5 台）。
リストの下の準備状況ボックスに、あと何台足りないかが表示されます。持ってきてもらう Switch にチェックを入れるか、
参加者を **キャンセル待ち** または **欠席** に移してください。

Tournament Tools から届いたレースの場合：そのグループの **受信した結果** を開き、認識された名前をそれぞれ正しい
プレイヤーに照合し、コースと着順を確認してから **確定** を選びます。暫定のライブ順位表は正式な結果ではありません。
グループ内の **オフライン時の代替手段：保存したLive／Processorの結果ファイルをインポート** や、
**管理 → 大会 → 正式なレース結果をインポート** で、結果ファイルを直接インポートすることもできます。

公開とコミュニティのレーティングは、最後のステップでそれぞれ別に決めます。

## 3. Windows 版 Tournament Tools

### 必要なもの

- x86-64 の Windows（Windows 11 で動作確認済み）と、数 GB の空き容量。ZIP は約 160 MB、展開すると約 1 GB です。
  インストーラーは一度だけインターネットを使い、Python 3.12 と公開パッケージをダウンロードします（GPU/CUDA を使う場合は
  さらに多く）。検出用とラテン文字用 OCR のモデルは同梱されており、英語の OCR を初めて実行するときにもう 1 つの
  モデル（english_g2.pth、約 15 MB）を一度だけダウンロードします。その後はオフラインで処理できます。NVIDIA の
  グラフィックカードで速くなるのは OCR の手順だけです。録画の最初のスキャンは常に CPU で実行されます
  （[どの手順がグラフィックカードを使うか](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card) を参照）。
- ライブキャプチャーには：正常に動作する Windows（DirectShow）ドライバーのあるキャプチャーボード。録画なら追加の
  ものは不要です。
- 任意、結果を送る場合：ウェブサイトのアドレスと大会運営者のアクセス権（ステップ 1）。

### インストール

1. プロジェクトの [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) ページ（各リリースに
   パッケージが添付されています）から `tournament-tools-….zip` と `SHA256SUMS.txt` をダウンロードします。クローンが
   あれば、自分でビルドすることもできます（[ツールを自分でビルドする](#ツールを自分でビルドする)）。PowerShell で：
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256` を実行し、値全体を比較してください。
2. ZIP 全体を書き込み可能なフォルダー（`Program Files` 以外）に展開します。`runtime-assets\` はランチャーの隣に
   置いたままにしてください。
3. `Install-MK8DX-TournamentTools.cmd` をダブルクリックし、`SUCCESS` と表示されるまで待ちます。このコンピューターに
   合わせて NVIDIA CUDA 版か CPU 版の PyTorch を自動で選びます。失敗した場合は、パッケージフォルダーの `install.log` を
   読んでください。

インストーラーは次のランチャーを作成します：

| ランチャー | 用途 |
| --- | --- |
| `TournamentProcessor.cmd` | `.mp4` または `.mkv` の録画をこの上にドラッグします。動画の隣にセッションフォルダー（`<name>_TournamentSession\Output_Results\`）を作成し、Excel、CSV、`<name>_TournamentRaceResultsV1.json` を書き出します。 |
| `TournamentAnalysis.cmd` | 同じ録画解析を、複数の動画や大会ごとのフォルダーで行うためのウィンドウです（[下記](#録画をあとから解析する)）。 |
| `TournamentLive.cmd` | 大会の夜のライブキャプチャー、または動画の再生：**動画ファイルを追加**（またはキャプチャーデバイスを追加）、**すべて開始**、**確定した順位** を確認し、最後に **エクスポートを開く**。記録を届ける方法は [Tournament Live からウェブサイトへ](#tournament-live-からウェブサイトへ) を参照してください。 |
| `TournamentConnect.cmd` | ウェブサイトへの任意の接続（下記）。 |
| `TournamentLiveCli.cmd` | 診断用：デバイスの検出、再生、結果のコマンド。ライブウィンドウの代わりにはなりません。 |

`TournamentTools.config.cmd` にはローカルのパスと言語の設定が入っています。新しいパッケージをインストールするときは、
このファイル、`TournamentLive\` セッションフォルダー、出力フォルダーを残しておいてください。

### 録画をあとから解析する

大会の夜をその場でキャプチャーするときは Tournament Live を使います。Tournament Live を使わずに大会の夜を行い、
録画しかない場合は、**Tournament Analysis** ウィンドウであとから解析します：

1. パッケージフォルダーの `TournamentAnalysis.cmd` をダブルクリックします。
2. **① 録画を選択**：**動画を追加...**で 1 つ以上の録画（`.mp4`、`.mkv`、`.mov`、
   `.avi`、`.ts`）を選びます。**フォルダーを追加...**で 1 つの大会の録画が入ったフォルダーを追加します。
3. **② 動画を選択**：追加したものはすべてチェックされています。解析しないものはチェックを外します
   （**すべて**、**なし**、**クリア**）。
4. **③ 分析を実行**：**セッション ID**（最初のファイル名と日付から入力され、各レースと
   一緒に保存されます）と **結果フォルダー**（初期設定では最初の録画の隣の
   `<first name>_TournamentSession`）を確認してから、**分析を開始**を選びます。ウィンドウは
   `TournamentProcessor.cmd` と同じ処理を実行します。アクティビティログに色付きの出力が表示され、開始ランプが
   黄色に変わり、**キャンセル**で終了します。録画は結果フォルダーの `Input_Videos\` にリンクされ、別の
   ドライブにある場合はコピーされます。
5. **🏁 結果**：**完了**と表示されたら、**最新の Excel を開く**または
   **結果フォルダーを開く**を選びます。`Output_Results\` には Excel ブック、CSV、
   `*_TournamentRaceResultsV1.json` が入っています。レースを確認してから、上で説明したとおり JSON をウェブサイトで
   インポートします。

表示テキストは Windows の言語（英語またはオランダ語）に従います。`TournamentTools.config.cmd` の
`MK8DX_TOURNAMENT_LANGUAGE` で変更できます。バナーに別の画像を表示するには、`TournamentTools.config.cmd` の
`MK8DX_ANALYSIS_BACKGROUND` にそのファイルを設定します。クローンからは、Tournament Processor とその認識アセットが
インストールされていれば `python -m tournament_processor.gui` で同じウィンドウが開きます。これには PySide6（processor の
`gui` extra）が必要で、それがない場合や `--classic-gui` を付けた場合は、よりシンプルな Tkinter ウィンドウが開きます。

### ウェブサイトに接続する（任意）

PowerShell で、パッケージフォルダーにて：

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

（上から順に：`sign-in` はウェブサイトのアドレスを一度だけ聞き、ブラウザーでサインインします。`server` はアドレスを
表示し、アドレスを付けると確認のうえ変更します。`tournaments` は届け先にできる大会の夜を一覧表示します。`target` は
Tournament Live のライブ送信に使う大会の夜とグループを選びます（`clear-target` で解除）。`send` はどの大会の夜かを
聞いてからアップロードします。`sign-out` はサインアウトします。）

`http://127.0.0.1:<port>`（または `http://localhost:<port>`）は、A1 や A3 のようにウェブサイトが同じ Windows
コンピューターで動いている場合にだけ使ってください。暗号化なしの HTTP は、この PC のこれらのアドレスに対してだけ
受け付けられ、それ以外には使えません。他のアドレスにはすべて信頼された HTTPS アドレスが必要です。ターミナルが
ない場合（たとえばスクリプトから実行する場合）、`sign-in` は何も聞きません。先に
`TournamentConnect.cmd server <address>` でアドレスを設定してください。あるサーバー向けの送信待ちのアップロードは、
そのサーバーに残ります。届いたレースは **受信した結果** に入り、自動で公開されることはありません。

### Tournament Live からウェブサイトへ

1. Tournament Live で **Tournament Managerに接続**（あとからは **大会を変更**）を選び、ブラウザーでのサインインを
   済ませて、**大会を選択**で大会の夜を選びます。この選択は提案にすぎず、実行の前でも後でも
   選べます。
2. 映像を実行します（**動画ファイルを追加** またはキャプチャーボード、次に **すべて開始**）。Tournament Live は、
   覚えているキャプチャーボードを グループ 1 の追加ソースとして自動で加えることがあります。グループ 1 に動画もある場合、
   **すべて開始** は *START を押す前に、すべての映像を現在のステップの異なるグループに1つずつ割り当ててください*で止まります：追加のソースを選んで **選択したものを削除** を選ぶか、専用のグループを割り当てて
   から、もう一度開始してください。
3. ウェブサイトで大会の夜を開き、ステップ 5（決勝グループはステップ 9）に進み、**利用可能なTournament Liveの録画** の下で該当する記録を探します。
   **グループにリンク** でグループを選び、**確認済みの録画をリンク** を選びます。レースは、承認するまで保留中の証拠として
   待機します。

### あとから接続する

接続せずに処理した大会の夜も、PC 上では完結しています：`Output_Results\` には Excel ブック、CSV、
`*_TournamentRaceResultsV1.json` が入っています。接続していない Tournament Live も Excel ブックを書き出します：映像を
止めたとき、解析が終わったとき、または映像が動いている間にウィンドウを閉じたとき（先に映像を止めます）です。
ファイルは閉じた後も `Live_Output\exports`（**エクスポートを開く**）に残ります。映像が止まる前に Live が強制終了
された場合、その最後のブックはありません。録画は残るので、Tournament Analysis または Processor で同じブックを作れます。
その後に何かが自動で送られることはありません。次のいずれかの方法でウェブサイトに届けてください：

- ウェブサイトのグループ内で：JSON を使って **オフライン時の代替手段：保存したLive／Processorの結果ファイルをインポート**、
  またはグループの Excel インポート。認識された名前はすべて、先にプレイヤーと照合しておく必要があります。照合されて
  いない名前があるグループは、インポートが拒否されます。
- 管理者の場合：**管理 → 大会 → 正式なレース結果をインポート**。インポートしたレースは、公開されるまで非公開の
  ままです。
- TournamentConnect で：`.\TournamentConnect.cmd sign-in` の後に
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`。大会の夜、グループ、最初のレース番号を
  聞かれます。レースは **受信した結果** に届きます。ウェブサイトに接続できない場合、ファイルはそのまま残るので、
  あとでもう一度送ってください。
- Tournament Live で：セッションが終わった後に **Tournament Managerに接続** で大会の夜を選ぶと、その終わった
  セッションがその大会の夜に提案されます。Live が接続中に失敗したアップロードは保持され、自動で、または
  **アップロードを再試行** で、同じサインイン中のアカウントに限って再送されます。**オフラインで作業** で実行した
  セッションはアップロード用に保持されません。そのファイルには上のいずれかの方法を使ってください。

サインインすると 2 つのことが加わります：届け先にできる大会の夜の一覧と、大会の夜の間のライブ送信（`target`）です。
ライブ送信では、Tournament Live がレースを認識するたびに、選んだグループへ送ります。どちらの場合も、レースが
カウントされるのは **受信した結果** で確定した後だけです。

### 読み取り結果を確認する

OCR は名前、順位、累計スコアを読み間違えることがあります。確定する前に、どのレースも画面や録画と見比べてください。
既知の制限が 1 つあります：Tournament Live は、正しいレース結果を、読み間違えた累計スコアとともにエクスポートする
ことがあり、ウェブサイトでの確認では読み取られた名前や累計を編集できません
（[ローカルのノート PC での Tournament Live](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md) を参照）。

ツールは、ゲーム本体の 15 言語の画面を読み取れます。Tournament Live は v0.2.2 パッケージで、1× の実機受け入れテストに
合格しました：3 台のソース PC が、録画した予選の動画をそれぞれのキャプチャーボードに再生しました
（[issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)）。キャプチャーボードを使わない動画の再生では、
キャプチャーの経路はテストされません。

## ツールを自分でビルドする

クローンから `python tooling/tournament/build_windows_package.py --output <new folder> --version local` を実行すると、
同じパッケージがビルドされます。[Client builds](../../../CLIENT_BUILDS.md) を参照してください。
