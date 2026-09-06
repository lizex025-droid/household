'use strict';

function incomeEntries(m=month, user=scope) {
  return (state.incomes || []).filter(i => i.date.startsWith(m) &&
    ((!isAdmin() || user === 'mine') ? i.user === state.currentUser : user === 'all' || i.user === user));
}
function householdBudget(m=month) { if(state.cloud)return BaytData.effectiveBudget(state.budgetRows,'household',null,m);return state.monthlyBudgets?.[m] ?? state.budget; }
function availableHouseholdBudget(m=month) {
  return Math.round((householdBudget(m) + sum(incomeEntries(m, 'all'))) * 100) / 100;
}
function budgetEditButton() {
  return isAdmin() ? `<button class="button" data-action="edit-monthly-budget">${icon('edit')}تعديل الميزانية</button>` : '';
}
function incomeAddButton() {
  return `<button class="button income-button" data-action="add-income">${icon('plus')}إضافة دخل</button>`;
}
function incomePanel(limit=Infinity, actions=true) {
  const list=incomeEntries().sort((a,b)=>b.date.localeCompare(a.date));
  return `<section class="panel income-panel"><div class="panel-head"><div><h2>سجل الدخل الإضافي</h2><p>${monthName(month)} · ${list.length} عملية · ${money(sum(list))} دينار</p></div>${actions?`<a class="text-button" href="#income">عرض سجل الدخل ${icon('arrow')}</a>`:''}</div>${incomeTable(list,limit,actions)}</section>`;
}
function incomeTable(list,limit=Infinity,actions=true) {
  if(!list.length) return `<div class="empty-state compact-empty">${icon('wallet')}<p>لا يوجد دخل إضافي مسجل لهذا الشهر.</p>${actions?incomeAddButton():''}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>من عند مين؟</th><th>استلمه</th><th>التاريخ</th><th>طريقة الاستلام</th><th>المبلغ</th>${actions?'<th class="no-print"> </th>':''}</tr></thead><tbody>${list.slice(0,limit).map(i=>`<tr><td><div class="transaction-title"><div><strong>${escapeHTML(i.source)}</strong><small>${escapeHTML(i.note)}</small></div></div></td><td><div class="member-cell">${avatar(userBy(i.user))}${escapeHTML(userBy(i.user).short)}</div></td><td>${displayDate(i.date)}</td><td>${escapeHTML(i.payment)}</td><td class="amount income-amount">+${money(i.amount)} <small>JOD</small></td>${actions?`<td class="no-print">${isAdmin()||i.user===state.currentUser?`<button class="icon-button" data-action="edit-income" data-id="${escapeHTML(i.id)}" aria-label="تعديل دخل من ${escapeHTML(i.source)}">${icon('edit')}</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function incomePage() {
  return `${heading('الدخل الإضافي','تسجيل المبالغ الواردة، ومصدرها، ومن استلمها.',`${monthControl()}${budgetEditButton()}${incomeAddButton()}`)}${isAdmin()?`<div class="dashboard-filter"><div class="tabs"><button data-action="scope" data-scope="all" class="${scope==='all'?'active':''}">دخل العائلة</button><button data-action="scope" data-scope="mine" class="${scope==='mine'?'active':''}">الدخل الذي استلمته</button></div></div>`:''}${stats()}${incomePanel()}<p class="income-explanation">الدخل المسجل يُضاف إلى المتاح للشهر الذي يحمل تاريخه. الميزانية الأساسية تُعدَّل بشكل مستقل، ولا تُسجَّل كعملية دخل.</p>`;
}
function incomeModal(id=null) {
  const existing=id?(state.incomes||[]).find(i=>i.id===id):null;
  if(id&&!existing)return;
  if(existing&&!isAdmin()&&existing.user!==state.currentUser)return;
  const i=existing||{amount:'',date:month===localDate().slice(0,7)?localDate():`${month}-01`,source:'',user:state.currentUser,payment:'نقدي',note:''};
  showModal(existing?'تعديل الدخل':'إضافة دخل',`<form id="incomeForm"><div class="form-grid"><label class="field">المبلغ (دينار)<input name="amount" type="number" required min="0.01" max="9999999" step="0.01" inputmode="decimal" placeholder="0.00" value="${i.amount}"></label><label class="field">التاريخ<input name="date" type="date" required value="${escapeHTML(i.date)}"></label><label class="field full">من عند مين؟<input name="source" required maxlength="100" list="incomeSources" placeholder="اسم الشخص أو جهة الدخل" value="${escapeHTML(i.source)}"><datalist id="incomeSources">${state.users.map(u=>option(u.name,u.name)).join('')}</datalist></label><label class="field">مين استلم المبلغ؟<select name="user">${(isAdmin()?state.users:[current()]).map(u=>option(u.id,u.name,i.user)).join('')}</select></label><label class="field">طريقة الاستلام<select name="payment">${['نقدي','تحويل بنكي','محفظة إلكترونية','أخرى'].map(p=>option(p,p,i.payment)).join('')}</select></label><label class="field full">ملاحظة (اختياري)<textarea name="note" maxlength="1000" placeholder="تفاصيل الدخل...">${escapeHTML(i.note)}</textarea></label></div><p class="income-explanation">يُضاف هذا المبلغ إلى رصيد الشهر المحدد بتاريخ العملية.</p><p id="incomeError" class="form-error" role="alert"></p><div class="form-actions">${existing?'<button type="button" class="button danger" id="deleteIncome">حذف الدخل</button>':''}<button type="button" class="button" data-action="close-modal">إلغاء</button><button class="button primary" type="submit">${icon('check')}حفظ الدخل</button></div></form>`);
  $('#incomeForm').onsubmit=event=>{
    event.preventDefault();const f=new FormData(event.target);
    const item={id:existing?.id||uid(),amount:Number(f.get('amount')),date:f.get('date'),source:f.get('source').trim(),user:isAdmin()?f.get('user'):state.currentUser,payment:f.get('payment'),note:f.get('note').trim()};
    if(!Number.isFinite(item.amount)||item.amount<=0||item.amount>9999999||!item.source||!validIncomeDate(item.date)){$('#incomeError').textContent='أدخل مبلغًا صحيحًا وتاريخًا واسم مصدر الدخل.';return;}
    item.amount=Math.round(item.amount*100)/100;
    if(state.cloud)return cloudMutate(async()=>{await cloud.saveIncome(state.householdId,item,existing);month=item.date.slice(0,7);},'تم حفظ الدخل','#incomeError');
    if(commit(()=>{state.incomes??=[];if(existing)state.incomes[state.incomes.findIndex(x=>x.id===id)]=item;else state.incomes.push(item);})){month=item.date.slice(0,7);closeModal();render();toast(existing?'تم تحديث الدخل والرصيد':'تم تسجيل الدخل وإضافته إلى رصيد الشهر');}
  };
  $('#deleteIncome')?.addEventListener('click',()=>{
    showModal('حذف الدخل؟',`<p>سيتم حذف ${money(existing.amount)} دينار من ${escapeHTML(existing.source)}، وتحديث رصيد الشهر.</p><div class="form-actions"><button class="button" id="cancelIncomeDelete">رجوع</button><button class="button danger" id="confirmIncomeDelete">حذف الدخل</button></div>`);
    $('#cancelIncomeDelete').onclick=()=>incomeModal(id);
    $('#confirmIncomeDelete').onclick=()=>{if(!isAdmin()&&existing.user!==state.currentUser)return;if(state.cloud)return cloudMutate(()=>cloud.deleteIncome(state.householdId,existing),'تم حذف الدخل');if(commit(()=>state.incomes=state.incomes.filter(x=>x.id!==id))){closeModal();render();toast('تم حذف الدخل وتحديث الرصيد');}};
  });
}
function editMonthlyBudget() {
  if(!isAdmin())return;
  const selectedMonth=month;
  showModal('تعديل الميزانية الشهرية',`<form id="monthlyBudgetForm"><label class="field">الميزانية الأساسية (دينار)<input name="budget" type="number" min="0" max="99999999" step="0.01" required value="${householdBudget(selectedMonth)}"></label><label class="field">تطبيق التعديل<select name="period"><option value="month">${monthName(selectedMonth)} فقط</option><option value="default">الميزانية الافتراضية للأشهر</option></select></label><p class="income-explanation" id="monthlyBudgetHint">التعديل لهذا الشهر فقط؛ لا يغيّر ميزانيات الأشهر الأخرى.</p><p class="income-explanation">الدخل الإضافي لهذا الشهر: ${money(sum(incomeEntries(selectedMonth,'all')))} دينار. يبقى منفصلًا عن قيمة الميزانية.</p><p id="monthlyBudgetError" class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="button" data-action="close-modal">إلغاء</button><button class="button primary" type="submit">حفظ الميزانية</button></div></form>`);
  const form=$('#monthlyBudgetForm');
  form.elements.period.onchange=()=>{const isDefault=form.elements.period.value==='default';form.elements.budget.value=isDefault?state.budget:householdBudget(selectedMonth);$('#monthlyBudgetHint').textContent=isDefault?'تُطبَّق على الأشهر التي ليس لها ميزانية خاصة، بما فيها الأشهر السابقة. ميزانية أي شهر مخصص تبقى كما هي.':'التعديل لهذا الشهر فقط؛ لا يغيّر ميزانيات الأشهر الأخرى.';};
  form.onsubmit=event=>{event.preventDefault();if(!isAdmin())return;const f=new FormData(form),value=Number(f.get('budget'));if(!Number.isFinite(value)||value<0||value>99999999){$('#monthlyBudgetError').textContent='أدخل ميزانية صحيحة، صفر أو أكثر.';return;}if(state.cloud)return cloudMutate(()=>cloud.setBudget(state.householdId,'household',null,Math.round(value*100)/100,f.get('period')==='default'?null:selectedMonth),'تم حفظ الميزانية الشهرية','#monthlyBudgetError');if(commit(()=>{const amount=Math.round(value*100)/100;if(f.get('period')==='default')state.budget=amount;else{state.monthlyBudgets??={};state.monthlyBudgets[selectedMonth]=amount;}})){closeModal();render();toast('تم حفظ الميزانية الشهرية');}};
}
function validIncomeDate(date) {
  if(typeof date!=='string'||!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date))return false;
  const value=new Date(date+'T12:00:00Z');return !isNaN(value)&&value.toISOString().slice(0,10)===date;
}
function validIncomeState(s) {
  const incomes=s.incomes??[],budgets=s.monthlyBudgets??{};
  return Array.isArray(incomes)&&incomes.every(i=>i&&typeof i.id==='string'&&Number.isFinite(i.amount)&&i.amount>0&&i.amount<=9999999&&validIncomeDate(i.date)&&typeof i.source==='string'&&i.source.trim().length>0&&i.source.length<=100&&s.users.some(u=>u.id===i.user)&&typeof i.note==='string'&&i.note.length<=1000&&['نقدي','تحويل بنكي','محفظة إلكترونية','أخرى'].includes(i.payment))&&new Set(incomes.map(i=>i.id)).size===incomes.length&&typeof budgets==='object'&&!Array.isArray(budgets)&&Object.entries(budgets).every(([key,value])=>/^\d{4}-(0[1-9]|1[0-2])$/.test(key)&&Number.isFinite(value)&&value>=0&&value<=99999999);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button||!state)return;
  if(button.dataset.action==='add-income')incomeModal();
  if(button.dataset.action==='edit-income')incomeModal(button.dataset.id);
  if(button.dataset.action==='edit-monthly-budget')editMonthlyBudget();
});
