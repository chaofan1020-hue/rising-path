(function () {
  let scannedFields = [];

  function visible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
  }

  function clean(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function fieldLabel(el) {
    if (el.labels && el.labels[0]) return clean(el.labels[0].textContent);
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return clean(placeholder);
    return clean(el.name || el.id || "");
  }

  function classify(text) {
    const t = text.toLowerCase();
    const rules = [
      [/first\s*name|firstname/, "first_name"],
      [/last\s*name|lastname|surname|family\s*name/, "last_name"],
      [/^name$|full\s*name/, "full_name"],
      [/email|e-?mail/, "email"],
      [/phone|telephone|mobile|contact\s*number/, "phone"],
      [/street|address/, "address"],
      [/city|town/, "city"],
      [/state|province/, "state"],
      [/zip|postal/, "zip_code"],
      [/country|nationality/, "country"],
      [/linkedin/, "linkedin"],
      [/github/, "github"],
      [/portfolio|personal\s*website|website/, "portfolio"],
      [/skills|technologies/, "skills"],
      [/company|employer/, "company"],
      [/job\s*title|position|role/, "job_title"],
      [/work\s*authorization|work\s*auth/, "work_authorization"],
      [/visa|immigration/, "visa_status"],
      [/cover\s*letter/, "cover_letter"],
      [/school|university|college/, "school"],
      [/degree/, "degree"],
      [/major|field\s*of\s*study/, "major"],
      [/graduation\s*date|graduation/, "graduation_date"],
      [/gpa/, "gpa"],
      [/cv|attachment|upload/, "file"],
      [/summary|about\s*me|bio/, "summary"],
    ];
    for (const [pattern, key] of rules) {
      if (pattern.test(t)) return key;
    }
    return "";
  }

  function scanForm() {
    const selectors = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";
    const nodes = Array.from(document.querySelectorAll(selectors)).filter(visible);
    scannedFields = nodes.map((el, index) => {
      const label = fieldLabel(el);
      const semanticKey = classify(label + " " + el.name + " " + el.id);
      const type = el.tagName.toLowerCase() === "select"
        ? "select"
        : el.type || "text";
      const finalSemanticKey = type === "file" ? "file" : semanticKey;
      const options = el.tagName.toLowerCase() === "select"
        ? Array.from(el.options).map((o) => o.text || o.value).filter(Boolean)
        : [];
      const groupIndex = nodes
        .slice(0, index)
        .filter((candidate) => candidate.name === el.name && candidate.type === el.type)
        .length;
      return {
        key: `${type}-${el.id || el.name || "field"}-${index}`,
        label,
        type,
        required: el.required || false,
        name: el.name || "",
        id: el.id || "",
        placeholder: el.getAttribute("placeholder") || "",
        options,
        selectorHints: {
          semanticKey: finalSemanticKey || label.toLowerCase().replace(/[^a-z0-9]+/g, "_") || el.name || el.id || String(index),
          index,
          id: el.id || "",
          name: el.name || "",
          groupIndex,
        },
      };
    });
    return scannedFields;
  }

  function findField(key) {
    const index = Number(key.split("-").pop());
    const matches = scanForm();
    return matches.find((f) => f.key === key) ? document.querySelectorAll(
      "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"
    )[index] : null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillField(field, value) {
    const index = Number(field.selectorHints.index);
    const nodes = Array.from(document.querySelectorAll(
      "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"
    )).filter(visible);
    const hints = field.selectorHints || {};
    let el = hints.id ? document.getElementById(String(hints.id)) : null;
    if (!el && hints.name) {
      const candidates = nodes.filter((candidate) => candidate.name === String(hints.name));
      el = candidates[Number(hints.groupIndex) || 0] || null;
    }
    if (!el) el = nodes[index];
    if (!el) return { key: field.key, filled: false, reason: "页面结构已变化，请重新扫描" };
    if ((hints.id && el.id !== String(hints.id)) || (hints.name && el.name !== String(hints.name))) {
      return { key: field.key, filled: false, reason: "页面字段已变化，请重新扫描" };
    }
    if (el.tagName.toLowerCase() === "select") {
      const option = Array.from(el.options).find((o) =>
        o.value.toLowerCase() === String(value).toLowerCase() ||
        o.text.toLowerCase() === String(value).toLowerCase()
      );
      if (!option) return { key: field.key, filled: false, reason: `找不到选项: ${value}` };
      setNativeValue(el, option.value);
      return { key: field.key, filled: true };
    }
    if (el.type === "checkbox") {
      const shouldCheck = value === true || String(value).toLowerCase() === "yes" || String(value) === "1";
      el.checked = shouldCheck;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { key: field.key, filled: true };
    }
    if (el.type === "file") {
      return { key: field.key, filled: false, reason: "文件上传需要手动选择" };
    }
    setNativeValue(el, String(value));
    return { key: field.key, filled: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "scanForm") {
      sendResponse({ ok: true, fields: scanForm() });
      return true;
    }
    if (message.type === "fillForm") {
      const results = [];
      for (const field of message.fields) {
        const item = scannedFields.find((f) => f.key === field.key);
        if (item && field.value) {
          results.push(fillField(item, field.value));
        } else if (item && item.type === "file") {
          results.push({ key: field.key, filled: false, reason: "文件上传需要手动选择" });
        }
      }
      sendResponse({ ok: true, results });
      return true;
    }
    if (message.type === "getState") {
      sendResponse({ ok: true, url: location.href, fields: scannedFields.length });
      return true;
    }
  });

  function submitLike(el) {
    if (!el) return false;
    const text = ((el.textContent || "") + " " + (el.getAttribute("value") || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
    if (/continue|next|confirm|save|review|继续|下一步|确认信息|保存/.test(text)) return false;
    return /submit|submit application|apply now|提交申请|确认提交/.test(text) &&
      (el.tagName === "BUTTON" || el.type === "submit");
  }

  function showSubmitConfirm() {
    if (document.getElementById("liorvix-submit-confirm")) return;
    const box = document.createElement("div");
    box.id = "liorvix-submit-confirm";
    box.setAttribute("role", "dialog");
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;border-radius:12px;padding:14px 16px;max-width:320px;box-shadow:0 12px 32px rgba(0,0,0,.25);font:14px/1.5 system-ui,sans-serif;";
    box.innerHTML = `
      <div style="margin-bottom:10px">已检测到提交，是否标记为已投递？</div>
      <div style="display:flex;gap:8px">
        <button data-action="confirm" style="flex:1;border:0;border-radius:8px;padding:7px 10px;background:#fff;color:#111;cursor:pointer">标记已投递</button>
        <button data-action="ignore" style="flex:1;border:1px solid #444;border-radius:8px;padding:7px 10px;background:transparent;color:#ddd;cursor:pointer">忽略</button>
      </div>`;
    document.documentElement.appendChild(box);
    box.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (action === "confirm") {
        chrome.runtime.sendMessage({ type: "markSubmitted" }).catch(() => {});
        box.remove();
      } else if (action === "ignore") {
        box.remove();
      }
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, input[type=submit]");
    if (submitLike(target)) showSubmitConfirm();
  }, true);

  function isLiorvixPage() {
    return location.hostname === "localhost"
      || location.hostname === "127.0.0.1"
      || location.hostname === "app.liorvix.com";
  }

  function announceExtensionReady(requestId) {
    window.postMessage({
      type: "liorvix-extension-ready",
      requestId: requestId || undefined,
      version: chrome.runtime.getManifest().version,
    }, location.origin);
  }

  if (isLiorvixPage()) {
    announceExtensionReady();
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === "liorvix-extension-ping") {
        announceExtensionReady(event.data.requestId);
      }
    });

    setTimeout(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            const accessToken = parsed?.access_token || parsed?.session?.access_token;
            if (accessToken) {
              chrome.runtime.sendMessage({
                type: "setAuthToken",
                token: accessToken,
                apiBase: location.origin,
              }).catch(() => {});
            }
          } catch {}
        }
      }
    }, 500);
    window.addEventListener("message", (event) => {
      if (event.data?.type === "liorvix-apply-context" && event.data.context) {
        chrome.runtime.sendMessage({ type: "setJobContext", context: event.data.context }).catch(() => {});
      }
    });
  }
})();
