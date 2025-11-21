from playwright.sync_api import sync_playwright

def verify_responsive_design():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Mobile Viewport
        context = browser.new_context(
            viewport={'width': 375, 'height': 667},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
        )
        page = context.new_page()

        try:
            # 1. Verify Login Page Responsiveness
            print("Navigating to Login Page...")
            page.goto("http://localhost:25577/")
            page.wait_for_selector(".auth-container")

            # Get width of auth container
            box = page.locator(".auth-container").bounding_box()
            viewport_width = page.viewport_size['width']

            print(f"Auth Container Width: {box['width']}")
            print(f"Viewport Width: {viewport_width}")

            # It should be roughly 90% of 375 = ~337.5
            if box['width'] > 300:
                print("PASS: Auth container is responsive (wide enough).")
            else:
                print("FAIL: Auth container is too narrow.")

            page.screenshot(path="verification/mobile_login.png")

            # 2. Login to verify Chat App Responsiveness
            print("Logging in...")
            page.fill("input[name='username']", "mobile_user")
            page.fill("input[name='password']", "password123")
            page.click("button[type='submit']")

            # Handle register if login fails (first run)
            try:
                page.wait_for_selector(".app-container", timeout=2000)
            except:
                print("Login failed (maybe user doesn't exist?), trying Register...")
                page.click("#showRegister")
                page.fill("input[name='regUsername']", "mobile_user")
                page.fill("input[name='regDisplayName']", "Mobile User")
                page.fill("input[name='regPassword']", "password123")
                page.click("#registerForm button[type='submit']")
                page.wait_for_selector(".app-container")

            print("Logged in. Verifying Chat UI...")

            # 3. Verify Chat UI Mobile State
            sidebar = page.locator(".sidebar")
            chat_area = page.locator(".chat-area")

            # Check Sidebar Visibility (it should be visible)
            # Check Chat Area Visibility (it should be hidden off-screen)

            # We can check bounding box x position
            chat_box = chat_area.bounding_box()
            print(f"Chat Area X: {chat_box['x']}")

            if chat_box['x'] >= viewport_width:
                print("PASS: Chat area is hidden off-screen initially.")
            else:
                print(f"FAIL: Chat area is visible (x={chat_box['x']}).")

            page.screenshot(path="verification/mobile_chat_list.png")

            # 4. Open Chat
            # Ensure a group exists
            if page.locator(".group-item").count() == 0:
                page.click("#createGroupBtn")
                page.fill("#groupNameInput", "Test Group")
                page.click("#submitCreateGroup")
                page.wait_for_selector(".group-item")

            page.click(".group-item >> nth=0")
            page.wait_for_timeout(500) # Animation

            chat_box = chat_area.bounding_box()
            print(f"Chat Area X after click: {chat_box['x']}")

            if chat_box['x'] == 0:
                print("PASS: Chat area slid in.")
            else:
                print(f"FAIL: Chat area not at 0 (x={chat_box['x']}).")

            page.screenshot(path="verification/mobile_chat_open.png")

            # 5. Verify Back Button
            back_btn = page.locator("#mobileBackBtn")
            if back_btn.is_visible():
                 print("PASS: Back button is visible.")
            else:
                 print("FAIL: Back button is hidden.")

            back_btn.click()
            page.wait_for_timeout(500) # Animation

            chat_box = chat_area.bounding_box()
            if chat_box['x'] >= viewport_width:
                print("PASS: Chat area slid away after back button.")
            else:
                print("FAIL: Chat area still visible.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_responsive_design()
