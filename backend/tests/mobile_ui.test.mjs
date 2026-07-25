import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const staticRoot = new URL('../app/static/', import.meta.url);

test('mobile call page exposes a user-gesture audio arm before a ring event', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('mobile.html', staticRoot), 'utf8'),
    readFile(new URL('mobile.js', staticRoot), 'utf8'),
  ]);

  assert.match(html, /id="audioArm"/);
  assert.match(html, /id="armAudio"/);
  assert.match(script, /audioArmed/);
  assert.match(script, /unlockAudio/);
});

test('idle and completed calls return to a distinct standby screen', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('mobile.html', staticRoot), 'utf8'),
    readFile(new URL('mobile.js', staticRoot), 'utf8'),
  ]);

  assert.match(html, /id="standbyScreen"/);
  assert.match(html, /id="callScreen"/);
  assert.doesNotMatch(html, /class="calling-label"/);
  assert.match(script, /function showStandby/);
  assert.match(script, /call\.status === 'ended'/);
});

test('standby is a minimal fullscreen entry without demo controls or fake status chrome', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('mobile.html', staticRoot), 'utf8'),
    readFile(new URL('mobile.js', staticRoot), 'utf8'),
  ]);

  assert.doesNotMatch(html, /id="recording"/);
  assert.doesNotMatch(html, /id="trigger"/);
  assert.doesNotMatch(html, /class="status-bar"/);
  assert.match(html, /点击进入/);
  assert.match(script, /requestFullscreen/);
});

test('armed standby is visually blank so only an incoming call appears', async () => {
  const [html, stylesheet, script] = await Promise.all([
    readFile(new URL('mobile.html', staticRoot), 'utf8'),
    readFile(new URL('mobile.css', staticRoot), 'utf8'),
    readFile(new URL('mobile.js', staticRoot), 'utf8'),
  ]);

  const standby = html.match(/<section class="standby-screen" id="standbyScreen">([\s\S]*?)<\/section>/);
  assert.ok(standby);
  assert.doesNotMatch(standby[1], /\S/);
  assert.match(stylesheet, /\.standby-screen\{flex:1;background:#000\}/);
  assert.doesNotMatch(script, /已就绪/);
});
