/* Offline fixtures only. This runner never contacts Home Assistant or Android. */
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  await fs.mkdir(path.join(__dirname,'artifacts'),{recursive:true});
  const server=http.createServer(async(req,res)=>{
    try{
      const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(!file.startsWith(root+path.sep))throw Error('Outside fixture root');
      const body=await fs.readFile(file);
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.png')?'image/png':'text/plain; charset=utf-8');res.end(body);
    }catch(error){res.statusCode=404;res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}});page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const base='http://127.0.0.1:'+server.address().port;
    let count=0;
    count+=(await require('./browser-portability.cjs')(page,base+'/tests/preview.html')).checks;
    await page.locator('hmi-room-panel-editor').evaluate(e=>e.launch());
    count+=(await require('./browser-history.cjs')(page,'hmi-room-panel-editor')).checks;
    await page.locator('hmi-room-panel-editor').evaluate(e=>e.finish(false));
    await page.evaluate(()=>window.makeEditor().launch());
    count+=(await require('./browser-service.cjs')(page,'hmi-room-panel-editor')).checks;
    count+=(await require('./browser-android.cjs')(page)).checks;
    count+=(await require('./browser-interactions.cjs')(page,base+'/tests/preview.html')).checks;
    count+=(await require('./browser-appearance.cjs')(page,base+'/tests/preview.html')).checks;
    if(errors.length)throw Error(errors.join('\n'));
    console.log(count+' browser checks passed using offline fixtures.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
