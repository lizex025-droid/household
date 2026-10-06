'use strict';

(() => {
  const RECEIPT_BUCKET = 'receipts';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const number = value => Number(value ?? 0);
  const asMonthStart = value => value ? `${String(value).slice(0, 7)}-01` : null;
  const firstName = value => String(value || '').trim().split(/\s+/)[0] || 'عضو';
  const extFor = file => file?.type === 'image/png' ? 'png' : file?.type === 'image/webp' ? 'webp' : 'jpg';
  const makeId = () => globalThis.crypto?.randomUUID?.() || (() => {
    throw new Error('المتصفح قديم ولا يدعم إنشاء المعرّفات المطلوبة.');
  })();

  function errorMessage(error) {
    const raw = String(error?.message || error?.error_description || error || 'تعذر الاتصال بالخدمة.');
    const known = [
      [/Invalid login credentials/i, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
      [/Email not confirmed/i, 'يجب تأكيد البريد الإلكتروني أولًا.'],
      [/User already registered/i, 'هذا البريد مسجل بالفعل. استخدم تسجيل الدخول.'],
      [/Password should be at least/i, 'كلمة المرور قصيرة جدًا. استخدم 8 أحرف على الأقل.'],
      [/already belongs to a household/i, 'هذا الحساب منضم بالفعل إلى عائلة.'],
      [/Admin access required/i, 'هذه العملية متاحة لمدير العائلة فقط.'],
      [/Household access required/i, 'لا تملك صلاحية الوصول إلى هذه العائلة.'],
      [/Invalid or expired invitation|Invalid invitation or email not confirmed/i, 'رمز الدعوة غير صالح أو منتهي، أو البريد غير مؤكد.'],
      [/Invalid household name or budget/i, 'تحقق من اسم العائلة والميزانية.'],
      [/Invalid member details/i, 'تحقق من اسم الفرد والصلاحية والميزانية.'],
      [/Invalid invitation/i, 'تحقق من البريد والصلاحية والميزانية.'],
      [/duplicate key value/i, 'هذه البيانات موجودة مسبقًا.'],
      [/row-level security|violates row-level security/i, 'تعذر الحفظ بسبب صلاحيات الحساب. أعد تسجيل الدخول ثم حاول مجددًا.'],
      [/Failed to fetch|NetworkError|Load failed/i, 'تعذر الوصول إلى Supabase. تحقق من الإنترنت ثم أعد المحاولة.']
    ];
    for (const [pattern, text] of known) if (pattern.test(raw)) return text;
    return raw;
  }

  function effectiveBudget(rows, scope, targetId, month) {
    const list = Array.isArray(rows) ? rows : [];
    const monthStart = month && month !== '0000-00' ? asMonthStart(month) : null;
    const matches = list.filter(row => {
      if (row.scope !== scope) return false;
      if (scope === 'member' && row.user_id !== targetId) return false;
      if (scope === 'category' && row.category_id !== targetId) return false;
      if (scope === 'household' && (row.user_id || row.category_id)) return false;
      return true;
    });
    if (monthStart) {
      const exact = matches.find(row => row.month_start === monthStart);
      if (exact) return number(exact.amount);
    }
    const recurring = matches.find(row => !row.month_start);
    return recurring ? number(recurring.amount) : 0;
  }

  function createBaytClient(createClient, config) {
    if (typeof createClient !== 'function') throw new Error('مكتبة Supabase لم تُحمّل بشكل صحيح.');
    if (!config?.url || !config?.publishableKey || config.publishableKey === 'YOUR_KEY') {
      throw new Error('إعدادات Supabase ناقصة في config.js.');
    }

    const supabase = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'bayt-auth-v1'
      }
    });

    const checked = async promise => {
      const result = await promise;
      if (result?.error) throw result.error;
      return result?.data;
    };

    const getSession = async () => {
      const data = await checked(supabase.auth.getSession());
      return data?.session || null;
    };

    const requireSession = async () => {
      const session = await getSession();
      if (!session?.user) throw new Error('سجّل الدخول أولًا.');
      return session;
    };

    async function load() {
      const session = await requireSession();
      const userId = session.user.id;

      const membership = await checked(
        supabase.from('household_members')
          .select('household_id,user_id,role,color,ink,joined_at')
          .eq('user_id', userId)
          .maybeSingle()
      );
      if (!membership) return null;

      const householdId = membership.household_id;
      const [household, members, categories, subcategories, budgetRows, expenses, receipts, favorites, incomes] = await Promise.all([
        checked(supabase.from('households').select('id,name,currency,share_expenses').eq('id', householdId).single()),
        checked(supabase.from('household_members').select('household_id,user_id,role,color,ink,joined_at').eq('household_id', householdId).order('joined_at')),
        checked(supabase.from('categories').select('id,household_id,name,icon,color,created_at').eq('household_id', householdId).order('created_at')),
        checked(supabase.from('subcategories').select('id,household_id,category_id,name,archived,created_at').eq('household_id', householdId).order('created_at')),
        checked(supabase.from('budgets').select('id,household_id,scope,user_id,category_id,month_start,amount,updated_at').eq('household_id', householdId)),
        checked(supabase.from('expenses').select('id,household_id,user_id,category_id,subcategory_id,amount,expense_date,merchant,note,payment_method,expense_type,created_by,revision').eq('household_id', householdId).order('expense_date', { ascending: false })),
        checked(supabase.from('expense_receipts').select('id,household_id,expense_id,object_path,uploaded_by,mime_type,size_bytes,created_at').eq('household_id', householdId)),
        checked(supabase.from('favorites').select('household_id,user_id,subcategory_id').eq('household_id', householdId).eq('user_id', userId)),
        checked(supabase.from('incomes').select('id,household_id,user_id,amount,income_date,source,payment_method,note,created_by,created_at,updated_at').eq('household_id', householdId).order('income_date', { ascending: false }))
      ]);

      const memberIds = members.map(m => m.user_id);
      const profiles = memberIds.length
        ? await checked(supabase.from('profiles').select('id,display_name').in('id', memberIds))
        : [];
      const profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
      const subById = new Map((subcategories || []).map(sub => [sub.id, sub]));
      const receiptByExpense = new Map((receipts || []).map(receipt => [receipt.expense_id, receipt]));

      const users = (members || []).map(member => {
        const profile = profileById.get(member.user_id);
        const name = profile?.display_name || (member.user_id === userId ? session.user.user_metadata?.display_name : '') || 'فرد العائلة';
        return {
          id: member.user_id,
          name,
          short: firstName(name),
          role: member.role,
          budget: 0,
          color: member.color || '#e7eee1',
          ink: member.ink || '#7d936d',
          managed: false
        };
      });

      const categoryList = (categories || []).map(category => ({
        id: category.id,
        name: category.name,
        icon: category.icon || 'layers',
        color: category.color || '#9aaf83',
        budget: 0,
        subs: (subcategories || [])
          .filter(sub => sub.category_id === category.id && !sub.archived)
          .map(sub => sub.name)
      })).filter(category => category.subs.length);

      const favoriteMap = Object.fromEntries(users.map(user => [user.id, []]));
      favoriteMap[userId] ||= [];
      for (const favorite of favorites || []) {
        const sub = subById.get(favorite.subcategory_id);
        if (sub && !sub.archived) favoriteMap[userId].push(`${sub.category_id}|${sub.name}`);
      }

      const expenseList = (expenses || []).map(expense => {
        const sub = subById.get(expense.subcategory_id);
        return {
          id: expense.id,
          amount: number(expense.amount),
          date: expense.expense_date,
          user: expense.user_id,
          category: expense.category_id,
          sub: sub?.name || 'أخرى',
          merchant: expense.merchant || '',
          payment: expense.payment_method || 'نقدي',
          type: expense.expense_type || 'need',
          note: expense.note || '',
          receipt: receiptByExpense.get(expense.id) || null,
          revision: expense.revision
        };
      });

      const incomeList = (incomes || []).map(income => ({
        id: income.id,
        amount: number(income.amount),
        date: income.income_date,
        source: income.source,
        user: income.user_id,
        payment: income.payment_method,
        note: income.note || ''
      }));

      return {
        version: 1,
        cloud: true,
        householdId,
        household: household.name,
        currency: household.currency || 'JOD',
        shareExpenses: !!household.share_expenses,
        currentUser: userId,
        users,
        categories: categoryList,
        expenses: expenseList,
        incomes: incomeList,
        favorites: favoriteMap,
        budgetRows: (budgetRows || []).map(row => ({ ...row, amount: number(row.amount) })),
        budget: 0,
        monthlyBudgets: {}
      };
    }

    async function removeReceipt(receipt) {
      if (!receipt) return;
      const path = typeof receipt === 'string' ? receipt : receipt.object_path;
      const id = typeof receipt === 'object' ? receipt.id : null;
      if (id) {
        const { error } = await supabase.from('expense_receipts').delete().eq('id', id);
        if (error) throw error;
      }
      if (path) {
        const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
        if (error) console.warn('Receipt storage cleanup failed:', error.message);
      }
    }

    async function saveExpense(householdId, item, existing, options = {}) {
      const session = await requireSession();
      const subcategoryId = await checked(supabase.rpc('ensure_subcategory', {
        p_household_id: householdId,
        p_category_id: item.category,
        p_name: item.sub
      }));

      const expenseId = UUID_RE.test(item.id || '') ? item.id : makeId();
      const payload = {
        household_id: householdId,
        user_id: item.user,
        category_id: item.category,
        subcategory_id: subcategoryId,
        amount: item.amount,
        expense_date: item.date,
        merchant: item.merchant || '',
        note: item.note || '',
        payment_method: item.payment || 'نقدي',
        expense_type: item.type || 'need'
      };

      if (existing?.id) {
        await checked(supabase.from('expenses').update(payload).eq('id', existing.id).eq('household_id', householdId).select('id').single());
      } else {
        await checked(supabase.from('expenses').insert({ ...payload, id: expenseId, created_by: session.user.id }).select('id').single());
      }
      const savedId = existing?.id || expenseId;

      if (options.removeReceipt || (options.file?.size && existing?.receipt)) {
        await removeReceipt(existing?.receipt);
      }

      if (options.file?.size) {
        const file = options.file;
        const path = `${householdId}/${savedId}/${session.user.id}/${makeId()}.${extFor(file)}`;
        {
          const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
            contentType: file.type,
            upsert: false,
            cacheControl: '3600'
          });
          if (error) throw error;
        }
        try {
          await checked(supabase.from('expense_receipts').insert({
            household_id: householdId,
            expense_id: savedId,
            object_path: path,
            uploaded_by: session.user.id,
            mime_type: file.type,
            size_bytes: file.size
          }).select('id').single());
        } catch (error) {
          await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
          throw error;
        }
      }

      if (options.favorite !== undefined) {
        const favoriteKey = { household_id: householdId, user_id: session.user.id, subcategory_id: subcategoryId };
        if (options.favorite) {
          const { error } = await supabase.from('favorites').upsert(favoriteKey, { onConflict: 'household_id,user_id,subcategory_id' });
          if (error) throw error;
        } else {
          const { error } = await supabase.from('favorites').delete()
            .eq('household_id', householdId)
            .eq('user_id', session.user.id)
            .eq('subcategory_id', subcategoryId);
          if (error) throw error;
        }
      }
      return { id: savedId };
    }

    async function deleteExpense(householdId, existing) {
      if (existing?.receipt) {
        try { await removeReceipt(existing.receipt); } catch (error) { console.warn(error); }
      }
      await checked(supabase.from('expenses').delete().eq('household_id', householdId).eq('id', existing.id).select('id').single());
    }

    async function saveIncome(householdId, item, existing) {
      const session = await requireSession();
      const id = UUID_RE.test(item.id || '') ? item.id : makeId();
      const payload = {
        household_id: householdId,
        user_id: item.user,
        amount: item.amount,
        income_date: item.date,
        source: item.source,
        payment_method: item.payment,
        note: item.note || ''
      };
      if (existing?.id) {
        await checked(supabase.from('incomes').update(payload).eq('household_id', householdId).eq('id', existing.id).select('id').single());
      } else {
        await checked(supabase.from('incomes').insert({ ...payload, id, created_by: session.user.id }).select('id').single());
      }
      return { id: existing?.id || id };
    }

    async function deleteIncome(householdId, existing) {
      await checked(supabase.from('incomes').delete().eq('household_id', householdId).eq('id', existing.id).select('id').single());
    }

    return {
      session: getSession,
      onAuthChange(callback) {
        const { data } = supabase.auth.onAuthStateChange(callback);
        return data?.subscription;
      },
      async signIn(email, password) {
        const data = await checked(supabase.auth.signInWithPassword({ email, password }));
        return data;
      },
      async signUp(email, password, name, redirectTo) {
        const data = await checked(supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name },
            emailRedirectTo: redirectTo
          }
        }));
        return data;
      },
      async signOut(scope = 'local') {
        await checked(supabase.auth.signOut({ scope }));
      },
      async resetPassword(email, redirectTo) {
        await checked(supabase.auth.resetPasswordForEmail(email, { redirectTo }));
      },
      async updatePassword(password) {
        await checked(supabase.auth.updateUser({ password }));
      },
      load,
      async bankAccounts(householdId) {
        return (await checked(supabase.from('bank_accounts').select('id,household_id,user_id,bank,masked_account,label,default_category_id,enabled,automation_configured').eq('household_id', householdId).order('created_at'))) || [];
      },
      async bankEvents(householdId) {
        return (await checked(supabase.from('bank_sms_events').select('id,account_id,expense_id,amount,merchant,transaction_date,transaction_time,reported_balance,received_at').eq('household_id', householdId).order('received_at', { ascending: false }).limit(10))) || [];
      },
      async bankTransfers(householdId) {
        return (await checked(supabase.from('bank_transfers').select('id,from_account_id,to_account_id,amount,transfer_date,reported_balance,received_at').eq('household_id', householdId).order('received_at', { ascending: false }).limit(10))) || [];
      },
      async saveBankAccount(householdId, account) {
        return checked(supabase.rpc('save_bank_account', {
          p_household_id: householdId, p_masked_account: account.masked_account,
          p_user_id: account.user_id, p_label: account.label,
          p_category_id: account.default_category_id, p_account_id: account.id || null,
          p_enabled: account.enabled
        }));
      },
      async setBankKey(accountId, token = null) {
        return checked(supabase.rpc('set_bank_automation_key', { p_account_id: accountId, p_token: token }));
      },
      bankEndpoint: `${config.url.replace(/\/$/, '')}/functions/v1/bank-sms`,
      async createHousehold(name, budget) {
        return checked(supabase.rpc('create_household', { p_name: name, p_budget: budget }));
      },
      async createInvitation(householdId, email, role, budget) {
        return checked(supabase.rpc('create_invitation', {
          p_household_id: householdId,
          p_email: email,
          p_role: role,
          p_budget: budget
        }));
      },
      async acceptInvitation(token) {
        return checked(supabase.rpc('accept_invitation', { p_token: token }));
      },
      async invitations(householdId) {
        return (await checked(supabase.rpc('list_invitations', { p_household_id: householdId }))) || [];
      },
      async revokeInvitation(invitationId) {
        await checked(supabase.rpc('revoke_invitation', { p_invitation_id: invitationId }));
      },
      async setBudget(householdId, scope, targetId, amount, month) {
        return checked(supabase.rpc('set_budget', {
          p_household_id: householdId,
          p_scope: scope,
          p_amount: amount,
          p_user_id: scope === 'member' ? targetId : null,
          p_category_id: scope === 'category' ? targetId : null,
          p_month_start: asMonthStart(month)
        }));
      },
      async saveCategory(householdId, category) {
        return checked(supabase.rpc('save_category', {
          p_household_id: householdId,
          p_name: category.name,
          p_subcategories: category.subs,
          p_budget: number(category.budget),
          p_category_id: UUID_RE.test(category.id || '') ? category.id : null,
          p_icon: category.icon || 'layers',
          p_color: category.color || '#9aaf83'
        }));
      },
      async saveHousehold(householdId, name, shareExpenses) {
        await checked(supabase.from('households').update({ name, share_expenses: shareExpenses }).eq('id', householdId).select('id').single());
      },
      async updateMember(householdId, member) {
        await checked(supabase.rpc('update_member', {
          p_household_id: householdId,
          p_user_id: member.id,
          p_display_name: member.name,
          p_role: member.role,
          p_budget: number(member.budget)
        }));
      },
      async addMember() {
        throw new Error('في النسخة السحابية أضف الفرد عبر زر الدعوات حتى يكون له حساب آمن.');
      },
      async removeMember(householdId, userId) {
        await checked(supabase.rpc('remove_member', { p_household_id: householdId, p_user_id: userId }));
      },
      saveExpense,
      deleteExpense,
      saveIncome,
      deleteIncome,
      async receiptUrl(receipt) {
        const path = typeof receipt === 'string' ? receipt : receipt?.object_path;
        if (!path) throw new Error('لا توجد فاتورة مرتبطة بهذا المصروف.');
        const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 600);
        if (error) throw error;
        return data.signedUrl;
      },
      async exportBackup(state) {
        return { ...state, exportedAt: new Date().toISOString() };
      }
    };
  }

  window.BaytData = Object.freeze({
    createBaytClient,
    effectiveBudget,
    errorMessage
  });
})();
