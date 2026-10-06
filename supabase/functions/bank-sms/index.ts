import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { parseArabBankSMS } from './bank-parser.mjs';

const reply = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
});

// JWT verification is disabled at the gateway because Shortcuts uses a revocable,
// account-scoped capability. The database authenticates its SHA-256 hash atomically.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  if (req.method !== 'POST') return reply(405, { error: 'استخدم POST.' });
  if (!req.headers.get('content-type')?.includes('application/json')) return reply(415, { error: 'استخدم JSON.' });
  if (Number(req.headers.get('content-length') || 0) > 8192) return reply(413, { error: 'الطلب كبير جدًا.' });
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: 'الطلب فارغ.' });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 8192) { await reader.cancel(); return reply(413, { error: 'الطلب كبير جدًا.' }); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: 'JSON غير صالح.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'الطلب غير صالح.' });
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || body.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return reply(401, { error: 'مفتاح الأتمتة غير صالح.' });
    if (typeof body.sender !== 'string' || !/^Arab\s*Bank$/i.test(body.sender.trim())) return reply(422, { error: 'مرسل البنك غير مدعوم.' });
    if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') return reply(400, { error: 'dry_run يجب أن تكون true أو false.' });
    let parsed; try { parsed = parseArabBankSMS(body.text); } catch (error) { return reply(422, { error: (error as Error).message }); }
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc('ingest_bank_purchase', { p_token: token, p_purchase: parsed, p_dry_run: body.dry_run === true });
    if (error) {
      if (error.code === '28000') return reply(401, { error: 'مفتاح الأتمتة ملغى أو غير صالح.' });
      if (error.message.includes('Account mismatch')) return reply(422, { error: 'الرسالة لحساب غير مربوط بهذا المفتاح.' });
      if (error.message.includes('Rate limit')) return reply(429, { error: 'وصلت لحد العمليات. حاول لاحقًا.' });
      return reply(503, { error: 'تعذر تسجيل العملية. أعد إرسال نفس الرسالة؛ لن تتكرر.' });
    }
    return reply(200, data);
  } catch { return reply(503, { error: 'تعذر الاتصال. أعد المحاولة بنفس الرسالة.' }); }
});
