import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArabBankSMS } from '../bank-parser.mjs';

const sms=(amount='1.950',merchant='SAMA AL DAHYYA MARKET',date='06/10/2026',time='16:01',balance='13.140')=>`JO\nYou have a purchase transaction on account 0119*600 from ${merchant} amount JOD ${amount} on ${date} ${time} . Balance JOD ${balance} .`;
test('reads Arab Bank example without losing fils or confusing balance with debit',()=>{
 assert.deepEqual(parseArabBankSMS(sms()),{account:'0119*600',merchant:'SAMA AL DAHYYA MARKET',amount:'1.950',date:'2026-10-06',time:'16:01',balance:'13.140'});
 assert.equal(parseArabBankSMS(sms('17.722','OPENAI* CHATGPT SUBSCR','06/10/2026','12:56','20.270')).amount,'17.722');
 assert.equal(parseArabBankSMS(sms('3.480','ZAIN APPLEPAY','06/10/2026','15:51','15.090')).amount,'3.480');
});
test('handles wrapping, optional JO, decimals and negative balances',()=>{
 assert.equal(parseArabBankSMS(sms('0.001','Market','06/10/2026','16:01','-0.050')).amount,'0.001');
 assert.equal(parseArabBankSMS(sms('12.5').replace(/^JO\n/,'').replace('from ','from\n')).amount,'12.500');
 assert.equal(parseArabBankSMS(sms().replace('0119*600','0119*604')).account,'0119*604');
});
test('rejects unsupported credit/refund/OTP messages and invalid monetary precision',()=>{
 for(const message of ['Your OTP is 123456',sms().replace('purchase','refund'),sms().replace('JOD 1.950','USD 1.950'),sms('0'),sms('1.9509'),sms('9999999.001'),sms('1,950')])assert.throws(()=>parseArabBankSMS(message));
});
test('rejects impossible dates, times, ambiguous trailing content and large requests',()=>{
 for(const message of [sms('1','x','31/02/2026'),sms('1','x','06/10/2026','24:00'),sms('1','x','06/10/2026','16:60'),sms()+'\n'+sms(), 'x'.repeat(4097)])assert.throws(()=>parseArabBankSMS(message));
});
