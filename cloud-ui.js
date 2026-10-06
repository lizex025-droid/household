'use strict';

let cloud = null, cloudPhase = 'loading', cloudError = '', cloudUser = null;
let cloudBusy = false, cloudGeneration = 0, cloudPoll = null;
const cloudMessage = error => window.BaytData?.errorMessage(error) || error?.message || 'تعذر الاتصال بالخدمة.';
const cloudRedirect = () => `${location.origin}${location.pathname}`;

function renderCloudGate() {
  document.body.classList.add('auth-mode');
  const signup = cloudPhase === 'signup', recover = cloudPhase === 'recover', password = cloudPhase === 'password';
  let content;
  if (cloudPhase === 'loading') content = '<div class="auth-loading"><span class="loading-ring"></span><p>نحضّر مساحة عائلتك...</p></div>';
  else if (cloudPhase === 'error') content = `<h1>نحتاج نعيد الاتصال</h1><p class="auth-description">${escapeHTML(cloudError)}</p><button class="button primary" id="cloudRetry">إعادة المحاولة</button><button class="text-button" id="gateSignOut">تسجيل الخروج</button>`;
  else if (cloudPhase === 'onboarding') content = `<h1>أهلًا في بيتك الجديد</h1><p class="auth-description">أنشئ مساحة لعائلتك، أو انضم باستخدام رمز دعوة وصلك من مدير العائلة.</p><form id="householdCreateForm"><label class="field">اسم العائلة<input name="name" required maxlength="60" value="عائلة بسيسو"></label><label class="field">ميزانية البيت الشهرية (JOD)<input name="budget" type="number" min="0" max="99999999" step="0.001" value="1400" required></label><button class="button primary" type="submit">${icon('home')}إنشاء العائلة</button></form><div class="auth-divider">أو عندك دعوة؟</div><form id="joinFamilyForm"><label class="field">رمز الدعوة<input name="token" required minlength="64" maxlength="64" dir="ltr" autocomplete="off" placeholder="الصق رمز الدعوة هنا"></label><button class="button" type="submit">الانضمام إلى العائلة</button></form><button class="text-button" id="gateSignOut">تسجيل الخروج</button><p class="form-error" id="authError" role="alert"></p>`;
  else content = `<h1>${password ? 'كلمة مرور جديدة' : recover ? 'نرجّعك لحسابك' : signup ? 'بيت أهدأ يبدأ من هون' : 'أهلًا بعودتك إلى بيت'}</h1><p class="auth-description">${password ? 'اختر كلمة مرور جديدة لحسابك.' : recover ? 'أدخل بريدك لنرسل لك رابط إعادة تعيين كلمة المرور.' : signup ? 'أنشئ حسابك وابدأ بإدارة مصاريف عائلتك.' : 'مصاريف عائلتك وميزانيتها، محفوظة في مكان واحد.'}</p><form id="authForm">${signup ? '<label class="field">اسمك<input name="name" required maxlength="60" autocomplete="name" placeholder="الاسم الكامل"></label>' : ''}${!password ? '<label class="field">البريد الإلكتروني<input name="email" type="email" required maxlength="254" autocomplete="email" dir="ltr" placeholder="you@example.com"></label>' : ''}${!recover ? `<label class="field">كلمة المرور<input name="password" type="password" required minlength="${signup || password ? 8 : 1}" autocomplete="${signup || password ? 'new-password' : 'current-password'}" dir="ltr" placeholder="${signup || password ? '8 أحرف على الأقل' : 'كلمة المرور'}"></label>` : ''}<p class="form-error" id="authError" role="alert">${escapeHTML(cloudError)}</p><button class="button primary" type="submit">${password ? 'حفظ كلمة المرور' : recover ? 'إرسال رابط الاستعادة' : signup ? 'إنشاء الحساب' : 'تسجيل الدخول'}${icon('arrow')}</button></form><div class="auth-links">${!signup && !recover && !password ? '<button class="text-button" data-auth-page="recover">نسيت كلمة المرور؟</button>' : ''}<button class="text-button" data-auth-page="${signup || recover || password ? 'signin' : 'signup'}">${signup || recover || password ? 'العودة لتسجيل الدخول' : 'جديد معنا؟ أنشئ حسابًا'}</button></div>`;
  $('#main').innerHTML = `<div class="auth-shell"><div class="auth-story"><span class="auth-house">${icon('home')}</span><span class="eyebrow">مساحة العائلة</span><h2>معًا، لبيت<br>أكثر توازنًا<span>.</span></h2><p>كل مصروف له مكان.<br>وكل خطوة صغيرة تقرّبنا من أهدافنا.</p><div class="auth-features"><span>${icon('check')}ميزانية واضحة</span><span>${icon('check')}قرارات مشتركة</span><span>${icon('check')}راحة بال أكثر</span></div><span class="auth-flower">✧</span></div><section class="auth-card"><a class="auth-brand" href="./">بيت<span>.</span></a>${content}<div class="auth-footnote">${icon('leaf')}خطوات صغيرة، فرق كبير</div></section></div>`;
  $$('[data-auth-page]').forEach(button => button.onclick = () => { cloudPhase = button.dataset.authPage; cloudError = ''; renderCloudGate(); });
  $('#cloudRetry')?.addEventListener('click', () => cloud ? loadCloud() : startCloud());
  $('#gateSignOut')?.addEventListener('click', () => cloudSignOut());
  $('#authForm')?.addEventListener('submit', submitCloudAuth);
  $('#householdCreateForm')?.addEventListener('submit', event => { event.preventDefault(); const f = new FormData(event.target); cloudMutate(() => cloud.createHousehold(f.get('name').trim(), Number(f.get('budget')) ), 'تم إنشاء مساحة عائلتك', '#authError'); });
  $('#joinFamilyForm')?.addEventListener('submit', event => { event.preventDefault(); cloudMutate(() => cloud.acceptInvitation(new FormData(event.target).get('token')), 'أهلًا بك في العائلة', '#authError'); });
}

