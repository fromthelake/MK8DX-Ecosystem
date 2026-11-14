# 赛事总监：主持一个锦标赛之夜

*本文是[英文版 Tournament Directors 指南](../../TOURNAMENT_DIRECTORS.md)的机器翻译，以英文版为准。欢迎通过“Translation correction”问题表单提交更正。*

[所有指南](../../../../README.md#get-started) · [Tournament Tools 参考文档](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

赛事总监在社区网站上主持一个锦标赛之夜：参赛者、主机、小组、
分数、决赛以及公开的报告。Windows 版 **Tournament Tools** 可以从录像或实时采集中读取比赛成绩，
因此你不必手动输入每一个名次。它们是可选的：分数也可以
手动输入，或者从 Excel/CSV 导入。

**没有网站时：** [第 3 节](#3-windows-tournament-tools) 中的 Windows Tournament Tools（Processor、
Analysis 和 Live）可以单独使用。它们会在你的电脑上写出 Excel、CSV 和 JSON 文件；Connect 是可选的。

识别结果本身绝不会成为正式成绩。每场比赛在计入之前都由你审核，是否公开也由你决定。

## 1. 在你所在社区的网站上获得赛事总监权限

1. 在网站上登录（见 [玩家](PLAYERS.md)）。
2. 在 **锦标赛** 页面上选择 **申请举办**。管理员会批准或拒绝这个申请。
   管理员以及获得批准后的赛事总监看不到这个按钮：他们会在同一页面（**赛事管理** 栏中）看到
   **创建新锦标赛**，并从那里开始当晚的比赛。
3. 要把 Windows 工具识别出的比赛发送到网站，管理员还需要在 **管理 → 锦标赛 → 赛事总监** 中
   为你已登录的玩家授予访问权限。这授予的是锦标赛访问权限，
   而不是全面的管理权限。

## 2. 在网站上主持当晚的比赛

从 **锦标赛** 打开这个锦标赛（管理员也可以在 **管理 → 锦标赛** 中找到它）。
当晚的比赛由一系列步骤组成；页面会显示你目前所在的步骤：

| 步骤 | 你要做的事 |
| --- | --- |
| 0 | 选择赛事总监 |
| 1 | 开始锦标赛 |
| 2 | 选择参赛者，标记谁已到场以及他们带来了哪些 Switch（每个名字旁边的 **NS1**/**NS2** 勾选框） |
| 3-4 | 创建并导出预选赛安排（小组和座位） |
| 5 | 输入预选赛分数：手动输入、从 Excel/CSV 文件导入，或者从 **收到的成绩** 中获取 |
| 6 | 导出预选赛成绩 |
| 7-8 | 检查并导出决赛小组 |
| 9 | 输入决赛小组分数；导入按小组进行，只要还有名字未匹配，该小组的导入就会被拒绝 |
| 10 | 完成并分享：最终排名表、报告和 WordPress 导出 |

只有在 Switch 足够时，第 2 步才会继续：每台 Switch 可坐两名玩家，因此当晚至少需要
到场参赛者人数的一半（向上取整）那么多台已勾选的 Switch（9 名到场玩家需要 5 台）。列表下方的准备状态框
会显示还缺多少台；请勾选大家带来的 Switch，或者把参赛者移到候补名单或缺席。

对于来自 Tournament Tools 的比赛：打开该小组的 **收到的成绩**，把每个识别出的
名字匹配到正确的玩家，检查赛道和完赛名次，然后选择 **确认**。临时的实时
排名表不是正式成绩。你也可以在小组内使用 **离线备用：导入已保存的 Live / Processor 成绩文件**，
或者使用 **管理 → 锦标赛 → 导入标准比赛成绩** 直接导入成绩文件。

公开和社区积分是最后一步中两个独立的决定。

## 3. Windows Tournament Tools

### 要求

- x86-64 的 Windows（已在 Windows 11 上测试）以及几 GB 的可用空间。ZIP 大约 450 MB，解压后大约 1.3 GB；
  安装程序需要联网一次，以下载 Python 3.12 和公开的软件包（使用 GPU/CUDA 时更多）；所有 OCR
  模型均已包含在内。安装完成后，处理可以离线进行。NVIDIA
  显卡只会加快 OCR 步骤；录像的第一次扫描总是在 CPU 上运行（见
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)）。
- 实时采集：一张带有可正常工作的 Windows（DirectShow）驱动程序的采集卡。使用录像时：不需要额外的东西。
- 可选，用于发送成绩：网站地址和锦标赛操作员权限（第 1 步）。

### 安装

1. 从项目的 [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) 页面（每个版本都附有
   发布包）下载 `tournament-tools-….zip` 和 `SHA256SUMS.txt`。如果你有代码仓库的克隆，
   也可以自己构建（[自己构建这些工具](#自己构建这些工具)）。在 PowerShell 中：
   运行 `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`，并比较完整的值。
2. 把完整的 ZIP 解压到一个可写入的文件夹（不要放在 `Program Files` 中）。让 `runtime-assets\` 保持在
   启动器旁边。
3. 双击 `Install-MK8DX-TournamentTools.cmd`，等待出现 `SUCCESS`。它会自行为这台电脑选择 NVIDIA CUDA 或 CPU 版
   PyTorch。如果失败，请阅读包文件夹中的 `install.log`。

安装程序会写出这些启动器：

| 启动器 | 用途 |
| --- | --- |
| `TournamentProcessor.cmd` | 把 `.mp4` 或 `.mkv` 录像拖到它上面。它会在视频旁边写出一个会话文件夹（`<name>_TournamentSession\Output_Results\`），其中有 Excel、CSV 和 `<name>_TournamentRaceResultsV1.json`。 |
| `TournamentAnalysis.cmd` | 一个窗口，用于对多个视频或每个锦标赛的一个文件夹进行同样的录像分析（[见下文](#事后分析录像)）。 |
| `TournamentLive.cmd` | 当晚的实时采集，或者回放视频：**添加视频文件**（或添加采集设备）、**全部开始**、检查 **已确认的排名**，然后 **打开导出文件夹**。要提交结果，请见 [把 Tournament Live 的结果送到网站](#把-tournament-live-的结果送到网站)。 |
| `TournamentConnect.cmd` | 可选的网站连接（见下文）。 |
| `TournamentLiveCli.cmd` | 诊断：设备发现、回放和成绩命令。不能代替实时窗口。 |

`TournamentTools.config.cmd` 保存本地路径和语言偏好。安装更新的包时，请保留它、`TournamentLive\` 会话
文件夹以及你的输出文件夹。

### 事后分析录像

如果你在当晚比赛进行时采集画面，请使用 Tournament Live。如果当晚没有使用它，而你只有
录像，请在事后用 **Tournament Analysis** 窗口分析它们：

1. 在包文件夹中双击 `TournamentAnalysis.cmd`。
2. **① Choose recordings**（选择录像）：**Add videos...**（添加视频）可以选择一个或多个录像（`.mp4`、`.mkv`、`.mov`、`.avi`、
   `.ts`）；**Add folder...**（添加文件夹）会添加一个存放某个锦标赛录像的文件夹。
3. **② Choose videos**（选择视频）：你添加的所有内容都已勾选；取消勾选不需要分析的内容（**All**（全部）、**None**（无）、
   **Clear**（清除））。
4. **③ Run the analysis**（运行分析）：检查 **Session id**（会话 ID，根据第一个名字和日期填写；它会随
   每场比赛一起保存）和 **Results folder**（成绩文件夹，默认是第一个录像旁边的 `<first name>_TournamentSession`），
   然后选择 **START ANALYSIS**（开始分析）。这个窗口执行与 `TournamentProcessor.cmd` 相同的处理；
   活动日志显示它的彩色输出，开始指示灯变为琥珀色，**Cancel**（取消）可以终止处理。录像
   会链接到成绩文件夹的 `Input_Videos\` 中，如果它们在另一个驱动器上则会被复制。
5. **🏁 Results**（结果）：显示 **Finished**（完成）后，选择 **Open Latest Excel**（打开最新的 Excel）或 **Open Results Folder**（打开成绩文件夹）：`Output_Results\`
   中有 Excel 工作簿、CSV 和 `*_TournamentRaceResultsV1.json`。检查这些比赛，然后按上文所述在网站上
   导入 JSON。

界面文字跟随 Windows 语言（英语或荷兰语）；`TournamentTools.config.cmd` 中的 `MK8DX_TOURNAMENT_LANGUAGE`
可以覆盖它。要在横幅中显示另一张图片，请把 `TournamentTools.config.cmd` 中的 `MK8DX_ANALYSIS_BACKGROUND`
设置为那个文件。在克隆的代码仓库中，如果已安装 Tournament Processor 及其识别素材，`python -m tournament_processor.gui` 会打开同一个窗口；
它需要 PySide6（processor 的 `gui` extra），
否则，或者使用 `--classic-gui` 时，会打开一个更简单的 Tkinter 窗口。

### 连接到网站（可选）

在 PowerShell 中，在包文件夹里：

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

只有当网站运行在同一台 Windows 电脑上时（像 A1 和 A3 那样），才使用 `http://127.0.0.1:<port>`（或 `http://localhost:<port>`）：
普通 HTTP 只对这台电脑上的这些地址有效，对其他任何地址都无效；其他每个
地址都需要它受信任的 HTTPS 地址。没有终端时（例如从脚本运行），`sign-in` 不会询问：
请先用 `TournamentConnect.cmd server <address>` 设置地址。等待发往某个服务器的上传会留在那个
服务器下。提交的比赛会进入 **收到的成绩**；它绝不会被自动公开。

### 把 Tournament Live 的结果送到网站

1. 在 Tournament Live 中选择 **连接到 Tournament Manager**（之后是 **更换锦标赛**），完成浏览器
   登录，并在 **Choose Tournament**（选择锦标赛）中选择当晚的比赛。这个选择只是一个建议；你可以在运行之前
   或之后做出选择。
2. 运行各路信号（**添加视频文件** 或一张采集卡，然后 **全部开始**）。Tournament Live 可能会自行把它记住的采集
   卡作为额外的信号源加到小组 1 上。如果小组 1 上还有一个视频，**全部开始**
   会停止并显示 *Assign every feed to exactly one different group*（把每一路信号分配到恰好一个不同的小组）：选择那个额外的信号源并选择 **移除
   所选**，或者给它一个单独的小组，然后再次开始。
3. 在网站上打开当晚的比赛，进入第 5 步（决赛小组为第 9 步），在 **可用的锦标赛实时录像** 下找到这次运行。
   在 **关联到小组** 中选择它的小组，然后选择 **关联已审核的录像**。这些比赛会作为待处理的证据等待，
   直到你接受它们。

### 以后再连接

在没有连接的情况下处理的当晚比赛，在你的电脑上也是完整的：`Output_Results\` 中有 Excel 工作簿、CSV
和 `*_TournamentRaceResultsV1.json`。没有连接的 Tournament Live 也会写出它的 Excel 工作簿：在你
停止各路信号时、分析完成时，或者在信号仍在运行时关闭窗口时（它会先停止信号）。
关闭之后，这些文件会留在 `Live_Output\exports`（**打开导出文件夹**）中。如果 Live 在信号停止之前被强制结束，
最终的工作簿就会缺失；录像仍然保留，Tournament Analysis 或 Processor 可以
用它们生成同样的工作簿。之后不会自动发送任何内容；请用以下
方式之一把它带到网站：

- 在网站的小组中：用 JSON 文件使用 **离线备用：导入已保存的 Live / Processor 成绩文件**，
  或者使用该小组的 Excel 导入。每个识别出的名字都必须先匹配到一名玩家；只要还有名字未匹配，
  导入就会拒绝该小组。
- 管理员：**管理 → 锦标赛 → 导入标准比赛成绩**。导入的比赛在公开之前
  保持不公开。
- 使用 TournamentConnect：先运行 `.\TournamentConnect.cmd sign-in`，然后运行
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`。它会询问当晚的比赛、小组和
  第一场比赛的编号；这些比赛会进入 **收到的成绩**。如果无法连接到网站，文件会留在
  原处；请稍后再次发送。
- 在 Tournament Live 中：会话结束后用 **连接到 Tournament Manager** 选择当晚的比赛，就会把
  那个已结束的会话提供给当晚的比赛。Live 连接期间上传失败的内容会被保留并再次发送，
  可以自动发送，也可以用 **重试上传**，但只针对同一个已登录的账户。用 **离线工作** 运行的会话
  不会保留以供上传；请用上面的某一种方式处理它的文件。

登录会增加两样东西：你可以提交到的当晚比赛列表，以及当晚的实时信号（`target`），
它会在 Tournament Live 识别出每场比赛时把它发送到所选的小组。无论哪种方式，一场比赛只有在
你于 **收到的成绩** 中确认之后才会计入。

### 检查读取的内容

OCR 可能会读错名字、名次或累计分数。在确认之前，请把每场比赛与屏幕或录像
进行比较。一个已知的限制：Tournament Live 可能会导出一个正确的比赛成绩，但累计总分读错了，
而网站的审核无法编辑观察到的名字或总分（见
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)）。

这些工具可以读取主机全部 15 种语言的游戏画面。Tournament Live 使用
v0.2.2 包通过了一次实体 1× 验收运行：三台信号源电脑把录好的预选赛视频播放到各自的采集卡中
（[issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)）。没有采集卡的视频回放
不能测试采集路径。

## 自己构建这些工具

在克隆的代码仓库中运行 `python tooling/tournament/build_windows_package.py --output <new folder> --version local`，
即可构建同样的包；见 [Client builds](../../../CLIENT_BUILDS.md)。
