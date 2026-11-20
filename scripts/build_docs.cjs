/* Optional: npm install --no-save marked; node scripts/build_docs.cjs */
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async function(marked){
  const root=path.resolve(__dirname,'..');
  const content=await fs.readFile(path.join(root,'docs/user-guide.md'),'utf8');
  const html=marked.parse(content);
  const output=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home Panel · инструкция</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#202a35;font:17px/1.7 system-ui,-apple-system,sans-serif}a{color:#176294;text-underline-offset:3px}aside{position:fixed;width:280px;height:100vh;overflow:auto;padding:28px 22px;background:#17212c;color:#ecf1f6}aside b{font-size:21px}aside a{display:block;font-size:14px;line-height:1.5;color:#c7d6e5;text-decoration:none;padding:7px 0}main{margin-left:280px;max-width:1160px;padding:44px 56px 100px}h1{font-size:38px;line-height:1.2;margin:0 0 28px}h2{font-size:25px;line-height:1.35;margin:48px 0 16px;scroll-margin-top:24px}p{margin:14px 0}img{display:block;max-width:100%;height:auto;border-radius:12px;border:1px solid #d0d8e2;margin:22px 0}img[src$="main.png"]{max-width:min(480px,100%)}table{border-collapse:collapse;width:100%;margin:24px 0;font-size:15px;background:white}th,td{border:1px solid #d3dce5;padding:12px 14px;text-align:left;vertical-align:top}th{background:#e6edf3}code{font-size:.9em;background:#e2e9ef;padding:2px 5px;border-radius:4px}pre{padding:16px;background:#e2e9ef;overflow:auto}li{margin:8px 0}.tag{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#6c8399}
@media(max-width:1000px){aside{position:relative;width:auto;height:auto}aside nav{columns:2}main{margin:0;padding:28px 24px 70px}h1{font-size:30px}}@media(max-width:620px){body{font-size:16px}aside nav{columns:1}main{padding:24px 18px}table{display:block;overflow:auto}h2{font-size:23px}}@media print{aside{display:none}main{margin:0;padding:0;max-width:none}h2{break-after:avoid}img,table{break-inside:avoid}body{background:white;font-size:11pt}}
</style><aside><b>Home Panel</b><p class="tag">Инструкция · версия 0.3.0</p><nav></nav></aside><main>${html}</main><script>document.querySelectorAll('main h2').forEach((h,i)=>{h.id='step-'+(i+1);const a=document.createElement('a');a.href='#'+h.id;a.textContent=h.textContent;document.querySelector('nav').append(a);});</script></html>`;
  await fs.writeFile(path.join(root,'docs/user-guide.html'),output,'utf8');
  return {htmlBytes:Buffer.byteLength(output)};
};
if(require.main===module)import('marked').then(module.exports).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