async function submitCloudAuth(event) {
  event.preventDefault();
  if (cloudBusy) return;
  const phase = cloudPhase, f = new FormData(event.target), submit = event.target.querySelector('[type="submit"]');
  const email = String(f.get('email') || '').trim(), password = String(f.get('password') || '');
  submit.disabled = true; cloudBusy = true; $('#authError').textContent = '';
  try {
    if (phase === 'signup') {
      const result = await cloud.signUp(email, password, f.get('name').trim(), cloudRedirect());
      if (!result.session) { cloudPhase = 'signin'; cloudError = ''; renderCloudGate(); showModal('أكّد بريدك الإلكتروني', '<p>راجع بريدك الإلكتروني وافتح رابط التأكيد، ثم ارجع وسجّل الدخول. إذا كان لديك حساب بالفعل، استخدم تسجيل الدخول أو استعادة كلمة المرور.</p><div class="form-actions"><button class="button primary" data-action="close-modal">تمام</button></div>'); return; }
    } else if (phase === 'recover') {
      await cloud.resetPassword(email, `${cloudRedirect()}?recovery=1`);
      cloudPhase = 'signin'; cloudError = ''; renderCloudGate(); toast('إذا كان البريد مسجلًا، ستصلك رسالة برابط الاستعادة.'); return;
    } else if (phase === 'password') {
      await cloud.updatePassword(password); history.replaceState(null, '', cloudRedirect()); toast('تم تحديث كلمة المرور');
    } else await cloud.signIn(email, password);
    cloudBusy = false;
    await loadCloud();
  } catch (error) { const target = $('#authError'); if (target) target.textContent = cloudMessage(error); }
  finally { submit.disabled = false; cloudBusy = false; }
}

async function startCloud() {
  renderCloudGate();
  try {
    if (!window.supabase?.createClient || !window.BaytData) throw Error('تعذر تحميل ملفات الاتصال. أعد تحميل الصفحة.');
    cloud = window.BaytData.createBaytClient(window.supabase.createClient, window.BAYT_CONFIG);
    cloud.onAuthChange((event, session) => {
      // Do not await SDK calls from inside the SDK's auth lock.
      if (event === 'SIGNED_OUT') {
        cloudGeneration++; state = null; scope='all';search='';Object.keys(filters).forEach(k=>filters[k]='');cloudUser = null; cloudPhase = 'signin'; cloudError = ''; closeModal(); renderCloudGate();
      } else if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => { cloudGeneration++; state = null; cloudPhase = 'password'; renderCloudGate(); }, 0);
      } else if (event === 'SIGNED_IN' && session?.user?.id !== cloudUser?.id) {
        setTimeout(() => { if (!cloudBusy && cloudPhase !== 'password') loadCloud(); }, 0);
      }
    });
    const session = await cloud.session();
    if (cloudPhase === 'password') return;
    if (session && new URLSearchParams(location.search).get('recovery') === '1') { cloudPhase = 'password'; renderCloudGate(); return; }
    if (session) await loadCloud();
    else { cloudPhase = 'signin'; renderCloudGate(); }
    clearInterval(cloudPoll);
    cloudPoll = setInterval(() => { if (document.visibilityState === 'visible' && state && !cloudBusy && !$('#modal').open) loadCloud(true); }, 60000);
  } catch (error) { cloudError = cloudMessage(error); cloudPhase = 'error'; renderCloudGate(); }
}

