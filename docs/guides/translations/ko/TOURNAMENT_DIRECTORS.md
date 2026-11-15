# 토너먼트 디렉터: 토너먼트 밤 운영하기

*이 문서는 [영어 Tournament Directors 안내서](../../TOURNAMENT_DIRECTORS.md)를 기계 번역한 것입니다. 기준은 영어판이며, 수정 제안은 "Translation correction" 이슈 양식으로 보내 주세요.*

[모든 안내서](../../../../README.md#get-started) · [Tournament Tools 참고 문서](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

토너먼트 디렉터는 커뮤니티 웹사이트에서 토너먼트 밤을 운영합니다: 참가자, 본체, 그룹,
점수, 결승과 공개 리포트. Windows용 **Tournament Tools**는 녹화나 실시간 캡처에서 레이스 결과를 읽을 수 있으므로
모든 순위를 손으로 입력할 필요가 없습니다. 이 도구는 선택 사항입니다. 점수는 손으로
입력하거나 Excel/CSV에서 가져올 수도 있습니다.

**웹사이트 없이:** [3장](#3-windows-tournament-tools)의 Windows Tournament Tools(Processor,
Analysis, Live)는 단독으로 작동합니다. 이 도구들은 PC에 Excel, CSV, JSON 파일을 씁니다. Connect는 선택 사항입니다.

인식 결과가 그 자체로 공식 결과가 되지는 않습니다. 모든 레이스는 반영되기 전에 내가 검토하며, 공개 여부도 내가 결정합니다.

## 1. 커뮤니티 웹사이트에서 디렉터 권한 받기

1. 웹사이트에 로그인합니다([플레이어](PLAYERS.md) 참고).
2. **토너먼트** 페이지에서 **주최 요청**을 선택합니다. 관리자가 요청을 승인하거나 거절합니다.
   관리자와 승인된 디렉터에게는 그 버튼이 보이지 않습니다. 대신 같은 페이지(**레이스 진행** 바)에
   **새 토너먼트 만들기**가 보이며, 그곳에서 밤을 시작합니다.
3. Windows 도구에서 인식한 레이스를 웹사이트로 보내려면, 관리자가 **관리 → 토너먼트 → 디렉터**에서
   로그인한 내 플레이어에게 접근 권한도 부여해야 합니다. 이 권한은 토너먼트에 대한 접근이며,
   전체 관리 권한이 아닙니다.

## 2. 웹사이트에서 밤 운영하기

**토너먼트**에서 토너먼트를 엽니다(관리자는 **관리 → 토너먼트**에서도 열 수 있음).
밤은 여러 단계로 이루어지며, 페이지에 현재 단계가 표시됩니다.

| 단계 | 할 일 |
| --- | --- |
| 0 | 디렉터 선택 |
| 1 | 토너먼트 시작 |
| 2 | 참가자를 선택하고, 누가 참석했는지와 누가 어떤 Switch를 가져오는지 표시(각 이름 옆의 **NS1**/**NS2** 체크) |
| 3-4 | 예선 배치(그룹과 자리) 만들기와 내보내기 |
| 5 | 예선 점수 입력: 손으로, Excel/CSV 파일에서, 또는 **수신된 결과**에서 |
| 6 | 예선 결과 내보내기 |
| 7-8 | 결승 그룹 확인과 내보내기 |
| 9 | 결승 그룹 점수 입력. 가져오기는 그룹별로 작동하며, 아직 연결되지 않은 이름이 있는 그룹은 거부합니다 |
| 10 | 마무리와 공유: 최종 순위표, 리포트, WordPress 내보내기 |

2단계는 Switch가 충분할 때만 진행됩니다. Switch 한 대에 플레이어 두 명이 앉으므로, 밤에는 최소한
참석 인원의 절반(올림)만큼 체크된 Switch가 필요합니다(참석 플레이어 9명이면 5대). 목록 아래의 준비 상태 상자에
몇 대가 부족한지 표시됩니다. 사람들이 가져오는 Switch를 체크하거나, 참가자를 대기 명단이나 불참으로 옮기세요.

Tournament Tools에서 온 레이스: 그룹의 **수신된 결과**를 열고, 인식된 각 이름을 올바른
플레이어에 연결하고, 코스와 완주 순위를 확인한 다음 **확인**을 선택합니다. 임시 라이브
순위표는 공식 결과가 아닙니다. 그룹 안의 **오프라인 대안: 저장된 Live / Processor 결과 파일 가져오기**나
**관리 → 토너먼트 → 기준 레이스 결과 가져오기**로 결과 파일을 직접 가져올 수도 있습니다.

공개와 커뮤니티 레이팅은 마지막 단계에서 각각 따로 결정합니다.

CSV와 Excel 내보내기에서 `=`, `+`, `-`, `@`로 시작하는 이름은 스프레드시트 프로그램에서 파일을 열어도 텍스트로 남습니다. CSV에서는 이를 위해 앞에 아포스트로피가 하나 붙으며, 웹사이트와 도구의 가져오기가 이를 다시 제거합니다.

## 3. Windows Tournament Tools

### 요구 사항

- x86-64 Windows(Windows 11에서 테스트됨)와 몇 GB의 여유 공간. ZIP은 약 450 MB이고 압축을 풀면 약 1.3 GB입니다.
  설치 프로그램은 Python 3.12와 공개 패키지를 내려받기 위해 한 번 인터넷이 필요합니다(GPU/CUDA를 쓰면 더 많음). 모든 OCR 모델이
  포함되어 있습니다. 설치 후에는 오프라인으로 처리할 수 있습니다. NVIDIA
  그래픽 카드는 OCR 단계만 빠르게 합니다. 녹화의 첫 스캔은 항상 CPU에서 실행됩니다(
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card) 참고).
- 실시간 캡처: Windows(DirectShow) 드라이버가 정상 작동하는 캡처 카드. 녹화만 쓴다면 추가로 필요한 것은 없습니다.
- 선택 사항, 결과를 보내려면: 웹사이트 주소와 토너먼트 운영자 권한(1단계).

### 설치

1. 프로젝트의 [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) 페이지에서(릴리스
   패키지는 각 릴리스에 첨부되어 있음) `tournament-tools-….zip`과 `SHA256SUMS.txt`를 내려받습니다. 저장소를 클론했다면
   직접 빌드할 수도 있습니다([도구 직접 빌드하기](#도구-직접-빌드하기)). PowerShell에서:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`를 실행하고 값 전체를 비교하세요.
2. ZIP 전체를 쓰기 가능한 폴더(`Program Files`가 아닌 곳)에 압축 해제합니다. `runtime-assets\`는
   실행 파일 옆에 그대로 두세요.
3. `Install-MK8DX-TournamentTools.cmd`를 더블클릭하고 `SUCCESS`가 나올 때까지 기다립니다. 이 컴퓨터에 맞게 NVIDIA CUDA 또는 CPU PyTorch를
   스스로 선택합니다. 실패하면 패키지 폴더의 `install.log`를 읽어 보세요.

설치 프로그램은 다음 실행 파일을 만듭니다.

| 실행 파일 | 용도 |
| --- | --- |
| `TournamentProcessor.cmd` | `.mp4` 또는 `.mkv` 녹화를 이 파일 위로 끌어다 놓습니다. 영상 옆에 세션 폴더(`<name>_TournamentSession\Output_Results\`)를 만들고 Excel, CSV와 `<name>_TournamentRaceResultsV1.json`을 씁니다. |
| `TournamentAnalysis.cmd` | 같은 녹화 영상 분석을 여러 영상이나 토너먼트별 폴더로 하는 창([아래](#나중에-녹화-분석하기)). |
| `TournamentLive.cmd` | 밤 동안의 실시간 캡처 또는 영상 재생: **영상 파일 추가**(또는 캡처 장치 추가), **모두 시작**, **확정 순위** 확인, 그다음 **내보내기 폴더 열기**. 결과를 전달하려면 [Tournament Live에서 웹사이트로](#tournament-live에서-웹사이트로)를 참고하세요. |
| `TournamentConnect.cmd` | 웹사이트에 대한 선택적 연결(아래). |
| `TournamentLiveCli.cmd` | 진단: 장치 탐색, 재생과 결과 명령. 라이브 창을 대신하지는 않습니다. |

`TournamentTools.config.cmd`에는 로컬 경로와 언어 설정이 들어 있습니다. 새 패키지를 설치할 때 이 파일,
`TournamentLive\` 세션 폴더와 출력 폴더를 보관하세요.

**다른 문자의 플레이어 이름.** Tournament Live와 Tournament Analysis는 라틴 문자뿐 아니라 키릴 문자, 일본어, 한국어, 중국어로 된 플레이어 이름도 읽습니다. 이를
위해 추가 텍스트 판독기 5개가 필요하며, 모두 합쳐 약 1GB의 메모리를 사용합니다(그래픽 카드가 있으면 그래픽 카드 메모리). 커뮤니티에서 이 문자들을 쓰는 사람이 없다면 꺼서 그 메모리를 아낄 수
있습니다. Tournament Live의 **인식**에서 **라틴 문자가 아닌 플레이어 이름 읽기**를 해제하거나, Tournament Analysis 창의 **분석 실행**에서 해제하거나,
`TournamentTools.config.cmd`에서 `MK8DX_NAME_SCRIPTS=off`로 설정하세요(`TournamentProcessor.cmd`에도 적용됩니다). 라틴 문자 이름은 어느
쪽이든 똑같이 읽습니다. 기본값은 켜짐입니다.

### 나중에 녹화 분석하기

밤을 진행하면서 캡처할 때는 Tournament Live를 사용합니다. Tournament Live 없이 밤을 진행해서 녹화만 있다면,
**Tournament Analysis** 창으로 나중에 분석하세요.

1. 패키지 폴더에서 `TournamentAnalysis.cmd`를 더블클릭합니다.
2. **① 녹화 선택**: **영상 추가...**로 녹화를 하나 이상 고릅니다(`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`). **폴더 추가...**는 토너먼트 하나의 녹화가 들어 있는 폴더를 추가합니다.
3. **② 영상 선택**: 추가한 모든 항목이 체크되어 있습니다. 분석하지 않을 항목은 체크를 해제하세요(**전체**, **없음**,
   **지우기**).
4. **③ 분석 실행**: **세션 ID**(첫 이름과 날짜로 채워지며 모든 레이스와 함께
   저장됨)와 **결과 폴더**(기본값은 첫 녹화 옆의 `<first name>_TournamentSession`)를 확인한 다음
   **분석 시작**를 선택합니다. 이 창은 `TournamentProcessor.cmd`와 같은 처리를 실행합니다.
   활동 로그에 색이 입혀진 출력이 표시되고, 시작 표시등이 주황색으로 바뀌며, **취소**로 중단할 수 있습니다. 녹화는
   결과 폴더의 `Input_Videos\`에 링크되며, 다른 드라이브에 있으면 복사됩니다.
5. **🏁 결과**: **완료됨**가 표시되면 **최신 Excel 열기** 또는 **결과 폴더 열기**를 선택합니다. `Output_Results\`에는
   Excel 통합 문서, CSV와 `*_TournamentRaceResultsV1.json`이 들어 있습니다. 레이스를 확인한 다음, 위에서 설명한 대로 웹사이트에서
   JSON을 가져오세요.

텍스트는 Windows 언어(영어 또는 네덜란드어)를 따릅니다. `TournamentTools.config.cmd`의 `MK8DX_TOURNAMENT_LANGUAGE`로
바꿀 수 있습니다. 배너에 다른 이미지를 표시하려면 `TournamentTools.config.cmd`의 `MK8DX_ANALYSIS_BACKGROUND`를
그 파일로 설정하세요. 클론에서는 Tournament Processor와 그 인식 에셋이 설치되어 있을 때 `python -m tournament_processor.gui`로
같은 창을 열 수 있습니다. PySide6(processor의 `gui` extra)가 필요하며,
없거나 `--classic-gui`를 쓰면 더 단순한 Tkinter 창이 열립니다.

### 관중과 OBS를 위한 실시간 점수판

Tournament Live의 **실시간 점수판 열기**(한 번에 한 그룹)와 **전체 피드 고정 점수판 열기**는 관중용 대시보드를
엽니다. 같은 URL을 OBS 브라우저 소스로 추가하세요. 표시 설정 세 가지는 오른쪽 아래의 작은 톱니바퀴 아래에
있습니다(마우스를 움직이면 나타나며, OBS에는 보이지 않습니다).

- **언어**: 대시보드 자체의 텍스트(머리글, 캡션, 상태, 이 패널)를 게임의 15개 언어 중 하나로 표시합니다.
  *브라우저 언어*(기본값)는 브라우저를 따르고, 지원되지 않으면 영어로 표시합니다. 코스 이름과 Tournament Live가
  읽는 본체 언어는 별개입니다.
- **점수판**: *자동*(기본값)은 레이스마다 최신 레이스 결과와 종합 순위를 번갈아 보여 줍니다. *종합 순위만*은
  종합 순위를 화면에 계속 표시합니다. 종합 순위에는 확정된 레이스만 들어가며, 캡션이 어느 레이스까지 포함됐는지
  알려 줍니다. 예: *레이스 7/12 후 · 레이스 8 확인 대기 중*.
- **코스 이름**: *영어 + 네덜란드어*(기본값) 또는 게임의 15개 언어 중 하나로, 코스와 컵 이름에만 적용됩니다.
  Tournament Live가 읽는 본체 언어는 바뀌지 않습니다.

선택은 브라우저가 기억합니다. OBS에서는 URL에 추가하세요: `?lang=de`(대시보드 텍스트), `?scoreboard=overall`,
`?trackLang=ja`(또는 `zh-TW`, `es-419` 같은 전체 로캘). 함께 쓰면 예를 들어
`http://127.0.0.1:8800/?view=grid&lang=ja&scoreboard=overall&trackLang=ja`입니다. `?controls=0`은 일반
브라우저에서도 톱니바퀴를 숨깁니다.

### 웹사이트에 연결(선택 사항)

PowerShell에서, 패키지 폴더 안에서:

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

`http://127.0.0.1:<port>`(또는 `http://localhost:<port>`)는 웹사이트가 A1과 A3처럼 같은 Windows
컴퓨터에서 실행될 때만 사용하세요. 일반 HTTP는 이 PC의 이 주소들에 대해서만 허용되며, 그 밖의 모든
주소에는 신뢰할 수 있는 HTTPS 주소가 필요합니다. 터미널이 없으면(예: 스크립트에서 실행) `sign-in`은 묻지 않습니다.
먼저 `TournamentConnect.cmd server <address>`로 주소를 설정하세요. 한 서버를 기다리는 업로드는 그
서버에 남습니다. 전달된 레이스는 **수신된 결과**에 들어가며, 절대 자동으로 공개되지 않습니다.

로그인은 선택한 주소에서만 브라우저를 엽니다. TournamentConnect와 Tournament Live는 그 주소를 코드와 함께 보여 주고, 다른 곳을 가리키는 로그인 링크는 거부합니다. 브라우저에 같은 주소와 같은 코드가 보일 때만 승인하세요. `sign-out`은 웹사이트에서 이 PC의 세션을 끝낸 다음 여기에서도 지웁니다. 웹사이트가 세션이 더 이상 작동하지 않는다고 확인할 때만 *Signed out*이라고 표시합니다. 다른 기기는 로그인 상태로 남습니다. 웹사이트에 연결할 수 없으면 로그인은 이 PC에 남습니다. 나중에 다시 시도하거나, `sign-out --this-pc-only`를 사용한 뒤 웹사이트 계정 메뉴의 **모든 기기에서 로그아웃**으로 세션을 끝내세요(**모든 곳에서 로그아웃**으로 확인하면 계정의 모든 기기가 로그아웃됩니다). Tournament Live에서 **로그아웃**은 `sign-out`과 같은 일을 합니다. **오프라인으로 작업**은 이 PC의 연결만 잊고 그렇다고 알려 줍니다.

### Tournament Live에서 웹사이트로

1. Tournament Live에서 **Tournament Manager에 연결**(나중에는 **토너먼트 변경**)을 선택하고, 브라우저
   로그인을 마친 다음 **토너먼트 선택**에서 밤을 고릅니다. 이 선택은 제안일 뿐이며, 실행 전이나
   후에 할 수 있습니다.
2. 피드를 실행합니다(**영상 파일 추가** 또는 캡처 카드, 그다음 **모두 시작**). Tournament Live는 기억하고 있는 캡처
   카드를 그룹 1의 추가 소스로 스스로 더할 수 있습니다. 그룹 1에 영상도 있으면 **모두 시작**이
   *START를 누르기 전에 모든 피드를 현재 단계의 서로 다른 그룹 하나에 각각 연결하세요*과 함께 멈춥니다. 추가 소스를 선택하고 **선택 항목
   삭제**를 고르거나, 그 소스에 별도의 그룹을 주고 다시 시작하세요.
3. 웹사이트에서 밤을 열고 5단계(결승 그룹은 9단계)로 가서 **사용 가능한 Tournament Live 녹화** 아래에서 실행 기록을 찾습니다.
   **그룹에 연결**에서 그룹을 고른 다음 **검토된 녹화 연결**을 선택합니다. 레이스는 내가 승인할 때까지
   대기 중인 증거로 남습니다.

### 캡처 위임과 피드 철회

명단 일치만으로는 공개 라이브 화면이 절대 저절로 열리지 않아요. Tournament Live 피드는 당신(또는 관리자)이 확인하거나, 이 밤의
라이브 캡처를 위임한 계정에서 올 때만 공개돼요. 그 전까지 웹사이트의 실행에는 *디렉터를 기다리는 중이에요* 가 표시되고,
Tournament Live도 디렉터를 기다린다고 알려요.

- **위임:** 5단계(결승 그룹은 9단계)의 **라이브 캡처 위임** 에서 캡처 담당자의 계정과 **유효 기간**(기본 12시간, 최대 7일)을
  고른 뒤 **라이브 캡처 위임** 을 누르세요. 대기 중인 실행에도 **…에게 라이브 캡처 위임(12시간)** 이 있어요. 계정은
  그 Tournament Live가 이 밤에 연결되고 **START** 를 누르면 나타나요. 그 뒤 이름이 그룹 명단과 일치하는 다음 레이스에서 공개
  화면이 열려요.
- **취소:** 위임 옆의 **취소** 를 고르세요. 그 계정의 피드는 곧바로 공개 화면에서 내려가고, 레이스는 확인용으로 남아요.
- **피드 철회:** 공개 중인 실행에서 **이 라이브 피드 철회** 를 고르고 한 번 더 클릭해 확인하세요. 레이스는 남아요. 다시 열 수
  있는 사람은 **라이브 연결 수동 확인** 을 쓰는 당신뿐이고, 명단 일치로는 열리지 않아요.

### 나중에 연결

연결 없이 처리한 밤도 PC에서는 완전합니다. `Output_Results\`에는 Excel 통합 문서, CSV와
`*_TournamentRaceResultsV1.json`이 들어 있습니다. 연결 없는 Tournament Live도 Excel 통합 문서를 씁니다:
피드를 정지할 때, 분석이 끝날 때, 또는 피드가 아직 실행 중일 때 창을 닫을 때(먼저 피드를 정지함)입니다.
파일은 창을 닫은 뒤에도 `Live_Output\exports`(**내보내기 폴더 열기**)에 남습니다. 피드가 정지되기 전에 Live가 강제 종료되면
마지막 통합 문서가 없습니다. 녹화는 남아 있으므로 Tournament Analysis나 Processor로
같은 통합 문서를 만들 수 있습니다. 그 뒤에 저절로 보내지는 것은 없습니다. 다음 방법 중 하나로 웹사이트에
가져오세요.

- 웹사이트의 그룹에서: JSON으로 **오프라인 대안: 저장된 Live / Processor 결과 파일 가져오기**,
  또는 그룹의 Excel 가져오기. 인식된 모든 이름을 먼저 플레이어에 연결해야 합니다. 연결되지 않은 이름이 있으면
  가져오기가 그 그룹을 거부합니다.
- 관리자: **관리 → 토너먼트 → 기준 레이스 결과 가져오기**. 가져온 레이스는 공개될 때까지
  비공개로 남습니다.
- TournamentConnect로: `.\TournamentConnect.cmd sign-in`을 실행한 다음
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`을 실행합니다. 밤, 그룹과
  첫 레이스 번호를 묻고, 레이스는 **수신된 결과**에 도착합니다. 웹사이트에 연결할 수 없으면 파일은 그 자리에
  남습니다. 나중에 다시 보내세요.
- Tournament Live에서: 세션이 끝난 뒤 **Tournament Manager에 연결**로 밤을 고르면, 끝난 그 세션을
  그 밤에 제공합니다. Live가 연결되어 있는 동안 실패한 업로드는 보관되었다가 자동으로 또는 **업로드 다시 시도**로
  다시 보내지며, 같은 로그인 계정에서만 보내집니다. **오프라인으로 작업**으로 실행한 세션은
  업로드용으로 보관되지 않습니다. 그 파일은 위의 방법 중 하나를 사용하세요.

로그인하면 두 가지가 추가됩니다: 내가 전달할 수 있는 밤의 목록, 그리고 밤 동안의 실시간 피드(`target`)로,
Tournament Live가 레이스를 인식할 때마다 선택한 그룹으로 보냅니다. 어느 쪽이든 레이스는
**수신된 결과**에서 내가 확인한 뒤에만 반영됩니다.

### 읽은 내용 확인하기

OCR은 이름, 순위 또는 누적 점수를 잘못 읽을 수 있습니다. 확인하기 전에 모든 레이스를 화면이나 녹화와
비교하세요. 알려진 한계 하나: Tournament Live는 누적 합계를 잘못 읽은 채로 올바른 레이스 결과를 내보낼 수 있으며,
웹사이트의 검토에서는 관찰된 이름이나 합계를 편집할 수 없습니다(
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md) 참고).

이 도구들은 본체의 15개 언어로 된 게임 화면을 읽습니다. Tournament Live는
v0.2.2 패키지로 실제 1× 인수 테스트를 통과했습니다: 소스 PC 세 대가 녹화된 예선 영상을 각자의 캡처 카드로 재생했습니다
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). 캡처 카드 없이 영상을 재생하는 것은
캡처 경로를 테스트하지 않습니다.

## 대회 삭제에는 이메일 링크가 필요합니다

웹사이트나 Android 앱에서 초안을 삭제하거나 대회를 제거하면 먼저 새로운 확인을 요청합니다. **새 이메일 링크로 확인** 창이 이유를 설명하고, **링크 보내기**를 누르면 계정 자신의 주소로 일회용 링크가 전송됩니다. 링크는 10분 동안 한 번만 작동합니다. 아무 기기에서나 링크를 열고 **이 작업 확인**을 누르면 삭제가 자동으로 계속됩니다. 확인은 해당 브라우저나 앱에서만 10분 동안 유효합니다. 대회 진행(참가자, 그룹, 점수, 마감)에는 요청되지 않으며, 이메일이 없는 집이나 클럽의 오프라인 설치에서는 전혀 묻지 않습니다. 이메일이 오지 않으면 스팸함을 확인하고 새 링크를 보내세요. 커뮤니티의 이메일이 작동하지 않으면 서버를 운영하는 사람이 서버에서 링크를 발급할 수 있습니다([Operations](../../../OPERATIONS.md#when-e-mail-fails-confirm-a-dangerous-action-from-the-server) 참고).

## 도구 직접 빌드하기

클론에서 `python tooling/tournament/build_windows_package.py --output <new folder> --version local`을 실행하면
같은 패키지가 빌드됩니다. [Client builds](../../../CLIENT_BUILDS.md)를 참고하세요.
