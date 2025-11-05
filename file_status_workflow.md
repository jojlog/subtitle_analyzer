# ⚙️ File Processing & Save View Unified Spec / 파일 처리 및 세이브뷰 통합 명세서 (최종판)

---

## 🇰🇷 **파일 처리 및 세이브뷰 통합 명세서 (Korean Version)**

### 1️⃣ 업로드 단계
- 업로드 방식: 드롭다운 / 브라우저 버튼
- 지원 형식: `.vtt`, `.txt`
- 업로드 개수: 최대 5개 (초과 시 알림)
  > “파일은 최대 5개까지만 업로드 가능합니다.”
- 업로드 후 각 파일에 `Start` / `Remove` 버튼 생성

---

### 2️⃣ Start 클릭 시
- **중복 이름 검사:** 동일 파일 존재 시 이름 변경 모달 표시
- 없으면 다음 단계 진행
- `status = analyzing`, `progress = 0 → 100`
- UI: `Analyzing (progress%)` 표시
- 세이브뷰에 비활성화 세이브파일 생성 (status/progress 표시)
- 버튼은 `Pause`로 변경
- 다른 파일들은 `status = queued`, 세이브뷰에 `Queued` 표시

---

### 3️⃣ Pause 클릭 시
- `analyzing` → `paused`, progress 유지
- UI: `Paused (progress%)` 표시
- 다른 파일들(`queued`)도 `paused`로 전환
- 세이브뷰에도 반영
- 버튼은 `Resume`으로 변경

---

### 4️⃣ Resume 클릭 시
- `paused` → `analyzing`, progress 이어서 진행
- UI: `Analyzing (progress%)` 표시
- 다른 `paused` 파일들은 `queued`로 전환
- 세이브뷰 반영
- 버튼은 다시 `Pause`로 변경
- 동일 프로세스 반복

---

### 5️⃣ Analyzing 진행 중
- progress 실시간 갱신 (0~100%)
- `status = analyzing`, UI에 `Analyzing (progress%)`

---

### 6️⃣ progress 100% 시 (완료 처리)
- `status = completed`
- 세이브뷰의 비활성화 세이브 → 활성화로 전환 (덮어쓰기)
- `status` 텍스트 제거, `저장날짜`와 `편집날짜` 표시
- 처음 autosave 시 두 날짜 동일
- 이후 편집 시마다 `Date Edited` 업데이트
- 다음 `queued` 파일 자동 analyzing으로 전환 → 루프 반복

---

### 7️⃣ Autosave 및 날짜 관리
- Autosave 시 `Date Edited` 자동 갱신
- Manual Save 시 `Date Edited` 갱신
- Rename 시 `Date Edited` 갱신
- Completed 파일 수정 시:
  - Status는 그대로 유지 (Analyzing으로 복귀하지 않음)
  - `Date Edited`만 갱신

---

### 8️⃣ Rename 로직
- 파일명 변경 시 내부 autosave 경로 즉시 갱신
- 동일 파일명 존재 시 경고 모달 표시:
  > “같은 이름의 파일이 이미 존재합니다.”
- Rename 시 `Date Edited` 갱신

---

### 9️⃣ 삭제 로직
- 삭제(Edit 모드 내) 클릭 시 확인 모달 표시:
  > “이 파일을 영구적으로 삭제하시겠습니까?”
- 확인 시:
  1. 파일 즉시 삭제
  2. 세이브뷰 리스트 즉시 갱신
  3. 활성화/비활성화 세이브 재정렬

---

### 🔟 프로그램 종료 시 처리
- 완료되지 않은 파일 존재 시 경고:
  > “진행 중인 파일이 모두 삭제됩니다. 그래도 종료하시겠습니까?”
- 확인 시:
  1. 모든 미완료 파일 삭제
  2. 세이브뷰 비활성화 세이브 삭제
  3. 세이브뷰 전체 초기화
  4. 프로그램 종료

---

### ⓫ 세이브뷰 구조 및 표시 규칙

#### 🔸 비활성화 세이브 (Inactive Save)
- 처리 중(Analyzing / Paused / Queued) 파일 표시용
- 클릭 불가, 열람 불가 (임시 표시)
- 항상 리스트 최상단 고정
- 표시 항목: `[File Name / Date Created(Status) / Date Edited(-)]`
  - Date Created에 날짜 대신 Status 표시
  - Date Edited는 “-” 플레이스홀더

