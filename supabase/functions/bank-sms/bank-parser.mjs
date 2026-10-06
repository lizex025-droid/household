// Arab Bank purchase SMS only. Amounts remain decimal strings (JOD has 1000 fils).
export function parseArabBankSMS(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('رسالة غير صالحة أو طويلة جدًا.');
  const normalized = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(?:JO\s+)?You have a purchase transaction on account (\d{2,12}\*{1,12}\d{3,4}) from (.{1,100}?) amount JOD (\d{1,7}(?:\.\d{1,3})?) on (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\s*\.\s*Balance JOD (-?\d{1,10}(?:\.\d{1,3})?)\s*\.?$/i);
  if (!match) throw new Error('الصيغة غير مدعومة. نستقبل رسائل الشراء بالدينار من Arab Bank فقط.');
  const [, account, merchant, amount, day, month, year, hour, minute, balance] = match;
  const date = `${year}-${month}-${day}`;
  const check = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date || Number(year) < 2000 || Number(year) > 2100 || Number(hour) > 23 || Number(minute) > 59) throw new Error('تاريخ العملية غير صالح.');
  const decimal = value => { const [whole, fraction = ''] = value.split('.'); return `${whole}.${fraction.padEnd(3, '0')}`; };
  if (Number(amount) <= 0 || Number(amount) > 9999999) throw new Error('مبلغ الخصم غير صالح.');
  return { account, merchant: merchant.trim(), amount: decimal(amount), date, time: `${hour}:${minute}`, balance: decimal(balance) };
}
