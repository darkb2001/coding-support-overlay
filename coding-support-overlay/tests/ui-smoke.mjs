import { createServer } from 'vite'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { checkMeetingComposer } from './fixtures/meeting-composer-check.mjs'
import { checkMeetingAnswerPages } from './fixtures/meeting-answer-pages-check.mjs'
const project=fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const root=await realpath(await mkdtemp(`${tmpdir()}/overlay-ui-smoke-`))
await mkdir(root,{recursive:true})
await writeFile(`${root}/index.html`,'<html><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>')
await writeFile(`${root}/fixture.tsx`, `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import App from '${project}/src/renderer/App.tsx'
import MeetingSetup from '${project}/src/renderer/MeetingSetup.tsx'
import MeetingWorkspace from '${project}/src/renderer/MeetingWorkspace.tsx'
import SetupScreen from '${project}/src/renderer/SetupScreen.tsx'
import QuitButton from '${project}/src/renderer/QuitButton.tsx'
import {readMeetingPrompt,readMeetingResponseFormat} from '${project}/src/renderer/MeetingPrompt.tsx'
import {readOpacity,saveText} from '${project}/src/renderer/preferences.ts'
import '${project}/src/renderer/styles.css'
import '${project}/src/renderer/meeting.css'
const models=['vibe-daily','gemini/gemini-3.7-flash','cx/gpt-5.5','cx/codex-auto-review']
window.fixture={hidden:false,minimized:false,quitRequested:false}
window.api={quitApp:async()=>{window.fixture.quitRequested=true},setMinimized:async()=>{window.fixture.minimized=true},hideOverlay:async()=>{window.fixture.hidden=true},toggleFocusable:async()=>{},bridge:{models:async()=>({ok:true,models}),testConnection:async()=>({ok:true})},meeting:{models:async()=>({ok:true,models,model:'vibe-daily'}),testModel:async(model)=>({ok:true,model,token:'fixture-only',latencyMs:12})}}
function Fixture(){
 const [live,setLive]=useState(false),[ready,setReady]=useState(null),[brief,setBrief]=useState(readMeetingPrompt),[format,setFormat]=useState(readMeetingResponseFormat),[model,setModel]=useState('vibe-daily'),[language,setLanguage]=useState('vi'),[opacity,setOpacity]=useState(readOpacity)
 const prompt={value:brief,onChange:setBrief,responseFormat:format,onFormatChange:setFormat,disabled:false}
 const provider=new URLSearchParams(location.search).has('provider')
 return <><div style={{background:'#ecf2e5',color:'#243a24',fontSize:10,padding:4}}>LOCAL UI FIXTURE · no real provider / audio / native IPC</div>{provider?<SetupScreen status={{ok:true,hasKey:true,verified:true}} onVerified={()=>{}} onClose={()=>{}}/>:<div className={'overlay-meeting '+(live?'is-live':'is-setup')} style={{display:'flex',flex:1,minHeight:0,flexDirection:'column',background:'transparent'}}>
 {!live&&<header className="meeting-app-header"><div className="meeting-brand"><strong>Meeting Copilot</strong></div><span className="meeting-drag-handle">Kéo để di chuyển</span><div className="meeting-header-actions"><button>Coding</button><button>Provider</button><button onClick={()=>window.api.hideOverlay()}>Ẩn</button><QuitButton/></div></header>}
 <div className="meeting-shell" style={{'--overlay-opacity':opacity}}>{live?<MeetingWorkspace model={model} language={language} prompt={prompt} transcript={[{speaker:'Others',text:'How would you design a rate limiter for a public API?',ts:1}]} answer={{reply:'**Token bucket per API key, stored in Redis.**\\n\\n- Refill tokens at a fixed rate, up to a burst capacity.\\n- Use a Lua script to decrement atomically.\\n- Return HTTP 429 with Retry-After when empty.\\n\\nA sliding-window log is more precise, but costs more memory.',model:'vibe-daily',question:'How would you design a rate limiter for a public API?'}} busy={false} hintLoading={false} status="Đang nghe" error={null} level={.03} systemLevel={.02} micMuted={false} onMicToggle={()=>{}} draftText="" liveDraft={true} copied={false} opacity={opacity} onOpacity={v=>{setOpacity(v);saveText('coding-support.opacity.v1',String(v))}} onLanguage={setLanguage} onModel={async s=>setModel(s.model)} onHint={()=>{}} onStop={()=>setLive(false)} onHistory={()=>{}} onCopy={()=>{}} onClear={()=>{}} onLiveDraft={()=>{}} onCapture={async()=>({id:'fixture',dataUrl:'data:image/png;base64,iVBORw0KGgo=',display:'Synthetic'})} onDiscard={async()=>{}} onQuestion={async()=>true}/>:<MeetingSetup prompt={prompt} language={language} prepared={ready} busy={false} status="" error={null} onLanguage={setLanguage} onReady={setReady} onStart={()=>setLive(true)} onHistory={()=>{}}/>}</div></div>}</>
}
const appMode=new URLSearchParams(location.search).has('app')
if(appMode){
 localStorage.setItem('coding-support.mode.v1','meeting')
 const f=window.fixture
 Object.assign(f,{starts:0,stops:0,recorderStops:0,flushes:0,modelCalls:[],languages:[],layouts:[],failModel:false,failLanguage:false,questions:[],captures:0,discards:[]})
 const listen=name=>cb=>{f[name]=cb;return()=>{delete f[name]}}
 Object.assign(window.api,{
  setLayout:async layout=>{f.layouts.push(layout)},setMinimized:async value=>{f.minimized=value},
  onChunk:listen('chunk'),onStatus:listen('agentStatus'),onError:listen('agentError'),
  session:{getActiveId:async()=>null,createNew:async()=>({id:'coding-fixture',messages:[]}),getAll:async()=>[],update:async()=>null},
 })
 window.api.bridge.status=async()=>({ok:true,hasKey:true,verified:true})
 Object.assign(window.api.meeting,{
  start:async()=>{f.starts++;return {ok:true,backend:'speechmatics',meetingId:'interview-fixture'}},
  stop:async id=>{f.stops++;f.stoppedId=id;return {ok:true}},
  setModel:async(id,selection)=>{f.modelCalls.push({id,selection});return f.failModel?{ok:false,error:'Fixture model rejected'}:{ok:true,selection}},
  setLanguage:async(language,meetingId)=>{f.languages.push(language);f.languageMeetingId=meetingId;if(f.delayLanguage)await new Promise(resolve=>{f.releaseLanguage=resolve});return f.failLanguage?{ok:false,error:'Fixture language rejected'}:{ok:true,language}},
  capture:async()=>{f.captures++;return {ok:true,attachment:{id:'11111111-1111-4111-8111-111111111111',display:'Synthetic code screen',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='}}},
  discardImage:async(id,imageId)=>{f.discards.push({id,imageId});return {ok:true}},
  requestHint:async input=>{f.status('suggesting');if(input.question!==undefined||input.imageId){f.questions.push(input);if(f.failQuestion)return {ok:false,error:'Fixture question rejected'};if(f.delayQuestion){f.reply({reply:'Question preview',partial:true});await new Promise(resolve=>{f.releaseQuestion=resolve})}}f.reply({reply:f.answerText||'Lifecycle answer',model:f.answerModel||'vibe-daily',question:input.question||'Lifecycle question'});f.status('idle');return {ok:true}},
  history:async()=>[],onTranscript:listen('transcript'),onReplyHint:listen('reply'),onStatus:listen('status'),onError:listen('error'),onAudioLevel:listen('level'),onDraft:listen('draft'),onHintShortcut:listen('hintShortcut')
 })
}
createRoot(document.getElementById('root')).render(appMode?<App/>:<Fixture/>);
`)
// Only the recorder boundary is substituted: App and MeetingMode lifecycle are production code.
await writeFile(`${root}/recorder.ts`, `export async function startRecorder(){return {setMuted:muted=>{window.fixture.micMuted=muted},flush:async()=>{window.fixture.flushes++;if(window.fixture.failMicFlush)throw Error('Synthetic mic flush failure')},stop:async()=>{window.fixture.recorderStops++}}}`)
const server=await createServer({plugins:[{name:'fixture-recorder',enforce:'pre',resolveId(id,importer){if(id==='./audioCapture'&&importer?.endsWith('/MeetingMode.tsx'))return root+'/recorder.ts'}}],configFile:false,root,cacheDir:`${root}/cache`,esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom'],alias:{react:`${project}/node_modules/react`,'react-dom':`${project}/node_modules/react-dom`,'react-markdown':`${project}/node_modules/react-markdown`}},server:{watch:{ignored:['**/chrome-*/**']},host:'127.0.0.1',port:0,fs:{allow:[root,project]}}})
await server.listen()
const port=server.httpServer.address().port
const chrome=spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${root}/chrome-${Date.now()}`],{stdio:['ignore','ignore','pipe']})
let ws
try{
 const devtools=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',c=>{const m=c.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1])}})})
 const debugBase=devtools.replace(/^ws:/,'http:').replace(/\/devtools\/.*/,'')
 const tab=await(await fetch(`${debugBase}/json/new?about:blank`,{method:'PUT'})).json()
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
 let id=0;const pending=new Map(),errors=[]
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)})
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))})
 const ev=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
 const wait=expr=>ev(`new Promise((r,j)=>{let n=0;const f=()=>{if(${expr})r(true);else if(n++>300)j(Error('UI condition timeout'));else setTimeout(f,50)};f()})`)
 const frames=()=>ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 const click=text=>ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`)
 const change=(selector,value)=>ev(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))}`)
 const shot=async name=>{await frames();const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${root}/${name}.png`,Buffer.from(data,'base64'))}
 await send('Page.enable');await send('Runtime.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:880,height:740,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:`http://127.0.0.1:${port}`});await wait("document.querySelector('.meeting-details')")
 const audioFrames=await ev(`(async()=>{
  const {createAudioFrameSource}=await import('/@fs${project}/src/renderer/audio-frame-source.ts');
  const ctx=new AudioContext({sampleRate:16000}), lengths=[];let source;
  try{await ctx.resume();source=await createAudioFrameSource(ctx,s=>lengths.push(s.length),e=>{throw Error(e)});
   const tone=ctx.createOscillator(),mute=ctx.createGain();mute.gain.value=0;
   tone.connect(source.node);source.node.connect(mute);mute.connect(ctx.destination);tone.start();
   await new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(lengths.length>=5){clearInterval(timer);resolve()}else if(n++>150){clearInterval(timer);reject(Error('Real AudioWorklet emitted no frames'))}},20)});
   await source.flush();tone.stop();return lengths;
  }finally{source?.stop();await ctx.close()}
 })()`)
 assert.ok(audioFrames.length>=5 && audioFrames.every(n=>n>0&&n<=800),'Actual Chrome AudioWorklet, synthetic oscillator only')
 await change('.meeting-details-columns input','Acme');await frames()
 await change('.meeting-details textarea','Backend role, TypeScript and Redis');await frames()
 await shot('01-details')
 await click('Tiếp theo');await wait("document.querySelector('#meeting-model option[value=\"gemini/gemini-3.7-flash\"]')")
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Bắt đầu phiên')).disabled"),true)
 assert.equal(await ev("!!document.querySelector('#meeting-model option[value=\"cx/codex-auto-review\"]')"),true)
 await change('#meeting-model','gemini/gemini-3.7-flash');await frames()
 await change('#meeting-response-format','Trả lời trực tiếp, có ví dụ khi cần.');await frames()
 await shot('02-preferences')
 await click('Kiểm tra kết nối');await frames()
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Bắt đầu phiên')).disabled"),false)
 await send('Page.reload');await wait("document.querySelector('.meeting-details')")
 assert.equal(await ev("document.querySelector('.meeting-details-columns input').value"),'Acme')
 assert.equal(await ev("document.querySelector('.meeting-details textarea').value"),'Backend role, TypeScript and Redis')
 await click('Tiếp theo');await wait("document.querySelector('#meeting-model')?.value==='gemini/gemini-3.7-flash'")
 assert.equal(await ev("document.querySelector('#meeting-response-format').value"),'Trả lời trực tiếp, có ví dụ khi cần.')
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Bắt đầu phiên')).disabled"),true)
 await click('Kiểm tra kết nối');await frames();await click('Bắt đầu phiên');await wait("document.querySelector('.meeting-toolbar')")
 assert.equal(await ev("getComputedStyle(document.querySelector('.meeting-toolbar')).webkitAppRegion"),'drag')
 await change('.meeting-opacity input','0.65');await frames()
 assert.equal(await ev("localStorage.getItem('coding-support.opacity.v1')"),'0.65')
 await send('Emulation.setDeviceMetricsOverride',{width:680,height:580,deviceScaleFactor:1,mobile:false});await frames()
 await shot('03-live')
 await click('Thu gọn');assert.equal(await ev('window.fixture.minimized'),true)
 await click('Tuỳ chọn');await wait("document.querySelector('#meeting-model')")
 await change('#meeting-model','cx/gpt-5.5');await frames()
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Áp dụng model').disabled"),true)
 await click('Kiểm tra kết nối');await frames();await click('Áp dụng model');await frames()
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('cx/gpt-5.5')"))
 assert.ok(await ev("document.querySelector('.meeting-answer-content').textContent.includes('vibe-daily')"))
 await shot('04-live-switch')
 await send('Emulation.setDeviceMetricsOverride',{width:400,height:560,deviceScaleFactor:1,mobile:false});await frames()
 assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false)
 await click('Tuỳ chọn');await shot('05-narrow-live')
 assert.ok(await ev("{const b=document.querySelector('.overlay-quit').getBoundingClientRect();b.right<=innerWidth&&b.bottom<=innerHeight}"))
 await click('Thoát');await frames();assert.equal(await ev('window.fixture.quitRequested'),true)
 assert.equal(await ev("document.querySelector('.overlay-quit').disabled"),true)
 await click('Kết thúc');await frames();await shot('06-narrow-details')
 await click('Tiếp theo');await frames();await shot('07-narrow-preferences')
 assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false)
 assert.ok(await ev("{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Bắt đầu phiên')).getBoundingClientRect();b.bottom<=innerHeight&&b.right<=innerWidth}"))
 await send('Emulation.setDeviceMetricsOverride',{width:880,height:740,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:`http://127.0.0.1:${port}/?provider`});await wait("document.querySelector('#provider-key')")
 await change('#provider-key','local-fixture-only-key');await wait("document.querySelector('#provider-model option[value=\"cx/gpt-5.5\"]')")
 await change('#provider-model','cx/gpt-5.5');await frames();await shot('08-provider')
 await send('Page.reload');await wait("document.querySelector('#provider-model')?.value==='cx/gpt-5.5'")
 assert.equal(await ev("document.querySelector('#provider-key').value"),'local-fixture-only-key')
 assert.equal(await ev("document.querySelector('#provider-model').tagName"),'SELECT')
 await send('Emulation.setDeviceMetricsOverride',{width:380,height:560,deviceScaleFactor:1,mobile:false});await frames()
 assert.ok(await ev("{const b=document.querySelector('.overlay-quit').getBoundingClientRect();b.right<=innerWidth&&b.bottom<=innerHeight}"))
 await click('Thoát');await frames();assert.equal(await ev('window.fixture.quitRequested'),true)
 // Regression: mount the complete production App, not just the workspace fixture.
 await send('Emulation.setDeviceMetricsOverride',{width:880,height:740,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:`http://127.0.0.1:${port}/?app`});await wait("document.querySelector('.meeting-details') && !document.querySelector('.provider-setup')")
 await click('Tiếp theo');await wait("document.querySelector('#meeting-model option[value=\"vibe-daily\"]')")
 await change('#meeting-model','vibe-daily');await frames()
 await click('Kiểm tra kết nối');await frames()
 await click('Thu gọn');await wait("document.querySelector('button[title=\"Expand\"]')")
 await ev("document.querySelector('button[title=\"Expand\"]').click()")
 await wait("!document.querySelector('button[title=\"Expand\"]')")
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Bắt đầu phiên')).disabled"),false)
 await click('Bắt đầu phiên');await wait("document.querySelector('.meeting-toolbar')")
 await ev("window.fixture.draft({speaker:'Me',text:'Mic partial Việt–Anh',ts:1});window.fixture.draft({speaker:'Others',text:'Remote partial Redis',ts:1})")
 await frames()
 assert.ok(await ev("document.querySelector('.meeting-question-strip').textContent.includes('Remote partial Redis')"))
 assert.ok(await ev("document.querySelector('.meeting-draft-preview').textContent.includes('Mic partial Việt–Anh')"))
 await ev("window.fixture.draft({speaker:'Me',text:'',ts:1});window.fixture.draft({speaker:'Others',text:'',ts:1});window.fixture.transcript({speaker:'Others',text:'Persistent interview question',ts:1})")
 await click('Answer');await wait("document.querySelector('.meeting-answer-content')?.textContent.includes('Lifecycle answer')")
 for(let n=0;n<3;n++){
  await click('Thu gọn');await wait("document.querySelector('button[title=\"Expand\"]')")
  assert.equal(await ev('window.fixture.stops'),0)
  assert.equal(await ev('window.fixture.recorderStops'),0)
  // Events continue to reach the live session while its UI is hidden.
  await ev(`window.fixture.transcript({speaker:'Others',text:'Hidden turn ${n}',ts:${n+2}})`)
  await ev("document.querySelector('button[title=\"Expand\"]').click()")
  await wait("!document.querySelector('button[title=\"Expand\"]')")
  assert.equal(await ev("getComputedStyle(document.querySelector('.overlay-meeting')).display"),'flex')
  assert.ok(await ev("document.querySelector('.meeting-answer-content').textContent.includes('Lifecycle answer')"))
 }
 assert.equal(await ev('window.fixture.starts'),1)
 assert.equal(await ev('window.fixture.layouts.at(-1)'),'live')
 await click('Hội thoại');await frames()
 assert.ok(await ev("document.querySelector('.meeting-transcript').textContent.includes('Persistent interview question')"))
 assert.ok(await ev("document.querySelector('.meeting-transcript').textContent.includes('Hidden turn 2')"))
 await click('Lịch sử');await wait("!document.querySelector('.meeting-toolbar')")
 await click('Đóng');await wait("document.querySelector('.meeting-toolbar')")
 assert.equal(await ev('window.fixture.stops'),0)
 await click('Tuỳ chọn');await wait("document.querySelector('#meeting-model')")
 await change('#meeting-model','cx/gpt-5.5');await frames();await click('Kiểm tra kết nối');await frames()
 await ev('window.fixture.failModel=true');await click('Áp dụng model');await frames()
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('vibe-daily')"))
 await ev('window.fixture.failModel=false');await click('Kiểm tra kết nối');await frames();await click('Áp dụng model');await frames()
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('cx/gpt-5.5')"))
 assert.equal(await ev('window.fixture.modelCalls.at(-1).id'),'interview-fixture')
 assert.ok(await ev("document.querySelector('.meeting-answer-content').textContent.includes('vibe-daily')"))
 assert.equal(await ev("!!document.querySelector('select[aria-label=\"Ngôn ngữ input / output\"] option[value=auto]')"),false)
 await ev('window.fixture.delayLanguage=true')
 await change('select[aria-label=\"Ngôn ngữ input / output\"]','en');await frames()
 assert.equal(await ev("document.querySelector('select[aria-label=\"Ngôn ngữ input / output\"]').disabled"),true)
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Answer')).disabled"),true)
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('Đang chuyển ngôn ngữ')"))
 await send('Emulation.setDeviceMetricsOverride',{width:400,height:820,deviceScaleFactor:1,mobile:false});await frames()
 assert.ok(await ev('document.documentElement.scrollWidth<=400'),'Pending language switch fits narrow overlay')
 assert.ok(await ev("{const r=document.querySelector('.meeting-session-status select').getBoundingClientRect();r.left>=0&&r.right<=400}"))
 await shot('pending-language-switch-400px')
 await send('Emulation.setDeviceMetricsOverride',{width:880,height:740,deviceScaleFactor:1,mobile:false})
 await ev('window.fixture.delayLanguage=false;window.fixture.releaseLanguage()');await frames()
 assert.equal(await ev('window.fixture.languageMeetingId'),'interview-fixture')
 assert.equal(await ev('window.fixture.languages.at(-1)'),'en')
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('English')"))
 assert.ok(await ev("document.querySelector('.meeting-answer-content').textContent.includes('Lifecycle answer')"))
 // Clipboard boundary fixture: verify Copy success and a rejected permission request.
 await ev("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.fixture.copiedText=text}}})")
 await click('Copy');await frames();assert.equal(await ev('window.fixture.copiedText'),'Lifecycle answer')
 await ev("navigator.clipboard.writeText=async()=>{throw Error('Fixture permission denied')}")
 await click('copy');await frames()
 assert.ok(await ev("document.querySelector('[role=alert]').textContent.includes('Không copy được')"))
 await ev('window.fixture.failLanguage=true');await change('select[aria-label=\"Ngôn ngữ input / output\"]','vi');await frames()
 assert.ok(await ev("document.querySelector('.meeting-session-status').textContent.includes('English')"))
 assert.equal(await ev('window.fixture.stops'),0)
 await click('Tuỳ chọn');await click('Answer');await frames();await click('Clear');await frames()
 assert.equal(await ev("!!document.querySelector('.meeting-answer-content')"),false)
 await ev("for(let i=0;i<2000;i++)window.fixture.transcript({speaker:i%2?'Me':'Others',text:'Soak UI turn '+i,ts:10000+i})");await frames()
 if(await ev("!document.querySelector('.meeting-transcript')")){await click('Hội thoại');await frames()}
 assert.equal(await ev("document.querySelectorAll('.meeting-transcript > p').length"),300)
 await ev("window.fixture.status('suggesting');window.fixture.reply({reply:'Streaming preview',model:'cx/gpt-5.5',partial:true})");await frames()
 assert.ok(await ev("document.querySelector('.meeting-answer-content').textContent.includes('Streaming preview')"))
 assert.equal(await ev("document.querySelector('.meeting-toolbar .meeting-primary').disabled"),true)
 await ev("window.fixture.reply({reply:'Streaming complete',model:'cx/gpt-5.5'})");await frames()
 assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Answer')).disabled"),false)
 await checkMeetingComposer({ ev, click, change, frames, wait, send, shot })
 await checkMeetingAnswerPages({ ev, click, change, frames, wait, send, shot })
 await click('Kết thúc');await wait("document.querySelector('.meeting-details')")
 assert.equal(await ev('window.fixture.stops'),1)
 assert.equal(await ev('window.fixture.stoppedId'),'interview-fixture')
 assert.equal(await ev('window.fixture.recorderStops'),1)
 assert.equal(await ev('window.fixture.starts'),1)
 // A native stop while collapsed may change session state but must not enlarge the bar.
 await click('Tiếp theo');await wait("document.querySelector('#meeting-model option')")
 await click('Kiểm tra kết nối');await frames();await click('Bắt đầu phiên');await wait("document.querySelector('.meeting-toolbar')")
 assert.equal(await ev("document.querySelector('.meeting-mic-toggle').getAttribute('aria-pressed')"),'false','New Meeting starts with mic enabled')
 assert.equal(await ev("document.querySelector('.meeting-answer-pages span').textContent"),'0 / 0','New Meeting resets answer pages')
 await click('Thu gọn');await wait("document.querySelector('button[title=\"Expand\"]')")
 const layoutsBeforeStop=await ev('window.fixture.layouts.length')
 await ev("window.fixture.status('stopped')");await frames()
 assert.equal(await ev('window.fixture.layouts.length'),layoutsBeforeStop)
 await ev("document.querySelector('button[title=\"Expand\"]').click()")
 await wait("!document.querySelector('button[title=\"Expand\"]')")
 assert.equal(await ev('window.fixture.layouts.at(-1)'),'setup')
 assert.equal(await ev('window.fixture.stops'),1)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,scope:'Production React components with local fixture API; actual AudioWorklet with generated oscillator. No private capture/provider/native-hide simulation claimed as live.',checks:['Details, format and model survive reload','Reload does not restore verification','Gemini 3.7 and GPT/Codex option groups','Start and live Apply require testing','Switch retains old answer attribution','Opacity persisted','Hide dispatch','Quit dispatch, disabled state and narrow-screen access','Drag CSS','400px no overflow; primary action reachable','Provider dropdown and saved input','Production App: prepared setup survives collapse','Production App: 3 collapse/expand cycles retain interview, recorder, transcript and answer','Production App: history return preserves session','Live model and language changes, rejected changes preserve active settings','Language switch retains completed answer','Copy success and permission failure; Clear only clears answer','Explicit stop called once with correct meeting ID','Backend stop while collapsed does not enlarge window','Speechmatics partial previews for both speakers replace and clear independently','Actual Chrome AudioWorklet: generated oscillator, 50ms frames and flush','Language-switch pending status and session ID binding','2000 UI events retain only 300 rendered turns','Streaming LLM preview keeps Answer disabled until final','Meeting Chat: multiline code, failure retains draft, streaming busy guard, session ID, explicit image preview/remove/send and Ctrl+Enter follow-up without resending image; 400px fits','Mic toggle: independent from Others/AI, survives collapse, suppresses muted draft, resets on next Meeting','300px answer / 220px content remain visible with 400px image composer; controls scroll separately','Answer pages: back/next, model attribution, Copy selected, Clear without deletion, collapse/History retention, pending preview does not steal browsing, 400px fit and next Meeting reset','Screenshot/typed follow-up Send bypass failed mic flush; regular Answer still flushes and reports failure','No uncaught browser errors'],screenshots:root},null,2))
}finally{ws?.close();chrome.kill('SIGTERM');await server.close()}