#### 🔸 활성화 세이브 (Active Save)
- Completed 파일 표시
- 클릭 시 실제 스크립트 열람 가능 (기존 레이아웃/기능 유지)
- 파일명 더블클릭 시 Rename 가능 (실제 파일명 동기화)
- 표시 항목: `[File Name / Date Edited / Date Created]`

#### 🔸 정렬 및 스크롤
- File Name / Date Created / Date Edited 옆의 화살표 클릭 시 정렬
- 비활성화 세이브는 항상 맨 위 고정 (정렬 제외)
- 활성화 세이브만 정렬 대상
- 헤더(정렬 항목)는 화면 상단 고정
- 전체 리스트(비활성화 + 활성화 세이브)는 스크롤 가능

#### 🔸 세션 지속성
- 비활성화 세이브는 세션 임시용
- 프로그램 재시작 시 모두 초기화

#### 🔸 Completed 파일 정책
- Completed 파일은 절대 Analyzing으로 복귀하지 않음
- Re-analyze 버튼 및 로직 완전 제거

---

## 🇬🇧 **Unified File Processing & Save View Specification (English Version)**

### 1️⃣ Upload Stage
- Upload via dropdown or browse button
- Supported formats: `.vtt`, `.txt`
- Max 5 files (alert if exceeded)
  > “You can upload up to 5 files only.”
- Each file gets `Start` / `Remove` buttons after upload

### 2️⃣ On Start Click
- Duplicate filename check → rename modal if needed
- If unique → proceed
- `status = analyzing`, `progress = 0 → 100`
- UI: `Analyzing (progress%)`
- Add inactive save in Save View (status/progress shown)
- Button changes to `Pause`
- Other files become `status = queued`

### 3️⃣ On Pause Click
- `analyzing` → `paused`, progress preserved
- UI: `Paused (progress%)`
- Queued files also become paused
- Reflected in Save View
- Button → `Resume`

### 4️⃣ On Resume Click
- `paused` → `analyzing`, progress resumes
- UI: `Analyzing (progress%)`
- Other paused files revert to `queued`
- Reflected in Save View
- Button → `Pause`

### 5️⃣ During Analyzing
- Progress updates (0–100%)
- `status = analyzing`, UI shows `Analyzing (progress%)`

### 6️⃣ When progress == 100%
- `status = completed`
- Inactive save → active (overwrite)
- Remove status text, show `Date Saved` and `Date Edited`
- Dates identical at first autosave, edited date updates with later edits
- Next queued file auto starts analyzing → loop repeats

### 7️⃣ Autosave & Date Rules
- Date Edited updates on autosave
- Date Edited updates on manual save
- Date Edited updates on rename
- Completed files never revert to analyzing
- Editing a completed file updates only Date Edited

### 8️⃣ Rename Logic
- Renaming updates internal autosave reference path
- Duplicate filename check triggers warning:
  > “A file with this name already exists.”
- Renaming triggers Date Edited update

### 9️⃣ Delete Logic
- Deleting (inside edit mode) opens confirmation modal:
  > “Are you sure you want to permanently delete this file?”
- Confirm → delete immediately, refresh Save View, reorder lists

### 10️⃣ Program Exit Handling
- If unfinished files exist → show warning:
  > “All ongoing files will be deleted. Continue?”
- On confirm:
  1. Delete all unfinished files
  2. Delete inactive saves
  3. Reset Save View
  4. Exit program

### 11️⃣ Save View Rules
#### 🔸 Inactive Saves
- Temporary display for Analyzing / Paused / Queued files
- Not clickable, cannot open
- Always fixed at top
- Display: `[File Name / Date Created(Status) / Date Edited(-)]`
  - Date Created shows status instead of date
  - Date Edited always shows “-”

#### 🔸 Active Saves
- Completed files
- Click to open script (preserve layout/features)
- Double-click to rename (syncs actual file)
- Display: `[File Name / Date Edited / Date Created]`

#### 🔸 Sorting & Scroll
- Click arrows beside columns to sort
- Inactive saves stay pinned at top (excluded from sorting)
- Active saves are sortable
- Header fixed at top
- Entire list scrollable

#### 🔸 Session Persistence
- Inactive saves are temporary; cleared on restart

#### 🔸 Completed File Policy
- Completed files never revert to Analyzing
- Re-analyze button and logic removed

