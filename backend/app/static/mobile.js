const $ = id => document.getElementById(id);
const ringtone = $('ringtone');
const voice = $('voiceMessage');
const apiBase = (window.WINGMAN_API_BASE || '').replace(/\/$/, '');
let polling;
let lastStatus = 'idle';
let audioArmed = false;
let dragStart = null;

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || '请求失败');
  return body;
}

function setText(status, caption) { $('status').textContent = status; $('caption').textContent = caption; }
async function enterFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {}
  window.scrollTo(0, 1);
}
async function unlockAudio() {
  await enterFullscreen();
  ringtone.volume = 0.01;
  ringtone.currentTime = 0;
  try {
    await ringtone.play();
    ringtone.pause();
    ringtone.currentTime = 0;
    ringtone.volume = 1;
    audioArmed = true;
    $('audioArm').classList.add('hidden');
    $('audioHint').textContent = '';
  } catch {
    ringtone.volume = 1;
    $('audioHint').textContent = '请再点一次进入以启用铃声。';
  }
}
async function playRingtone() {
  ringtone.currentTime = 0;
  try { await ringtone.play(); $('audioHint').textContent = ''; }
  catch { $('audioArm').classList.remove('hidden'); $('audioHint').textContent = audioArmed ? '请再次点击进入。' : '点击进入后可自动响铃。'; }
}
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }
function resetSlider() { $('answerKnob').style.transform = ''; $('answerSlider').classList.remove('is-dragging'); }
function showStandby() {
  $('standbyScreen').classList.remove('hidden');
  $('callScreen').classList.add('hidden');
  $('incomingActions').classList.add('hidden');
}
function showCall() {
  $('standbyScreen').classList.add('hidden');
  $('callScreen').classList.remove('hidden');
  $('incomingActions').classList.remove('hidden');
}
function applyState(call) {
  if (call.status === lastStatus) return;
  lastStatus = call.status;
  const isRinging = call.status === 'ringing';
  const isCallActive = ['scheduled', 'ringing', 'accepted'].includes(call.status);
  if (isCallActive) showCall(); else showStandby();
  $('answerSlider').classList.toggle('hidden', !isRinging);
  $('decline').classList.toggle('hidden', !['scheduled', 'ringing', 'accepted'].includes(call.status));
  if (call.status === 'scheduled') setText('Wingman 即将呼叫', '戒指信号已收到。');
  if (isRinging) { setText('Wingman 正在呼叫你', '向右滑动来接听。'); playRingtone(); }
  if (call.status === 'accepted') { stopRingtone(); resetSlider(); setText('已接听', '正在播放私人提醒语音…'); voice.play().catch(() => $('audioHint').textContent = '轻触屏幕后播放语音。'); }
  if (call.status === 'declined' || call.status === 'ended' || call.status === 'idle') { stopRingtone(); resetSlider(); }
}
async function answerCall() { try { applyState(await api('/api/v1/demo/call/accept', {method: 'POST'})); } catch (error) { $('audioHint').textContent = error.message; } }
async function poll() { try { applyState(await api('/api/v1/demo/call')); } catch (error) { $('audioHint').textContent = error.message; } }

$('armAudio').addEventListener('click', unlockAudio);
$('more').addEventListener('click', () => $('moreSheet').classList.toggle('hidden'));
$('subtitle').addEventListener('click', () => { $('caption').classList.toggle('subtitle-off'); $('subtitle').textContent = $('caption').classList.contains('subtitle-off') ? '显示字幕' : '隐藏字幕'; });
$('decline').addEventListener('click', async () => { try { applyState(await api('/api/v1/demo/call/decline', {method: 'POST'})); } catch (error) { $('audioHint').textContent = error.message; } });
$('answerSlider').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); answerCall(); } });
$('answerSlider').addEventListener('pointerdown', event => { dragStart = event.clientX; $('answerSlider').setPointerCapture(event.pointerId); $('answerSlider').classList.add('is-dragging'); });
$('answerSlider').addEventListener('pointermove', event => { if (dragStart !== null) { const travel = Math.max(0, Math.min(event.clientX - dragStart, $('answerSlider').clientWidth - 60)); $('answerKnob').style.transform = `translateX(${travel}px)`; } });
$('answerSlider').addEventListener('pointerup', event => { if (dragStart === null) return; const completed = event.clientX - dragStart > $('answerSlider').clientWidth * 0.52; dragStart = null; completed ? answerCall() : resetSlider(); });
voice.addEventListener('ended', async () => { try { applyState(await api('/api/v1/demo/call/end', {method: 'POST'})); } catch {} });
poll(); polling = setInterval(poll, 1000);
window.addEventListener('pagehide', () => clearInterval(polling));
