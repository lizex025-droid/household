'use strict';

let bankAccounts = [], bankSettingsGeneration = 0;

async function renderBankSettings() {
  if (!state?.cloud || page !== 'settings') return;
  const generation = ++bankSettingsGeneration, householdId = state.householdId;
  const panel = document.createElement('section'); panel.id = 'bankSettings'; panel.className = 'panel settings-panel';
  panel.innerHTML = '<h2>أتمتة رسائل البنك</h2><p>جاري تحميل الحسابات...</p>';
  $('#main').append(panel);
  try {
    const [accounts, events, transfers] = await Promise.all([cloud.bankAccounts(householdId), cloud.bankEvents(householdId), cloud.bankTransfers(householdId)]);
    if (generation !== bankSettingsGeneration || !state?.cloud || state.householdId !== householdId || !panel.isConnected) return;
    bankAccounts = accounts;
    const hasKey=accounts.some(a=>a.automation_configured&&a.enabled);
    const accountById=id=>accounts.find(a=>a.id===id);
    const accountOwner=id=>{const a=accountById(id);return a?userBy(a.user_id).name:'حساب غير معروف';};
    const purchases=events.length?`<div class="table-wrap"><table><thead><tr><th>المتجر</th><th>الحساب</th><th>التاريخ</th><th>الخصم</th><th>رصيد البنك</th><th> </th></tr></thead><tbody>${events.map(e=>`<tr><td>${escapeHTML(e.merchant)}</td><td>${escapeHTML(accountOwner(e.account_id))}</td><td>${escapeHTML(e.transaction_date)} <bdi>${escapeHTML(e.transaction_time.slice(0,5))}</bdi></td><td><bdi>${money(e.amount)} JOD</bdi></td><td><bdi>${money(e.reported_balance)} JOD</bdi></td><td>${e.expense_id?`<button class="text-button" data-bank-action="expense" data-bank-id="${e.expense_id}">مراجعة المصروف</button>`:'المصروف محذوف'}</td></tr>`).join('')}</tbody></table></div>`:'<p>لم تصل عمليات شراء بعد.</p>';
    const transferRows=transfers.length?`<div class="table-wrap"><table><thead><tr><th>من</th><th>إلى</th><th>التاريخ</th><th>المبلغ</th><th>رصيد الحساب المرسل</th></tr></thead><tbody>${transfers.map(t=>`<tr><td>${escapeHTML(accountOwner(t.from_account_id))}</td><td>${escapeHTML(accountOwner(t.to_account_id))}</td><td>${escapeHTML(t.transfer_date)}</td><td><bdi>${money(t.amount)} JOD</bdi></td><td><bdi>${money(t.reported_balance)} JOD</bdi></td></tr>`).join('')}</tbody></table></div>`:'<p>لم تصل حوالات بين الحسابات بعد.</p>';
    panel.innerHTML = `<div class="panel-head"><h2>أتمتة رسائل البنك</h2><button class="button" data-bank-action="add">${icon('plus')}ربط حساب</button></div><p>المشتريات تتحول لمصاريف على صاحب الحساب. الحوالات بين الحسابات المرتبطة تظهر كسجل مستقل ولا تُحسب كمصروف منزلي. Shortcut واحد بمفتاح مدير يغطي كل الحسابات المرتبطة.</p>${accounts.map(a=>`<div class="bank-account"><div><strong>${escapeHTML(a.label)}</strong><p><bdi>${escapeHTML(a.masked_account)}</bdi> · ${escapeHTML(userBy(a.user_id).name)} · ${!a.enabled?'متوقف':a.automation_configured?'المفتاح مُعدّ':hasKey?'مشمول بالأتمتة':'يحتاج إعداد Shortcut'}</p></div><div class="settings-actions"><button class="button" data-bank-action="setup" data-bank-id="${a.id}" ${!a.enabled?'disabled':''}>إعداد الآيفون</button><button class="button" data-bank-action="edit" data-bank-id="${a.id}">تعديل</button>${a.automation_configured?`<button class="button danger" data-bank-action="revoke" data-bank-id="${a.id}">إلغاء المفتاح</button>`:''}</div></div>`).join('')||'<p>لا توجد حسابات مربوطة. أضف معرّف الحساب كما يظهر في رسالة البنك.</p>'}<details class="bank-guide"><summary>كيف تعمل الأتمتة؟</summary><p>على الآيفون: Shortcuts ← Automation ← Message. اترك Sender فارغًا واكتب <bdi>Balance JOD</bdi> في Message Contains حتى تصل المشتريات والحوالات، ثم اختر Run Immediately. أرسل Content إلى رابط الاستقبال باستخدام Get Contents of URL وPOST بصيغة JSON.</p><p>المفتاح يعمل لمدة سنة أو حتى إلغائه. الرسائل غير المطابقة مثل OTP تُرفض، والرسالة نفسها لا تُسجّل مرتين.</p></details><h3>آخر المشتريات المستوردة</h3>${purchases}<h3>آخر الحوالات بين الحسابات</h3>${transferRows}`;
  } catch { if (panel.isConnected) panel.innerHTML = '<h2>أتمتة رسائل البنك</h2><p>تعذر تحميل إعدادات البنك. أعد تحديث الصفحة.</p>'; }
}

