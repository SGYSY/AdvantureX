const $ = id => document.getElementById(id);
const base = (window.WINGMAN_API_BASE || '').replace(/\/$/, '');
const ring = $('ringtone'), voice = $('voice');
let current = 'idle', timer;
let audioArmed = false;
const set = (a, b) => { $('status').textContent = a; $('caption').textContent = b; };
const api = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {headers:{'Content-Type':'application/json'}, ...options});
  const body = await response.json(); if (!response.ok) throw Error(body.detail || '请求失败'); return body;
};
async function ringNow() { try { ring.currentTime=0; await ring.play(); } catch { $('sound').classList.remove('hidden'); $('hint').textContent='请点击“开启铃声”。'; } }
async function armAudio(){
  try{
    ring.currentTime=0;await ring.play();ring.pause();ring.currentTime=0;
    audioArmed=true;$('arm').classList.add('ready');$('arm').style.background='#29956f';$('arm').textContent='已预备：等待戒指双击';
    $('hint').textContent='已允许铃声。请保持此页面在前台，收到 iMessage 后返回这里。';
  }catch{$('hint').textContent='浏览器未允许播放铃声，请再点一次“预备戒指来电”。';}
}
function render(status) {
  if (status === current) return; current=status;
  const ringing=status==='ringing'; $('answer').classList.toggle('hidden',!ringing); $('decline').classList.toggle('hidden',!['scheduled','ringing','accepted'].includes(status));
  if(status==='scheduled') set('iMessage 已安排','Wingman 会在几秒后向你发起网页来电。');
  if(ringing){set('Wingman 正在呼叫你','点击接听后播放你的录音。');ringNow();if(!audioArmed)$('hint').textContent='页面已切换为来电；如未响铃，请点“开启铃声”。';}
  if(status==='accepted'){ring.pause();set('已接听','正在播放私人提醒语音…');voice.play().catch(()=>{$('hint').textContent='请再点一次接听播放语音。';});}
  if(status==='declined'){ring.pause();set('来电已挂断','你可以随时再模拟一次双击。');}
  if(status==='ended'){ring.pause();voice.pause();set('通话结束','私人提醒流程已完成。');}
}
async function poll(){if(!base)return;try{render((await api('/api/v1/demo/call')).status)}catch(e){$('hint').textContent=`无法连接 Wingman 服务：${e.message}`}}
$('recording').onchange=e=>{const f=e.target.files[0];if(!f)return;voice.src=URL.createObjectURL(f);$('hint').textContent=`已选中录音：${f.name}`;};
$('arm').onclick=armAudio;
$('trigger').onclick=async()=>{if(!audioArmed)await armAudio();$('trigger').disabled=true;$('setup').style.opacity='.6';
  if(!base){$('modeNote').textContent='静态预览正在模拟；不会发送 iMessage。';render('scheduled');timer=setTimeout(()=>render('ringing'),5000);return;}
  try{render((await api('/api/v1/demo/fixed',{method:'POST'})).status);$('modeNote').textContent='已请求私密服务发送 iMessage。';}catch(e){$('hint').textContent=e.message;$('trigger').disabled=false;}
};
$('sound').onclick=ringNow;
$('answer').onclick=async()=>{if(!base){render('accepted');return}try{render((await api('/api/v1/demo/call/accept',{method:'POST'})).status)}catch(e){$('hint').textContent=e.message}};
$('decline').onclick=async()=>{if(!base){clearTimeout(timer);render('declined');return}try{render((await api('/api/v1/demo/call/decline',{method:'POST'})).status)}catch(e){$('hint').textContent=e.message}};
voice.onended=async()=>{if(!base){render('ended');return}try{render((await api('/api/v1/demo/call/end',{method:'POST'})).status)}catch{}};
poll();setInterval(poll,1000);
