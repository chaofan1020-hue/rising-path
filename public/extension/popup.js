// PathUp AutoFill - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const fieldsList = document.getElementById('fieldsList');
  const platformUrlInput = document.getElementById('platformUrl');
  const syncBtn = document.getElementById('syncBtn');
  const openPlatformBtn = document.getElementById('openPlatformBtn');
  
  // 加载保存的配置
  async function loadConfig() {
    const result = await chrome.storage.local.get(['platformUrl', 'fieldMappings', 'parsedFields', 'lastSync']);
    
    if (result.platformUrl) {
      platformUrlInput.value = result.platformUrl;
    }
    
    updateStatus(!!result.parsedFields && Object.keys(result.parsedFields).length > 0);
    renderFields(result.parsedFields || {});
  }
  
  // 更新状态指示
  function updateStatus(isActive) {
    if (isActive) {
      statusDot.classList.add('active');
      statusText.textContent = '已连接 - 配置就绪';
    } else {
      statusDot.classList.remove('active');
      statusText.textContent = '未连接 - 需要同步';
    }
  }
  
  // 渲染字段列表
  function renderFields(fields) {
    if (!fields || Object.keys(fields).length === 0) {
      fieldsList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p>暂无简历字段</p>
          <p style="font-size: 11px; margin-top: 4px;">请先在 PathUp 平台上传并解析简历</p>
        </div>
      `;
      return;
    }
    
    const fieldLabels = {
      name: '姓名',
      email: '邮箱',
      phone: '电话',
      location: '地址',
      education: '教育背景',
      experience: '工作经验',
      skills: '技能'
    };
    
    let html = '';
    
    // 基础字段
    ['name', 'email', 'phone', 'location'].forEach(key => {
      if (fields[key]) {
        html += `
          <div class="field-item">
            <span class="field-name">${fieldLabels[key] || key}</span>
            <span class="field-value has-value">${fields[key]}</span>
          </div>
        `;
      }
    });
    
    // 教育背景
    if (fields.education && fields.education.length > 0) {
      const edu = fields.education[0];
      html += `
        <div class="field-item">
          <span class="field-name">学校</span>
          <span class="field-value has-value">${edu.school}</span>
        </div>
      `;
    }
    
    // 工作经验
    if (fields.experience && fields.experience.length > 0) {
      const exp = fields.experience[0];
      html += `
        <div class="field-item">
          <span class="field-name">公司</span>
          <span class="field-value has-value">${exp.company}</span>
        </div>
      `;
    }
    
    // 技能
    if (fields.skills) {
      const skills = [];
      if (fields.skills.technical) skills.push(...fields.skills.technical);
      if (fields.skills.tools) skills.push(...fields.skills.tools);
      if (skills.length > 0) {
        html += `
          <div class="field-item">
            <span class="field-name">技能</span>
            <span class="field-value has-value">${skills.slice(0, 3).join(', ')}</span>
          </div>
        `;
      }
    }
    
    fieldsList.innerHTML = html || '<div class="empty-state"><p>暂无数据</p></div>';
  }
  
  // 从平台同步数据
  async function syncFromPlatform() {
    const platformUrl = platformUrlInput.value.trim();
    
    if (!platformUrl) {
      alert('请先输入 PathUp 平台地址');
      return;
    }
    
    // 保存平台地址
    await chrome.storage.local.set({ platformUrl });
    
    syncBtn.disabled = true;
    syncBtn.textContent = '同步中...';
    
    try {
      // 获取字段映射
      const mappingsRes = await fetch(`${platformUrl}/api/field-mappings?access_code_id=1`);
      const mappingsData = await mappingsRes.json();
      
      // 获取简历列表
      const resumesRes = await fetch(`${platformUrl}/api/resume?access_code_id=1`);
      const resumesData = await resumesRes.json();
      
      // 查找最新且有 parsed_fields 的简历
      let parsedFields = {};
      if (resumesData.resumes && resumesData.resumes.length > 0) {
        const latestResume = resumesData.resumes.find(r => r.parsed_fields) || resumesData.resumes[0];
        if (latestResume.parsed_fields) {
          parsedFields = latestResume.parsed_fields;
        }
      }
      
      // 保存到本地存储
      await chrome.storage.local.set({
        fieldMappings: mappingsData.mappings || [],
        parsedFields: parsedFields,
        lastSync: new Date().toISOString()
      });
      
      updateStatus(true);
      renderFields(parsedFields);
      
      // 通知内容脚本刷新配置
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'refreshConfig' });
      }
      
      alert('同步成功！');
      
    } catch (error) {
      console.error('Sync error:', error);
      alert('同步失败: ' + error.message);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '同步简历数据';
    }
  }
  
  // 打开平台
  function openPlatform() {
    const platformUrl = platformUrlInput.value.trim() || 'https://pathup.example.com';
    chrome.tabs.create({ url: platformUrl });
  }
  
  // 事件绑定
  syncBtn.addEventListener('click', syncFromPlatform);
  openPlatformBtn.addEventListener('click', openPlatform);
  
  // 平台地址变化时保存
  platformUrlInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ platformUrl: platformUrlInput.value });
  });
  
  // 初始化
  await loadConfig();
});