function bankAccountModal(id = null) {
  const existing = bankAccounts.find(a=>a.id===id);
  if (id && !existing) return;
  const a = existing || {label:'',masked_account:'',user_id:state.currentUser,default_category_id:state.categories.find(c=>c.name==='أخرى')?.id||state.categories[0].id,enabled:true};
  showModal(existing?'تعديل الحساب البنكي':'ربط حساب بنكي', `<form id="bankAccountForm"><label class="field">اسم الحساب<input name="label" required maxlength="60" value="${escapeHTML(a.label)}" placeholder="حساب عاهد · Arab Bank"></label><label class="field">معرّف الحساب الظاهر في الرسالة<input name="masked_account" required dir="ltr" pattern="[0-9]{2,12}[*]{1,12}[0-9]{3,4}" value="${escapeHTML(a.masked_account)}" placeholder="0119*600"></label><label class="field">صاحب الحساب<select name="user_id">${(isAdmin()?state.users:[current()]).map(u=>option(u.id,u.name,a.user_id)).join('')}</select></label><label class="field">التصنيف الافتراضي للعمليات<select name="default_category_id">${state.categories.map(c=>option(c.id,c.name,a.default_category_id)).join('')}</select></label><label class="inline-check"><input name="enabled" type="checkbox" ${a.enabled?'checked':''}>استقبال الرسائل لهذا الحساب</label><p>تغيير صاحب الحساب أو معرّفه، أو إيقافه، يلغي المفتاح القديم. رسائل السوبرماركت المعروفة تُصنّف ضمن الأكل.</p><p id="bankError" class="form-error"></p><div class="form-actions"><button type="button" class="button" data-action="close-modal">إلغاء</button><button class="button primary">حفظ الربط</button></div></form>`);
  $('#bankAccountForm').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); cloudMutate(()=>cloud.saveBankAccount(state.householdId,{id:existing?.id,label:f.get('label').trim(),masked_account:f.get('masked_account').trim(),user_id:isAdmin()?f.get('user_id'):state.currentUser,default_category_id:f.get('default_category_id'),enabled:!!f.get('enabled')}),'تم حفظ ربط الحساب','#bankError'); };
}

