const API_BASE = "http://localhost:5000";

let state = {
  token: "",
  context: null,
  fields: [],
  results: [],
  applicationId: null,
};

chrome.storage.session.get(["token", "context"], (stored) => {
  state.token = stored.token || "";
  state.context = stored.context || null;
});

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
      body: JSON.stringify({ job_id: state.context.jobId, status: "pending", notes: "" }),
    });
    state.applicationId = created.application?.id || null;
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
      await chrome.storage.session.set({ token: message.token });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "setJobContext") {
      state.context = message.context;
      await chrome.storage.session.set({ context: message.context });
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
      await ensureApplication("filling");
      const fill = await chrome.tabs.sendMessage(tab.id, { type: "fillForm", fields: selected });
      const fieldMap = new Map((state.fields || []).map((f) => [f.key, f]));
      const feedbackFields = selected
        .filter((r) => r.value)
        .map((r) => ({
          fieldKey: r.key,
          semanticKey: fieldMap.get(r.key)?.selectorHints?.semanticKey || r.key,
          suggestedValue: r.suggestedValue,
          finalValue: r.value,
          action: r.value === r.suggestedValue ? "confirmed" : "edited",
        }));
      const ignoredFields = (state.results || [])
        .filter((r) => !message.keys.includes(r.key) && r.value && r.source === "ai")
        .map((r) => ({
          fieldKey: r.key,
          semanticKey: fieldMap.get(r.key)?.selectorHints?.semanticKey || r.key,
          suggestedValue: r.value,
          finalValue: "",
          action: "ignored",
        }));
      if (feedbackFields.length > 0 || ignoredFields.length > 0) {
        try {
          await api("/api/application/prefill-feedback", {
            method: "POST",
            body: JSON.stringify({
              jobId: state.context?.jobId,
              company: state.context?.company,
              domain: tab.url ? new URL(tab.url).hostname : "",
              fields: [...feedbackFields, ...ignoredFields],
            }),
          });
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
    context: state.context,
    fields: state.fields,
    results: state.results,
    applicationId: state.applicationId,
  };
}
