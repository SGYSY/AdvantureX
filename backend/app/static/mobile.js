const $ = id => document.getElementById(id);
const ringtone = $('ringtone');
const voice = $('voiceMessage');
const apiBase = (window.WINGMAN_API_BASE || '').replace(/\/$/, '');
let polling;
let lastStatus = 'idle';
let audioArmed = false;

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || '请求失败');
  return body;
}
function setText(status, caption) { $('status').textContent = status; $('caption').textContent = caption; }
async function playRingtone() {
  ringtone.currentTime = 0;
  try { await ringtone.play(); $('audioHint').textContent = ''; }
  catch { $('sound').classList.remove('hidden'); $('audioHint').textContent = '手机浏览器阻止自动响铃，请点“开启铃声”。'; }
}
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }
async function armAudio() {
  try {
    ringtone.currentTime = 0;
    await ringtone.play();
    ringtone.pause();
    ringtone.currentTime = 0;
    audioArmed = true;
    $('arm').classList.add('ready');
    $('arm').style.background = '#29956f';
    $('arm').textContent = '已预备：等待戒指双击';
    $('audioHint').textContent = '已允许铃声。请保持此页面在前台，收到 iMessage 后返回这里。';
  } catch {
    $('audioHint').textContent = '浏览器未允许播放铃声，请再点一次“预备戒指来电”。';
  }
}
function applyState(call) {
  if (call.status === lastStatus) return;
  lastStatus = call.status;
  const isRinging = call.status === 'ringing';
  $('answer').classList.toggle('hidden', !isRinging);
  $('decline').classList.toggle('hidden', !['scheduled', 'ringing', 'accepted'].includes(call.status));
  if (call.status === 'scheduled') setText('iMessage 已安排', 'Wingman 会在几秒后向你发起网页来电。');
  if (isRinging) {
    setText('Wingman 正在呼叫你', '点击接听后播放你的录音。');
    playRingtone();
    if (!audioArmed) $('audioHint').textContent = '页面已切换为来电；如未响铃，请点“开启铃声”。';
  }
  if (call.status === 'accepted') { stopRingtone(); $('sound').classList.add('hidden'); setText('已接听', '正在播放私人提醒语音…'); voice.play().catch(() => $('audioHint').textContent = '请再点一次接听以播放语音。'); }
  if (call.status === 'declined') { stopRingtone(); setText('来电已挂断', '你可以随时再模拟一次双击。'); }
  if (call.status === 'ended') { stopRingtone(); voice.pause(); setText('通话结束', '私人提醒流程已完成。'); }
}
async function poll() {
  try { applyState(await api('/api/v1/demo/call')); }
  catch (error) { $('audioHint').textContent = `无法连接 Wingman 服务：${error.message}`; }
}
$('recording').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  if (voice.dataset.objectUrl) URL.revokeObjectURL(voice.dataset.objectUrl);
  const url = URL.createObjectURL(file); voice.src = url; voice.dataset.objectUrl = url;
  $('audioHint').textContent = `已选中录音：${file.name}`;
});
$('arm').addEventListener('click', armAudio);
$('trigger').addEventListener('click', async () => {
  if (!audioArmed) await armAudio();
  $('trigger').disabled = true;
  try {
    const call = await api('/api/v1/demo/fixed', {method: 'POST'});
    $('setup').classList.add('hidden'); applyState(call);
    $('audioHint').textContent = '已发起。请留意你的 iMessage，然后等待网页来电。';
  } catch (error) { $('audioHint').textContent = error.message; $('trigger').disabled = false; }
});
$('sound').addEventListener('click', playRingtone);
$('answer').addEventListener('click', async () => { try { applyState(await api('/api/v1/demo/call/accept', {method: 'POST'})); } catch (e) { $('audioHint').textContent = e.message; } });
$('decline').addEventListener('click', async () => { try { applyState(await api('/api/v1/demo/call/decline', {method: 'POST'})); } catch (e) { $('audioHint').textContent = e.message; } });
voice.addEventListener('ended', async () => { try { applyState(await api('/api/v1/demo/call/end', {method: 'POST'})); } catch {} });
poll(); polling = setInterval(poll, 1000);
window.addEventListener('pagehide', () => clearInterval(polling));
