/**
 * Liorvix DOM 引擎 v0.2
 *
 * 一份代码两处用：
 *  - 浏览器扩展：manifest 里先加载本文件，content.js 只做消息收发；
 *  - 本地 Agent：Playwright 用 addScriptTag 注入每一帧。
 *
 * 对外只暴露 window.__liorvixEngine，接口：
 *   scan()                    → { fields, automationIds, pageText, url, title }
 *   fill(values)              → [{ key, filled, reason, value }]
 *   attachFileBase64(b64, t)  → { ok, reason }（扩展用；Agent 直接走原生 setInputFiles）
 *   findFileInputs()          → [{ index, name, id, automationId }]
 *   advance({ next, submit }) → { action: 'clicked_next'|'needs_submit'|'none', text }
 *   fingerprint()             → string
 *
 * 设计要点（对比 v0.1）：
 *  - label 不再只看 labels[0]：aria-labelledby → aria-label → label → 容器内 label 文本 → 上一个兄弟节点 → placeholder → name/id；
 *  - 支持 shadow DOM 递归、radio 组、checkbox、date、自定义下拉（role=combobox / aria-haspopup=listbox）；
 *  - 每个字段带 section 上下文，供语义消歧；
 *  - 填不进去不再"假成功"：逐字段回读校验，返回真实结果。
 */