function bankSetup(a) {
  showModal(`إعداد أتمتة ${a.label}`, `<p>الرسائل من الحساب <bdi>${escapeHTML(a.masked_account)}</bdi> تُسجّل على ${escapeHTML(userBy(a.user_id).name)}. إعداد الأتمتة مرة واحدة على آيفون صاحب الرسائل.</p><label class="field">رابط الاستقبال<input id="bankEndpoint" readonly dir="ltr" value="${escapeHTML(cloud.bankEndpoint)}"></label><button class="button" id="copyBankEndpoint">نسخ الرابط</button><p>${a.automation_configured?'إنشاء مفتاح جديد يلغي المفتاح الموجود في Shortcut القديم.':'أنشئ مفتاحًا خاصًا للأتمتة.'} المفتاح يظهر هنا مرة واحدة؛ انسخه إلى Shortcut، ولا تشاركه.</p><button class="button primary" id="createBankKey">${a.automation_configured?'استبدال المفتاح':'إنشاء مفتاح الأتمتة'}</button><div id="bankKeyDetails"></div><p id="bankSetupError" class="form-error"></p><details class="bank-guide" open><summary>خطوات Shortcuts</summary><ol><li>افتح Shortcuts ← Automation ← + ← Message.</li><li>اترك Sender فارغًا واكتب <bdi>Balance JOD</bdi> في Message Contains حتى تعمل المشتريات والحوالات. لا تختَر جهة اتصال للبنك؛ اختلاف اسم المرسل يمنع تشغيل الأتمتة.</li><li>اختر Run Immediately ثم New Blank Automation.</li><li>أضف Get Contents of URL والصق رابط الاستقبال أعلاه. Method: POST، وRequest Body: JSON.</li><li>أضف حقول نص: <bdi>token</bdi> = مفتاحك، <bdi>sender</bdi> = Arab Bank، <bdi>text</bdi> = متغير Shortcut Input، ثم اضغطه واختر خاصية <bdi>Message</bdi> لا <bdi>Content</bdi>.</li><li>أضف Get Dictionary Value للمفتاح <bdi>message</bdi> من النتيجة، ثم Show Notification لعرض نجاح التسجيل أو الخطأ.</li><li>احفظ الأتمتة. عند وصول شراء أو حوالة جديدة، تحقق من ظهورها في سجل البنك.</li></ol></details>`);
  $('#copyBankEndpoint').onclick = ()=>copyBankValue(cloud.bankEndpoint,$('#bankEndpoint'));
  $('#createBankKey').onclick = () => {
    if (a.automation_configured) {
      showModal('استبدال مفتاح الأتمتة؟','<p>سيُلغى المفتاح القديم فورًا. ستحتاج تحديث token داخل Shortcut.</p><div class="form-actions"><button class="button" id="cancelBankRotate">رجوع</button><button class="button primary" id="confirmBankRotate">استبدال</button></div>');
      $('#cancelBankRotate').onclick=()=>bankSetup(a); $('#confirmBankRotate').onclick=()=>{bankSetup({...a,automation_configured:false});createBankKey(a);};
    } else createBankKey(a);
  };
}

async function copyBankValue(value, input) {
  try { await navigator.clipboard.writeText(value); toast('تم النسخ'); }
  catch { input?.select(); toast('حدّد القيمة وانسخها من الحقل'); }
}

async function createBankKey(a) {
  if (cloudBusy) return;
  cloudBusy = true; const button=$('#createBankKey'); if(button)button.disabled=true;
  const householdId=state.householdId,userId=state.currentUser;
  try {
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    await cloud.setBankKey(a.id,token);
    if(!state?.cloud||state.householdId!==householdId||state.currentUser!==userId||!$('#bankKeyDetails'))return;
    a.automation_configured=true;
    $('#bankKeyDetails').innerHTML=`<label class="field">مفتاح الأتمتة<input id="bankToken" type="password" readonly dir="ltr" autocomplete="off"></label><div class="settings-actions"><button class="button" id="copyBankToken">نسخ المفتاح</button><button class="button" id="showBankToken">إظهار / إخفاء</button></div><h3>اختبار أو إعادة إرسال رسالة</h3><p>الصق رسالة شراء أو حوالة تخص أي حساب مرتبط. المعاينة لا تحفظ شيئًا؛ التسجيل يضيف العملية مرة واحدة.</p><label class="field">نص رسالة البنك<textarea id="bankTestText" dir="ltr" maxlength="4096" placeholder="You have a purchase transaction... أو JOD ... has been debited..."></textarea></label><div class="settings-actions"><button class="button" id="previewBankSMS">معاينة فقط</button><button class="button primary" id="sendBankSMS">تسجيل الرسالة</button></div><p id="bankTestResult" role="status"></p>`;
    $('#bankToken').value=token; $('#copyBankToken').onclick=()=>copyBankValue(token,$('#bankToken'));
    $('#showBankToken').onclick=()=>$('#bankToken').type=$('#bankToken').type==='password'?'text':'password';
    $('#previewBankSMS').onclick=()=>testBankSMS(token,true,a.masked_account); $('#sendBankSMS').onclick=()=>testBankSMS(token,false,a.masked_account);
    if(button)button.hidden=true;
  } catch(error) { const target=$('#bankSetupError'); if(target)target.textContent=cloudMessage(error); }
  finally { cloudBusy=false;if(button)button.disabled=false; }
}

