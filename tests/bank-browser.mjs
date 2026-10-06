// Offline fixtures only: no real session, database mutation or token is used.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const server=createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep)&&file!==root){res.writeHead(403).end();return;}const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css'};res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const browser=await chromium.launch({headless:true,executablePath:process.env.BAYT_CHROMIUM_EXECUTABLE_PATH,args:process.env.BAYT_CHROMIUM_EXECUTABLE_PATH?['--no-sandbox','--disable-dev-shm-usage']:undefined});
try {
 const page=await browser.newPage({viewport:{width:430,height:932}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.message);});page.setDefaultTimeout(10000);
 await page.route('https://**/*',route=>route.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/client.js*',async route=>route.fulfill({contentType:'application/javascript',body:readFileSync(new URL('../client.js',import.meta.url),'utf8')+`
window.supabase={createClient(){}};
window.__testAccounts=[{id:'bank-test',household_id:'home-test',user_id:'ahed',bank:'Arab Bank',masked_account:'0119*600',label:'حساب عاهد · Arab Bank',default_category_id:'other',enabled:true,automation_configured:false}];
window.__testKeys=[];
window.BaytData={...window.BaytData,createBaytClient(){return {
 session:async()=>({user:{id:'ahed',email:'test@example.invalid'}}),onAuthChange(){},
 load:async()=>{const s=seed();return {...s,cloud:true,householdId:'home-test',budgetRows:[{scope:'household',month_start:null,amount:1400},...s.users.map(u=>({scope:'member',user_id:u.id,month_start:null,amount:u.budget})),...s.categories.map(c=>({scope:'category',category_id:c.id,month_start:null,amount:c.budget}))]};},
 bankAccounts:async()=>window.__testAccounts,bankEvents:async()=>[],bankTransfers:async()=>[],
 setBankKey:async(id,token)=>{window.__testKeys.push({id,token});window.__testAccounts[0].automation_configured=!!token;},
 saveBankAccount:async(h,a)=>{window.__testAccounts[0]={...window.__testAccounts[0],...a};},
 bankEndpoint:'https://example.invalid/functions/v1/bank-sms'
};}};` }));
 await page.goto(base+'/#settings');await page.locator('#bankSettings').getByText('حساب عاهد · Arab Bank',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(process.env.BAYT_TEST_SCREENSHOT)await page.screenshot({path:process.env.BAYT_TEST_SCREENSHOT,fullPage:true});
 await page.getByRole('button',{name:'إعداد الآيفون',exact:true}).click();
 await page.getByRole('button',{name:'إنشاء مفتاح الأتمتة',exact:true}).click();await page.locator('#bankToken').waitFor();
 assert.equal((await page.locator('#bankToken').inputValue()).length,64);assert.equal(await page.locator('#bankToken').getAttribute('type'),'password');
 await page.locator('#bankTestText').fill('JO You have a purchase transaction on account 0119*600 from TEST MARKET amount JOD 17.722 on 06/10/2026 12:56 . Balance JOD 20.270 .');
 await page.getByRole('button',{name:'معاينة فقط',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#bankTestResult').textContent.includes('17.722'));
 assert.equal(await page.evaluate(()=>window.__testKeys.length),1);
 await page.locator('#bankTestText').fill('JO You have a purchase transaction on account 0119*604 from TEST amount JOD 0.001 on 06/10/2026 12:56 . Balance JOD 20.270 .');
 await page.getByRole('button',{name:'معاينة فقط',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#bankTestResult').textContent.includes('غير مربوط'));
 await page.locator('#closeModal').click();await page.waitForFunction(()=>!document.querySelector('#bankToken'));
 // Amount editing and dashboard totals retain the third decimal in local mode.
 await page.evaluate(()=>{const s=seed();s.cloud=true;s.householdId='home-test';s.budgetRows=[{scope:'household',amount:1400,month_start:null}];s.expenses=[{id:'precision-test',amount:17.722,date:localDate(),user:'ahed',category:'other',sub:'أخرى',merchant:'Test',payment:'Visa',type:'need',note:''}];state=s;location.hash='dashboard';render();});
 await page.waitForFunction(()=>document.querySelector('#availableBalanceValue')?.textContent.includes('1,382.278'));
 await page.evaluate(()=>expenseModal('precision-test'));assert.equal(await page.locator('[name="amount"]').inputValue(),'17.722');assert.equal(await page.locator('[name="amount"]').getAttribute('step'),'0.001');assert.match(await page.locator('#expenseForm').textContent(),/حتى 10 MB/);await page.locator('#closeModal').click();
 assert.deepEqual(errors,[]);console.log('Browser checks passed: mobile settings, key generation/masking, preview, account mismatch, key cleanup, three-decimal totals and expense editing.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
