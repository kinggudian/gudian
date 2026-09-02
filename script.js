/* ==========================================================
   설정값 (배포 전 반드시 채워야 하는 자리)
   ========================================================== */

// [필수] Anthropic API 키. 절대 공개 저장소에 실제 키를 커밋하지 마세요.
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY_HERE";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// [필수] Google Apps Script 웹앱 URL (Sheets 연동용)
// Apps Script 배포 후 발급되는 /exec URL을 아래에 넣어주세요.
const GOOGLE_SHEETS_WEBAPP_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEBAPP_URL_HERE";

/* ==========================================================
   화면 전환 유틸
   ========================================================== */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

/* ==========================================================
   화면 2: 짖음 시간 입력 그리드 생성
   ========================================================== */

const TIME_BUCKETS = [
  { key: "새벽(0~6시)", label: "새벽(0~6시)" },
  { key: "아침(6~9시)", label: "아침(6~9시)" },
  { key: "오전(9~12시)", label: "오전(9~12시)" },
  { key: "오후(12~15시)", label: "오후(12~15시)" },
  { key: "저녁(15~18시)", label: "저녁(15~18시)" },
  { key: "밤(18~24시)", label: "밤(18~24시)" },
];
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function buildBarkGrid() {
  const tbody = document.querySelector("#bark-grid tbody");
  tbody.innerHTML = "";
  TIME_BUCKETS.forEach((bucket) => {
    const tr = document.createElement("tr");
    const th = document.createElement("td");
    th.textContent = bucket.label;
    tr.appendChild(th);
    DAYS.forEach((day) => {
      const td = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.bucket = bucket.key;
      cb.dataset.day = day;
      td.appendChild(cb);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
buildBarkGrid();

function getBarkCounts() {
  const counts = {};
  TIME_BUCKETS.forEach((b) => (counts[b.key] = 0));
  document.querySelectorAll("#bark-grid input[type=checkbox]").forEach((cb) => {
    if (cb.checked) counts[cb.dataset.bucket]++;
  });
  return counts;
}

/* ==========================================================
   화면 1 → 2 전환
   ========================================================== */

document.getElementById("btn-start").addEventListener("click", () => {
  showScreen("screen-input");
});

/* ==========================================================
   화면 2: 동의 체크 전에는 제출 버튼 비활성화
   ========================================================== */

const consentInput = document.getElementById("consent-input");
const submitInputBtn = document.getElementById("btn-submit-input");

consentInput.addEventListener("change", () => {
  submitInputBtn.disabled = !consentInput.checked;
});

/* ==========================================================
   화면 2 → 3: 입력값 수집 후 결과 화면으로 이동, AI 호출
   ========================================================== */

let collectedInput = {}; // 이후 Sheets 저장 시 재사용

submitInputBtn.addEventListener("click", () => {
  // 필수 입력값 검증 (select/radio 등 브라우저 기본 required만으로는
  // 라디오/셀렉트 일부를 못 잡는 경우가 있어 최소 확인)
  const residenceType = document.getElementById("residence-type").value;
  const householdType = document.getElementById("household-type").value;
  const petBreed = document.getElementById("pet-breed").value.trim();
  const petSize = document.getElementById("pet-size").value;
  const complaintEl = document.querySelector('input[name="complaint"]:checked');

  if (!residenceType || !householdType || !petBreed || !petSize || !complaintEl) {
    alert("필수 항목을 모두 입력해주세요.");
    return;
  }
  if (!consentInput.checked) {
    alert("데이터 수집 동의가 필요합니다.");
    return;
  }

  const barkCounts = getBarkCounts();
  const totalChecked = Object.values(barkCounts).reduce((a, b) => a + b, 0);
  if (totalChecked === 0) {
    alert("최소 한 개 이상의 시간대를 체크해주세요.");
    return;
  }

  collectedInput = {
    residenceType,
    householdType,
    petBreed,
    petSize,
    complaint: complaintEl.value,
    barkCounts,
  };

  // 입력 요약 표시
  const summaryEl = document.getElementById("result-input-summary");
  summaryEl.innerHTML = `
    <strong>입력 요약</strong><br/>
    거주형태: ${collectedInput.residenceType} · 가구형태: ${collectedInput.householdType}<br/>
    반려견: ${collectedInput.petBreed} (${collectedInput.petSize}견) ·
    이웃 민원 경험: ${collectedInput.complaint}
  `;

  showScreen("screen-result");
  document.getElementById("result-loading").classList.remove("hidden");
  document.getElementById("result-output").classList.add("hidden");

  runAiAnalysis(barkCounts);
});

/* ==========================================================
   AI 기능: 짖음 시간대 집계 요약
   PRD 대응: ## 3 AI 기능 (AI 입력/처리/출력/제한사항)
   ========================================================== */

async function runAiAnalysis(barkCounts) {
  const systemPrompt = `
당신은 반려견 짖음 시간대 데이터를 정리하는 단순 집계 도우미입니다.
아래 규칙을 반드시 지키세요.

[처리 방식]
- 입력된 시간대별 체크 횟수(0~7)만 보고 가장 빈도가 높은 시간대를 찾으세요.
- 추가적인 추론, 예측, 원인 분석을 하지 마세요.

[절대 하지 말아야 할 것]
- 반려견의 분리불안 여부, 원인, 심각도를 진단하거나 확정하지 마세요.
- 향수·음성 개입의 효과나 안전성에 대해 어떠한 주장도 하지 마세요.
- 이웃 갈등 발생 가능성이나 민원 처리 결과를 예측하거나 단정하지 마세요.

[출력 형식]
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{"mostFrequentBucket": "가장 빈도가 높은 시간대 라벨", "count": 숫자, "summarySentence": "한국어 1문장 요약"}

summarySentence 예시: "지난 한 주간 아침(6~9시) 시간대에 짖음 기록이 가장 많았습니다."
`.trim();

  const userMessage = `다음은 지난 1주일간 시간대별 짖음 체크 횟수입니다(0~7회): ${JSON.stringify(
    barkCounts
  )}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`);
    }

    const data = await response.json();
    const textBlock = data.content.find((c) => c.type === "text");
    const raw = textBlock ? textBlock.text.trim() : "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // 모델이 JSON 외 텍스트를 포함한 경우, 중괄호 구간만 추출 시도
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed || !parsed.summarySentence) {
      throw new Error("AI 응답 형식을 해석할 수 없습니다.");
    }

    renderResult(barkCounts, parsed);
  } catch (err) {
    console.error(err);
    document.getElementById("result-loading").classList.add("hidden");
    document.getElementById("result-output").classList.remove("hidden");
    document.getElementById("ai-summary-sentence").textContent =
      "결과를 불러오는 중 오류가 발생했습니다. API 키 설정 또는 네트워크 상태를 확인해주세요.";
    renderChart(barkCounts);
  }
}

function renderResult(barkCounts, aiResult) {
  document.getElementById("result-loading").classList.add("hidden");
  document.getElementById("result-output").classList.remove("hidden");

  renderChart(barkCounts);

  document.getElementById("ai-summary-sentence").textContent = aiResult.summarySentence;

  // 다음 단계(Sheets 저장)에서 사용할 수 있도록 결과 보관
  collectedInput.mostFrequentBucket = aiResult.mostFrequentBucket || "";
}

function renderChart(barkCounts) {
  const chartEl = document.getElementById("bark-chart");
  chartEl.innerHTML = "";
  const max = Math.max(...Object.values(barkCounts), 1);

  Object.entries(barkCounts).forEach(([bucket, count]) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    const heightPx = Math.round((count / max) * 130) || 2;
    bar.style.height = `${heightPx}px`;

    const label = document.createElement("div");
    label.className = "chart-label";
    label.textContent = `${bucket.replace(/\(.+\)/, "")}\n${count}회`;
    label.style.whiteSpace = "pre-line";

    wrap.appendChild(bar);
    wrap.appendChild(label);
    chartEl.appendChild(wrap);
  });
}

