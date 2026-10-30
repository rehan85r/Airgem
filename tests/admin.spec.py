#!/usr/bin/env python3
"""Admin UI regression checks against an isolated in-memory Supabase fixture.

Run: python3 tests/admin.spec.py
Requires Python Playwright and Chromium. No production credentials or writes are used.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import threading
import unittest

from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=5000)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = (ROOT / 'tests/admin-fixture.js').read_text()
TURNSTILE = """window.turnstile={render:(selector,options)=>{options.callback('test-only-captcha-token');return 1;},reset:()=>{}};"""
LUCIDE = """window.lucide={createIcons:()=>{document.querySelectorAll('[data-lucide]').forEach(i=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','lucide');svg.innerHTML='<path d="M5 12h14M12 5v14" fill="none" stroke="currentColor" stroke-width="1.8"/>';i.replaceWith(svg);});}};"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class AdminBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def open(self, config=None, width=1536, height=1024):
        self.context = self.browser.new_context(viewport={'width':width,'height':height})
        self.addCleanup(self.context.close)
        self.context.set_default_timeout(7000)
        self.context.add_init_script('window.__testConfig='+json.dumps(config or {})+';')
        self.remote_requests = []
        def route(request_route):
            url = request_route.request.url
            if url.startswith(self.base):
                request_route.continue_()
            elif 'supabase-js' in url:
                request_route.fulfill(status=200, content_type='application/javascript', body=FIXTURE)
            elif '/turnstile/' in url:
                request_route.fulfill(status=200, content_type='application/javascript', body=TURNSTILE)
            elif 'lucide' in url:
                request_route.fulfill(status=200, content_type='application/javascript', body=LUCIDE)
            else:
                self.remote_requests.append(url)
                request_route.abort()
        self.context.route('**/*', route)
        self.page = self.context.new_page()
        self.js_errors = []
        self.page.on('pageerror', lambda error:self.js_errors.append(str(error)))
        self.page.goto(self.base+'/admin-panel.html', wait_until='networkidle')
        self.dialog_handler = lambda dialog:dialog.accept()
        self.page.on('dialog', self.dialog_handler)
        return self.page

    def ready(self, **kwargs):
        page = self.open(**kwargs)
        expect(page.locator('#dashboard')).to_be_visible()
        expect(page.locator('#agStatProjects')).to_have_text('6')
        return page

    def nav(self, name):
        self.page.locator(f'[data-nav="{name}"]').first.click()

    def editor(self, name='Axis Robotics'):
        self.page.locator('#search').fill(name)
        self.page.get_by_role('button', name='Edit '+name, exact=True).click()
        expect(self.page.locator('#editorView')).to_be_visible()

    def tab(self, name):
        self.page.locator(f'[data-editor-tab="{name}"]').click()

    def publish(self):
        self.page.locator('#publish').click()

    def assert_no_js_errors(self):
        self.assertEqual(self.js_errors, [])

    def test_dashboard_filters_and_pagination(self):
        page = self.ready()
        expect(page.locator('#agStatTop')).to_contain_text('2')
        page.locator('#search').fill('Axis')
        expect(page.locator('#list')).to_contain_text('Axis Robotics')
        expect(page.locator('#list')).not_to_contain_text('Arcus')
        page.locator('#search').fill('')
        page.locator('#categoryFilter').select_option('Mainnet')
        expect(page.locator('#list')).to_contain_text('Axis Robotics')
        expect(page.locator('#list')).not_to_contain_text('Arcus')
        page.locator('#categoryFilter').select_option('')
        page.locator('#statusFilter').select_option('Ended')
        expect(page.locator('#list')).to_contain_text('Relay')
        expect(page.locator('#list')).not_to_contain_text('Axis Robotics')
        page.locator('#statusFilter').select_option('')
        page.locator('#pagination').get_by_role('button',name='Next page',exact=True).click()
        expect(page.locator('#list')).to_contain_text('Nova')
        expect(page.locator('#list')).not_to_contain_text('Axis Robotics')
        page.locator('#sortBy').select_option('oldest')
        expect(page.locator('#list tbody tr').first).to_contain_text('Nova')
        page.locator('#sortBy').select_option('name')
        expect(page.locator('#list tbody tr').first).to_contain_text('Arcus')
        self.assert_no_js_errors()

    def test_login_and_mfa_enforced(self):
        page = self.open(config={'signedIn':False,'level':'aal1'})
        expect(page.locator('#loginBox')).to_be_visible()
        expect(page.locator('#dashboard')).to_be_hidden()
        page.locator('#email').fill('admin@example.test')
        page.locator('#password').fill('test-password')
        page.locator('#loginForm button[type=submit]').click()
        expect(page.locator('#mfaBox')).to_be_visible()
        expect(page.locator('#dashboard')).to_be_hidden()
        page.locator('#mfaCode').fill('000000')
        page.locator('#mfaForm button[type=submit]').click()
        expect(page.locator('#mfaError')).to_contain_text('Invalid')
        page.locator('#mfaCode').fill('123456')
        page.locator('#mfaForm button[type=submit]').click()
        expect(page.locator('#dashboard')).to_be_visible()
        self.assert_no_js_errors()

    def test_unauthorized_user_never_gets_dashboard(self):
        page = self.open(config={'authorized':False})
        expect(page.locator('#dashboard')).to_be_hidden()
        expect(page.locator('#loginError')).to_contain_text('authorized')
        calls = page.evaluate('window.__mock.calls')
        self.assertFalse(any(c.get('table')=='projects' for c in calls))
        self.assert_no_js_errors()

    def test_add_project_is_local_until_publish(self):
        page = self.ready()
        page.locator('[data-action=add]').click()
        expect(page.locator('#editorView')).to_be_visible()
        self.assertEqual(page.evaluate('window.__mock.projects.length'),6)
        page.locator('#name').fill('New browser test project')
        page.locator('#category').fill('Testnet')
        page.locator('#task').fill('Testnet')
        page.locator('#status').fill('Potential')
        self.publish()
        expect(page.locator('#message')).to_contain_text('publish', ignore_case=True)
        self.assertEqual(page.evaluate('window.__mock.projects.length'),7)
        self.assertEqual(page.evaluate('window.__mock.projects.at(-1).name'),'New browser test project')
        self.assertEqual(page.evaluate('window.__mock.projects.at(-1).guide'),[])
        self.assert_no_js_errors()

    def test_edit_preserves_unedited_data_and_writes_correct_columns(self):
        page = self.ready()
        self.editor()
        page.locator('#name').fill('Axis Robotics Edited')
        self.tab('details')
        page.locator('#timeEstimate').fill('45 min')
        page.locator('#started').fill('2026-10-02')
        self.publish()
        expect(page.locator('#message')).to_contain_text('publish', ignore_case=True)
        record = page.evaluate('window.__mock.projects.find(p=>p.id===1)')
        self.assertEqual(record['name'],'Axis Robotics Edited')
        self.assertEqual(record['time'],'45 min')
        self.assertEqual(record['launch_date'],'2026-10-02')
        self.assertTrue(any(link['label']=='Docs' for link in record['links']))
        self.assertEqual(record['guide'][0]['tag'],'Daily')
        self.assert_no_js_errors()

    def test_failed_publish_keeps_draft(self):
        page = self.ready()
        self.editor()
        page.locator('#name').fill('Unsaved after failure')
        page.evaluate("window.__mock.failNext={table:'projects',op:'update',message:'Permission denied by test policy'}")
        self.publish()
        expect(page.locator('#message')).to_contain_text('Permission denied')
        expect(page.locator('#name')).to_have_value('Unsaved after failure')
        self.assertEqual(page.evaluate('window.__mock.projects.find(p=>p.id===1).name'),'Axis Robotics')
        self.assert_no_js_errors()

    def test_investors_na_and_guide_task_roundtrip(self):
        page = self.ready()
        self.editor()
        self.tab('investors')
        page.locator('#agSetInvestorsNA').click()
        expect(page.locator('#agSetInvestorsNA')).to_have_attribute('aria-pressed','true')
        self.publish()
        expect(page.locator('#message')).to_contain_text('publish', ignore_case=True)
        self.assertEqual(page.evaluate('window.__mock.projects.find(p=>p.id===1).investors'),'N/A')
        self.tab('investors')
        page.locator('#agAddInvestor').click()
        expect(page.locator('#agSetInvestorsNA')).to_have_attribute('aria-pressed','false')
        entries = page.locator('#agInvestorList input[type=text]')
        entries.last.fill('Tier 2')
        entries.nth(entries.count()-2).fill('Browser Test Capital')
        self.tab('guide')
        page.locator('#agTaskAdd').click()
        page.locator('#agTaskTitle').fill('Browser task')
        page.locator('#guideEditor').fill('Browser guide instructions')
        page.evaluate('''() => { const editor=document.getElementById('guideEditor'); const range=document.createRange(); range.selectNodeContents(editor); const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); editor.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); }''')
        page.locator('#guideToolbar [data-cmd=bold]').click()
        self.publish()
        expect(page.locator('#message')).to_contain_text('publish', ignore_case=True)
        record=page.evaluate('window.__mock.projects.find(p=>p.id===1)')
        self.assertIn('Browser Test Capital',record['investors'])
        self.assertEqual(len(record['guide']),2)
        self.assertEqual(record['guide'][-1]['title'],'Browser task')
        self.assertIn('Browser guide instructions',record['guide'][-1]['html'])
        self.assertRegex(record['guide'][-1]['html'],r'<(?:b|strong)>')
        self.assert_no_js_errors()

    def test_guide_sanitization_preserves_formatting_and_rejects_active_content(self):
        page = self.ready()
        html = page.evaluate("""() => window.AirgemEditor.cleanHTML('<h2>Guide</h2><script>alert(1)</script><img src=javascript:alert(1) onerror=alert(1)><a href=javascript:alert(1)>bad link</a><p onclick=alert(1)><strong>Safe</strong></p><div class="guide-step-box selected-step-box"><a href="https://example.org">Go</a></div>')""")
        self.assertIn('<h2>Guide</h2>',html)
        self.assertIn('<strong>Safe</strong>',html)
        self.assertIn('class="guide-step-box"',html)
        self.assertNotIn('<script',html)
        self.assertNotIn('javascript:',html)
        self.assertNotIn('onerror',html)
        self.assertNotIn('onclick',html)
        self.assertNotIn('selected-step-box',html)
        self.assert_no_js_errors()

    def test_logo_investor_and_guide_uploads_use_existing_bucket(self):
        page = self.ready()
        self.editor()
        page.locator('#logoFile').set_input_files(str(ROOT / 'airgem-logo.png'))
        page.wait_for_function('window.__mock.uploads.length === 1')
        expect(page.locator('#logoUrl')).to_have_value(re.compile(r'https://example.test/storage/'))
        self.tab('investors')
        page.locator('#agInvestorList input[type=file]').first.set_input_files(str(ROOT / 'airgem-logo.png'))
        page.wait_for_function('window.__mock.uploads.length === 2')
        self.tab('guide')
        page.locator('#guideImageFile').set_input_files(str(ROOT / 'airgem-logo.png'))
        page.wait_for_function('window.__mock.uploads.length === 3')
        expect(page.locator('#guideEditor img')).to_have_count(1)
        page.locator('#guidePreview').click()
        expect(page.locator('#guidePreviewOverlay')).to_be_visible()
        expect(page.locator('#guidePreviewContent img')).to_have_count(1)
        page.locator('#guidePreviewClose').click()
        self.publish()
        expect(page.locator('#message')).to_contain_text('publish', ignore_case=True)
        uploads = page.evaluate('window.__mock.uploads')
        self.assertTrue(all(upload['bucket']=='project-logos' for upload in uploads))
        self.assertEqual(uploads[0]['type'],'image/webp')
        self.assertEqual(uploads[1]['type'],'image/webp')
        self.assertTrue(uploads[2]['path'].startswith('guide/'))
        self.assert_no_js_errors()

    def test_delete_project_confirmation_and_refresh(self):
        page = self.ready()
        page.locator('#search').fill('Axis Robotics')
        page.get_by_role('button',name='Delete Axis Robotics',exact=True).click()
        expect(page.locator('#agStatProjects')).to_have_text('5')
        self.assertFalse(page.evaluate('window.__mock.projects.some(p=>p.id===1)'))
        self.assert_no_js_errors()

    def test_top_airdrops_selection_save_and_clear(self):
        page = self.ready()
        self.nav('top')
        page.locator('#trendingSelect').fill('Relay')
        page.locator('#trendingSearchResults').get_by_role('button',name='Relay',exact=True).click()
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('saved', ignore_case=True)
        self.assertEqual(len(page.evaluate('window.__mock.top')),3)
        page.locator('#clearTrending').click()
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('saved', ignore_case=True)
        self.assertEqual(page.evaluate('window.__mock.top'),[])
        self.assert_no_js_errors()

    def test_failed_top_save_restores_previous_records_and_retry_succeeds(self):
        page = self.ready()
        self.nav('top')
        original = page.evaluate('structuredClone(window.__mock.top)')
        page.locator('#trendingSelect').fill('Relay')
        page.locator('#trendingSearchResults').get_by_role('button',name='Relay',exact=True).click()
        page.evaluate("window.__mock.failNext={table:'site_trending_items',op:'insert',message:'Temporary Top save failure'}")
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('Previous selection was restored')
        self.assertEqual(page.evaluate('window.__mock.top'),original)
        expect(page.locator('#trendingCurrent')).to_contain_text('Relay')
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('saved', ignore_case=True)
        self.assertEqual(len(page.evaluate('window.__mock.top')),3)
        self.assert_no_js_errors()

    def test_pending_publish_and_upload_lock_editor_and_task_selection(self):
        page = self.ready()
        self.editor()
        page.locator('#name').fill('Pending publish name')
        page.evaluate("window.__mock.delayNext={table:'projects',op:'update',ms:1500}")
        self.publish()
        expect(page.locator('#form')).to_have_attribute('aria-busy','true')
        self.assertTrue(page.locator('#form').evaluate('(form)=>form.inert'))
        name_box=page.locator('#name').bounding_box()
        page.mouse.click(name_box['x']+20,name_box['y']+15)
        page.keyboard.type('Must not change pending data')
        expect(page.locator('#name')).to_have_value('Pending publish name')
        page.wait_for_function("document.getElementById('form').inert === false")
        expect(page.locator('#message')).to_contain_text('published', ignore_case=True)
        self.assertEqual(page.evaluate('window.__mock.projects.find(p=>p.id===1).name'),'Pending publish name')
        self.tab('guide')
        page.locator('#agTaskAdd').click()
        page.locator('#agTaskTabs button').first.click()
        expect(page.locator('#agTaskTitle')).to_have_value('Getting started')
        page.evaluate("window.__mock.delayNext={op:'upload',ms:1500}")
        page.locator('#guideImageFile').set_input_files(str(ROOT / 'airgem-logo.png'))
        expect(page.locator('#form')).to_have_attribute('aria-busy','true')
        self.assertTrue(page.locator('#form').evaluate('(form)=>form.inert'))
        task_box=page.locator('#agTaskTabs button').last.bounding_box()
        page.mouse.click(task_box['x']+20,task_box['y']+15)
        expect(page.locator('#agTaskTitle')).to_have_value('Getting started')
        page.wait_for_function("document.getElementById('form').inert === false")
        expect(page.locator('#guideEditor img')).to_have_count(1)
        page.locator('#agTaskTabs button').last.click()
        expect(page.locator('#guideEditor img')).to_have_count(0)
        page.locator('#agTaskTabs button').first.click()
        expect(page.locator('#guideEditor img')).to_have_count(1)
        self.assert_no_js_errors()

    def test_silent_top_delete_denial_is_detected_before_success(self):
        page = self.ready()
        self.nav('top')
        baseline=page.evaluate('window.__mock.calls.length')
        page.evaluate('window.__mock.suppressDeletes=true')
        page.locator('#clearTrending').click()
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('does not match')
        expect(page.locator('#trendingMessage')).to_contain_text('Reload')
        expect(page.locator('#saveTrending')).to_be_disabled()
        self.assertEqual(len(page.evaluate('window.__mock.top')),2)
        writes=page.evaluate('(start)=>window.__mock.calls.slice(start).map(call=>call.op)',baseline)
        self.assertEqual(writes,['delete','select'])
        self.assert_no_js_errors()

    def test_post_write_top_read_failure_avoids_blind_rollback(self):
        page = self.ready()
        self.nav('top')
        page.locator('#trendingSelect').fill('Relay')
        page.locator('#trendingSearchResults').get_by_role('button',name='Relay',exact=True).click()
        baseline=page.evaluate('window.__mock.calls.length')
        page.evaluate("window.__mock.failNext={table:'site_trending_items',op:'select',message:'Verification read failed'}")
        page.locator('#saveTrending').click()
        expect(page.locator('#trendingMessage')).to_contain_text('Verification read failed')
        expect(page.locator('#trendingMessage')).to_contain_text('Reload')
        expect(page.locator('#saveTrending')).to_be_disabled()
        self.assertEqual(len(page.evaluate('window.__mock.top')),3)
        writes=page.evaluate('(start)=>window.__mock.calls.slice(start).map(call=>call.op)',baseline)
        self.assertEqual(writes,['delete','insert','select'])
        self.assert_no_js_errors()

    def test_initial_load_failure_is_distinct_from_empty_and_recovers(self):
        page = self.open(config={'failNext':{'table':'projects','op':'select','message':'Temporary read failure'}})
        expect(page.locator('#dashboard')).to_be_visible()
        expect(page.locator('#dataError')).to_contain_text('Temporary read failure')
        expect(page.locator('#list')).to_contain_text('Projects are unavailable')
        expect(page.locator('#list')).not_to_contain_text('Your projects start here')
        expect(page.locator('#agStatProjects')).to_have_text('—')
        page.reload(wait_until='networkidle')
        expect(page.locator('#agStatProjects')).to_have_text('6')
        expect(page.locator('#dataError')).to_be_hidden()
        expect(page.locator('#list')).to_contain_text('Axis Robotics')
        self.assert_no_js_errors()

    def test_empty_guide_record_stays_empty_after_basic_edit(self):
        page = self.ready()
        self.editor('Arcus')
        page.locator('#name').fill('Arcus updated')
        self.publish()
        expect(page.locator('#message')).to_contain_text('published', ignore_case=True)
        self.assertEqual(page.evaluate('window.__mock.projects.find(p=>p.id===2).guide'),[])
        self.assert_no_js_errors()

    def test_editor_keyboard_tabs_and_hidden_field_validation(self):
        page = self.ready()
        self.editor()
        page.locator('[data-editor-tab=basic]').focus()
        page.keyboard.press('ArrowRight')
        expect(page.locator('[data-editor-tab=details]')).to_be_focused()
        expect(page.locator('[data-editor-panel=details]')).to_be_visible()
        page.keyboard.press('End')
        expect(page.locator('[data-editor-tab=guide]')).to_be_focused()
        page.keyboard.press('Home')
        expect(page.locator('[data-editor-tab=basic]')).to_be_focused()
        page.keyboard.press('ArrowLeft')
        expect(page.locator('[data-editor-tab=guide]')).to_be_focused()
        self.tab('basic')
        page.locator('#name').fill('')
        self.tab('links')
        page.locator('#linkWebsite').fill('invalid-url')
        self.tab('details')
        self.publish()
        expect(page.locator('[data-editor-panel=basic]')).to_be_visible()
        expect(page.locator('#name')).to_be_focused()
        page.locator('#name').fill('Axis Robotics')
        self.tab('details')
        self.publish()
        expect(page.locator('[data-editor-panel=links]')).to_be_visible()
        expect(page.locator('#linkWebsite')).to_be_focused()
        self.assertFalse(page.evaluate("window.__mock.calls.some(call=>call.table==='projects' && call.op==='update')"))
        self.assert_no_js_errors()

    def test_mobile_navigation_traps_focus_and_returns_it(self):
        page = self.ready(width=390,height=844)
        self.assertTrue(page.locator('#sidebar').evaluate('(el)=>el.inert'))
        page.locator('#mobileMenu').click()
        expect(page.locator('#sidebar')).to_have_attribute('aria-modal','true')
        expect(page.locator('[data-nav=dashboard]')).to_be_focused()
        self.assertTrue(page.locator('.app-shell').evaluate('(el)=>el.inert'))
        controls=page.locator('#sidebar a[href], #sidebar button:not([disabled])')
        controls.first.focus()
        page.keyboard.press('Shift+Tab')
        expect(controls.last).to_be_focused()
        page.keyboard.press('Tab')
        expect(controls.first).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#mobileMenu')).to_be_focused()
        self.assertFalse(page.locator('.app-shell').evaluate('(el)=>el.inert'))
        self.assertTrue(page.locator('#sidebar').evaluate('(el)=>el.inert'))
        page.locator('#mobileMenu').click()
        self.nav('projects')
        expect(page.locator('#pageTitle')).to_have_text('Projects')
        expect(page.locator('#mobileMenu')).to_have_attribute('aria-expanded','false')
        self.assert_no_js_errors()

    def test_unsaved_editor_and_top_changes_require_explicit_discard(self):
        page = self.ready()
        page.remove_listener('dialog',self.dialog_handler)
        self.editor()
        page.locator('#name').fill('Unpublished name')
        page.once('dialog',lambda dialog:dialog.dismiss())
        self.nav('projects')
        expect(page.locator('#editorView')).to_be_visible()
        expect(page.locator('#name')).to_have_value('Unpublished name')
        page.once('dialog',lambda dialog:dialog.accept())
        self.nav('projects')
        expect(page.locator('#projectsView')).to_be_visible()
        self.assertEqual(page.evaluate('window.__mock.projects.find(p=>p.id===1).name'),'Axis Robotics')
        self.nav('top')
        page.locator('#trendingSelect').fill('Relay')
        page.locator('#trendingSearchResults').get_by_role('button',name='Relay',exact=True).click()
        page.once('dialog',lambda dialog:dialog.dismiss())
        self.nav('dashboard')
        expect(page.locator('#trendingManager')).to_be_visible()
        expect(page.locator('#trendingCurrent')).to_contain_text('Relay')
        page.once('dialog',lambda dialog:dialog.accept())
        self.nav('dashboard')
        self.nav('top')
        expect(page.locator('#trendingCurrent')).not_to_contain_text('Relay')
        self.assertEqual(len(page.evaluate('window.__mock.top')),2)
        self.assert_no_js_errors()

    def test_mfa_enrollment_cancel_clears_setup_and_enrollment_can_complete(self):
        page = self.ready(config={'noFactors':True})
        self.nav('settings')
        page.locator('#mfaSetup').click()
        expect(page.locator('#mfaBox')).to_be_visible()
        expect(page.locator('#dashboard')).to_be_hidden()
        expect(page.locator('#mfaSecret')).to_contain_text('Manual setup key')
        page.locator('#mfaCancel').click()
        expect(page.locator('#dashboard')).to_be_visible()
        expect(page.locator('#mfaSecret')).to_be_empty()
        expect(page.locator('#mfaQr')).to_be_hidden()
        self.assertTrue(page.evaluate("window.__mock.calls.some(call=>call.op==='mfa-unenroll')"))
        self.nav('settings')
        page.locator('#mfaSetup').click()
        page.locator('#mfaCode').fill('123456')
        page.locator('#mfaForm button[type=submit]').click()
        expect(page.locator('#dashboard')).to_be_visible()
        self.nav('settings')
        expect(page.locator('#mfaSetup')).to_be_hidden()
        expect(page.locator('#mfaStatus')).to_contain_text('enabled')
        self.assert_no_js_errors()

    def test_desktop_and_mobile_no_page_overflow(self):
        for width in [1536,1024,768,390,320]:
            with self.subTest(width=width):
                page=self.ready(width=width,height=1024 if width>768 else 844)
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
                if width>=768:
                    self.editor()
                else:
                    page.locator('[data-action=add]').click()
                for name in ['basic','details','links','investors','guide']:
                    self.tab(name)
                    self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
                self.assert_no_js_errors()
                self.context.close()


if __name__=='__main__':
    unittest.main(verbosity=2)
