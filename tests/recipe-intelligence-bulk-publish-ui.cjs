const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { JSDOM } = require('jsdom');
const load = require('./helpers/load-component.cjs');

async function setup(t, request, extra = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1:55543/' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const originals = Object.fromEntries(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); for (const k of Object.keys(globals)) if (originals[k]) Object.defineProperty(globalThis, k, originals[k]); else delete globalThis[k]; });
  await React.act(async () => root.render(React.createElement(load('WordPressPublishDialog').WordPressPublishDialog, { items: [{ id: 'a', title: 'Soup' }, { id: 'b', title: 'Lasagna' }], connections: [{ id: 'site', siteUrl: 'https://kitchen.example/' }], timezone: 'Africa/Casablanca', request, refresh: async () => {}, close: () => {}, ...extra })));
  const button = text => [...document.querySelectorAll('button')].find(e => e.textContent === text);
  const click = async text => { assert.ok(button(text), text); await React.act(async () => button(text).click()); };
  const change = async (label, value) => {
    const el = document.querySelector(`[aria-label="${label}"]`); assert.ok(el, label);
    await React.act(async () => { Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); });
  };
  const confirm = async () => React.act(async () => document.querySelector('input[type=checkbox]').click());
  return { click, change, confirm, button };
}
const plan = { title: 'Saved recipe', siteUrl: 'https://kitchen.example/', documentHash: 'doc', reviewHash: 'review', ready: true, images: [], profile: { ready: true, canPublish: true, scheduling: true, recipeCardLabel: 'WP Recipe Maker' } };

test('bulk schedules carry individual timezone-converted times, wait for confirmation and retain partial success', async t => {
  const calls = []; const year = new Date().getUTCFullYear() + 1;
  const request = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (method === 'GET') return plan;
    if (route.includes('/b/')) throw new Error('Site connection interrupted');
    return { postId: 10, status: 'future', scheduledAt: body.scheduledAt, editUrl: 'https://kitchen.example/wp-admin/post.php?post=10' };
  };
  const ui = await setup(t, request, { initialStatus: 'future' }); assert.equal(calls.length, 0);
  await ui.change('Publication time for Soup', `${year}-11-20T09:30`);
  await ui.change('Publication time for Lasagna', `${year}-11-20T11:00`);
  await ui.click('Prepare articles and upload images'); assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.ok(ui.button('Send 2 ready articles').disabled); await ui.confirm();
  await ui.change('Publication time for Soup', `${year}-11-20T10:00`); assert.ok(ui.button('Send 2 ready articles').disabled);
  await ui.confirm(); await ui.click('Send 2 ready articles');
  const posts = calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 2);
  const wall = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  assert.equal(wall(posts[0].body.scheduledAt), '10:00'); assert.equal(wall(posts[1].body.scheduledAt), '11:00');
  assert.ok(posts.every(p => p.body.confirmSchedule === true && p.body.confirmPublish === false && p.body.reviewHash === 'review'));
  assert.match(document.body.textContent, /Scheduled · Post 10/); assert.match(document.querySelector('[role=alert]').textContent, /connection interrupted/);
  assert.ok(ui.button('Send 1 ready article').disabled); await ui.confirm(); await ui.click('Send 1 ready article');
  assert.equal(calls.filter(c => c.method === 'POST' && c.route.includes('/a/')).length, 1);
});

test('single draft defaults to private and supports mixed bulk actions without a schedule requirement for drafts', async t => {
  const calls = [];
  const ui = await setup(t, async (route, method = 'GET', body) => { calls.push({ route, method, body }); return method === 'GET' ? plan : { postId: 8, status: body.status, editUrl: 'https://kitchen.example/edit' }; });
  assert.deepEqual([...document.querySelectorAll('select[aria-label]')].map(s => s.value), ['draft', 'draft']);
  await ui.change('Publication action for Lasagna', 'publish'); await ui.click('Prepare articles and upload images'); await ui.confirm(); await ui.click('Send 2 ready articles');
  const posts = calls.filter(c => c.method === 'POST'); assert.deepEqual(posts.map(c => c.body.status), ['draft', 'publish']);
  assert.equal(posts[0].body.confirmPublish, false); assert.equal(posts[1].body.confirmPublish, true); assert.ok(posts.every(c => !c.body.scheduledAt));
});

test('old bridge cannot schedule and selecting a destination never sends a post', async t => {
  let posts = 0;
  const ui = await setup(t, async (_route, method = 'GET') => { if (method === 'POST') posts++; return { ...plan, profile: { ...plan.profile, scheduling: false } }; }, { items: [{ id: 'a', title: 'Soup' }], initialStatus: 'future' });
  await ui.change('Publication time for Soup', `${new Date().getUTCFullYear() + 1}-11-20T09:30`); await ui.click('Prepare articles and upload images');
  assert.match(document.body.textContent, /Update Recipe Intelligence Bridge/); await ui.confirm(); assert.ok(ui.button('Send 1 ready article').disabled); assert.equal(posts, 0);
});