/* ==========================================================
   화면 3 → 4
   ========================================================== */

document.getElementById("btn-goto-feedback").addEventListener("click", () => {
  showScreen("screen-feedback");
});

/* ==========================================================
   화면 4: 연락처 입력 시에만 동의 체크 필수
   ========================================================== */

const contactEmailInput = document.getElementById("contact-email");
const consentContact = document.getElementById("consent-contact");

/* ==========================================================
   화면 4 → 5: 피드백 제출 + Google Sheets 저장
   ========================================================== */

document.getElementById("btn-submit-feedback").addEventListener("click", async () => {
  const similarEl = document.querySelector('input[name="similar"]:checked');
  const empathyEl = document.querySelector('input[name="empathy"]:checked');
  const interestEl = document.querySelector('input[name="interest"]:checked');
  const desiredPrice = document.getElementById("desired-price").value.trim();
  const contactEmail = contactEmailInput.value.trim();

  if (!similarEl || !empathyEl || !interestEl) {
    alert("모든 필수 항목에 응답해주세요.");
    return;
  }
  if (contactEmail && !consentContact.checked) {
    alert("연락처를 남기시려면 수집 동의가 필요합니다.");
    return;
  }

  const feedbackData = {
    timestamp: new Date().toISOString(),
    residenceType: collectedInput.residenceType || "",
    householdType: collectedInput.householdType || "",
    complaintExperience: collectedInput.complaint || "",
    mostFrequentBucket: collectedInput.mostFrequentBucket || "",
    similarToReality: similarEl.value,
    empathyScore: empathyEl.value,
    interestScore: interestEl.value,
    desiredPrice: desiredPrice,
    contactEmail: contactEmail || "",
  };

  await saveToGoogleSheets(feedbackData);

  showScreen("screen-complete");
});

/* ==========================================================
   Google Sheets 저장 연동
   PRD 대응: Sheets 연동 [필요] — 응답 데이터 누적 저장
   ========================================================== */

async function saveToGoogleSheets(data) {
  if (
    !GOOGLE_SHEETS_WEBAPP_URL ||
    GOOGLE_SHEETS_WEBAPP_URL === "YOUR_GOOGLE_APPS_SCRIPT_WEBAPP_URL_HERE"
  ) {
    console.warn("Google Sheets WebApp URL이 설정되지 않아 저장을 건너뜁니다.");
    return;
  }

  try {
    // Apps Script 웹앱은 브라우저 CORS 프리플라이트를 지원하지 않는 경우가 많아
    // no-cors 모드로 전송합니다. (응답 내용은 읽을 수 없으나 저장은 수행됨)
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error("Sheets 저장 중 오류:", err);
  }
}