async function testBankSMS(token,dryRun,account) {
  if(cloudBusy)return;const text=$('#bankTestText').value; const target=$('#bankTestResult');
  try {
    const {parseArabBankSMS}=await import('./bank-parser.mjs');const parsed=parseArabBankSMS(text);const linked=new Set(bankAccounts.filter(a=>a.enabled).map(a=>a.masked_account));
    if(parsed.type==='purchase'&&!linked.has(parsed.account))throw Error('الرسالة لحساب غير مربوط بالبيت.');
    if(parsed.type==='transfer'&&(!linked.has(parsed.fromAccount)||!linked.has(parsed.toAccount)))throw Error('أحد حسابات الحوالة غير مربوط بالبيت.');
    if(dryRun){target.textContent=parsed.type==='transfer'?`معاينة بدون حفظ: حوالة ${money(parsed.amount)} JOD · ${parsed.fromAccount} ← ${parsed.toAccount} · ${parsed.date}.`:`معاينة بدون حفظ: ${money(parsed.amount)} JOD · ${parsed.merchant} · ${parsed.date} ${parsed.time} · الحساب ${parsed.account}.`;return;}
    cloudBusy=true;const response=await fetch(cloud.bankEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,sender:'Arab Bank',text})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'تعذر التسجيل');target.textContent=result.message;
    // Keep the one-time key available; refresh totals once this dialog closes.
    if(result.status==='recorded')toast('تم تسجيل العملية. أغلق النافذة وحدّث البيانات لعرضها.');
  }catch(error){target.textContent=error.message;}finally{cloudBusy=false;}
}

document.addEventListener('click',event=>{
  const b=event.target.closest('[data-bank-action]');if(!b||!state?.cloud)return;
  const a=bankAccounts.find(x=>x.id===b.dataset.bankId);
  if(b.dataset.bankAction==='add')bankAccountModal();
  if(b.dataset.bankAction==='edit'&&a)bankAccountModal(a.id);
  if(b.dataset.bankAction==='setup'&&a)bankSetup(a);
  if(b.dataset.bankAction==='expense'){const e=state.expenses.find(x=>x.id===b.dataset.bankId);if(e)expenseModal(e.id);else toast('حدّث البيانات لعرض المصروف الجديد');}
  if(b.dataset.bankAction==='revoke'&&a){showModal('إلغاء مفتاح الأتمتة؟','<p>ستتوقف رسائل هذا المفتاح حتى تنشئ مفتاحًا جديدًا وتحدّث Shortcut. المصاريف المسجلة تبقى محفوظة.</p><div class="form-actions"><button class="button" data-action="close-modal">إلغاء</button><button class="button danger" id="confirmBankRevoke">إيقاف المفتاح</button></div>');$('#confirmBankRevoke').onclick=()=>cloudMutate(()=>cloud.setBankKey(a.id),'تم إلغاء مفتاح الأتمتة');}
});

// Remove capability material from the DOM immediately when a dialog closes.
$('#modal').addEventListener('close',()=>{if($('#bankToken'))$('#modalContent').replaceChildren();});
document.addEventListener('DOMContentLoaded',()=>{if(state?.cloud&&page==='settings'&&!$('#bankSettings'))renderBankSettings();});
