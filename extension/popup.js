const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const fieldsEl = document.getElementById("fields");
const selectedKeys = new Set();

function showError(message) {
  errorEl.textContent = message || "";
}

async function getState() {
  const res = await chrome.runtime.sendMessage({ type: "getState" });
  if (!res?.ok) throw new Error(res?.error || "读取状态失败");
  return res.state;
}

function sourceClass(source) {
  if (source === "ai") return "ai";
  if (source === "resume" || source === "manual") return "resume";
  return "empty";
}

function sourceText(source) {
  if (source === "ai") return "AI 推测";
  if (source === "resume") return "简历";
  if (source === "manual") return "手动";
  return "未填写";
}

function render(state) {
  statusEl.textContent = state.token
    ? `已连接 · ${state.context?.company || "未指定公司"} · ${state.fields.length} 个字段`
    : "未连接 Liorvix，请先在 Liorvix 登录";
  fieldsEl.innerHTML = "";
  if (!state.results.length) {
    fieldsEl.innerHTML = '<p class="muted">还没有预填数据，先点击“扫描表单”。</p>';
    return;
  }
  for (const result of state.results) {
    if (!selectedKeys.has(result.key)) selectedKeys.add(result.key);
    const item = document.createElement("div");
    item.className = "field";
    const label = state.fields.find((f) => f.key === result.key)?.label || result.key;
    const checked = selectedKeys.has(result.key) ? "checked" : "";
    item.innerHTML = `
      <label>
        <input type="checkbox" data-key="${result.key}" ${checked} />
        <span>
          <strong>${escapeHtml(label)}</strong>
          <div class="meta"><span class="badge ${sourceClass(result.source)}">${sourceText(result.source)}</span>
          · ${Math.round(result.confidence * 100)}% 置信度</div>
          <input type="text" data-key="${result.key}" data-original="${escapeHtml(result.value || "")}" value="${escapeHtml(result.value || "")}" placeholder="${escapeHtml(result.reason || "等待手动填写")}" />
        </span>
      </label>`;
    fieldsEl.appendChild(item);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

document.getElementById("scan").addEventListener("click", async () => {
  showError("");
  try {
    const res = await chrome.runtime.sendMessage({ type: "scan" });
    if (!res?.ok) throw new Error(res?.error || "扫描失败");
    render(res.state);
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById("fill").addEventListener("click", async () => {
  showError("");
  const state = await getState();
  const keys = Array.from(selectedKeys);
  const values = {};
  for (const key of keys) {
    const input = fieldsEl.querySelector(`input[type=text][data-key="${key}"]`);
    if (input) values[key] = input.value;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: "fill", keys, values });
    if (!res?.ok) throw new Error(res?.error || "填写失败");
    const failed = (res.results || []).filter((r) => !r.filled);
    if (failed.length) {
      showError("部分字段未填写：\n" + failed.map((r) => r.reason).join("\n"));
    } else {
      statusEl.textContent = "填写完成，请检查后手动提交。";
    }
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById("mark-submitted").addEventListener("click", async () => {
  showError("");
  try {
    const res = await chrome.runtime.sendMessage({ type: "markSubmitted" });
    if (!res?.ok) throw new Error(res?.error || "标记失败");
    statusEl.textContent = "已在 Liorvix 申请管理中标记为已投递。";
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById("open-liorvix").addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:5000" });
});

fieldsEl.addEventListener("change", (event) => {
  const key = event.target.dataset.key;
  if (!key) return;
  if (event.target.checked) selectedKeys.add(key);
  else selectedKeys.delete(key);
});

getState().then(render).catch((e) => showError(e.message));