async function loadCloud(background = false) {
  const generation = ++cloudGeneration;
  if (!background) { cloudPhase = 'loading'; renderCloudGate(); }
  try {
    const session = await cloud.session();
    if (generation !== cloudGeneration) return;
    if (!session) { state = null; cloudUser = null; cloudPhase = 'signin'; renderCloudGate(); return; }
    const next = await cloud.load(month);
    if (generation !== cloudGeneration) return;
    cloudUser = session.user;
    state = next;
    cloudPhase = next ? 'ready' : 'onboarding';
    cloudError = '';
    if (next) { next.users.find(u=>u.id===session.user.id).email=session.user.email;document.body.classList.remove('auth-mode'); render(); }
    else renderCloudGate();
  } catch (error) {
    if (generation !== cloudGeneration) return;
    if (background && state) { $('.local-status').innerHTML = '<i></i>تعذر التحديث · أعد المحاولة'; return; }
    state = null; cloudError = cloudMessage(error); cloudPhase = 'error'; renderCloudGate();
  }
}

async function cloudMutate(operation, success = 'تم الحفظ', errorSelector = null) {
  if (cloudBusy) return false;
  cloudBusy = true;
  const controls = $$('dialog[open] button, dialog[open] input, dialog[open] select, dialog[open] textarea, .auth-card button');
  const previous = controls.map(el => el.disabled); controls.forEach(el => el.disabled = true);
  const generation = cloudGeneration;
  try {
    const result = await operation();
    if (generation !== cloudGeneration) return true;
    // After the server confirms a mutation, never report it as unsaved merely
    // because the subsequent refresh failed.
    $('#modal').close();
    await loadCloud();
    toast(result?.warnings?.length ? result.warnings.join(' · ') : cloudPhase === 'error' ? `${success}؛ تعذر تحديث العرض. أعد الاتصال.` : success);
    return true;
  } catch (error) {
    const message = cloudMessage(error);
    const target = errorSelector ? $(errorSelector) : null;
    if (target) target.textContent = message;
    else toast(message);
    return false;
  } finally { cloudBusy = false; controls.forEach((el, i) => el.disabled = previous[i]); }
}

function applyCloudBudgets() {
  if (!state?.cloud) return;
  const fn = BaytData.effectiveBudget, rows = state.budgetRows;
  state.budget = fn(rows, 'household', null, '0000-00');
  state.users.forEach(u => u.budget = fn(rows, 'member', u.id, month));
  state.categories.forEach(c => c.budget = fn(rows, 'category', c.id, month));
}

function cloudDecorate() {
  if (page === 'settings' && typeof renderBankSettings === 'function') renderBankSettings();
  document.body.classList.remove('auth-mode');
  $('.local-status').innerHTML = '<i></i>متصل بقاعدة البيانات';
  $('.profile small').textContent = isAdmin() ? 'مدير العائلة' : 'فرد العائلة';
  $('#profileButton').setAttribute('aria-label', 'إعدادات الحساب');
  $('footer>span:last-child').textContent = 'محفوظ في Supabase · العملة: JOD';
  if (!$('#refreshCloudButton')) {
    const button = document.createElement('button'); button.id = 'refreshCloudButton'; button.className = 'icon-button';
    button.title = 'تحديث البيانات'; button.setAttribute('aria-label', 'تحديث البيانات'); button.innerHTML = icon('download');
    button.onclick = () => { if (!cloudBusy) loadCloud(); };
    $('.topbar-actions').prepend(button);
  }
  if (page === 'members' && isAdmin()) {
    const button = document.createElement('button'); button.className = 'button'; button.textContent = 'الدعوات'; button.onclick = cloudInvitations;
    $('.heading-actions').prepend(button);
    const add = $('[data-action="add-member"]'); if (add) add.innerHTML = `${icon('plus')}إضافة فرد`;
  }
}