(function () {
  'use strict';
  if (window.__liorvixEngine && window.__liorvixEngine.version) return;

  var VERSION = '0.2.0';
  var FIELD_MAP = new Map();
  var RADIO_GROUPS = new Map();

  // ---------------------------------------------------------------- utils

  function norm(text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(text) {
    return norm(text).toLowerCase();
  }

  function cssEscape(value) {
    var raw = String(value == null ? '' : value);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);
    return raw.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function isHiddenByStyle(el) {
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 40) {
      var style = window.getComputedStyle(node);
      if (!style) break;
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      if (style.opacity === '0' && node !== el) return true;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
      depth += 1;
    }
    return false;
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    if (el.disabled) return false;
    if (isHiddenByStyle(el)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    // 有些控件被视觉隐藏但仍可操作（例如反爬蜜罐），尺寸为 0 已在上面排除
    return true;
  }

  function textOf(el) {
    if (!el) return '';
    if (el.tagName === 'INPUT') {
      var type = lower(el.getAttribute('type'));
      if (type === 'submit' || type === 'button' || type === 'reset') return norm(el.value);
    }
    return norm(el.innerText || el.textContent || '');
  }

  function humanize(value) {
    return norm(String(value || '')
      .replace(/\$?ctl\d+\$?/gi, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.[\]]+/g, ' ')
      .replace(/\d{2,}/g, ' '));
  }

  function stripLabelNoise(text) {
    return norm(text)
      .replace(/^\s*(q\s*\d{1,2}[).:\-]?)\s*/i, '')
      .replace(/\(\s*(required|optional|必填|选填)\s*\)/gi, '')
      .replace(/\s*[:*]\s*$/, '')
      .replace(/\s*\*\s*$/, '')
      .replace(/^\s*\*\s*/, '');
  }

  // ------------------------------------------------- shadow DOM 遍历

  function collectRoots(root, out, depth) {
    if (!root || depth > 30) return out;
    out.push(root);
    var all;
    try {
      all = root.querySelectorAll('*');
    } catch (error) {
      return out;
    }
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].shadowRoot) collectRoots(all[i].shadowRoot, out, depth + 1);
    }
    return out;
  }

  function searchRoots() {
    return collectRoots(document, [], 0);
  }

  function queryDeep(selector) {
    var roots = searchRoots();
    var found = [];
    for (var i = 0; i < roots.length; i += 1) {
      try {
        var list = roots[i].querySelectorAll(selector);
        for (var j = 0; j < list.length; j += 1) found.push(list[j]);
      } catch (error) { /* 非法选择器忽略 */ }
    }
    return found;
  }

  function ownerDocumentOf(el) {
    return el.ownerDocument || document;
  }

  // ------------------------------------------------- 标签提取

  function labelFromIds(el, ids) {
    if (!ids) return '';
    var doc = ownerDocumentOf(el);
    var rootNode = el.getRootNode && el.getRootNode();
    var parts = [];
    var list = String(ids).split(/\s+/);
    for (var i = 0; i < list.length; i += 1) {
      var target = null;
      if (rootNode && rootNode.getElementById) target = rootNode.getElementById(list[i]);
      if (!target) target = doc.getElementById(list[i]);
      if (target) parts.push(textOf(target));
    }
    return norm(parts.join(' '));
  }

  function labelFromContainer(el) {
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < 5) {
      var candidates = [];
      try {
        candidates = node.querySelectorAll('label, legend, .label, [class*="label" i], [class*="Label"], dt, [data-automation-id$="label"], [data-automation-id$="Label"]');
      } catch (error) {
        candidates = [];
      }
      for (var i = 0; i < candidates.length && i < 6; i += 1) {
        var text = textOf(candidates[i]);
        if (!text) continue;
        if (text.length > 160) continue;
        // 容器自己的文字里可能包含选项文本，过滤掉过长的段落
        if (candidates[i].contains(el)) continue;
        return text;
      }
      if (node.tagName === 'FIELDSET') break;
      node = node.parentElement;
      depth += 1;
    }
    return '';
  }

  function labelFromPrevious(el) {
    var node = el.previousElementSibling;
    var hops = 0;
    while (node && hops < 3) {
      var text = textOf(node);
      if (text && text.length <= 160 && !node.querySelector('input, select, textarea')) return text;
      node = node.previousElementSibling;
      hops += 1;
    }
    return '';
  }

  function labelFor(el) {
    var labelledBy = el.getAttribute('aria-labelledby');
    var fromIds = labelFromIds(el, labelledBy);
    if (fromIds) return stripLabelNoise(fromIds);

    var aria = el.getAttribute('aria-label');
    if (aria && norm(aria)) return stripLabelNoise(aria);

    var labels = el.labels;
    if (labels && labels.length) {
      var joined = [];
      for (var i = 0; i < labels.length; i += 1) joined.push(textOf(labels[i]));
      var text = norm(joined.join(' '));
      if (text) return stripLabelNoise(text);
    }

    var wrapping = el.closest ? el.closest('label') : null;
    if (wrapping) {
      var wrapText = textOf(wrapping);
      if (wrapText && wrapText.length <= 160) return stripLabelNoise(wrapText);
    }

    var fromContainer = labelFromContainer(el);
    if (fromContainer) return stripLabelNoise(fromContainer);

    var fromPrevious = labelFromPrevious(el);
    if (fromPrevious) return stripLabelNoise(fromPrevious);

    var placeholder = el.getAttribute('placeholder');
    if (placeholder && norm(placeholder)) return stripLabelNoise(placeholder);

    var title = el.getAttribute('title');
    if (title && norm(title)) return stripLabelNoise(title);

    var automation = el.getAttribute('data-automation-id');
    if (automation) return stripLabelNoise(humanize(automation));

    return stripLabelNoise(humanize(el.getAttribute('name') || el.getAttribute('id') || ''));
  }

  function sectionFor(el) {
    var fieldset = el.closest ? el.closest('fieldset') : null;
    if (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (legend) return norm(textOf(legend)).slice(0, 200);
    }
    var container = el.closest
      ? el.closest('[role="group"], [data-automation-id$="Section"], [data-automation-id*="section"], section, .form-section, .application-question')
      : null;
    if (container) {
      var heading = container.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], legend');
      if (heading) return norm(textOf(heading)).slice(0, 200);
      var automation = container.getAttribute && container.getAttribute('data-automation-id');
      if (automation) return norm(humanize(automation)).slice(0, 200);
    }
    // 往上找最近的标题
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < 8) {
      var previous = node.previousElementSibling;
      while (previous && previous !== node) {
        if (/^H[1-6]$/.test(previous.tagName) || previous.getAttribute('role') === 'heading') {
          return norm(textOf(previous)).slice(0, 200);
        }
        previous = previous.previousElementSibling;
      }
      node = node.parentElement;
      depth += 1;
    }
    return '';
  }

  // ------------------------------------------------- 控件发现

  var CONTROL_SELECTOR = [
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="combobox"]',
    '[aria-haspopup="listbox"]',
  ].join(',');

  function isSkippable(el) {
    if (!el || !el.tagName) return true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    var tag = el.tagName;
    if (tag === 'INPUT') {
      var type = lower(el.getAttribute('type'));
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return true;
    }
    if (el.getAttribute('readonly') !== null && el.getAttribute('type') !== 'checkbox') {
      // 只读字段改不了，但没有值的只读字段依然值得报出来
      return !el.value;
    }
    return false;
  }

  function controlType(el) {
    var tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') {
      var type = lower(el.getAttribute('type') || 'text');
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'file') return 'file';
      return type;
    }
    if (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox') return 'combobox';
    return 'text';
  }

  function optionsFor(el, type) {
    if (type === 'select') {
      var out = [];
      for (var i = 0; i < el.options.length; i += 1) {
        var option = el.options[i];
        var label = norm(option.label || option.text || option.value);
        if (!label) continue;
        if (option.disabled) continue;
        out.push(label);
      }
      return out;
    }
    return [];
  }

  function automationIdOf(el) {
    return el.getAttribute('data-automation-id') || el.getAttribute('data-automationid') || '';
  }

  function radioGroupLabel(el) {
    var fieldset = el.closest ? el.closest('fieldset') : null;
    if (fieldset && fieldset.querySelector('legend')) return norm(textOf(fieldset.querySelector('legend')));
    var group = el.closest ? el.closest('[role="radiogroup"]') : null;
    if (group) {
      var aria = group.getAttribute('aria-label');
      if (aria) return norm(aria);
      var labelled = labelFromIds(group, group.getAttribute('aria-labelledby'));
      if (labelled) return labelled;
    }
    return labelFor(el);
  }

  function radioOptionLabel(input) {
    var wrapping = input.closest ? input.closest('label') : null;
    if (wrapping) return norm(textOf(wrapping));
    var id = input.getAttribute('id');
    if (id) {
      var doc = ownerDocumentOf(input);
      var explicit = doc.querySelector('label[for="' + cssEscape(id) + '"]');
      if (explicit) return norm(textOf(explicit));
    }
    return norm(input.getAttribute('aria-label') || input.value || '');
  }

  function scan() {
    FIELD_MAP = new Map();
    RADIO_GROUPS = new Map();

    var controls = queryDeep(CONTROL_SELECTOR);
    var fields = [];
    var automationIds = [];
    var seen = new Set();
    var radioSeen = new Set();
    var index = 0;

    for (var i = 0; i < controls.length; i += 1) {
      var el = controls[i];
      if (isSkippable(el)) continue;
      if (!visible(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);

      var type = controlType(el);
      var automation = automationIdOf(el);
      if (automation && automationIds.indexOf(automation) === -1) automationIds.push(automation);

      if (type === 'radio') {
        var groupName = el.getAttribute('name') || radioGroupLabel(el);
        if (radioSeen.has(groupName)) continue;
        radioSeen.add(groupName);
        var groupInputs = controls.filter(function (candidate) {
          return candidate.tagName === 'INPUT'
            && lower(candidate.getAttribute('type')) === 'radio'
            && (candidate.getAttribute('name') || '') === (el.getAttribute('name') || '')
            && visible(candidate);
        });
        var options = groupInputs.map(radioOptionLabel).filter(Boolean);
        var key = 'f' + index;
        index += 1;
        FIELD_MAP.set(key, { element: el, type: 'radio', inputs: groupInputs });
        fields.push({
          key: key,
          label: radioGroupLabel(el),
          type: 'radio',
          name: el.getAttribute('name') || '',
          id: el.getAttribute('id') || '',
          automationId: automation,
          placeholder: '',
          required: el.required || el.getAttribute('aria-required') === 'true',
          options: options,
          disabled: false,
          currentValue: (groupInputs.filter(function (candidate) { return candidate.checked; })[0] || {}).value || '',
          section: sectionFor(el),
        });
        continue;
      }

      var key2 = 'f' + index;
      index += 1;
      var optionsForField = optionsFor(el, type);
      FIELD_MAP.set(key2, { element: el, type: type, options: optionsForField });
      fields.push({
        key: key2,
        label: labelFor(el),
        type: type,
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        automationId: automation,
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        required: Boolean(el.required) || el.getAttribute('aria-required') === 'true',
        options: optionsForField,
        disabled: Boolean(el.disabled),
        currentValue: type === 'checkbox' ? (el.checked ? 'checked' : '') : String(el.value || ''),
        section: sectionFor(el),
      });
    }

    return {
      version: VERSION,
      url: location.href,
      title: document.title,
      fields: fields,
      automationIds: automationIds,
      pageText: norm(document.body ? document.body.innerText : '').slice(0, 8000),
    };
  }

  // ------------------------------------------------- 写入

  function setNativeValue(el, value) {
    var proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeOptionText(value) {
    return lower(value)
      .replace(/[（(]\s*(required|optional|必填|选填)\s*[)）]/g, '')
      .replace(/^[\s*•·-]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var YES_WORDS = ['yes', 'y', 'true', '1', '是', '同意', '愿意', '有'];
  var NO_WORDS = ['no', 'n', 'false', '0', '否', '不同意', '不愿意', '没有'];

  function matchOption(options, value) {
    var wanted = normalizeOptionText(value);
    if (!wanted) return null;
    var normalized = options.map(function (option) { return { raw: option, norm: normalizeOptionText(option) }; });

    var exact = normalized.find(function (option) { return option.norm === wanted; });
    if (exact) return exact.raw;

    var synonyms = [wanted];
    if (YES_WORDS.indexOf(wanted) !== -1) synonyms = synonyms.concat(YES_WORDS);
    if (NO_WORDS.indexOf(wanted) !== -1) synonyms = synonyms.concat(NO_WORDS);

    for (var i = 0; i < synonyms.length; i += 1) {
      var hit = normalized.find(function (option) { return option.norm === synonyms[i]; });
      if (hit) return hit.raw;
    }
    for (var j = 0; j < synonyms.length; j += 1) {
      var needle = synonyms[j];
      if (!needle || needle.length < 2) continue;
      var partial = normalized.find(function (option) { return option.norm.indexOf(needle) !== -1 || needle.indexOf(option.norm) !== -1; });
      if (partial) return partial.raw;
    }
    return null;
  }

  function fillSelect(el, value) {
    var options = [];
    for (var i = 0; i < el.options.length; i += 1) {
      if (!el.options[i].disabled) options.push(norm(el.options[i].label || el.options[i].text || el.options[i].value));
    }
    var chosen = matchOption(options, value);
    if (!chosen) return { filled: false, reason: '找不到选项: ' + value };
    for (var j = 0; j < el.options.length; j += 1) {
      var option = el.options[j];
      if (norm(option.label || option.text || option.value) === chosen) {
        setNativeValue(el, option.value);
        var actual = norm(option.label || option.text || option.value);
        return { filled: true, value: actual };
      }
    }
    return { filled: false, reason: '选项写入失败' };
  }

  function fillRadio(entry, value) {
    var wanted = lower(value);
    var inputs = entry.inputs || [];
    for (var i = 0; i < inputs.length; i += 1) {
      var label = lower(radioOptionLabel(inputs[i]));
      var raw = lower(inputs[i].value);
      if (label === wanted || raw === wanted || (label && label.indexOf(wanted) !== -1)) {
        if (!inputs[i].checked) inputs[i].click();
        return { filled: true, value: label || raw };
      }
    }
    // yes/no 兜底
    var isYes = YES_WORDS.indexOf(wanted) !== -1;
    var isNo = NO_WORDS.indexOf(wanted) !== -1;
    if (isYes || isNo) {
      for (var k = 0; k < inputs.length; k += 1) {
        var optionLabel = lower(radioOptionLabel(inputs[k]) + ' ' + inputs[k].value);
        if (isYes && /(^|\b)(yes|是|同意)/.test(optionLabel)) { inputs[k].click(); return { filled: true, value: optionLabel }; }
        if (isNo && /(^|\b)(no|否|不同意)/.test(optionLabel)) { inputs[k].click(); return { filled: true, value: optionLabel }; }
      }
    }
    return { filled: false, reason: '找不到单选项: ' + value };
  }

  function fillCheckbox(el, value) {
    var truthy = value === true || /^(yes|true|1|是|agree|同意|i agree)/i.test(norm(value));
    if (el.checked !== truthy) el.click();
    return { filled: true, value: truthsString(truthy) };
  }

  function truthsString(value) {
    return value ? 'checked' : 'unchecked';
  }

  // 自定义下拉：点开 → 等 listbox → 选中 → 回读
  function fillCombobox(el, value) {
    return new Promise(function (resolve) {
      var before = norm(el.innerText || el.textContent || el.value || '');
      try {
        el.scrollIntoView({ block: 'center' });
        el.click();
      } catch (error) {
        resolve({ filled: false, reason: '下拉无法点击' });
        return;
      }
      var attempts = 0;
      var timer = setInterval(function () {
        attempts += 1;
        var listbox = document.querySelector('[role="listbox"], [data-automation-id*="options"], ul[role="menu"]');
        var options = listbox
          ? Array.prototype.slice.call(listbox.querySelectorAll('[role="option"], li, [data-automation-id*="option"]'))
          : [];
        var labels = options.map(function (option) { return norm(option.innerText || option.textContent); }).filter(Boolean);
        if (!labels.length && attempts < 8) return;
        clearInterval(timer);
        if (!labels.length) {
          resolve({ filled: false, reason: '下拉没有展开选项' });
          return;
        }
        var chosen = matchOption(labels, value);
        if (!chosen) {
          document.body.click();
          resolve({ filled: false, reason: '下拉里没有匹配项: ' + value });
          return;
        }
        var target = options.filter(function (option) { return norm(option.innerText || option.textContent) === chosen; })[0];
        if (!target) {
          resolve({ filled: false, reason: '选项节点丢失' });
          return;
        }
        target.click();
        setTimeout(function () {
          var after = norm(el.innerText || el.textContent || el.value || '');
          resolve({
            filled: after !== before || after.indexOf(chosen) !== -1,
            value: after || chosen,
            reason: after === before ? '点击选项后控件没有更新' : undefined,
          });
        }, 220);
      }, 120);
    });
  }

  function fillDate(el, value) {
    var raw = norm(value);
    var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      setNativeValue(el, raw);
      return { filled: true, value: raw };
    }
    var parsed = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (parsed) {
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var isoValue = parsed[3] + '-' + pad(parsed[1]) + '-' + pad(parsed[2]);
      setNativeValue(el, isoValue);
      return { filled: true, value: isoValue };
    }
    setNativeValue(el, raw);
    return { filled: Boolean(el.value), value: el.value };
  }

  function fill(values) {
    var results = [];
    var items = Array.isArray(values) ? values : [];

    function run(index) {
      if (index >= items.length) return Promise.resolve(results);
      var item = items[index];
      var entry = FIELD_MAP.get(item.key);
      if (!entry) {
        results.push({ key: item.key, filled: false, reason: '字段已失效，请重新扫描' });
        return run(index + 1);
      }
      var el = entry.element;
      var value = item.value == null ? '' : String(item.value);
      var outcome;

      if (item.type === 'radio' || entry.type === 'radio') {
        outcome = fillRadio(entry, value);
      } else if (entry.type === 'checkbox') {
        outcome = fillCheckbox(el, value);
      } else if (entry.type === 'select') {
        outcome = fillSelect(el, value);
      } else if (entry.type === 'combobox') {
        return fillCombobox(el, value).then(function (result) {
          results.push({ key: item.key, filled: result.filled, reason: result.reason, value: result.value });
          return run(index + 1);
        });
      } else if (entry.type === 'date') {
        outcome = fillDate(el, value);
      } else if (entry.type === 'file') {
        outcome = { filled: false, reason: '文件字段由上传通道处理' };
      } else {
        try {
          el.scrollIntoView({ block: 'center' });
        } catch (error) { /* noop */ }
        try { el.focus(); } catch (error) { /* noop */ }
        setNativeValue(el, value);
        outcome = { filled: String(el.value) === value || String(el.value) === norm(value), value: el.value, reason: el.value ? undefined : '写入后值为空' };
      }

      results.push({ key: item.key, filled: Boolean(outcome.filled), reason: outcome.reason, value: outcome.value });
      return run(index + 1);
    }

    return run(0);
  }

  // ------------------------------------------------- 文件上传（扩展用）

  function base64ToBytes(base64) {
    var binary = window.atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function findFileInputs() {
    var inputs = queryDeep('input[type="file"]').filter(visible);
    return inputs.map(function (input, index) {
      return {
        index: index,
        name: input.getAttribute('name') || '',
        id: input.getAttribute('id') || '',
        automationId: automationIdOf(input),
        accept: input.getAttribute('accept') || '',
        multiple: Boolean(input.multiple),
      };
    });
  }

  function attachFileBase64(base64, payload) {
    var info = payload || {};
    var kind = info.kind || 'resume';
    var inputs = queryDeep('input[type="file"]');
    var chosen = null;
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      if (!visible(input)) continue;
      var hint = lower([input.getAttribute('name'), input.getAttribute('id'), automationIdOf(input), input.getAttribute('aria-label')].join(' '));
      if (kind === 'resume' && /(resume|cv|curriculum|履歷|简历)/.test(hint)) { chosen = input; break; }
      if (kind === 'cover_letter' && /(cover|letter|自荐|求职信)/.test(hint)) { chosen = input; break; }
      if (!chosen) chosen = input;
    }
    if (!chosen) return { ok: false, reason: '页面上没有可用的文件输入' };

    try {
      var fileName = info.fileName || 'resume.pdf';
      var mimeType = info.mimeType || 'application/pdf';
      var file = new File([base64ToBytes(base64)], fileName, { type: mimeType });
      var transfer = new DataTransfer();
      transfer.items.add(file);
      chosen.files = transfer.files;
      chosen.dispatchEvent(new Event('input', { bubbles: true }));
      chosen.dispatchEvent(new Event('change', { bubbles: true }));
      var attached = chosen.files && chosen.files.length > 0;
      return { ok: attached, reason: attached ? undefined : '浏览器拒绝了文件写入' };
    } catch (error) {
      return { ok: false, reason: '写入文件失败: ' + (error && error.message) };
    }
  }

  // ------------------------------------------------- 翻页 / 提交

  var NEXT_TEXT = /^(next|continue|save and continue|save & continue|proceed|下一步|继续|保存并继续)\b/i;
  var SUBMIT_TEXT = /(submit|submit application|apply|apply now|send application|提交申请|提交|确认提交)/i;

  function clickableIn(selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var found = [];
      try { found = queryDeep(selectors[i]); } catch (error) { found = []; }
      for (var j = 0; j < found.length; j += 1) {
        if (visible(found[j])) return found[j];
      }
    }
    return null;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.className && typeof el.className === 'string' && /disabled/i.test(el.className)) return true;
    return false;
  }

  function buttons() {
    return queryDeep('button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]').filter(visible);
  }

  function findSubmit(selectors) {
    var explicit = clickableIn(selectors || []);
    if (explicit) return explicit;
    var candidates = buttons().filter(function (el) {
      var text = textOf(el) || norm(el.getAttribute('value'));
      return text && SUBMIT_TEXT.test(text) && !NEXT_TEXT.test(text);
    });
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function findNext(selectors) {
    var explicit = clickableIn(selectors || []);
    if (explicit && !isDisabled(explicit)) return explicit;
    var candidates = buttons().filter(function (el) {
      var text = textOf(el) || norm(el.getAttribute('value'));
      return text && NEXT_TEXT.test(text) && !SUBMIT_TEXT.test(text.replace(NEXT_TEXT, ''));
    });
    var enabled = candidates.filter(function (el) { return !isDisabled(el); });
    return enabled.length ? enabled[0] : null;
  }

  function advance(options) {
    var config = options || {};
    var submit = findSubmit(config.submit || []);
    var next = findNext(config.next || []);
    if (next) {
      next.scrollIntoView({ block: 'center' });
      next.click();
      return { action: 'clicked_next', text: textOf(next) || norm(next.getAttribute('value')) };
    }
    if (submit) return { action: 'needs_submit', text: textOf(submit) || norm(submit.getAttribute('value')) };
    return { action: 'none', text: '' };
  }

  function clickSubmit(selectors) {
    var submit = findSubmit(selectors || []);
    if (!submit || isDisabled(submit)) return { ok: false, reason: '提交按钮不存在或不可用' };
    submit.scrollIntoView({ block: 'center' });
    submit.click();
    return { ok: true, text: textOf(submit) };
  }

  function fingerprint() {
    var headers = queryDeep('h1, h2, h3, [role="heading"]').slice(0, 3).map(textOf).join('|');
    var controls = queryDeep('input, select, textarea').length;
    var steps = queryDeep('[aria-current="step"], [data-automation-id*="progress"]').map(textOf).join('|');
    return [location.pathname, controls, headers.slice(0, 160), steps.slice(0, 80)].join('::');
  }

  window.__liorvixEngine = {
    version: VERSION,
    scan: scan,
    fill: fill,
    findFileInputs: findFileInputs,
    attachFileBase64: attachFileBase64,
    advance: advance,
    clickSubmit: clickSubmit,
    fingerprint: fingerprint,
  };
})();
