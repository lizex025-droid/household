// Arab Bank purchase and internal-transfer SMS. Amounts remain decimal strings
// because JOD has 1000 fils.
export function parseArabBankSMS(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('رسالة غير صالحة أو طويلة جدًا.');
  const normalized = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  const decimal = value => { const [whole, fraction = ''] = value.split('.'); return `${whole}.${fraction.padEnd(3, '0')}`; };
  const validDate = (year, month, day) => {
    const date = `${year}-${month}-${day}`;
    const check = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date || Number(year) < 2000 || Number(year) > 2100) throw new Error('تاريخ العملية غير صالح.');
    return date;
  };
  const purchase = normalized.match(/^(?:JO\s+)?You have a purchase transaction on account (\d{2,12}\*{1,12}\d{3,4}) from (.{1,100}?) amount JOD (\d{1,7}(?:\.\d{1,3})?) on (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\s*\.\s*Balance JOD (-?\d{1,10}(?:\.\d{1,3})?)\s*\.?$/i);
  if (purchase) {
    const [, account, merchant, amount, day, month, year, hour, minute, balance] = purchase;
    const date = validDate(year, month, day);
    if (Number(hour) > 23 || Number(minute) > 59) throw new Error('تاريخ العملية غير صالح.');
    if (Number(amount) <= 0 || Number(amount) > 9999999) throw new Error('مبلغ الخصم غير صالح.');
    return { type: 'purchase', account, merchant: merchant.trim(), amount: decimal(amount), date, time: `${hour}:${minute}`, balance: decimal(balance) };
  }
  const transfer = normalized.match(/^(?:JO\s+)?JOD (\d{1,7}(?:\.\d{1,3})?) has been debited from (\d{2,12}\*{1,12}\d{3,4}) and has been credited to (\d{2,12}\*{1,12}\d{3,4}) on (\d{2})\/(\d{2})\/(\d{4})\s*\.\s*Balance JOD (-?\d{1,10}(?:\.\d{1,3})?)\s*\.?$/i);
  if (!transfer) throw new Error('الصيغة غير مدعومة. نستقبل رسائل الشراء والحوالات الداخلية بالدينار من Arab Bank فقط.');
  const [, amount, fromAccount, toAccount, month, day, year, balance] = transfer;
  if (fromAccount === toAccount || Number(amount) <= 0 || Number(amount) > 9999999) throw new Error('بيانات الحوالة غير صالحة.');
  return { type: 'transfer', fromAccount, toAccount, amount: decimal(amount), date: validDate(year, month, day), balance: decimal(balance) };
}