function cloudSettingsPage() {
  return `${heading('بيتك، على طريقتك', 'إعدادات العائلة والحساب المتصل.')}<section class="panel settings-panel"><h2>تفاصيل البيت</h2><form id="settingsForm"><label class="field">اسم العائلة<input name="household" required maxlength="60" value="${escapeHTML(state.household)}" ${!isAdmin() ? 'disabled' : ''}></label><label class="inline-check"><input name="share" type="checkbox" ${state.shareExpenses ? 'checked' : ''} ${!isAdmin() ? 'disabled' : ''}>السماح للأفراد بقراءة مصاريف البيت كاملًا</label><p>كل فرد يعدّل مصاريفه فقط. المدير يدير جميع المصاريف والميزانيات.</p>${isAdmin() ? '<button class="button primary" type="submit">حفظ الإعدادات</button>' : ''}</form></section><section class="panel settings-panel"><h2>حسابك</h2><p>${escapeHTML(cloudUser?.email || '')}</p><div class="settings-actions"><button class="button" data-cloud-action="password">تغيير كلمة المرور</button><button class="button" data-cloud-action="signout">تسجيل الخروج</button><button class="button danger" data-cloud-action="signout-all">تسجيل الخروج من كل الأجهزة</button></div></section><section class="panel settings-panel"><h2>نسخة من بياناتك</h2><p>نزّل البيانات المتاحة لحسابك مع صور الفواتير. النسخة للتنزيل والاحتفاظ بها؛ لا تستبدل بيانات العائلة السحابية تلقائيًا.</p><button class="button" data-action="backup">${icon('download')}تنزيل نسخة احتياطية</button></section><section class="panel settings-panel"><h2>مساحة العائلة المتصلة</h2><p>تُحفظ المصاريف في Supabase بعد تأكيد الخادم. تتحدث البيانات بعد الحفظ، وعند العودة إلى النافذة، وكل دقيقة أثناء عرض الصفحة. يمكنك أيضًا استخدام زر التحديث أعلى الصفحة.</p><p>يمكن إضافة أفراد بالاسم فقط لتسجيل مصاريفهم دون حساب دخول. حسابات الدخول مستقلة؛ لدعوة صاحب حساب أنشئ دعوة وشارك رمزها معه؛ يسجل حسابًا ببريده ويؤكده ثم يستخدم الرمز.</p></section>`;
}

function cloudAccountMenu() {
  showModal('حسابك', `<p>${escapeHTML(cloudUser?.email || '')}</p><div class="form-actions"><button class="button" data-cloud-action="password">تغيير كلمة المرور</button><button class="button danger" data-cloud-action="signout">تسجيل الخروج</button></div>`);
}

async function cloudSignOut(scope = 'local') {
  if (cloudBusy) return;
  cloudBusy = true;
  try {
    await cloud.signOut(scope);
    cloudGeneration++; state = null; scope='all';search='';Object.keys(filters).forEach(k=>filters[k]='');cloudUser = null; cloudPhase = 'signin'; cloudError = ''; $('#modal').close(); renderCloudGate();
  } catch (error) { toast(cloudMessage(error)); }
  finally { cloudBusy = false; }
}

function cloudInviteModal() {
  if (!isAdmin()) return;
  showModal('خلّي العائلة معنا', `<p class="eyebrow">أنشئ رمز دعوة وشاركه مع صاحب البريد. لن نرسل رسالة تلقائيًا.</p><form id="inviteForm"><label class="field">البريد الإلكتروني<input name="email" type="email" required maxlength="254" dir="ltr" placeholder="member@example.com"></label><div class="form-grid"><label class="field">الميزانية الشهرية (JOD)<input name="budget" type="number" min="0" max="99999999" step="0.001" value="0" required></label><label class="field">الصلاحية<select name="role"><option value="member">فرد العائلة</option><option value="admin">مدير العائلة</option></select></label></div><p id="inviteError" class="form-error"></p><div class="form-actions"><button class="button primary" type="submit">إنشاء رمز الدعوة</button></div></form>`);
  $('#inviteForm').onsubmit = async event => {
    event.preventDefault(); if (cloudBusy) return;
    const f = new FormData(event.target); cloudBusy = true; const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const invite = await cloud.createInvitation(state.householdId, f.get('email').trim(), f.get('role'), Number(f.get('budget')));
      showModal('الدعوة جاهزة', `<p>شارك هذا الرمز مع <strong>${escapeHTML(f.get('email'))}</strong>. يجب أن يسجّل حسابًا بهذا البريد ويؤكده. الرمز صالح 7 أيام ويستخدم مرة واحدة.</p><label class="field">رمز الدعوة<textarea id="invitationToken" readonly dir="ltr">${escapeHTML(invite.token)}</textarea></label><div class="form-actions"><button class="button primary" id="copyInvitation">نسخ الرمز</button><button class="button" data-action="close-modal">تم</button></div>`);
      $('#copyInvitation').onclick = async () => { try { await navigator.clipboard.writeText(invite.token); toast('تم نسخ رمز الدعوة'); } catch { $('#invitationToken').select(); toast('حدّد الرمز وانسخه من الحقل'); } };
    } catch (error) { $('#inviteError').textContent = cloudMessage(error); }
    finally { cloudBusy = false; button.disabled = false; }
  };
}

