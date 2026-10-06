import test from 'node:test';
import assert from 'node:assert/strict';
import { extractShortcutText } from '../supabase/functions/bank-sms/shortcut-input.mjs';

const sms = 'JO\nJOD 1.700 has been debited from 0119*600 and has been credited to 0119*603 on 10/06/2026 . Balance JOD 22.753';

test('accepts direct iOS Message.Content text', () => {
  assert.equal(extractShortcutText(sms), sms);
});

test('unwraps common Shortcut Message JSON shapes', () => {
  assert.equal(extractShortcutText({ Content: sms, Sender: 'Arab Bank' }), sms);
  assert.equal(extractShortcutText({ message: { content: sms } }), sms);
  assert.equal(extractShortcutText([{ text: sms }]), sms);
});

test('rejects missing or ambiguous Shortcut input', () => {
  for (const value of [null, {}, [], [sms, sms], { Sender: 'Arab Bank' }]) {
    assert.throws(() => extractShortcutText(value), /Content/);
  }
});
