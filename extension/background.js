const DEFAULT_API_BASE = "http://localhost:5000";

let state = {
  token: "",
  context: null,
  fields: [],
  results: [],
  applicationId: null,
  profileVersion: 0,
  apiBase: DEFAULT_API_BASE,
};

const SUPPORTED_SEMANTIC_KEYS = new Set([
  "first_name", "last_name", "full_name", "email", "phone", "address", "city",
  "state", "zip_code", "country", "linkedin", "github", "portfolio",
  "work_authorization", "visa_status", "summary", "skills", "languages",
]);

chrome.storage.session.get(["token", "context", "applicationId", "profileVersion", "apiBase"], (stored) => {
  state.token = stored.token || "";
  state.context = stored.context || null;
  state.applicationId = stored.applicationId || null;
  state.profileVersion = Number.isInteger(stored.profileVersion) ? stored.profileVersion : 0;
  state.apiBase = typeof stored.apiBase === "string" && stored.apiBase ? stored.apiBase : DEFAULT_API_BASE;
});

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${state.apiBase}${path}`, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || `请求失败: ${res.status}`);
  return data;
}

async function ensureApplication(status) {
  if (state.context?.jobId) {
    if (state.applicationId) {
      await api(`/api/applications/${state.applicationId}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      return state.applicationId;
    }
    const created = await api("/api/applications", {
      method: "POST",
      body: JSON.stringify({
        job_id: state.context.jobId,
        resume_id: state.context.resumeId || undefined,
        status: "pending",
        notes: "",
      }),
    });
    state.applicationId = created.application?.id || null;
    await chrome.storage.session.set({ applicationId: state.applicationId });
    if (state.applicationId && status !== "pending") {
      await api(`/api/applications/${state.applicationId}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    }
    return state.applicationId;
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "setAuthToken") {
      state.token = message.token;
      if (typeof message.apiBase === "string" && message.apiBase) state.apiBase = message.apiBase;
      await chrome.storage.session.set({ token: message.token, apiBase: state.apiBase });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "setJobContext") {
      const previous = state.context;
      const changed = previous?.jobId !== message.context?.jobId || previous?.jobUrl !== message.context?.jobUrl;
      state.context = message.context;
      if (changed) {
        state.applicationId = null;
        state.fields = [];
        state.results = [];
        state.profileVersion = 0;
      }
      await chrome.storage.session.set({
        context: message.context,
        applicationId: state.applicationId,
        profileVersion: state.profileVersion,
      });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "getState") {
      sendResponse({ ok: true, state: serializeState() });
      return;
    }
    if (message.type === "scan") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("没有可用的标签页");
      const scan = await chrome.tabs.sendMessage(tab.id, { type: "scanForm" });
      state.fields = scan.fields || [];
      state.results = [];
      if (state.token) {
        const prefill = await api("/api/application/prefill", {
          method: "POST",
          body: JSON.stringify({
            jobId: state.context?.jobId,
            company: state.context?.company,
            fields: state.fields,
          }),
        });
        state.results = prefill.fields || [];
        state.profileVersion = Number.isInteger(prefill.version) ? prefill.version : 0;
        await chrome.storage.session.set({ profileVersion: state.profileVersion });
      }
      sendResponse({ ok: true, state: serializeState() });
      return;
    }
    if (message.type === "fill") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("没有可用的标签页");
      const selected = (state.results || [])
        .filter((r) => message.keys.includes(r.key))
        .map((r) => {
          const value = message.values?.[r.key] ?? r.value;
          return { ...r, value, suggestedValue: r.value };
        });
      if (selected.length === 0) throw new Error("请先选择需要填写的字段");
      if (!selected.some((field) => field.value)) throw new Error("所选字段没有可填写的值");
      const fill = await chrome.tabs.sendMessage(tab.id, { type: "fillForm", fields: selected });
      if ((fill.results || []).some((result) => !result.filled)) {
        throw new Error("部分字段未填写，申请状态未更新，请重新扫描后重试");
      }
      await ensureApplication("filling");
      const fieldMap = new Map((state.fields || []).map((f) => [f.key, f]));
      const feedbackFields = selected
        .filter((r) => r.value)
        .map((r) => ({
          fieldKey: r.key,
          ...(SUPPORTED_SEMANTIC_KEYS.has(fieldMap.get(r.key)?.selectorHints?.semanticKey)
            ? { semanticKey: fieldMap.get(r.key).selectorHints.semanticKey }
            : {}),
          suggestedValue: r.suggestedValue,
          finalValue: r.value,
          action: r.value === r.suggestedValue ? "confirmed" : "edited",
        }));
      const ignoredFields = (state.results || [])
        .filter((r) => !message.keys.includes(r.key) && r.value && r.source === "ai")
        .map((r) => ({
          fieldKey: r.key,
          ...(SUPPORTED_SEMANTIC_KEYS.has(fieldMap.get(r.key)?.selectorHints?.semanticKey)
            ? { semanticKey: fieldMap.get(r.key).selectorHints.semanticKey }
            : {}),
          suggestedValue: r.value,
          finalValue: "",
          action: "ignored",
        }));
      if (feedbackFields.length > 0 || ignoredFields.length > 0) {
        try {
          const feedbackVersion = await api("/api/application/prefill-feedback", {
            method: "POST",
            body: JSON.stringify({
              version: state.profileVersion,
              jobId: state.context?.jobId,
              domain: tab.url ? new URL(tab.url).hostname : "",
              fields: [...feedbackFields, ...ignoredFields],
            }),
          });
          if (Number.isInteger(feedbackVersion.version)) {
            state.profileVersion = feedbackVersion.version;
            await chrome.storage.session.set({ profileVersion: state.profileVersion });
          }
        } catch (error) {
          console.error("Prefill feedback failed:", error);
        }
      }
      sendResponse({ ok: true, results: fill.results || [], state: serializeState() });
      return;
    }
    if (message.type === "markSubmitted") {
      const id = await ensureApplication("submitted");
      if (!id) throw new Error("尚未找到申请记录");
      sendResponse({ ok: true });
      return;
    }
  })().then(() => {}, (error) => {
    console.error("Background error:", error);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

function serializeState() {
  return {
    token: Boolean(state.token),
    apiBase: state.apiBase,
    context: state.context,
    fields: state.fields,
    results: state.results,
    applicationId: state.applicationId,
  };
}