async function cloudInvitations() {
  if (!isAdmin()) return;
  showModal('دعوات العائلة', '<p class="eyebrow">جاري تحميل الدعوات...</p>');
  try {
    const invites = await cloud.invitations(state.householdId);
    showModal('دعوات العائلة', invites.length ? invites.map(i => `<div class="alert-row"><div><strong>${escapeHTML(i.email)}</strong><span>${i.accepted_at ? 'تم الانضمام' : i.revoked_at ? 'ملغاة' : new Date(i.expires_at) < new Date() ? 'منتهية' : 'بانتظار الانضمام'} · ${i.role === 'admin' ? 'مدير' : 'عضو'}</span></div>${!i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date() ? `<button class="text-button" data-revoke-invite="${escapeHTML(i.id)}">إلغاء الدعوة</button>` : ''}</div>`).join('') : '<p>لا توجد دعوات بعد.</p>');
    $$('[data-revoke-invite]').forEach(b => b.onclick = () => cloudMutate(() => cloud.revokeInvitation(b.dataset.revokeInvite), 'تم إلغاء الدعوة'));
  } catch (error) { $('#modalContent').textContent = cloudMessage(error); }
}

function cloudBudgetModal(kind, id) {
  if (!isAdmin()) return;
  const type = kind === 'user' ? 'member' : kind, target = type === 'household' ? null : id;
  const name = type === 'household' ? 'البيت' : type === 'member' ? userBy(id).name : catBy(id).name;
  const recurring = BaytData.effectiveBudget(state.budgetRows, type, target, '0000-00');
  const selected = BaytData.effectiveBudget(state.budgetRows, type, target, month);
  showModal(`ميزانية ${name}`, `<form id="budgetForm"><label class="field">تطبيق الميزانية<select name="period"><option value="${month}">لهذا الشهر فقط · ${monthName(month)}</option><option value="">السقف الشهري المتكرر</option></select></label><label class="field">المبلغ (JOD)<input name="budget" type="number" min="0" max="99999999" step="0.001" value="${selected}" required></label><p class="eyebrow">ميزانية الشهر المحدد تتقدم على السقف المتكرر.</p><p class="form-error" id="budgetError"></p><div class="form-actions"><button class="button primary">حفظ الميزانية</button></div></form>`);
  $('#budgetForm').elements.period.onchange = event => $('#budgetForm').elements.budget.value = event.target.value ? selected : recurring;
  $('#budgetForm').onsubmit = event => { event.preventDefault(); const f = new FormData(event.target); cloudMutate(() => cloud.setBudget(state.householdId, type, target, Number(f.get('budget')), f.get('period') || null), 'تم تحديث الميزانية', '#budgetError'); };
}

async function cloudReceipt(expense) {
  showModal('صورة الفاتورة', '<p class="eyebrow">جاري تحميل الفاتورة...</p>');
  try { const url = await cloud.receiptUrl(expense.receipt); if ($('#modal').open && $('#modalTitle').textContent === 'صورة الفاتورة') $('#modalContent').innerHTML = `<img class="receipt-preview" src="${escapeHTML(url)}" alt="فاتورة ${escapeHTML(expense.merchant)}">`; }
  catch (error) { $('#modalContent').textContent = cloudMessage(error); }
}

