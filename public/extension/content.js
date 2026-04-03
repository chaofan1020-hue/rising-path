// PathUp AutoFill - Content Script
// 检测网页表单并自动填写

(function() {
  'use strict';

  // 存储从后台获取的字段映射
  let fieldMappings = [];
  let parsedFields = {};
  let currentCompany = '';

  // 常见表单字段名称映射
  const COMMON_FIELD_PATTERNS = {
    // 姓名相关
    'name': ['name', 'fullname', 'full_name', 'your-name', 'candidate-name'],
    'first_name': ['firstname', 'first_name', 'given-name', 'fname'],
    'last_name': ['lastname', 'last_name', 'family-name', 'lname'],
    
    // 联系方式
    'email': ['email', 'email-address', 'e-mail', 'mail'],
    'phone': ['phone', 'phone-number', 'telephone', 'mobile', 'cell'],
    
    // 地址
    'address': ['address', 'street-address', 'address-line1'],
    'city': ['city', 'town', 'locality'],
    'state': ['state', 'province', 'region'],
    'zip_code': ['zip', 'zip-code', 'postal', 'postal-code'],
    'country': ['country', 'country-code'],
    
    // 教育背景
    'school': ['school', 'university', 'college', 'institution'],
    'degree': ['degree', 'education-level', 'highest-degree'],
    'major': ['major', 'field-of-study', 'specialization'],
    'graduation_date': ['graduation-date', 'grad-date', 'graduation-year'],
    'gpa': ['gpa', 'grade-point-average'],
    
    // 工作经历
    'company': ['company', 'employer', 'company-name'],
    'job_title': ['title', 'job-title', 'position', 'job_title'],
    
    // 其他
    'skills': ['skills', 'technical-skills', 'competencies'],
    'linkedin': ['linkedin', 'linked-in'],
    'github': ['github', 'git-hub'],
    'cover_letter': ['cover-letter', 'cover_letter', 'personal-statement']
  };

  // 初始化
  async function init() {
    try {
      // 从存储获取配置
      const result = await chrome.storage.local.get(['fieldMappings', 'parsedFields']);
      fieldMappings = result.fieldMappings || [];
      parsedFields = result.parsedFields || {};
      
      // 检测当前页面公司名
      detectCompany();
      
      // 检测并填充表单
      detectAndFillForm();
      
      // 添加可视化标识
      addVisualIndicator();
      
    } catch (error) {
      console.error('PathUp AutoFill Error:', error);
    }
  }

  // 检测当前页面的公司名
  function detectCompany() {
    const hostname = window.location.hostname;
    const title = document.title.toLowerCase();
    
    let company = hostname
      .replace(/^www\./, '')
      .replace(/\.(com|org|net|co|io|careers)/g, '')
      .split('.')[0];
    
    const titleMatch = title.match(/(?:at|@|with|-|\|)\s*([a-zA-Z0-9]+)/i);
    if (titleMatch) {
      company = titleMatch[1];
    }
    
    currentCompany = company;
  }

  // 查找页面上的表单
  function findForms() {
    const forms = document.querySelectorAll('form');
    const formContainers = document.querySelectorAll('[class*="application"], [class*="apply"]');
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    
    return {
      forms: Array.from(forms),
      formContainers: Array.from(formContainers),
      standaloneInputs: Array.from(inputs).filter(input => !input.closest('form'))
    };
  }

  // 匹配表单字段
  function matchField(inputElement) {
    const name = (inputElement.name || '').toLowerCase();
    const id = (inputElement.id || '').toLowerCase();
    const placeholder = (inputElement.placeholder || '').toLowerCase();
    const label = findLabelForInput(inputElement).toLowerCase();
    const ariaLabel = (inputElement.getAttribute('aria-label') || '').toLowerCase();
    
    const combinedText = name + ' ' + id + ' ' + placeholder + ' ' + label + ' ' + ariaLabel;
    
    for (const [fieldType, patterns] of Object.entries(COMMON_FIELD_PATTERNS)) {
      for (const pattern of patterns) {
        if (combinedText.includes(pattern)) {
          return fieldType;
        }
      }
    }
    
    return null;
  }

  // 查找输入框的 label
  function findLabelForInput(input) {
    if (input.id) {
      const label = document.querySelector('label[for="' + input.id + '"]');
      if (label) return label.textContent;
    }
    
    let parent = input.parentElement;
    while (parent) {
      if (parent.tagName === 'LABEL') {
        return parent.textContent;
      }
      parent = parent.parentElement;
    }
    
    return '';
  }

  // 获取字段映射值
  function getMappedValue(fieldType) {
    // 检查特定公司的映射
    for (const mapping of fieldMappings) {
      if (mapping.company_pattern && 
          (currentCompany.includes(mapping.company_pattern.toLowerCase()) || 
           mapping.company_pattern.includes(currentCompany))) {
        if (mapping.field_name === fieldType) {
          return getFieldValue(mapping.field_name);
        }
      }
    }
    
    // 检查通用映射
    for (const mapping of fieldMappings) {
      if (!mapping.company_pattern && mapping.field_name === fieldType) {
        return getFieldValue(mapping.field_name);
      }
    }
    
    // 直接从 parsedFields 获取
    return getFieldValue(fieldType);
  }

  // 从结构化字段中获取值
  function getFieldValue(fieldName) {
    if (parsedFields[fieldName]) {
      return parsedFields[fieldName];
    }
    
    // 处理姓名拆分为 first/last name
    if (fieldName === 'first_name' && parsedFields.name) {
      const parts = parsedFields.name.split(' ');
      return parts[0] || '';
    }
    if (fieldName === 'last_name' && parsedFields.name) {
      const parts = parsedFields.name.split(' ');
      return parts.slice(1).join(' ') || '';
    }
    
    // 教育经历
    if (fieldName === 'school' && parsedFields.education && parsedFields.education.length > 0) {
      return parsedFields.education[0].school || '';
    }
    if (fieldName === 'degree' && parsedFields.education && parsedFields.education.length > 0) {
      return parsedFields.education[0].degree || '';
    }
    if (fieldName === 'major' && parsedFields.education && parsedFields.education.length > 0) {
      return parsedFields.education[0].major || '';
    }
    
    // 工作经历
    if (fieldName === 'company' && parsedFields.experience && parsedFields.experience.length > 0) {
      return parsedFields.experience[0].company || '';
    }
    if (fieldName === 'job_title' && parsedFields.experience && parsedFields.experience.length > 0) {
      return parsedFields.experience[0].title || '';
    }
    
    // 技能
    if (fieldName === 'skills' && parsedFields.skills) {
      if (parsedFields.skills.technical) {
        return parsedFields.skills.technical.join(', ');
      }
      if (parsedFields.skills.tools) {
        return parsedFields.skills.tools.join(', ');
      }
    }
    
    return null;
  }

  // 检测并填充表单
  function detectAndFillForm() {
    const { forms, formContainers, standaloneInputs } = findForms();
    
    // 填充表单中的字段
    forms.forEach(form => {
      fillFormFields(form);
    });
    
    // 填充独立输入框
    fillFormFields(standaloneInputs);
  }

  // 填充表单字段
  function fillFormFields(elements) {
    if (!elements) return;
    
    const inputs = elements.querySelectorAll ? 
      elements.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])') :
      elements;
    
    inputs.forEach(input => {
      if (input.disabled || input.readOnly) return;
      
      const fieldType = matchField(input);
      if (fieldType) {
        const value = getMappedValue(fieldType);
        if (value) {
          fillInput(input, value);
        }
      }
    });
    
    // 处理 textarea (求职信等)
    const textareas = elements.querySelectorAll ? 
      elements.querySelectorAll('textarea') : [];
    textareas.forEach(textarea => {
      if (textarea.disabled || textarea.readOnly) return;
      
      const name = (textarea.name || '').toLowerCase();
      const id = (textarea.id || '').toLowerCase();
      const placeholder = (textarea.placeholder || '').toLowerCase();
      
      if (name.includes('cover') || name.includes('letter') || 
          id.includes('cover') || id.includes('letter') ||
          placeholder.includes('cover') || placeholder.includes('letter')) {
        // 可以添加求职信模板
      }
    });
  }

  // 填充输入框
  function fillInput(input, value) {
    const inputType = input.type ? input.type.toLowerCase() : 'text';
    
    // 跳过特殊类型的输入框
    if (['file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'hidden'].includes(inputType)) {
      return;
    }
    
    // 设置值
    if (input.value !== value) {
      // 触发输入事件以确保 React 等框架能检测到变化
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      
      nativeInputValueSetter.call(input, value);
      
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      
      input.dispatchEvent(inputEvent);
      input.dispatchEvent(changeEvent);
      
      // 标记已填充
      input.setAttribute('data-pathup-filled', 'true');
    }
  }

  // 添加可视化标识
  function addVisualIndicator() {
    // 检查是否已有指示器
    if (document.getElementById('pathup-indicator')) return;
    
    const indicator = document.createElement('div');
    indicator.id = 'pathup-indicator';
    indicator.innerHTML = 'PathUp AutoFill';
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 999999;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    
    indicator.onclick = () => {
      const config = {
        fieldMappings: fieldMappings,
        parsedFields: parsedFields,
        currentCompany: currentCompany
      };
      console.log('PathUp AutoFill Config:', config);
      alert('PathUp AutoFill 配置已输出到控制台');
    };
    
    document.body.appendChild(indicator);
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fillForm') {
      const { fieldType, value } = request;
      const inputs = document.querySelectorAll('input');
      
      inputs.forEach(input => {
        if (matchField(input) === fieldType) {
          fillInput(input, value);
        }
      });
      
      sendResponse({ success: true });
    }
    
    if (request.action === 'getFormFields') {
      const inputs = document.querySelectorAll('input:not([type="submit"]):not([type="button"])');
      const fields = [];
      
      inputs.forEach(input => {
        const matchedType = matchField(input);
        fields.push({
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          label: findLabelForInput(input),
          matchedType: matchedType,
          currentValue: input.value,
          filled: input.getAttribute('data-pathup-filled') === 'true'
        });
      });
      
      sendResponse({ fields: fields });
    }
    
    if (request.action === 'refreshConfig') {
      init();
      sendResponse({ success: true });
    }
    
    return true;
  });

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
