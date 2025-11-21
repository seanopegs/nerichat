from playwright.sync_api import sync_playwright

def verify_mobile_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a mobile viewport
        context = browser.new_context(
            viewport={'width': 375, 'height': 667},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
        )
        page = context.new_page()

        # 1. Login
        page.goto("http://localhost:3000/")
        page.fill("input#username", "mobile_user")
        page.fill("input#password", "password123") # Assuming basic auth logic for testing or register
        # Check if login or register is needed.
        # Looking at index.html (implied), let's assume login works if user exists, or register if not.
        # Let's try to click "Login" button.
        page.click("button#loginBtn")

        # Wait for chat app to load
        page.wait_for_selector(".app-container")

        # 2. Verify Sidebar is visible and Chat Area is hidden initially on mobile
        sidebar = page.locator(".sidebar")
        chat_area = page.locator(".chat-area")

        # Sidebar should be visible (x=0)
        # Chat area should be hidden (x=100%)
        # It's hard to check exact transform in Playwright easily without eval, but we can check visibility or take screenshot.

        page.screenshot(path="verification/1_mobile_sidebar.png")
        print("Screenshot 1 taken: Sidebar view")

        # 3. Open a group/chat
        # We need to make sure there is a group.
        # Create a group if none exists.
        if page.locator(".group-item").count() == 0:
            page.click("#createGroupBtn")
            page.fill("#groupNameInput", "Mobile Test Group")
            page.click("#submitCreateGroup")
            page.wait_for_selector(".group-item", state="visible")

        # Click the first group
        page.click(".group-item >> nth=0")

        # 4. Verify Chat Area slides in
        # Wait for transition
        page.wait_for_timeout(500)

        # Chat area should now be active (class active)
        if "active" in chat_area.get_attribute("class"):
            print("Chat area has active class")
        else:
            print("Chat area MISSING active class")

        page.screenshot(path="verification/2_mobile_chat_open.png")
        print("Screenshot 2 taken: Chat open view")

        # 5. Click Back Button
        # Check if back button is visible
        back_btn = page.locator("#mobileBackBtn")
        if back_btn.is_visible():
            print("Back button is visible")
        else:
            print("Back button is NOT visible")

        back_btn.click()
        page.wait_for_timeout(500)

        # 6. Verify Sidebar is back
        if "active" not in chat_area.get_attribute("class"):
             print("Chat area active class removed")
        else:
             print("Chat area STILL has active class")

        page.screenshot(path="verification/3_mobile_back_to_list.png")
        print("Screenshot 3 taken: Back to list")

        browser.close()

if __name__ == "__main__":
    verify_mobile_ui()