async function cloudBackup() {
  if (cloudBusy) return;
  cloudBusy = true; toast('جاري تجهيز البيانات والفواتير...');
  try { const data = await cloud.exportBackup(state); download(JSON.stringify(data, null, 2), `bayt-cloud-${localDate()}.json`, 'application/json'); toast('تم تنزيل نسخة البيانات والفواتير'); }
  catch (error) { toast(`لم تكتمل النسخة الاحتياطية: ${cloudMessage(error)}`); }
  finally { cloudBusy = false; }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-cloud-action]'); if (!button || !state?.cloud) return;
  if (button.dataset.cloudAction === 'signout') cloudSignOut();
  if (button.dataset.cloudAction === 'password') {
    showModal('تغيير كلمة المرور', '<form id="passwordForm"><label class="field">كلمة المرور الجديدة<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><p id="passwordError" class="form-error"></p><div class="form-actions"><button class="button primary">حفظ كلمة المرور</button></div></form>');
    $('#passwordForm').onsubmit = e => { e.preventDefault(); cloudMutate(() => cloud.updatePassword(new FormData(e.target).get('password')), 'تم تحديث كلمة المرور', '#passwordError'); };
  }
  if (button.dataset.cloudAction === 'signout-all') {
    showModal('تسجيل الخروج من كل الأجهزة؟', '<p>سيتم إلغاء تجديد جلسات حسابك على الأجهزة الأخرى. قد تبقى رموز الوصول الحالية صالحة حتى انتهاء مدتها.</p><div class="form-actions"><button class="button" data-action="close-modal">إلغاء</button><button class="button danger" id="confirmGlobalLogout">تسجيل الخروج من الجميع</button></div>');
    $('#confirmGlobalLogout').onclick = () => cloudSignOut('global');
  }
});
window.addEventListener('focus', () => { if (state?.cloud && cloud && state && !cloudBusy && !$('#modal').open) loadCloud(true); });

function cloudMemberModal(id) {
  if (!isAdmin()) return;
  const member=id?state.users.find(u=>u.id===id):null;
  if(id&&!member)return;
  showModal(member?'تعديل فرد العائلة':'إضافة فرد بالاسم', `<form id="cloudMemberForm"><label class="field">الاسم<input name="name" required maxlength="60" value="${escapeHTML(member?.name||'')}"></label><label class="field">الميزانية الشهرية (دينار)<input name="budget" type="number" min="0" max="99999999" step="0.001" required value="${member?BaytData.effectiveBudget(state.budgetRows,'member',id,'0000-00'):0}"></label>${member&&!member.managed?`<label class="field">الصلاحية<select name="role">${option('member','فرد العائلة',member.role)}${option('admin','مدير العائلة',member.role)}</select></label>`:''}<p class="eyebrow">${member&&!member.managed?'هذا الفرد لديه حساب دخول.':'هذا الاسم لتسجيل الدخل والمصاريف فقط، ولا يحتاج بريدًا أو كلمة مرور.'}</p><p id="memberError" class="form-error" role="alert"></p><div class="form-actions">${member&&member.id!==state.currentUser?'<button type="button" class="button danger" id="cloudRemoveMember">حذف الفرد</button>':''}<button class="button primary" type="submit">حفظ الفرد</button>${!member?'<button type="button" class="button" id="inviteLogin">دعوة حساب دخول</button>':''}</div></form>`);
  $('#cloudMemberForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=f.get('name').trim(),budget=Number(f.get('budget'));return cloudMutate(()=>member?cloud.updateMember(state.householdId,{...member,name,budget,role:member.managed?'member':f.get('role')}):cloud.addMember(state.householdId,name,budget),'تم حفظ الفرد','#memberError');};
  $('#inviteLogin')?.addEventListener('click',cloudInviteModal);
  $('#cloudRemoveMember')?.addEventListener('click',()=>{
    showModal('حذف فرد العائلة؟',`<p>حذف ${escapeHTML(member.name)}؟ يجب نقل عملياته أو حذفها أولًا إذا كانت له عمليات مسجلة.</p><div class="form-actions"><button class="button" data-action="close-modal">إلغاء</button><button class="button danger" id="confirmCloudRemove">حذف الفرد</button></div>`);
    $('#confirmCloudRemove').onclick=()=>cloudMutate(()=>cloud.removeMember(state.householdId,id),'تم حذف الفرد');
  });
}

if(CLOUD_ENABLED)startCloud();

